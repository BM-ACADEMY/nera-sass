/**
 * Customer panel Template Management: the templates of the WhatsApp number
 * linked to this workspace (its brand's WABA) and nothing else. Same features
 * as the admin panel; Meta calls use the brand's own credential.
 */
const { runAsSystem } = require('../../services/tenantContext');
const { requirePermission, can } = require('../../services/permissions');
const { createTemplateApi, replyError, upload, TemplateApiError } = require('../../services/metaTemplateApi');

module.exports = function registerWaTemplateRoutes(app, ctx) {
  const { Clients, auth, META_GRAPH_VERSION } = ctx;
  const api = createTemplateApi({ metaGraphVersion: META_GRAPH_VERSION || 'v21.0' });
  const manage = requirePermission('templates.manage');
  const fail = (res, error) => {
    console.error('[wa-templates]', error.message);
    return res.status(500).json({ error: 'Server error' });
  };
  const reply = (res, error) => replyError(res, error, fail);
  // The meta_whatsapp_* cache is platform data; every query below is limited
  // to this brand's own WABA.
  const sys = (fn) => runAsSystem(fn, 'wa-templates');

  async function brandOf() {
    return Clients.findOne({}, { _id: 0, id: 1, name: 1, phone_number_id: 1, wa_business_id: 1, whatsapp_number: 1, wa_access_token: 1 }).lean();
  }
  async function context() {
    const brand = await brandOf();
    if (!brand?.wa_business_id) throw new TemplateApiError(409, 'No WhatsApp number is linked to this workspace yet.', 'WHATSAPP_NOT_CONNECTED');
    if (!brand.wa_access_token) throw new TemplateApiError(409, 'This WhatsApp number cannot manage templates yet. The Getnera team is finishing the connection.', 'WHATSAPP_CREDENTIAL_MISSING');
    return { wabaId: brand.wa_business_id, token: brand.wa_access_token };
  }

  app.get('/api/wa-templates', auth, async (req, res) => {
    try {
      const brand = await brandOf();
      if (!brand?.wa_business_id) return res.json({ configured: false, templates: [] });
      if (req.query.refresh === '1') {
        const c = await context();
        await sys(() => api.refresh(c));
      }
      return res.json({
        configured: true,
        can_manage: Boolean(brand.wa_access_token) && can(req.identity, 'templates.manage'),
        number: { display_phone_number: brand.whatsapp_number ? `+${String(brand.whatsapp_number).replace(/^\+/, '')}` : null, name: brand.name },
        templates: await sys(() => api.list(brand.wa_business_id)),
      });
    } catch (error) {
      return reply(res, error);
    }
  });

  app.post('/api/wa-templates/check-pending', auth, async (req, res) => {
    try {
      const c = await context();
      return res.json(await sys(() => api.checkPending(c)));
    } catch (error) {
      return reply(res, error);
    }
  });

  app.get('/api/wa-templates/:templateId', auth, async (req, res) => {
    try {
      const brand = await brandOf();
      const template = brand?.wa_business_id ? await sys(() => api.findOwn(brand.wa_business_id, req.params.templateId)) : null;
      if (!template) return res.status(404).json({ error: 'Template not found' });
      return res.json({ template: (await sys(() => api.list(brand.wa_business_id))).find((t) => t.template_id === template.template_id) });
    } catch (error) {
      return reply(res, error);
    }
  });

  app.post('/api/wa-templates', auth, manage, async (req, res) => {
    try {
      const c = await context();
      return res.status(201).json({ template: await sys(() => api.create(c, req.body)) });
    } catch (error) {
      return reply(res, error);
    }
  });

  app.put('/api/wa-templates/:templateId', auth, manage, async (req, res) => {
    try {
      const c = await context();
      const { template } = await sys(() => api.update(c, req.params.templateId, req.body));
      return res.json({ template });
    } catch (error) {
      return reply(res, error);
    }
  });

  app.delete('/api/wa-templates/:templateId', auth, manage, async (req, res) => {
    try {
      const c = await context();
      await sys(() => api.remove(c, req.params.templateId));
      return res.json({ success: true });
    } catch (error) {
      return reply(res, error);
    }
  });

  app.post('/api/wa-templates-media', auth, manage, upload.single('file'), async (req, res) => {
    try {
      const c = await context();
      return res.json(await api.uploadMedia(c, req.file, req.body?.format));
    } catch (error) {
      return reply(res, error);
    }
  });
};
