/**
 * LeadOS routes: Clients (WhatsApp business profiles) and Meta inventory.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerClientsRoutes(app, ctx) {
const {
  Clients,
  DEFAULT_TENANT_ID,
  Jimp,
  Leads,
  META_GRAPH_VERSION,
  META_PROFILE_FIELDS,
  MetaWhatsappAccounts,
  MetaWhatsappPhoneNumbers,
  MetaWhatsappSyncRuns,
  MetaWhatsappTemplates,
  NO_ID,
  assertPhoneBelongsToWaba,
  auth,
  axios,
  cacheMetaBusinessProfile,
  clientsWhatsAppStatusReady,
  deleteCascade,
  graphPageData,
  metaInventoryReady,
  normalizedPhoneDigits,
  parsePhoneNumberFromString,
  profileLogoUpload,
  resolveClientMetaConfig,
  syncMetaWhatsAppInventory,
  updateKeyCascade,
  updateWhatsAppBusinessProfile,
  verifyClientWhatsApp,
} = ctx;
// ══════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════
app.get('/api/meta/embedded-signup/config', auth, (req, res) => {
  const appId = process.env.META_APP_ID || '';
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '';
  res.json({ enabled: Boolean(appId && configId), app_id: appId, config_id: configId,
    waba_id: process.env.WA_BUSINESS_ACCOUNT_ID || '', graph_version: META_GRAPH_VERSION });
});

app.post('/api/clients/:id/meta-embedded-signup/complete', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const { waba_id: wabaId, phone_number_id: phoneId, expected_whatsapp_number: expectedNumber,
      name, wa_category: waCategory, wa_description: waDescription } = req.body;
    if (!wabaId || !phoneId) return res.status(400).json({ error: 'Meta did not return a WABA ID and Phone Number ID' });
    const configuredWaba = process.env.WA_BUSINESS_ACCOUNT_ID;
    if (configuredWaba && String(wabaId) !== String(configuredWaba)) {
      return res.status(400).json({ error: `Select WABA ${configuredWaba} in Meta Embedded Signup` });
    }
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: 'META_PAGE_ACCESS_TOKEN is not configured' });
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const phones = await graphPageData(`${base}/${wabaId}/phone_numbers`, token, {
      fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status'
    });
    const phone = phones.find(item => String(item.id) === String(phoneId));
    if (!phone) return res.status(400).json({ error: 'The new phone number is not accessible under the selected WABA' });
    if (expectedNumber && normalizedPhoneDigits(phone.display_phone_number) !== normalizedPhoneDigits(expectedNumber)) {
      return res.status(400).json({ error: 'The number verified in Meta does not match the number entered in LeadOS' });
    }
    const duplicate = await Clients.findOne({ phone_number_id: phoneId, id: { $ne: Number(req.params.id) } }, { id: 1, name: 1 }).lean();
    if (duplicate) return res.status(409).json({ error: `This phone is already assigned to ${duplicate.name}` });
    const connected = String(phone.status || '').toUpperCase() === 'CONNECTED';
    const previousClient = await Clients.findOne({ id: req.params.id }, { name: 1 }).lean();
    const clientChanges = {
      wa_business_id: wabaId, phone_number_id: phoneId, whatsapp_number: normalizedPhoneDigits(phone.display_phone_number),
      whatsapp_status: connected ? 'verified' : 'verification_pending', whatsapp_verified_at: connected ? new Date() : null,
      wa_description: waDescription || null, whatsapp_verification_error: null, updated_at: new Date(),
    };
    if (String(name ?? '').trim()) clientChanges.name = name;
    if (waCategory) clientChanges.wa_category = waCategory;
    const updatedClient = await Clients.findOneAndUpdate({ id: req.params.id }, { $set: clientChanges }, { new: true, projection: NO_ID }).lean();
    const updated = { rows: updatedClient ? [updatedClient] : [] };
    if (!updated.rows.length) return res.status(404).json({ error: 'Client not found' });
    if (previousClient && clientChanges.name) await updateKeyCascade('clients', 'name', previousClient.name, clientChanges.name);
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phoneId }, { $set: { client_id: Number(req.params.id) } });
    let profileSynced = false;
    try {
      await updateWhatsAppBusinessProfile(updated.rows[0]);
      profileSynced = true;
    } catch (profileError) {
      console.warn(`[Clients] New Meta phone mapped but profile sync is pending for client ${req.params.id}:`, profileError.response?.data?.error?.message || profileError.message);
    }
    res.json({ success: true, client: updated.rows[0], meta_phone: phone, profile_synced: profileSynced });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Embedded Signup completion failed';
    console.error(`[Clients] Embedded Signup completion failed for client ${req.params.id}:`, message);
    res.status(400).json({ error: message });
  }
});

app.post('/api/clients/:id/meta-profile-logo', auth, profileLogoUpload.single('logo'), async (req, res) => {
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
    const config = await assertPhoneBelongsToWaba(client);
    const duplicatePhone = await Clients.findOne({ phone_number_id: config.phoneId, id: { $ne: client.id } }, { id: 1, name: 1 }).lean();
    if (duplicatePhone) {
      return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.name}` });
    }

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

app.get('/api/meta/whatsapp/inventory', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const [accounts, phoneRows, templates, lastRun, inventoryClients] = await Promise.all([
      MetaWhatsappAccounts.find({}, NO_ID).sort({ name: 1 }).lean(),
      MetaWhatsappPhoneNumbers.find({}, NO_ID).lean(),
      MetaWhatsappTemplates.find({}, { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, status: 1, category: 1, components: 1, last_synced_at: 1 }).sort({ name: 1, language: 1 }).lean(),
      MetaWhatsappSyncRuns.findOne({}, NO_ID).sort({ id: -1 }).lean(),
      Clients.find({}, { id: 1, name: 1 }).lean(),
    ]);
    const accountNames = new Map(accounts.map((a) => [a.waba_id, a.name]));
    const clientNames = new Map(inventoryClients.map((c) => [c.id, c.name]));
    const wabas = accounts.map((a) => ({ ...a, phone_count: phoneRows.filter((p) => p.waba_id === a.waba_id).length }));
    const phones = phoneRows
      .filter((p) => accountNames.has(p.waba_id))
      .map((p) => ({ ...p, waba_name: accountNames.get(p.waba_id), client_name: clientNames.get(p.client_id) ?? null }))
      .sort((a, b) => (a.client_id == null ? -1 : 0) - (b.client_id == null ? -1 : 0)
        || (a.client_id ?? 0) - (b.client_id ?? 0)
        || String(a.verified_name || '').localeCompare(String(b.verified_name || '')));
    const summary = new Map();
    for (const t of templates) {
      const s = summary.get(t.waba_id) || { waba_id: t.waba_id, total: 0, approved: 0, other: 0 };
      s.total++;
      if (t.status === 'APPROVED') s.approved++; else if (t.status != null) s.other++;
      summary.set(t.waba_id, s);
    }
    res.json({ wabas, phone_numbers: phones, templates, template_summary: [...summary.values()], last_sync: lastRun || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/meta/whatsapp/sync', auth, async (req, res) => {
  try { res.json({ success: true, ...(await syncMetaWhatsAppInventory()) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/meta/whatsapp/cache/wabas/:wabaId', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const account = await MetaWhatsappAccounts.findOne({ waba_id: req.params.wabaId }, { _id: 0, waba_id: 1, name: 1 }).lean();
    if (!account) {
      return res.status(404).json({ error: 'Cached WABA not found' });
    }
    const mappedPhones = await MetaWhatsappPhoneNumbers.find({ waba_id: req.params.wabaId, client_id: { $ne: null } }, { client_id: 1 }).lean();
    const mappedClient = mappedPhones.length
      ? await Clients.findOne({ id: { $in: mappedPhones.map((p) => p.client_id) } }, { name: 1 }).lean()
      : null;
    if (mappedClient) {
      return res.status(409).json({
        error: `Cannot clear this cache because a phone number is mapped to ${mappedClient.name}`
      });
    }
    await deleteCascade('meta_whatsapp_templates', { waba_id: req.params.wabaId });
    await deleteCascade('meta_whatsapp_accounts', { waba_id: req.params.wabaId });
    res.json({ success: true, waba_id: account.waba_id, name: account.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meta/whatsapp/phone-numbers/:phoneId/register', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit two-step verification PIN' });
    const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, { _id: 0, phone_number_id: 1, waba_id: 1 }).lean();
    if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
    const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: 'Meta system-user access token is not configured' });
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const currentPhones = await graphPageData(`${base}/${phone.waba_id}/phone_numbers`, token, { fields: 'id' });
    if (!currentPhones.some(item => String(item.id) === String(phone.phone_number_id))) {
      return res.status(409).json({ error: `Phone Number ID does not belong to WABA ${phone.waba_id}` });
    }
    await axios.post(`${base}/${phone.phone_number_id}/register`, {
      messaging_product: 'whatsapp', pin,
    }, { headers: { Authorization: `Bearer ${token}` } });
    await axios.post(`${base}/${phone.waba_id}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const syncResult = await syncMetaWhatsAppInventory();
    res.json({ success: true, phone_number_id: phone.phone_number_id, waba_id: phone.waba_id, ...syncResult });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Meta phone registration failed';
    console.error('[Meta Phone Registration]', message);
    res.status(400).json({ error: message });
  }
});

app.patch('/api/meta/whatsapp/phone-numbers/:phoneId/map', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { client_id } = req.body;
    const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, NO_ID).lean();
    if (!phone) return res.status(404).json({ error: 'Meta phone number not found' });
    if (client_id === null || client_id === undefined || client_id === '') {
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: req.params.phoneId }, { $set: { client_id: null } });
      return res.json({ success: true });
    }
    const clientId = Number(client_id);
    if (!(await Clients.exists({ id: clientId }))) return res.status(404).json({ error: 'Brand not found' });
    await MetaWhatsappPhoneNumbers.updateMany({ client_id: clientId }, { $set: { client_id: null } });
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: clientId } });
    const metaVerified = String(phone.connection_status || '').toUpperCase() === 'CONNECTED' || String(phone.verification_status || '').toUpperCase() === 'VERIFIED';
    await Clients.updateOne({ id: clientId }, { $set: {
      wa_business_id: phone.waba_id, phone_number_id: phone.phone_number_id, whatsapp_number: phone.display_phone_number,
      whatsapp_status: metaVerified ? 'verified' : 'verification_pending', whatsapp_verified_at: metaVerified ? new Date() : null,
      whatsapp_verification_error: null, updated_at: new Date(),
    } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/clients', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { tenant_id } = req.query;
    const clientRows = await Clients.find(tenant_id ? { tenant_id: Number(tenant_id) } : {}, NO_ID).sort({ created_at: -1 }).lean();
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
          ...c,
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

app.post('/api/clients', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const { name, wa_category, wa_description, wa_address, wa_email, wa_website, tenant_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Business name is required' });
    const created = await Clients.create({
      name: name.trim(), wa_category: wa_category || 'OTHER', wa_description: wa_description || null, wa_address: wa_address || null,
      wa_email: wa_email || null, wa_website: wa_website || null, status: 'active', whatsapp_status: 'not_configured',
      tenant_id: tenant_id || DEFAULT_TENANT_ID, created_at: new Date(),
    });
    res.status(201).json({ client: created.toObject() });
  } catch (err) {
    console.error('[Clients] POST /api/clients failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/clients/:id', auth, async (req, res) => {
  try {
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

    const allowed = ['name', 'phone_number_id', 'wa_access_token',
      'wa_business_id', 'whatsapp_number', 'wa_category', 'wa_description', 'wa_address', 'wa_email',
      'wa_website', 'status'];
    const entries = allowed.filter(field => req.body[field] !== undefined).map(field => [field, req.body[field]]);
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }
    if (!entries.length) return res.json({ success: true, client: existing });

    const credentialFields = ['phone_number_id', 'wa_access_token', 'wa_business_id', 'whatsapp_number'];
    const credentialsChanged = credentialFields.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    const next = { ...existing, ...Object.fromEntries(entries) };
    const nextMetaConfig = resolveClientMetaConfig(next);
    const metaProfileChanged = META_PROFILE_FIELDS.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    let metaProfile = null;
    if (metaProfileChanged && nextMetaConfig.phoneId) {
      try {
        const duplicatePhone = await Clients.findOne({ phone_number_id: nextMetaConfig.phoneId, id: { $ne: Number(req.params.id) } }, { id: 1, name: 1 }).lean();
        if (duplicatePhone) {
          return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.name}` });
        }
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
    res.json({
      success: true,
      client: updatedClient,
      meta_profile_synced: Boolean(metaProfile),
      meta_profile_pending: metaProfileChanged && !nextMetaConfig.phoneId,
      meta_profile: metaProfile
    });
  } catch (err) {
    console.error(`[Clients] PATCH /api/clients/${req.params.id} failed:`, err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const client = await Clients.findOne({ id }, NO_ID).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Deregister from Meta WhatsApp Cloud API
    if (client.phone_number_id && client.wa_access_token) {
      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${client.phone_number_id}/deregister`,
          {},
          { headers: { Authorization: `Bearer ${client.wa_access_token}` } }
        );
        console.log(`[Meta] Successfully deregistered phone_number_id: ${client.phone_number_id}`);
      } catch (metaErr) {
        // Log but do not block local DB deletion
        console.warn(`[Meta] Deregistration failed for client ${id}:`, metaErr.response?.data || metaErr.message);
      }
    }

    await deleteCascade('clients', { id: client.id });

    res.json({ success: true, message: 'Client deleted and deregistered successfully' });
  } catch (err) {
    console.error(`[Delete Client API] Error deleting client ${req.params.id}:`, err);
    res.status(500).json({ error: 'Server error during deletion' });
  }
});

// POST /api/clients/:id/whatsapp-setup
app.post('/api/clients/:id/whatsapp-setup', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const client = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const verified = await verifyClientWhatsApp(client);
    res.json({ success: true, message: 'WhatsApp verified and enabled successfully', client: verified });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message || 'WhatsApp verification failed';
    console.error('[WhatsApp Verification]', err.response?.data || err);
    res.status(err.status || 400).json({ error: message });
  }
});
};
