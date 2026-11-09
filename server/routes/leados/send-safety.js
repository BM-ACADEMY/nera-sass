/**
 * LeadOS routes: marketing consent per contact and the sending health of the
 * workspace's WhatsApp number (plan N1).
 *
 *   GET    /api/leads/:id/consent          current consent with its history
 *   POST   /api/leads/:id/consent          record an opt-in { source, text }
 *   POST   /api/leads/:id/opt-out          record an opt-out { reason }
 *   GET    /api/whatsapp/health            number health + send queue counts
 *   POST   /api/whatsapp/health/resume     owner/admin resumes marketing
 *   POST   /api/whatsapp/health/pause      owner/admin pauses marketing
 *   GET    /api/whatsapp/send-queue        recent queue rows of this workspace
 */
const consent = require('../../services/consent');
const numberHealth = require('../../services/numberHealth');
const sendQueue = require('../../services/whatsappSendQueue');
const { requirePermission } = require('../../services/permissions');

module.exports = function registerSendSafetyRoutes(app, ctx) {
const { Leads, Clients, CampaignMessageQueue, NO_ID, auth } = ctx;

const leadId = (value) => {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};

const presentConsent = (row, lead) => ({
  lead_id: lead?.id ?? row?.lead_id ?? null,
  phone: lead?.phone || row?.phone || null,
  status: row?.status || (consent.optedOut(lead) ? 'opted_out' : 'none'),
  opt_in: row?.status === 'opted_in' ? { source: row.opt_in_source, at: row.opt_in_at, text: row.opt_in_text, by: row.opt_in_by ?? null } : null,
  opt_out: row?.status === 'opted_out' ? { source: row.opt_out_source, at: row.opt_out_at, text: row.opt_out_text, by: row.opt_out_by ?? null } : null,
  events: Array.isArray(row?.events) ? row.events.slice(-50) : [],
});

app.get('/api/leads/:id/consent', auth, async (req, res) => {
  try {
    const id = leadId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await Leads.findOne({ id }, { _id: 0, id: 1, phone: 1, opted_out: 1, whatsapp_opt_out: 1, whatsapp_opt_in: 1 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const row = await consent.getConsent({ phone: lead.phone, leadId: lead.id });
    res.json({ consent: presentConsent(row, lead) });
  } catch (err) {
    console.error('[consent]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// The agent records that the contact agreed to marketing messages, naming
// where (form, call, shop visit...) and the wording the contact agreed to.
app.post('/api/leads/:id/consent', auth, async (req, res) => {
  try {
    const id = leadId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const text = String(req.body?.text || '').trim();
    if (text.length < 3) return res.status(400).json({ error: 'text is required: the wording the contact agreed to' });
    const source = String(req.body?.source || 'manual').trim().toLowerCase();
    if (!consent.SOURCE_PATTERN.test(source)) return res.status(400).json({ error: 'source must be a short word such as manual, form, call or shop' });
    const lead = await Leads.findOne({ id }, { _id: 0, id: 1, phone: 1 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const row = await consent.recordOptIn({ leadId: lead.id, phone: lead.phone, source, text, by: req.user?.id ?? null });
    res.json({ consent: presentConsent(row, lead) });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[consent]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/opt-out', auth, async (req, res) => {
  try {
    const id = leadId(req.params.id);
    if (!id) return res.status(400).json({ error: 'Invalid lead id' });
    const lead = await Leads.findOne({ id }, { _id: 0, id: 1, phone: 1 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const row = await consent.recordOptOut({ leadId: lead.id, phone: lead.phone, source: 'manual', text: String(req.body?.reason || 'Opted out by the team').slice(0, 500), by: req.user?.id ?? null });
    res.json({ consent: presentConsent(row, lead), cancelled_queued: row.cancelled_queued });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[opt-out]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

async function brandNumber() {
  const brand = await Clients.findOne({}, { _id: 0, id: 1, name: 1, phone_number_id: 1, whatsapp_status: 1 }).lean();
  return brand?.phone_number_id ? brand : null;
}

app.get('/api/whatsapp/health', auth, async (req, res) => {
  try {
    const brand = await brandNumber();
    if (!brand) return res.status(409).json({ error: 'WhatsApp is not connected for this workspace. Connect WhatsApp in Settings first.', code: 'WHATSAPP_NOT_CONNECTED' });
    const [health, queue] = await Promise.all([numberHealth.summary(brand.phone_number_id), sendQueue.stats({})]);
    res.json({ brand: { id: brand.id, name: brand.name, whatsapp_status: brand.whatsapp_status }, health, queue });
  } catch (err) {
    console.error('[whatsapp/health]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/whatsapp/health/resume', auth, requirePermission('whatsapp.manage'), async (req, res) => {
  try {
    const brand = await brandNumber();
    if (!brand) return res.status(409).json({ error: 'WhatsApp is not connected for this workspace', code: 'WHATSAPP_NOT_CONNECTED' });
    const result = await numberHealth.resumeMarketing(brand.phone_number_id, { by: req.user?.id ?? null });
    if (!result.ok) return res.status(409).json({ error: result.message, code: result.code });
    res.json({ success: true, health: await numberHealth.summary(brand.phone_number_id) });
  } catch (err) {
    console.error('[whatsapp/health/resume]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/whatsapp/health/pause', auth, requirePermission('whatsapp.manage'), async (req, res) => {
  try {
    const brand = await brandNumber();
    if (!brand) return res.status(409).json({ error: 'WhatsApp is not connected for this workspace', code: 'WHATSAPP_NOT_CONNECTED' });
    await numberHealth.pauseMarketing(brand.phone_number_id, { by: req.user?.id ?? null, reason: req.body?.reason || 'Paused by the workspace' });
    res.json({ success: true, health: await numberHealth.summary(brand.phone_number_id) });
  } catch (err) {
    console.error('[whatsapp/health/pause]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/whatsapp/send-queue', auth, async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' && sendQueue.TERMINAL.concat('pending', 'processing').includes(req.query.status) ? req.query.status : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const filter = status ? { status } : {};
    const rows = await CampaignMessageQueue.find(filter, {
      ...NO_ID, id: 1, campaign_id: 1, lead_id: 1, phone: 1, name: 1, kind: 1, msg_type: 1, template_name: 1, status: 1, attempts: 1,
      next_attempt_at: 1, last_attempt_at: 1, error_message: 1, skip_reason: 1, wa_message_id: 1, created_at: 1, processed_at: 1, source: 1,
    }).sort({ created_at: -1 }).limit(limit).lean();
    res.json({ queue: await sendQueue.stats({}), rows: rows.map((row) => ({ ...row, phone: row.phone ? `…${String(row.phone).slice(-4)}` : null })) });
  } catch (err) {
    console.error('[whatsapp/send-queue]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
