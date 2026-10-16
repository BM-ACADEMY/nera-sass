/**
 * LeadOS routes: WhatsApp templates.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerTemplatesRoutes(app, ctx) {
const {
  Clients,
  META_GRAPH_VERSION,
  NO_ID,
  Templates,
  auth,
  axios,
  deleteCascade,
  templateMediaMulter,
  templateParameterDefinitionsReady,
} = ctx;
// ══════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════
app.get('/api/templates', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const templateRows = await Templates.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const templateClients = new Map((await Clients.find({ id: { $in: templateRows.map((t) => t.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    res.json({ templates: templateRows.map((t) => ({ ...t, brand_name: templateClients.get(t.client_id) ?? null })) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/templates/bulk-scope', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const ids = [...new Set((req.body.template_ids || []).map(Number).filter(Number.isInteger))];
    const scope = String(req.body.template_scope || '').toLowerCase();
    if (!ids.length) return res.status(400).json({ error: 'Select at least one template.' });
    if (!['leados', 'alliance', 'shared'].includes(scope)) {
      return res.status(400).json({ error: 'Workspace must be LeadOS, AllianceOS, or Shared.' });
    }
    const result = await Templates.updateMany({ id: { $in: ids } }, { $set: { template_scope: scope, updated_at: new Date() } });
    res.json({ success: true, updated: result.matchedCount, template_scope: scope });
  } catch (error) {
    console.error('Bulk template workspace update error:', error);
    res.status(500).json({ error: 'Unable to update selected templates.' });
  }
});

app.post('/api/templates/sync-all', auth, async (req, res) => {
  try {
    const { client_id } = req.body;
    const client = client_id ? await Clients.findOne({ id: client_id }, NO_ID).lean() : null;
    const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

    if (!waBusinessId || !waToken) {
      return res.status(400).json({ error: 'Meta Business ID or Access Token is missing' });
    }

    console.log(`[Templates Sync] Fetching from Meta for business account: ${waBusinessId}`);
    
    // Fetch templates from Meta API (limit 100)
    const metaRes = await axios.get(
      `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates?limit=100`,
      { headers: { Authorization: `Bearer ${waToken}` } }
    );

    const metaTemplates = metaRes.data.data || [];
    let imported = 0;
    let updated = 0;

    for (const t of metaTemplates) {
      const bodyComp = t.components?.find(c => c.type === 'BODY') || {};
      const headerComp = t.components?.find(c => c.type === 'HEADER');
      const footerComp = t.components?.find(c => c.type === 'FOOTER');
      const buttonsComp = t.components?.find(c => c.type === 'BUTTONS');

      const bodyText = bodyComp.text || '';
      const headerFormat = headerComp ? (headerComp.format || 'TEXT') : 'NONE';
      const headerText = headerComp ? (headerComp.text || headerComp.example?.header_handle?.[0] || null) : null;
      const footerText = footerComp ? footerComp.text : null;
      const buttonsVal = buttonsComp ? JSON.stringify(buttonsComp.buttons || []) : '[]';

      const status = (t.status || 'DRAFT').toLowerCase();
      const metaId = String(t.id);

      // Check if template exists locally by name and language
      const localTpl = await Templates.findOne({ name: t.name, language: t.language }, { id: 1, status: 1, meta_template_id: 1 }).lean();

      if (localTpl) {
        const approvedAt = (status === 'approved' && !localTpl.approved_at) ? new Date() : localTpl.approved_at;
        await Templates.updateOne({ id: localTpl.id }, { $set: {
          status, meta_template_id: metaId, approved_at: approvedAt ?? null, category: t.category, header_format: headerFormat,
          header: headerText, body: bodyText, footer: footerText, buttons: JSON.parse(buttonsVal), updated_at: new Date(),
        } });
        updated++;
      } else {
        const approvedAt = status === 'approved' ? new Date() : null;
        await Templates.create({
          name: t.name, category: t.category, language: t.language, header_format: headerFormat, header: headerText, body: bodyText,
          footer: footerText, buttons: JSON.parse(buttonsVal), client_id: client_id || null, status, meta_template_id: metaId,
          approved_at: approvedAt, created_at: new Date(),
        });
        imported++;
      }
    }

    res.json({ success: true, imported, updated, total: metaTemplates.length });
  } catch (err) {
    console.error('[Templates Sync Error]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message || 'Failed to sync templates from Meta' });
  }
});

app.post('/api/templates', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const { name, category, language, header_format, header, body, footer, buttons, client_id, samples, parameter_definitions = {}, template_scope = 'leados' } = req.body;
    const created = await Templates.create({
      name, category, language: language || 'en', header_format: header_format || 'TEXT', header: header || null, body,
      footer: footer || null, buttons: buttons || [], client_id: client_id || null, status: 'draft', created_at: new Date(),
      samples: samples || [], parameter_definitions,
      template_scope: ['leados', 'alliance', 'shared'].includes(template_scope) ? template_scope : 'leados',
    });
    res.status(201).json({ template: created.toObject() });
  } catch (err) {
    console.error('Create template err:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/:id/submit — submit to Meta for approval
app.post('/api/templates/:id/submit', auth, async (req, res) => {
  try {
    const tpl = await Templates.findOne({ id: req.params.id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const client = tpl.client_id
      ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean()
      : null;

    const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

    // Construct Meta components
    const components = [];
    if (tpl.header_format && tpl.header_format !== 'TEXT' && tpl.header_format !== 'NONE') {
      const comp = { type: 'HEADER', format: tpl.header_format };
      if (tpl.header) comp.example = { header_handle: [tpl.header] };
      components.push(comp);
    } else if (tpl.header) {
      components.push({ type: 'HEADER', format: 'TEXT', text: tpl.header });
    }

    const bodyComp = { type: 'BODY', text: tpl.body };
    if (tpl.samples && Array.isArray(tpl.samples) && tpl.samples.length > 0) {
      bodyComp.example = { body_text: [tpl.samples] };
    }
    components.push(bodyComp);
    if (tpl.footer) components.push({ type: 'FOOTER', text: tpl.footer });
    if (tpl.buttons && tpl.buttons.length > 0) {
      components.push({ type: 'BUTTONS', buttons: tpl.buttons });
    }

    const metaRes = await axios.post(
      `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates`,
      {
        name: tpl.name,
        language: tpl.language || 'en',
        category: tpl.category || 'UTILITY',
        allow_category_change: true,
        components,
      },
      { headers: { Authorization: `Bearer ${waToken}` } }
    );

    await Templates.updateOne({ id: req.params.id }, { $set: { status: 'pending', submitted_at: new Date(), meta_template_id: metaRes.data.id } });

    res.json({ success: true, meta_id: metaRes.data.id });
  } catch (err) {
    console.error('Template submit error:', err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const errMsg = metaErr
      ? `Meta API Error (${metaErr.code}): ${metaErr.message}`
      : err.message || 'Failed to submit template';
    res.status(500).json({ error: errMsg, meta_error: metaErr || null });
  }
});
app.post('/api/templates/upload-media', auth, templateMediaMulter.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { client_id } = req.body;
  let waToken = process.env.META_PAGE_ACCESS_TOKEN;
  
  try {
    if (client_id && client_id !== 'null' && client_id !== 'undefined') {
      const tokenClient = await Clients.findOne({ id: client_id }, { wa_access_token: 1 }).lean();
      if (tokenClient && tokenClient.wa_access_token) waToken = tokenClient.wa_access_token;
    }

    // 1. Get App ID from the token
    const appRes = await axios.get(`https://graph.facebook.com/v18.0/app?access_token=${waToken}`);
    const appId = appRes.data.id;
    if (!appId) throw new Error('Could not resolve App ID from token');

    // 2. Initialize Resumable Upload Session
    const fileStats = require('fs').statSync(req.file.path);
    const sessionRes = await axios.post(
      `https://graph.facebook.com/v18.0/${appId}/uploads?file_length=${fileStats.size}&file_type=${encodeURIComponent(req.file.mimetype)}`,
      null,
      { headers: { Authorization: `Bearer ${waToken}` } }
    );
    const sessionId = sessionRes.data.id;

    // 3. Upload file data to session
    const fileData = require('fs').readFileSync(req.file.path);
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v18.0/${sessionId}`,
      fileData,
      {
        headers: {
          Authorization: `OAuth ${waToken}`,
          'file_offset': '0',
          'Content-Type': 'application/octet-stream'
        }
      }
    );
    
    // Cleanup local file
    require('fs').unlinkSync(req.file.path);
    
    res.json({ success: true, handle: uploadRes.data.h });
  } catch (err) {
    console.error('Meta Upload Error:', err.response?.data || err.message);
    if (req.file && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    const metaErr = err.response?.data?.error;
    res.status(500).json({ 
      error: metaErr ? `Meta Error: ${metaErr.message}` : 'Failed to upload media to Meta'
    });
  }
});

// GET /api/templates/:id/sync — sync status from Meta
app.get('/api/templates/:id/sync', auth, async (req, res) => {
  try {
    const tpl = await Templates.findOne({ id: req.params.id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const client = tpl.client_id ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean() : null;
    const sharedWaToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    const isAllianceTemplate = ['alliance', 'shared'].includes(String(tpl.template_scope || '').toLowerCase());
    const waToken = isAllianceTemplate ? (sharedWaToken || client?.wa_access_token) : (client?.wa_access_token || sharedWaToken);
    const waBusinessId = isAllianceTemplate ? (process.env.WA_BUSINESS_ACCOUNT_ID || client?.wa_business_id) : (client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID);

    if (!waToken) {
      return res.status(409).json({
        error: 'Meta access token is not configured. Add a client WhatsApp token, META_SYSTEM_USER_ACCESS_TOKEN, or META_PAGE_ACCESS_TOKEN and restart the backend.',
        code: 'META_TOKEN_MISSING',
      });
    }
    if (!tpl.meta_template_id && !waBusinessId) {
      return res.status(409).json({
        error: 'This template has no Meta template ID and no WhatsApp Business Account ID is configured.',
        code: 'META_TEMPLATE_AND_WABA_MISSING',
      });
    }

    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    let metaTpl = null;
    if (tpl.meta_template_id) {
      const metaRes = await axios.get(`${base}/${tpl.meta_template_id}`, {
        params: { fields: 'id,name,status,language,category,components' },
        headers: { Authorization: `Bearer ${waToken}` },
        timeout: 20000,
      });
      metaTpl = metaRes.data;
    } else {
      const metaRes = await axios.get(`${base}/${waBusinessId}/message_templates`, {
        params: { name: tpl.name, limit: 100 },
        headers: { Authorization: `Bearer ${waToken}` },
        timeout: 20000,
      });
      metaTpl = (metaRes.data?.data || []).find(
        (item) => item.name === tpl.name && item.language === (tpl.language || 'en')
      );
    }

    if (metaTpl) {
      const status = metaTpl.status.toLowerCase();
      const bodyComp = metaTpl.components?.find((component) => component.type === 'BODY') || {};
      const headerComp = metaTpl.components?.find((component) => component.type === 'HEADER');
      const footerComp = metaTpl.components?.find((component) => component.type === 'FOOTER');
      const buttonsComp = metaTpl.components?.find((component) => component.type === 'BUTTONS');
      const syncedTemplate = await Templates.findOneAndUpdate(
        { id: tpl.id },
        [{ $set: {
          status, meta_template_id: metaTpl.id,
          approved_at: status === 'approved' ? { $ifNull: ['$approved_at', '$$NOW'] } : '$approved_at',
          category: metaTpl.category ?? null, header_format: headerComp?.format || 'NONE',
          header: headerComp?.text || headerComp?.example?.header_handle?.[0] || null,
          body: bodyComp.text || '', footer: footerComp?.text || null, buttons: { $literal: buttonsComp?.buttons || [] }, updated_at: '$$NOW',
        } }],
        { new: true, projection: NO_ID }
      ).lean();
      return res.json({ template: syncedTemplate });
    }

    return res.status(404).json({
      error: `Meta did not return template "${tpl.name}" (${tpl.language || 'en'}) for the configured WhatsApp Business Account. Verify its WABA, language, and Meta template ID.`,
      code: 'META_TEMPLATE_NOT_FOUND',
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    const message = metaError
      ? `Meta API error${metaError.code ? ` (${metaError.code})` : ''}: ${metaError.message}`
      : err.code === 'ECONNABORTED'
        ? 'Meta status check timed out. Please try again.'
        : err.message || 'Failed to sync template status.';
    console.error('Template sync error:', metaError || err.message);
    // Do not return 401 here: that status is reserved for the LeadOS login
    // session and would incorrectly log the administrator out.
    const status = err.response?.status >= 400 && err.response?.status < 500 ? 502 : 500;
    res.status(status).json({ error: message, code: metaError?.code || err.code || 'TEMPLATE_SYNC_FAILED' });
  }
});

// PUT /api/templates/:id
app.put('/api/templates/:id', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const { name, category, language, header_format, header, body, footer, buttons, client_id, samples, parameter_definitions, template_scope } = req.body;
    const { id } = req.params;

    const current = await Templates.findOne({ id }, NO_ID).lean();
    if (!current) return res.status(404).json({ error: 'Template not found' });

    // Build components for Meta
    const components = [];
    const finalHeaderFmt = header_format !== undefined ? header_format : current.header_format;
    const finalHeader = header !== undefined ? header : current.header;

    if (finalHeaderFmt && finalHeaderFmt !== 'TEXT' && finalHeaderFmt !== 'NONE') {
      const comp = { type: 'HEADER', format: finalHeaderFmt };
      if (finalHeader) comp.example = { header_handle: [finalHeader] };
      components.push(comp);
    } else if (finalHeader) {
      components.push({ type: 'HEADER', format: 'TEXT', text: finalHeader });
    }

    const bodyComp = { type: 'BODY', text: body || current.body };
    const finalSamples = samples !== undefined ? samples : current.samples;
    if (finalSamples && Array.isArray(finalSamples) && finalSamples.length > 0) {
      bodyComp.example = { body_text: [finalSamples] };
    }
    components.push(bodyComp);

    if (footer !== undefined ? footer : current.footer) components.push({ type: 'FOOTER', text: footer !== undefined ? footer : current.footer });
    const finalBtns = buttons !== undefined ? buttons : current.buttons;
    if (finalBtns && finalBtns.length > 0) {
      components.push({ type: 'BUTTONS', buttons: finalBtns });
    }

    if (current.status !== 'draft' && current.meta_template_id) {
      const client = current.client_id ? await Clients.findOne({ id: current.client_id }, NO_ID).lean() : null;
      const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

      await axios.post(
        `https://graph.facebook.com/v18.0/${current.meta_template_id}`,
        { components },
        { headers: { Authorization: `Bearer ${waToken}` } }
      );
    }

    const changes = {
      header: header !== undefined ? header : (current.header ?? null),
      footer: footer !== undefined ? footer : (current.footer ?? null),
      status: current.status !== 'draft' && current.status != null ? 'pending' : current.status,
      updated_at: new Date(),
    };
    if (name != null) changes.name = name;
    if (category != null) changes.category = category;
    if (language != null) changes.language = language;
    if (header_format != null) changes.header_format = header_format;
    if (body != null) changes.body = body;
    if (buttons) changes.buttons = buttons;
    if (client_id) changes.client_id = client_id;
    if (samples) changes.samples = samples;
    if (parameter_definitions) changes.parameter_definitions = parameter_definitions;
    if (['leados', 'alliance', 'shared'].includes(template_scope)) changes.template_scope = template_scope;
    const updatedTemplate = await Templates.findOneAndUpdate({ id }, { $set: changes }, { new: true, projection: NO_ID }).lean();

    res.json({ template: updatedTemplate || undefined });
  } catch (err) {
    console.error('Template update error:', err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const errMsg = metaErr
      ? `Meta API Error (${metaErr.code}): ${metaErr.message}`
      : err.message || 'Failed to update template';
    res.status(500).json({ error: errMsg, meta_error: metaErr || null });
  }
});

// DELETE /api/templates/:id
app.delete('/api/templates/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const tpl = await Templates.findOne({ id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    if (tpl.status !== 'draft') {
      const client = tpl.client_id ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean() : null;
      const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
      const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

      try {
        await axios.delete(
          `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates`,
          {
            params: { name: tpl.name },
            headers: { Authorization: `Bearer ${waToken}` }
          }
        );
      } catch (metaErr) {
        console.error('Meta template delete error:', metaErr.response?.data || metaErr.message);
      }
    }

    await deleteCascade('templates', { id });
    res.json({ success: true });
  } catch (err) {
    console.error('Template delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
};
