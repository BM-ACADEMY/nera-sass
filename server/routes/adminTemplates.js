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
 * server. The template logic itself is shared with the customer panel
 * (services/metaTemplateApi.js).
 */
const { MetaWhatsappTemplates, MetaWhatsappPhoneNumbers, MetaWhatsappAccounts, Clients, Tenants } = require('../models');
const { inventoryAccessToken } = require('../services/metaInventoryCredentials');
const { platformWabaId, platformPhoneId } = require('../services/platformInbox');
const { createTemplateApi, replyError, present, upload, LIST_FIELDS, PUBLIC_FIELDS, TemplateApiError } = require('../services/metaTemplateApi');
const audit = require('../services/audit');

module.exports = function registerAdminTemplateRoutes(router, { permit, fail, metaGraphVersion = 'v21.0' }) {
  const api = createTemplateApi({ metaGraphVersion });
  const view = permit('platform.meta');
  const manage = permit('platform.meta');
  const reply = (res, error) => replyError(res, error, fail);

  // The platform WABA and credential, or an error explaining what to set up.
  async function platformContext() {
    const token = inventoryAccessToken();
    const wabaId = await platformWabaId();
    if (!wabaId) throw new TemplateApiError(409, 'Pick the admin WhatsApp number first: WhatsApp Numbers → "Use for admin WhatsApp".', 'PLATFORM_NUMBER_NOT_SET');
    if (!token) throw new TemplateApiError(503, 'The Meta inventory credential (META_INVENTORY_ACCESS_TOKEN) is not configured', 'META_CREDENTIAL_NOT_CONFIGURED');
    return { token, wabaId };
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
      if (req.query.refresh === '1') await api.refresh(await platformContext());
      return res.json({
        configured: true, can_manage: Boolean(inventoryAccessToken()), waba_id: wabaId, waba_name: account?.name || null,
        number: phone, templates: await api.list(wabaId),
      });
    } catch (error) {
      return reply(res, error);
    }
  });

  // Status of templates still in review (the status webhook normally does this at once).
  router.post('/templates/platform/check-pending', view, async (req, res) => {
    try {
      return res.json(await api.checkPending(await platformContext()));
    } catch (error) {
      return reply(res, error);
    }
  });

  router.post('/templates/platform', manage, async (req, res) => {
    try {
      const ctx = await platformContext();
      const template = await api.create(ctx, req.body);
      await audit.record(audit.EVENTS.META_TEMPLATE_CREATED, { req, targetType: 'meta_template', targetId: template.template_id, meta: { waba_id: ctx.wabaId, name: template.name, language: template.language } });
      return res.status(201).json({ template });
    } catch (error) {
      return reply(res, error);
    }
  });

  router.put('/templates/platform/:templateId', manage, async (req, res) => {
    try {
      const ctx = await platformContext();
      const { template, name } = await api.update(ctx, req.params.templateId, req.body);
      await audit.record(audit.EVENTS.META_TEMPLATE_UPDATED, { req, targetType: 'meta_template', targetId: template.template_id, meta: { waba_id: ctx.wabaId, name } });
      return res.json({ template });
    } catch (error) {
      return reply(res, error);
    }
  });

  router.delete('/templates/platform/:templateId', manage, async (req, res) => {
    try {
      const ctx = await platformContext();
      const removed = await api.remove(ctx, req.params.templateId);
      await audit.record(audit.EVENTS.META_TEMPLATE_DELETED, { req, targetType: 'meta_template', targetId: removed.template_id, meta: { waba_id: ctx.wabaId, name: removed.name } });
      return res.json({ success: true });
    } catch (error) {
      return reply(res, error);
    }
  });

  router.post('/templates/media', manage, upload.single('file'), async (req, res) => {
    try {
      const ctx = await platformContext();
      return res.json(await api.uploadMedia(ctx, req.file, req.body?.format));
    } catch (error) {
      return reply(res, error);
    }
  });

  // One template with its content, for the preview (any WABA; staff only).
  router.get('/templates/item/:templateId', view, async (req, res) => {
    try {
      const template = await MetaWhatsappTemplates.findOne({ template_id: String(req.params.templateId) }, PUBLIC_FIELDS).lean();
      if (!template) return res.status(404).json({ error: 'Template not found' });
      return res.json({ template: present(template) });
    } catch (error) {
      return reply(res, error);
    }
  });

  // Every workspace WABA's templates (read-only), with the workspace that uses
  // the WABA's number. The list is light; a preview loads one template.
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
      return reply(res, error);
    }
  });
};
