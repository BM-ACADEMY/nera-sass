/**
 * Admin panel Template Management.
 *
 *   Getnera templates  the platform number's WABA (the admin WhatsApp picked in
 *                      WhatsApp Numbers): list, create, edit, delete, refresh.
 *   Client templates   read-only view of every workspace WABA's templates from
 *                      the Meta inventory cache.
 *
 * Meta is the source of truth; meta_whatsapp_templates is the cache the list
 * reads. All Meta calls use the inventory credential, which never leaves the
 * server.
 */
const axios = require('axios');
const multer = require('multer');
const { MetaWhatsappTemplates, MetaWhatsappPhoneNumbers, MetaWhatsappAccounts, Clients, Tenants } = require('../models');
const { inventoryAccessToken } = require('../services/metaInventoryCredentials');
const { platformWabaId, platformPhoneId } = require('../services/platformInbox');
const { buildTemplate, TemplateError } = require('../services/templateBuilder');
const audit = require('../services/audit');

const MEDIA_TYPES = {
  IMAGE: { mime: ['image/jpeg', 'image/png'], max: 5 * 1024 * 1024 },
  VIDEO: { mime: ['video/mp4', 'video/3gpp'], max: 16 * 1024 * 1024 },
  DOCUMENT: { mime: ['application/pdf'], max: 100 * 1024 * 1024 },
};
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
// The client list is light (no message content); a preview loads one template.
const LIST_FIELDS = { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, category: 1, status: 1, last_synced_at: 1 };
const PUBLIC_FIELDS = { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, category: 1, status: 1, components: 1, last_synced_at: 1, 'raw_data.rejected_reason': 1, 'raw_data.quality_score': 1, 'raw_data.parameter_format': 1 };

class MetaCallError extends Error {
  constructor(error) {
    const meta = error.response?.data?.error;
    super(meta?.error_user_msg || meta?.message || error.message || 'Meta request failed');
    this.status = 502;
    this.code = 'META_ERROR';
    this.meta_title = meta?.error_user_title || null;
  }
}

const present = (t) => ({
  template_id: t.template_id, waba_id: t.waba_id, name: t.name, language: t.language, category: t.category, status: t.status,
  components: t.components || [], last_synced_at: t.last_synced_at,
  rejected_reason: t.raw_data?.rejected_reason && t.raw_data.rejected_reason !== 'NONE' ? t.raw_data.rejected_reason : null,
  quality: t.raw_data?.quality_score?.score || null,
  parameter_format: t.raw_data?.parameter_format || null,
});

module.exports = function registerAdminTemplateRoutes(router, { permit, fail, metaGraphVersion = 'v21.0' }) {
  const graph = (path) => `https://graph.facebook.com/${metaGraphVersion}/${path}`;
  const view = permit('platform.meta');
  const manage = permit('platform.meta');

  const replyError = (res, error) => {
    if (error instanceof TemplateError) return res.status(400).json({ error: error.message, field: error.field });
    if (error instanceof MetaCallError) return res.status(502).json({ error: error.message, title: error.meta_title, code: error.code });
    if (error.status && error.code) return res.status(error.status).json({ error: error.message, code: error.code });
    return fail(res, error);
  };

  // The platform WABA and credential, or a 409 explaining what to set up.
  async function platformContext() {
    const token = inventoryAccessToken();
    const wabaId = await platformWabaId();
    if (!wabaId) {
      const error = new Error('Pick the admin WhatsApp number first: WhatsApp Numbers → "Use for admin WhatsApp".');
      error.status = 409; error.code = 'PLATFORM_NUMBER_NOT_SET';
      throw error;
    }
    if (!token) {
      const error = new Error('The Meta inventory credential (META_INVENTORY_ACCESS_TOKEN) is not configured');
      error.status = 503; error.code = 'META_CREDENTIAL_NOT_CONFIGURED';
      throw error;
    }
    return { token, wabaId };
  }

  const cacheTemplate = (wabaId, t) => {
    const fields = {
      waba_id: wabaId, name: t.name ?? null, language: t.language ?? null, status: t.status ?? null,
      category: t.category ?? null, components: t.components || [], raw_data: t, last_synced_at: new Date(),
    };
    return MetaWhatsappTemplates.updateOne({ template_id: String(t.id) }, { $set: fields }, { upsert: true });
  };

  // Pulls every template of one WABA from Meta into the cache and drops the
  // cached rows Meta no longer returns.
  async function refreshWaba(wabaId, token) {
    const seen = [];
    let url = graph(`${wabaId}/message_templates`);
    let params = { fields: 'id,name,language,status,category,components,rejected_reason,quality_score,parameter_format', limit: 100 };
    for (let page = 0; url && page < 20; page += 1) {
      let data;
      try {
        ({ data } = await axios.get(url, { params, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 }));
      } catch (error) {
        throw new MetaCallError(error);
      }
      for (const t of data?.data || []) {
        await cacheTemplate(wabaId, t);
        seen.push(String(t.id));
      }
      url = data?.paging?.next || null;
      params = undefined;
    }
    await MetaWhatsappTemplates.deleteMany({ waba_id: wabaId, template_id: { $nin: seen } });
    return seen.length;
  }

  router.get('/templates/platform', view, async (req, res) => {
    try {
      const wabaId = await platformWabaId();
      const phoneId = platformPhoneId();
      const [phone, account] = await Promise.all([
        phoneId ? MetaWhatsappPhoneNumbers.findOne({ phone_number_id: phoneId }, { _id: 0, display_phone_number: 1, verified_name: 1, profile_picture_url: 1 }).lean() : null,
        wabaId ? MetaWhatsappAccounts.findOne({ waba_id: wabaId }, { _id: 0, name: 1 }).lean() : null,
      ]);
      if (!wabaId) return res.json({ configured: false, templates: [], number: null });
      if (req.query.refresh === '1') {
        const { token } = await platformContext();
        await refreshWaba(wabaId, token);
      }
      const templates = await MetaWhatsappTemplates.find({ waba_id: wabaId }, PUBLIC_FIELDS).sort({ name: 1, language: 1 }).lean();
      return res.json({
        configured: true, can_manage: Boolean(inventoryAccessToken()), waba_id: wabaId, waba_name: account?.name || null,
        number: phone, templates: templates.map(present),
      });
    } catch (error) {
      return replyError(res, error);
    }
  });

  // Asks Meta for the current status of the admin WABA's templates still in
  // review. The status webhook normally does this at once; the page calls
  // this while something is pending, in case the webhook is not subscribed.
  router.post('/templates/platform/check-pending', view, async (req, res) => {
    try {
      const { token, wabaId } = await platformContext();
      const pending = await MetaWhatsappTemplates.find({ waba_id: wabaId, status: { $in: ['PENDING', 'IN_APPEAL'] } }, { _id: 0, template_id: 1, raw_data: 1 }).limit(20).lean();
      let changed = 0;
      for (const t of pending) {
        let data;
        try {
          ({ data } = await axios.get(graph(String(t.template_id)), {
            params: { fields: 'id,name,language,status,category,components,rejected_reason,quality_score,parameter_format' },
            headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
          }));
        } catch (error) {
          throw new MetaCallError(error);
        }
        if (data?.status && data.status !== 'PENDING') changed += 1;
        await cacheTemplate(wabaId, { ...t.raw_data, ...data, id: t.template_id });
      }
      const templates = await MetaWhatsappTemplates.find({ waba_id: wabaId }, PUBLIC_FIELDS).sort({ name: 1, language: 1 }).lean();
      return res.json({ checked: pending.length, changed, templates: templates.map(present) });
    } catch (error) {
      return replyError(res, error);
    }
  });

  router.post('/templates/platform', manage, async (req, res) => {
    try {
      const payload = buildTemplate(req.body);
      const { token, wabaId } = await platformContext();
      if (await MetaWhatsappTemplates.exists({ waba_id: wabaId, name: payload.name, language: payload.language })) {
        return res.status(409).json({ error: `A template named "${payload.name}" already exists in this language.`, field: 'name' });
      }
      let created;
      try {
        ({ data: created } = await axios.post(graph(`${wabaId}/message_templates`), payload, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 }));
      } catch (error) {
        throw new MetaCallError(error);
      }
      const record = { id: created.id, name: payload.name, language: payload.language, category: created.category || payload.category, status: created.status || 'PENDING', components: payload.components, parameter_format: payload.parameter_format };
      await cacheTemplate(wabaId, record);
      await audit.record(audit.EVENTS.META_TEMPLATE_CREATED, { req, targetType: 'meta_template', targetId: String(created.id), meta: { waba_id: wabaId, name: payload.name, language: payload.language } });
      const saved = await MetaWhatsappTemplates.findOne({ template_id: String(created.id) }, PUBLIC_FIELDS).lean();
      return res.status(201).json({ template: present(saved) });
    } catch (error) {
      return replyError(res, error);
    }
  });

  // Meta allows editing the content (not the name or language) of approved,
  // rejected or paused templates; the edit goes back to review.
  router.put('/templates/platform/:templateId', manage, async (req, res) => {
    try {
      const { token, wabaId } = await platformContext();
      const current = await MetaWhatsappTemplates.findOne({ template_id: String(req.params.templateId), waba_id: wabaId }, { _id: 0 }).lean();
      if (!current) return res.status(404).json({ error: 'Template not found' });
      const payload = buildTemplate({ ...req.body, name: current.name, language: current.language });
      const update = { components: payload.components };
      if (payload.category !== current.category) update.category = payload.category;
      try {
        await axios.post(graph(String(current.template_id)), update, { headers: { Authorization: `Bearer ${token}` }, timeout: 30000 });
      } catch (error) {
        throw new MetaCallError(error);
      }
      await cacheTemplate(wabaId, { ...current.raw_data, id: current.template_id, name: current.name, language: current.language, category: payload.category, status: 'PENDING', components: payload.components });
      await audit.record(audit.EVENTS.META_TEMPLATE_UPDATED, { req, targetType: 'meta_template', targetId: current.template_id, meta: { waba_id: wabaId, name: current.name } });
      const saved = await MetaWhatsappTemplates.findOne({ template_id: current.template_id }, PUBLIC_FIELDS).lean();
      return res.json({ template: present(saved) });
    } catch (error) {
      return replyError(res, error);
    }
  });

  router.delete('/templates/platform/:templateId', manage, async (req, res) => {
    try {
      const { token, wabaId } = await platformContext();
      const current = await MetaWhatsappTemplates.findOne({ template_id: String(req.params.templateId), waba_id: wabaId }, { _id: 0, template_id: 1, name: 1 }).lean();
      if (!current) return res.status(404).json({ error: 'Template not found' });
      try {
        await axios.delete(graph(`${wabaId}/message_templates`), { params: { name: current.name, hsm_id: current.template_id }, headers: { Authorization: `Bearer ${token}` }, timeout: 20000 });
      } catch (error) {
        throw new MetaCallError(error);
      }
      await MetaWhatsappTemplates.deleteOne({ template_id: current.template_id });
      await audit.record(audit.EVENTS.META_TEMPLATE_DELETED, { req, targetType: 'meta_template', targetId: current.template_id, meta: { waba_id: wabaId, name: current.name } });
      return res.json({ success: true });
    } catch (error) {
      return replyError(res, error);
    }
  });

  // Sample media for an IMAGE / VIDEO / DOCUMENT header: Meta's resumable
  // upload returns a handle the template references.
  router.post('/templates/media', manage, upload.single('file'), async (req, res) => {
    try {
      const format = String(req.body?.format || '').toUpperCase();
      const rule = MEDIA_TYPES[format];
      if (!rule) return res.status(400).json({ error: 'Choose an image, video or document header first' });
      if (!req.file) return res.status(400).json({ error: 'Choose a file to upload' });
      if (!rule.mime.includes(req.file.mimetype)) return res.status(400).json({ error: `Use ${format === 'IMAGE' ? 'a JPG or PNG image' : format === 'VIDEO' ? 'an MP4 video' : 'a PDF file'}` });
      if (req.file.size > rule.max) return res.status(400).json({ error: `The file is too large (max ${Math.round(rule.max / 1024 / 1024)} MB)` });
      const appId = String(process.env.META_APP_ID || '').trim();
      if (!appId) return res.status(503).json({ error: 'META_APP_ID is not configured', code: 'META_APP_ID_MISSING' });
      const { token } = await platformContext();
      let handle;
      try {
        const session = await axios.post(graph(`${appId}/uploads`), null, {
          params: { file_name: req.file.originalname.replace(/[^\w.-]/g, '_').slice(0, 100), file_length: req.file.size, file_type: req.file.mimetype },
          headers: { Authorization: `Bearer ${token}` }, timeout: 20000,
        });
        const uploaded = await axios.post(graph(session.data.id), req.file.buffer, {
          headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': 'application/octet-stream' },
          maxBodyLength: Infinity, timeout: 120000,
        });
        handle = uploaded.data?.h;
      } catch (error) {
        throw new MetaCallError(error);
      }
      if (!handle) return res.status(502).json({ error: 'Meta did not return a media handle' });
      return res.json({ handle, file_name: req.file.originalname, size: req.file.size });
    } catch (error) {
      return replyError(res, error);
    }
  });

  // One template with its content, for the preview.
  router.get('/templates/item/:templateId', view, async (req, res) => {
    try {
      const template = await MetaWhatsappTemplates.findOne({ template_id: String(req.params.templateId) }, PUBLIC_FIELDS).lean();
      if (!template) return res.status(404).json({ error: 'Template not found' });
      return res.json({ template: present(template) });
    } catch (error) {
      return replyError(res, error);
    }
  });

  // Every workspace WABA's templates (read-only), with the workspace that uses
  // the WABA's number.
  router.get('/templates/clients', view, async (req, res) => {
    try {
      const platformWaba = await platformWabaId();
      const [accounts, phones, brands, tenants] = await Promise.all([
        MetaWhatsappAccounts.find({}, { _id: 0, waba_id: 1, name: 1 }).lean(),
        MetaWhatsappPhoneNumbers.find({ client_id: { $ne: null } }, { _id: 0, waba_id: 1, client_id: 1, display_phone_number: 1 }).lean(),
        Clients.find({}, { _id: 0, id: 1, name: 1, tenant_id: 1 }).lean(),
        Tenants.find({ status: { $ne: 'deleted' } }, { _id: 0, id: 1, name: 1 }).lean(),
      ]);
      const brandById = new Map(brands.map((b) => [b.id, b]));
      const tenantById = new Map(tenants.map((t) => [t.id, t]));
      const workspacesByWaba = new Map();
      for (const p of phones) {
        const brand = brandById.get(p.client_id);
        const tenant = brand && tenantById.get(brand.tenant_id);
        if (!tenant) continue;
        const list = workspacesByWaba.get(p.waba_id) || [];
        list.push({ tenant_id: tenant.id, name: tenant.name, number: p.display_phone_number || null });
        workspacesByWaba.set(p.waba_id, list);
      }
      const filter = platformWaba ? { waba_id: { $ne: platformWaba } } : {};
      const templates = await MetaWhatsappTemplates.find(filter, LIST_FIELDS).sort({ name: 1 }).lean();
      const accountName = new Map(accounts.map((a) => [a.waba_id, a.name]));
      return res.json({
        templates: templates.map((t) => ({ ...present(t), components: undefined, waba_name: accountName.get(t.waba_id) || null, workspaces: workspacesByWaba.get(t.waba_id) || [] })),
        accounts: accounts.filter((a) => a.waba_id !== platformWaba).map((a) => ({ ...a, workspaces: workspacesByWaba.get(a.waba_id) || [] })),
      });
    } catch (error) {
      return replyError(res, error);
    }
  });
};
