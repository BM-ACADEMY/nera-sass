/**
 * Platform admin: client brand management and the platform Meta WhatsApp
 * inventory (/api/admin/clients, /api/admin/meta/whatsapp/*).
 *
 * The same features the LeadOS app has in routes/leados/clients.js, for
 * platform staff. Mounted inside the admin router, so every request already
 * runs in the system context. Changes to a brand are written through
 * runAsTenant(brand.tenant_id); workspaces themselves are never created or
 * changed here (that stays in POST /api/admin/tenants).
 *
 * `leados()` returns the LeadOS route context from server.js (Meta helpers),
 * read lazily because it is defined after the admin router is mounted.
 */
const { Clients, Tenants } = require('../models');
const { runAsTenant } = require('../services/tenantContext');
const { sanitizeClient } = require('../services/clientSecrets');
const { escapeRegex } = require('../db/mongo');
const audit = require('../services/audit');

const NO_ID = { _id: 0 };
const PROFILE_FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';
const EDITABLE_FIELDS = [
  'name', 'status', 'whatsapp_number', 'phone_number_id', 'wa_business_id',
  'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website',
  'city', 'phone', 'contact_person', 'industry',
];
const CREDENTIAL_FIELDS = ['phone_number_id', 'wa_business_id', 'whatsapp_number'];

const metaError = (error, fallback) => error.response?.data?.error?.message || error.message || fallback;

module.exports = function registerAdminClientRoutes(router, { permit, fail, leados }) {
  // ── Brands ────────────────────────────────────────────────
  router.get('/clients', permit('platform.tenants.view'), async (req, res) => {
    try {
      const { Leads, MetaWhatsappPhoneNumbers, metaInventoryReady } = leados();
      await metaInventoryReady;
      const filter = {};
      if (req.query.tenant_id) filter.tenant_id = Number(req.query.tenant_id);
      if (req.query.search) {
        const re = { $regex: escapeRegex(String(req.query.search)), $options: 'i' };
        filter.$or = [{ name: re }, { city: re }, { whatsapp_number: re }];
      }
      const clients = await Clients.find(filter, NO_ID).sort({ created_at: -1 }).limit(500).lean();
      const clientIds = clients.map((c) => c.id);
      const tenantIds = [...new Set(clients.map((c) => c.tenant_id).filter((id) => id != null))];
      const [tenants, metaPhones, leadCounts] = await Promise.all([
        Tenants.find({ id: { $in: tenantIds } }, { _id: 0, id: 1, name: 1, status: 1 }).lean(),
        MetaWhatsappPhoneNumbers.find({ client_id: { $in: clientIds } }, NO_ID).lean(),
        Leads.aggregate([
          { $match: { client_id: { $in: clientIds } } },
          { $group: { _id: '$client_id', lead_count: { $sum: 1 }, converted_count: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
        ]),
      ]);
      const tenantMap = new Map(tenants.map((t) => [t.id, t]));
      const phoneByClient = new Map(metaPhones.map((p) => [p.client_id, p]));
      const countsByClient = new Map(leadCounts.map((c) => [c._id, c]));
      return res.json({
        clients: clients.map((c) => {
          const metaPhone = phoneByClient.get(c.id);
          return {
            ...sanitizeClient(c),
            tenant_name: tenantMap.get(c.tenant_id)?.name || 'Unknown',
            tenant_status: tenantMap.get(c.tenant_id)?.status || 'active',
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
          };
        }),
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.patch('/clients/:id', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const {
        parsePhoneNumberFromString, resolveClientMetaConfig, updateWhatsAppBusinessProfile,
        updateKeyCascade, META_PROFILE_FIELDS, metaInventoryReady,
      } = leados();
      await metaInventoryReady;
      const body = { ...(req.body || {}) };
      const existing = await Clients.findOne({ id: Number(req.params.id) }, NO_ID).lean();
      if (!existing) return res.status(404).json({ error: 'Client not found' });

      if (body.whatsapp_number !== undefined && String(body.whatsapp_number).trim()) {
        const rawPhone = String(body.whatsapp_number).trim();
        const parsedPhone = parsePhoneNumberFromString(rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`);
        if (!/^\+?[\d\s().-]+$/.test(rawPhone) || !parsedPhone?.isValid()) {
          return res.status(400).json({ error: 'Enter a valid WhatsApp number with country calling code, for example +91 98765 43210' });
        }
        body.whatsapp_number = parsedPhone.number.slice(1);
      }
      if (body.name !== undefined && !String(body.name).trim()) {
        return res.status(400).json({ error: 'Business name is required' });
      }
      const changes = Object.fromEntries(EDITABLE_FIELDS
        .filter((field) => body[field] !== undefined)
        .map((field) => [field, body[field] === '' ? null : body[field]]));
      if (!Object.keys(changes).length) return res.json({ success: true, client: sanitizeClient(existing) });

      const changed = (field) => changes[field] !== undefined && String(changes[field] || '') !== String(existing[field] || '');
      if (changes.phone_number_id && changed('phone_number_id')) {
        const taken = await Clients.findOne({ phone_number_id: changes.phone_number_id, id: { $ne: existing.id } }, { id: 1, name: 1 }).lean();
        if (taken) return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${taken.name}` });
      }

      // Push the public business profile to Meta when it changed and the
      // brand already has a phone. A brand without one keeps it as a draft.
      const next = { ...existing, ...changes };
      const nextMetaConfig = resolveClientMetaConfig(next);
      const metaProfileChanged = META_PROFILE_FIELDS.some(changed);
      let metaProfile = null;
      if (metaProfileChanged && nextMetaConfig.phoneId) {
        try {
          metaProfile = (await updateWhatsAppBusinessProfile(next)).profile;
        } catch (error) {
          return res.status(400).json({ error: `Meta profile update failed: ${metaError(error, 'Meta profile update failed')}` });
        }
      }
      if (CREDENTIAL_FIELDS.some(changed)) {
        const ready = nextMetaConfig.phoneId && nextMetaConfig.token && next.whatsapp_number;
        Object.assign(changes, {
          whatsapp_status: ready ? 'verification_pending' : 'not_configured',
          whatsapp_verified_at: null,
          whatsapp_verification_error: null,
        });
      }

      const updated = await runAsTenant(existing.tenant_id, async () => {
        const row = await Clients.findOneAndUpdate(
          { id: existing.id },
          { $set: { ...changes, updated_at: new Date() } },
          { new: true, projection: NO_ID },
        ).lean();
        if (changes.name !== undefined && changes.name !== existing.name) {
          await updateKeyCascade('clients', 'name', existing.name, changes.name);
        }
        return row;
      });
      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId: existing.tenant_id, req, targetType: 'client', targetId: existing.id, meta: { fields: Object.keys(changes) },
      });
      return res.json({
        success: true,
        client: sanitizeClient(updated),
        meta_profile_synced: Boolean(metaProfile),
        meta_profile_pending: metaProfileChanged && !nextMetaConfig.phoneId,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/clients/:id/whatsapp-setup', permit('platform.tenants.manage'), async (req, res) => {
    try {
      const { verifyClientWhatsApp } = leados();
      const client = await Clients.findOne({ id: Number(req.params.id) }, NO_ID).lean();
      if (!client) return res.status(404).json({ error: 'Client not found' });
      const verified = await runAsTenant(client.tenant_id, () => verifyClientWhatsApp(client));
      return res.json({ success: true, client: sanitizeClient(verified) });
    } catch (error) {
      if (error.status === 404) return fail(res, error);
      return res.status(400).json({ error: metaError(error, 'WhatsApp verification failed') });
    }
  });

  router.post('/clients/:id/meta-profile-logo', permit('platform.meta'), (req, res, next) => leados().profileLogoUpload.single('logo')(req, res, next), async (req, res) => {
    try {
      const { Jimp, axios, META_GRAPH_VERSION, MetaWhatsappPhoneNumbers, assertPhoneBelongsToWaba, cacheMetaBusinessProfile } = leados();
      if (!req.file) return res.status(400).json({ error: 'Select a JPEG or PNG logo image' });
      if (!process.env.META_APP_ID) return res.status(503).json({ error: 'META_APP_ID is required in server/.env to upload a Meta profile logo' });
      const client = await Clients.findOne({ id: Number(req.params.id) }, NO_ID).lean();
      if (!client) return res.status(404).json({ error: 'Client not found' });
      if (!client.phone_number_id) return res.status(400).json({ error: 'Add this brand’s real Meta Phone Number ID before uploading its profile logo' });
      const config = await assertPhoneBelongsToWaba(client);

      const image = await Jimp.read(req.file.buffer);
      const logoBuffer = await image.cover(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);
      const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
      const session = await axios.post(`${base}/${process.env.META_APP_ID}/uploads`, null, {
        params: { file_name: `client-${client.id}-logo.jpg`, file_length: logoBuffer.length, file_type: 'image/jpeg' },
        headers: { Authorization: `Bearer ${config.token}` },
      });
      if (!session.data?.id) throw new Error('Meta did not return an upload session ID');
      const upload = await axios.post(`${base}/${session.data.id}`, logoBuffer, {
        headers: { Authorization: `Bearer ${config.token}`, file_offset: '0', 'Content-Type': 'image/jpeg' },
        maxBodyLength: 6 * 1024 * 1024,
      });
      if (!upload.data?.h) throw new Error('Meta did not return a profile-picture handle');
      await axios.post(`${base}/${config.phoneId}/whatsapp_business_profile`, {
        messaging_product: 'whatsapp', profile_picture_handle: upload.data.h,
      }, { headers: { Authorization: `Bearer ${config.token}` } });
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: config.phoneId }, { $set: { client_id: client.id } });
      const profile = await cacheMetaBusinessProfile(config.phoneId, config.token);
      return res.json({ success: true, profile_picture_url: profile.profile_picture_url || null });
    } catch (error) {
      return res.status(400).json({ error: `Meta logo upload failed: ${metaError(error, 'Meta logo upload failed')}` });
    }
  });

  // ── Platform Meta WhatsApp inventory ──────────────────────
  router.get('/meta/whatsapp/inventory', permit('platform.tenants.view'), async (req, res) => {
    try {
      const { MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates, MetaWhatsappSyncRuns, metaInventoryReady } = leados();
      await metaInventoryReady;
      const [accounts, phoneRows, templates, lastRun, brands, tenants] = await Promise.all([
        MetaWhatsappAccounts.find({}, NO_ID).sort({ name: 1 }).lean(),
        MetaWhatsappPhoneNumbers.find({}, NO_ID).lean(),
        MetaWhatsappTemplates.find({}, { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, status: 1, category: 1, last_synced_at: 1 }).sort({ name: 1, language: 1 }).lean(),
        MetaWhatsappSyncRuns.findOne({}, NO_ID).sort({ id: -1 }).lean(),
        Clients.find({}, { _id: 0, id: 1, name: 1, tenant_id: 1 }).lean(),
        Tenants.find({}, { _id: 0, id: 1, name: 1, status: 1 }).sort({ name: 1 }).lean(),
      ]);
      const accountNames = new Map(accounts.map((a) => [a.waba_id, a.name]));
      const brandById = new Map(brands.map((c) => [c.id, c]));
      const tenantNames = new Map(tenants.map((t) => [t.id, t.name]));
      const wabas = accounts.map((a) => ({ ...a, raw_data: undefined, phone_count: phoneRows.filter((p) => p.waba_id === a.waba_id).length }));
      const phones = phoneRows
        .filter((p) => accountNames.has(p.waba_id))
        .map((p) => {
          const brand = brandById.get(p.client_id);
          return {
            ...p,
            waba_name: accountNames.get(p.waba_id),
            client_name: brand?.name ?? null,
            tenant_id: brand?.tenant_id ?? null,
            tenant_name: brand ? (tenantNames.get(brand.tenant_id) ?? null) : null,
          };
        })
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
      // Workspaces a number can be assigned to: each has exactly one brand.
      const brandByTenant = new Map(brands.map((c) => [c.tenant_id, c]));
      const workspaces = tenants
        .filter((t) => brandByTenant.has(t.id))
        .map((t) => ({ tenant_id: t.id, tenant_name: t.name, status: t.status, client_id: brandByTenant.get(t.id).id }));
      return res.json({
        wabas,
        phone_numbers: phones,
        templates,
        template_summary: [...summary.values()],
        workspaces,
        last_sync: lastRun || null,
        sync_enabled: process.env.META_INVENTORY_SYNC !== 'off',
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/meta/whatsapp/sync', permit('platform.meta'), async (req, res) => {
    try {
      return res.json({ success: true, ...(await leados().syncMetaWhatsAppInventory()) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  // Clears only the locally cached copy of one WABA; nothing is deleted at Meta.
  router.delete('/meta/whatsapp/cache/wabas/:wabaId', permit('platform.meta'), async (req, res) => {
    try {
      const { MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, deleteCascade, metaInventoryReady } = leados();
      await metaInventoryReady;
      const account = await MetaWhatsappAccounts.findOne({ waba_id: req.params.wabaId }, { _id: 0, waba_id: 1, name: 1 }).lean();
      if (!account) return res.status(404).json({ error: 'Cached WABA not found' });
      const mapped = await MetaWhatsappPhoneNumbers.find({ waba_id: req.params.wabaId, client_id: { $ne: null } }, { client_id: 1 }).lean();
      const mappedClient = mapped.length ? await Clients.findOne({ id: { $in: mapped.map((p) => p.client_id) } }, { name: 1 }).lean() : null;
      if (mappedClient) {
        return res.status(409).json({ error: `Cannot clear this cache because a phone number is mapped to ${mappedClient.name}` });
      }
      await deleteCascade('meta_whatsapp_templates', { waba_id: req.params.wabaId });
      await deleteCascade('meta_whatsapp_accounts', { waba_id: req.params.wabaId });
      return res.json({ success: true, waba_id: account.waba_id, name: account.name });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/meta/whatsapp/phone-numbers/:phoneId/register', permit('platform.meta'), async (req, res) => {
    try {
      const { MetaWhatsappPhoneNumbers, META_GRAPH_VERSION, axios, graphPageData, syncMetaWhatsAppInventory, metaInventoryReady } = leados();
      await metaInventoryReady;
      const pin = String(req.body?.pin || '').trim();
      if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit two-step verification PIN' });
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, { _id: 0, phone_number_id: 1, waba_id: 1 }).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
      const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
      if (!token) return res.status(503).json({ error: 'Meta system-user access token is not configured' });
      const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
      const current = await graphPageData(`${base}/${phone.waba_id}/phone_numbers`, token, { fields: 'id' });
      if (!current.some((item) => String(item.id) === String(phone.phone_number_id))) {
        return res.status(409).json({ error: `Phone Number ID does not belong to WABA ${phone.waba_id}` });
      }
      await axios.post(`${base}/${phone.phone_number_id}/register`, { messaging_product: 'whatsapp', pin }, { headers: { Authorization: `Bearer ${token}` } });
      await axios.post(`${base}/${phone.waba_id}/subscribed_apps`, null, { headers: { Authorization: `Bearer ${token}` } });
      const syncResult = await syncMetaWhatsAppInventory();
      return res.json({ success: true, phone_number_id: phone.phone_number_id, waba_id: phone.waba_id, ...syncResult });
    } catch (error) {
      return res.status(400).json({ error: metaError(error, 'Meta phone registration failed') });
    }
  });

  // Every brand (other than `exceptClientId`) still connected to this number
  // stops sending through it: its WhatsApp connection is cleared.
  const releaseNumber = async (phoneNumberId, exceptClientId = null) => {
    const holders = await Clients.find(
      { phone_number_id: String(phoneNumberId), ...(exceptClientId != null ? { id: { $ne: exceptClientId } } : {}) },
      { _id: 0, id: 1, tenant_id: 1 },
    ).lean();
    for (const brand of holders) {
      await runAsTenant(brand.tenant_id, () => Clients.updateOne({ id: brand.id }, { $set: {
        phone_number_id: null, wa_business_id: null, whatsapp_number: null,
        whatsapp_status: 'not_configured', whatsapp_verified_at: null, whatsapp_verification_error: null, updated_at: new Date(),
      } }));
    }
  };

  // Assigns a platform Meta number to one workspace's brand (or unassigns it
  // with client_id null). A number belongs to at most one workspace.
  router.patch('/meta/whatsapp/phone-numbers/:phoneId/map', permit('platform.meta'), async (req, res) => {
    try {
      const { MetaWhatsappPhoneNumbers, metaInventoryReady } = leados();
      await metaInventoryReady;
      const { client_id } = req.body || {};
      const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, NO_ID).lean();
      if (!phone) return res.status(404).json({ error: 'Meta phone number not found' });
      if (client_id === null || client_id === undefined || client_id === '') {
        await releaseNumber(phone.phone_number_id);
        await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: null } });
        return res.json({ success: true });
      }
      const client = await Clients.findOne({ id: Number(client_id) }, { _id: 0, id: 1, tenant_id: 1 }).lean();
      if (!client) return res.status(404).json({ error: 'Brand not found' });
      await releaseNumber(phone.phone_number_id, client.id);
      await MetaWhatsappPhoneNumbers.updateMany({ client_id: client.id }, { $set: { client_id: null } });
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: client.id } });
      const verified = String(phone.connection_status || '').toUpperCase() === 'CONNECTED'
        || String(phone.verification_status || '').toUpperCase() === 'VERIFIED';
      await runAsTenant(client.tenant_id, () => Clients.updateOne({ id: client.id }, { $set: {
        wa_business_id: phone.waba_id, phone_number_id: phone.phone_number_id, whatsapp_number: phone.display_phone_number,
        whatsapp_status: verified ? 'verified' : 'verification_pending', whatsapp_verified_at: verified ? new Date() : null,
        whatsapp_verification_error: null, updated_at: new Date(),
      } }));
      await audit.record(audit.EVENTS.BRAND_UPDATED, {
        tenantId: client.tenant_id, req, targetType: 'client', targetId: client.id, meta: { meta_phone_mapped: phone.phone_number_id },
      });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });
};
