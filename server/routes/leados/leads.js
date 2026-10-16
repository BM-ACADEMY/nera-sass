/**
 * LeadOS routes: Lead sources, sample sheet and debug.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerLeadsRoutes(app, ctx) {
const {
  CampaignImportRecipients,
  Leads,
  Templates,
  auth,
  getTemplateVariableNumbers,
  templateParameterDefinitionsReady,
  verifyToken,
  xlsx,
} = ctx;
// ══════════════════════════════════════════════════════════
// LEADS ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/leads/sources — distinct source values
// Public campaign import template. Keep this static route before
// `/api/leads/:id`, otherwise Express treats "template" as a lead ID.
app.get('/api/leads/template', (req, res) => {
  const ws = xlsx.utils.json_to_sheet([
    { Name: 'John Doe', Phone: '919876543210' },
    { Name: 'Jane Smith', Phone: '919876543211' }
  ]);
  ws['!cols'] = [{ wch: 20 }, { wch: 20 }];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Template');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="leados_campaign_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Template-specific recipient sheet. Variable columns are positional because
// Meta matches values to {{1}}, {{2}}, etc., not to CRM field names.
app.get('/api/templates/:id/campaign-sheet', async (req, res) => {
  try {
    const sheetToken = req.query.token || req.headers.authorization?.replace('Bearer ', '');
    try { verifyToken(String(sheetToken || '')); } catch { return res.status(401).json({ error: 'Login required' }); }
    await templateParameterDefinitionsReady;
    const template = await Templates.findOne({ id: req.params.id }, { _id: 0, name: 1, body: 1, header: 1, parameter_definitions: 1 }).lean();
    if (!template) return res.status(404).json({ error: 'Template not found' });
    let requestedMappings = null;
    try {
      requestedMappings = req.query.mappings ? JSON.parse(req.query.mappings) : null;
    } catch { requestedMappings = null; }
    const isExcelSourced = (section, number) => {
      if (!requestedMappings) return true;
      return requestedMappings?.[section]?.[String(number)]?.source === 'excel_parameter';
    };
    const headers = ['Name', 'Phone'];
    for (const number of getTemplateVariableNumbers(template.header)) {
      if (!isExcelSourced('header', number)) continue;
      const label = template.parameter_definitions?.header?.[String(number)]?.label;
      headers.push(`Header {{${number}}}${label ? ` - ${label}` : ''}`);
    }
    for (const number of getTemplateVariableNumbers(template.body)) {
      if (!isExcelSourced('body', number)) continue;
      const label = template.parameter_definitions?.body?.[String(number)]?.label;
      headers.push(`Body {{${number}}}${label ? ` - ${label}` : ''}`);
    }
    const example = Object.fromEntries(headers.map((header) => [header, '']));
    example.Name = 'John Doe';
    example.Phone = '919876543210';
    const sheet = xlsx.utils.json_to_sheet([example], { header: headers });
    sheet['!cols'] = headers.map((header) => ({ wch: Math.max(18, header.length + 3) }));
    const instructions = xlsx.utils.aoa_to_sheet([
      ['Template', template.name],
      ['Instructions'],
      ['Keep the column names unchanged. Enter phone numbers with country code.'],
      ['Fill every Header {{n}} and Body {{n}} cell for every recipient.'],
      ['The values are sent to Meta in numeric order.']
    ]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Recipients');
    xlsx.utils.book_append_sheet(workbook, instructions, 'Instructions');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const safeName = String(template.name || 'template').replace(/[^a-z0-9_-]+/gi, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_campaign_recipients.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Unable to generate template recipient sheet.' });
  }
});

// DEBUG: Check campaign import recipients
app.get('/api/debug/campaign-imports', auth, async (req, res) => {
  try {
    const { batch_id } = req.query;

    const importRows = await CampaignImportRecipients.find(batch_id ? { batch_id } : {}, { _id: 0, batch_id: 1, lead_id: 1, created_at: 1 })
      .sort({ created_at: -1 }).lean();
    const importLeads = new Map((await Leads.find({ id: { $in: importRows.map((r) => r.lead_id) } }, { id: 1, name: 1, phone: 1, client_id: 1, status: 1 }).lean())
      .map((l) => [l.id, l]));
    const result = { rows: importRows.filter((r) => importLeads.has(r.lead_id)).slice(0, 50).map((r) => {
      const l = importLeads.get(r.lead_id);
      return { batch_id: r.batch_id, lead_id: r.lead_id, created_at: r.created_at, name: l.name, phone: l.phone, client_id: l.client_id, status: l.status };
    }) };

    res.json({
      count: result.rows.length,
      recipients: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/sources', auth, async (req, res) => {
  try {
    const rows = (await Leads.distinct('source', { source: { $nin: [null, ''] } })).sort().map((source) => ({ source }));
        
    let rawSources = rows.map(r => r.source)
                         .filter(s => !s.startsWith('Csv_') && !s.startsWith('={{') && s.toLowerCase() !== 'test');
    
    const uniqueSources = [];
    const seen = new Set();
    for (const s of rawSources) {
      const lower = s.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        
        // Custom formatting for common sources
        if (lower === 'whatsapp') {
          uniqueSources.push('WhatsApp');
        } else if (lower === 'meta_ads') {
          uniqueSources.push('Meta Ads');
        } else if (lower === 'instagram dm') {
          uniqueSources.push('Instagram DM');
        } else {
          uniqueSources.push(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
        }
      }
    }
    
    res.json({ sources: uniqueSources.sort() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
};
