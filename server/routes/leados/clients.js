/**
 * LeadOS routes: Clients (WhatsApp business profiles) and Embedded Signup.
 * Shared helpers live in server.js and arrive through `ctx`. Customer responses
 * are always sanitised; changes need tenant.settings / whatsapp.manage.
 */
const { assertPhoneNumberAvailable } = require('../../services/whatsappIdentity');
const { sanitizeClient } = require('../../services/clientSecrets');
const { requirePermission, can } = require('../../services/permissions');
const audit = require('../../services/audit');
const { normalizeWebsite } = require('../../utils/website');

// 409 for a number already connected to another brand or workspace.
const sendPhoneInUse = (res, error) => res.status(409).json({ error: error.message, code: error.code });

// A workspace's brand is created when the workspace is provisioned and is
// removed only with the workspace's data; customers cannot create or delete one.
const BRAND_MANAGED_BY_PLATFORM = {
  error: 'Your brand profile is created with your workspace and cannot be added or removed here. Contact support for changes.',
  code: 'BRAND_MANAGED_BY_PLATFORM',
};

// Fields that change how the brand sends on WhatsApp (owner/admin, whatsapp.manage).
const WHATSAPP_CREDENTIAL_FIELDS = ['phone_number_id', 'wa_access_token', 'wa_business_id', 'whatsapp_number'];

module.exports = function registerClientsRoutes(app, ctx) {
const {
  Clients,
  Jimp,
  Leads,
  META_GRAPH_VERSION,
  META_PROFILE_FIELDS,
  MetaWhatsappPhoneNumbers,
  NO_ID,
  assertPhoneBelongsToWaba,
  auth,
  axios,
  cacheMetaBusinessProfile,
  clientsWhatsAppStatusReady,
  metaInventoryReady,
  parsePhoneNumberFromString,
  profileLogoUpload,
  resolveClientMetaConfig,
  updateKeyCascade,
  updateWhatsAppBusinessProfile,
  verifyClientWhatsApp,
} = ctx;
// ══════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════
// Embedded Signup is paused until the secure, customer-owned flow (Task 1B)
// exists. The legacy completion verified the customer's account with the
// platform's own Meta token, which must not be used; the config therefore
// reports signup as unavailable so the app never starts it, and the
// completion route refuses without calling Meta or changing anything.
const SECURE_SIGNUP_PENDING = {
  error: 'WhatsApp connection is temporarily unavailable while secure account connection is being set up.',
  code: 'SECURE_SIGNUP_PENDING',
};

app.get('/api/meta/embedded-signup/config', auth, (req, res) => {
  res.json({ enabled: false, reason: SECURE_SIGNUP_PENDING.code, message: SECURE_SIGNUP_PENDING.error });
});

app.post('/api/clients/:id/meta-embedded-signup/complete', auth, requirePermission('whatsapp.manage'), (req, res) => {
  res.status(503).json(SECURE_SIGNUP_PENDING);
});

app.post('/api/clients/:id/meta-profile-logo', auth, requirePermission('whatsapp.manage'), profileLogoUpload.single('logo'), async (req, res) => {
  try {
    await metaInventoryReady;
    if (!req.file) return res.status(400).json({ error: 'Select a JPEG or PNG logo image' });
    if (!process.env.META_APP_ID) {
      return res.status(503).json({ error: 'META_APP_ID is required in server/.env to upload a Meta profile logo' });
    }
    const client = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.phone_number_id) {
      return res.status(400).json({ error: 'Add this brand’s real Meta Phone Number ID before uploading its profile logo' });
    }
    try {
      await assertPhoneNumberAvailable(client.phone_number_id, { exceptClientId: client.id });
    } catch (inUse) {
      if (inUse.code === 'PHONE_NUMBER_IN_USE') return sendPhoneInUse(res, inUse);
      throw inUse;
    }
    const config = await assertPhoneBelongsToWaba(client);

    const image = await Jimp.read(req.file.buffer);
    const logoBuffer = await image.cover(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const sessionResponse = await axios.post(`${base}/${process.env.META_APP_ID}/uploads`, null, {
      params: { file_name: `client-${client.id}-logo.jpg`, file_length: logoBuffer.length, file_type: 'image/jpeg' },
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const uploadId = sessionResponse.data?.id;
    if (!uploadId) throw new Error('Meta did not return an upload session ID');
    const uploadResponse = await axios.post(`${base}/${uploadId}`, logoBuffer, {
      headers: { Authorization: `Bearer ${config.token}`, file_offset: '0', 'Content-Type': 'image/jpeg' },
      maxBodyLength: 6 * 1024 * 1024
    });
    const handle = uploadResponse.data?.h;
    if (!handle) throw new Error('Meta did not return a profile-picture handle');
    await axios.post(`${base}/${config.phoneId}/whatsapp_business_profile`, {
      messaging_product: 'whatsapp', profile_picture_handle: handle
    }, { headers: { Authorization: `Bearer ${config.token}` } });
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: config.phoneId }, { $set: { client_id: client.id } });
    const profile = await cacheMetaBusinessProfile(config.phoneId, config.token);
    res.json({ success: true, profile_picture_url: profile.profile_picture_url || null });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Meta logo upload failed';
    console.error(`[Clients] Meta logo upload failed for client ${req.params.id}:`, message);
    res.status(400).json({ error: `Meta logo upload failed: ${message}` });
  }
});

// The platform Meta inventory (view, sync, cache, registration, link/unlink)
// is staff-only: routes/adminMetaInventory.js under /api/admin/meta/whatsapp.
// Customers connect their own WhatsApp account through Embedded Signup above.

app.get('/api/clients', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    // The caller's own workspace only (tenant scope); no request-chosen tenant.
    const clientRows = await Clients.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const clientIds = clientRows.map((c) => c.id);
    const [metaPhones, leadCounts] = await Promise.all([
      MetaWhatsappPhoneNumbers.find({ client_id: { $in: clientIds } }, NO_ID).lean(),
      Leads.aggregate([
        { $match: { client_id: { $in: clientIds } } },
        { $group: { _id: '$client_id', lead_count: { $sum: 1 }, converted_count: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
      ]),
    ]);
    const countsByClient = new Map(leadCounts.map((c) => [c._id, c]));
    const rows = [];
    for (const c of clientRows) {
      const phonesForClient = metaPhones.filter((p) => p.client_id === c.id);
      for (const metaPhone of phonesForClient.length ? phonesForClient : [null]) {
        rows.push({
          ...sanitizeClient(c),
          meta_profile_picture_url: metaPhone?.profile_picture_url ?? null,
          meta_verified_name: metaPhone?.verified_name ?? null,
          meta_profile_about: metaPhone?.profile_about ?? null,
          meta_profile_address: metaPhone?.profile_address ?? c.wa_address ?? null,
          meta_profile_description: metaPhone?.profile_description ?? c.wa_description ?? null,
          meta_profile_email: metaPhone?.profile_email ?? c.wa_email ?? null,
          meta_profile_websites: metaPhone?.profile_websites ?? (c.wa_website != null ? [c.wa_website] : null),
          meta_profile_vertical: metaPhone?.profile_vertical ?? c.wa_category ?? null,
          meta_quality_rating: metaPhone?.quality_rating ?? null,
          meta_connection_status: metaPhone?.connection_status ?? null,
          lead_count: countsByClient.get(c.id)?.lead_count || 0,
          converted_count: countsByClient.get(c.id)?.converted_count || 0,
        });
      }
    }
    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/clients', auth, (req, res) => res.status(403).json(BRAND_MANAGED_BY_PLATFORM));

// Brand profile changes need tenant.settings; WhatsApp credential fields also
// need whatsapp.manage. Both are checked before anything is read or sent.
app.patch('/api/clients/:id', auth, requirePermission('tenant.settings'), async (req, res) => {
  try {
    const credentialChange = WHATSAPP_CREDENTIAL_FIELDS.some((field) => req.body[field] !== undefined);
    if (credentialChange && !can(req.identity, 'whatsapp.manage')) {
      return res.status(403).json({ error: 'You do not have permission to do this', permission: 'whatsapp.manage' });
    }
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    if (req.body.whatsapp_number !== undefined && String(req.body.whatsapp_number).trim()) {
      const rawPhone = String(req.body.whatsapp_number).trim();
      const parsedPhone = parsePhoneNumberFromString(rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`);
      if (!/^\+?[\d\s().-]+$/.test(rawPhone) || !parsedPhone?.isValid()) {
        return res.status(400).json({ error: 'Enter a valid WhatsApp number with country calling code, for example +91 98765 43210' });
      }
      req.body.whatsapp_number = parsedPhone.number.slice(1);
    }
    const existing = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!existing) return res.status(404).json({ error: 'Client not found' });
    // A changed website must be a real http(s) URL; an unchanged legacy value
    // is left as it is so it never blocks saving other fields.
    if (req.body.wa_website !== undefined && String(req.body.wa_website ?? '') !== String(existing.wa_website ?? '')) {
      const website = normalizeWebsite(req.body.wa_website);
      if (!website.ok) return res.status(400).json({ error: 'Enter a valid website, for example https://example.com', code: 'INVALID_WEBSITE' });
      req.body.wa_website = website.value ?? '';
    }

    const allowed = ['name', 'phone_number_id', 'wa_access_token',
      'wa_business_id', 'whatsapp_number', 'wa_category', 'wa_description', 'wa_address', 'wa_email',
      'wa_website', 'status'];
    const entries = allowed.filter(field => req.body[field] !== undefined).map(field => [field, req.body[field]]);
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }
    if (!entries.length) return res.json({ success: true, client: sanitizeClient(existing) });

    // A number already connected to another brand is refused before anything
    // is written or sent to Meta.
    const nextPhoneId = req.body.phone_number_id !== undefined ? req.body.phone_number_id : existing.phone_number_id;
    if (req.body.phone_number_id !== undefined || META_PROFILE_FIELDS.some((field) => req.body[field] !== undefined)) {
      try {
        await assertPhoneNumberAvailable(nextPhoneId, { exceptClientId: existing.id });
      } catch (inUse) {
        if (inUse.code === 'PHONE_NUMBER_IN_USE') return sendPhoneInUse(res, inUse);
        throw inUse;
      }
    }

    const credentialsChanged = WHATSAPP_CREDENTIAL_FIELDS.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    const next = { ...existing, ...Object.fromEntries(entries) };
    const nextMetaConfig = resolveClientMetaConfig(next);
    const metaProfileChanged = META_PROFILE_FIELDS.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    // The WhatsApp business profile is synced to Meta only when the brand has
    // its own complete connection (number, WABA and token). Otherwise the
    // profile is saved here and the Meta sync is reported as pending; a
    // profile edit never needs a Meta call the brand cannot make.
    const canSyncMeta = Boolean(nextMetaConfig.phoneId && nextMetaConfig.wabaId && nextMetaConfig.token);
    let metaPendingReason = null;
    if (metaProfileChanged && !canSyncMeta) {
      if (!nextMetaConfig.phoneId) metaPendingReason = 'WHATSAPP_NOT_CONNECTED';
      else if (!nextMetaConfig.token) metaPendingReason = 'WHATSAPP_CREDENTIAL_MISSING';
      else metaPendingReason = 'WHATSAPP_ACCOUNT_ID_MISSING';
    }
    let metaProfile = null;
    if (metaProfileChanged && canSyncMeta) {
      try {
        const metaResult = await updateWhatsAppBusinessProfile(next);
        metaProfile = metaResult.profile;
      } catch (metaError) {
        const message = metaError.response?.data?.error?.message || metaError.message || 'Meta profile update failed';
        console.error(`[Clients] Meta profile update failed for client ${req.params.id}:`, message);
        return res.status(400).json({ error: `Meta profile update failed: ${message}` });
      }
    }
    const hasRequiredCredentials = nextMetaConfig.phoneId && nextMetaConfig.token && next.whatsapp_number;
    if (credentialsChanged) {
      entries.push(['whatsapp_status', hasRequiredCredentials ? 'verification_pending' : 'not_configured']);
      entries.push(['whatsapp_verified_at', null]);
      entries.push(['whatsapp_verification_error', null]);
    }
    const clientChanges = Object.fromEntries(entries.map(([field, value]) => [field, value === '' ? null : value]));
    const updatedClient = await Clients.findOneAndUpdate(
      { id: req.params.id },
      { $set: { ...clientChanges, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    if (clientChanges.name !== undefined && clientChanges.name !== existing.name) {
      await updateKeyCascade('clients', 'name', existing.name, clientChanges.name);
    }
    const changedFields = entries.map(([field]) => field).filter((field) => field !== 'wa_access_token');
    await audit.record(clientChanges.wa_access_token !== undefined ? audit.EVENTS.TOKEN_UPDATED : audit.EVENTS.BRAND_UPDATED, {
      tenantId: req.identity.tenantId, req, targetType: 'client', targetId: existing.id,
      meta: { fields: changedFields, token_updated: clientChanges.wa_access_token !== undefined, meta_profile_synced: Boolean(metaProfile) },
    });
    res.json({
      success: true,
      client: sanitizeClient(updatedClient),
      meta_profile_synced: Boolean(metaProfile),
      meta_profile_pending: Boolean(metaPendingReason),
      meta_profile_pending_reason: metaPendingReason,
      meta_profile: metaProfile
    });
  } catch (err) {
    console.error(`[Clients] PATCH /api/clients/${req.params.id} failed:`, err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// Refused before anything is read, deregistered at Meta or deleted.
app.delete('/api/clients/:id', auth, (req, res) => res.status(403).json(BRAND_MANAGED_BY_PLATFORM));

// POST /api/clients/:id/whatsapp-setup
app.post('/api/clients/:id/whatsapp-setup', auth, requirePermission('whatsapp.manage'), async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const client = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const verified = await verifyClientWhatsApp(client);
    res.json({ success: true, message: 'WhatsApp verified and enabled successfully', client: sanitizeClient(verified) });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message || 'WhatsApp verification failed';
    console.error('[WhatsApp Verification]', err.response?.data || err);
    res.status(err.status || 400).json({ error: message });
  }
});
};
