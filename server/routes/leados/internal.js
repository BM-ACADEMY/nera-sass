/**
 * LeadOS routes: Internal endpoints called by n8n.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerInternalRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  Leads,
  Messages,
  axios,
  internalAuth,
  io,
  upsertOne,
} = ctx;
const { tenantCanSend, tenantLifecycle } = require('../../services/lifecycle');
const { internalPlatformAuth } = require('../../middleware/authMiddleware');
const ai = require('../../services/aiAutomation');
const { BrainDocs } = ctx;
// ── INTERNAL (called by n8n) ──────────────────────────────

// POST /api/internal/save-conversation
app.post('/api/internal/save-conversation', internalAuth, async (req, res) => {
  try {
    const { lead_id, direction, message, sender, wa_message_id } = req.body;
    // The old SQL wrote message columns into conversations (which has none of
    // them); store the message on the lead's conversation instead.
    const lead = await Leads.findOne({ id: lead_id }, { _id: 0, id: 1, phone: 1 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const conversation = await upsertOne(
      Conversations,
      lead.phone ? { phone: lead.phone } : { lead_id: lead.id },
      { $set: { lead_id: lead.id, last_message: message, last_message_at: new Date() } },
      { lead_id: lead.id, phone: lead.phone || null, status: 'open', last_message: message, last_message_at: new Date(), created_at: new Date() }
    );
    await Messages.create({
      conversation_id: conversation.id, direction, content: message, msg_type: 'text', wa_msg_id: wa_message_id || null,
      is_ai: sender === 'ai' || sender === 'bot', status: 'sent', sent_at: new Date(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/internal/update-lead
app.post('/api/internal/update-lead', internalAuth, async (req, res) => {
  try {
    const { lead_id, status, score, interest } = req.body;
    const leadChanges = { updated_at: new Date() };
    if (status != null) leadChanges.status = status;
    if (score != null) leadChanges.score = score;
    if (interest != null) leadChanges.interest = interest;
    await Leads.updateOne({ id: lead_id }, { $set: leadChanges });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

class SendError extends Error {
  constructor(status, error, code) { super(error); this.status = status; this.code = code; }
}

// Sends one WhatsApp message to a lead of the calling tenant with the brand's
// own token (never handed to n8n), then stores it on the lead's thread.
// `build(to)` returns the Graph payload; `content` is what the inbox shows.
async function sendToLead(req, leadIdRaw, content, build) {
  const leadId = Number(leadIdRaw);
  if (!Number.isInteger(leadId) || leadId <= 0) throw new SendError(400, 'lead_id is required');
  if (!(await tenantCanSend(req.tenant.id))) throw new SendError(403, 'This workspace cannot send messages', 'SEND_BLOCKED');

  const lead = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, phone: 1, client_id: 1 }).lean();
  if (!lead || !lead.phone) throw new SendError(404, 'Lead not found');
  const brand = lead.client_id != null
    ? await Clients.findOne({ id: lead.client_id }, { _id: 0, id: 1, phone_number_id: 1, wa_access_token: 1 }).lean()
    : null;
  if (!brand?.phone_number_id || !brand?.wa_access_token) throw new SendError(409, 'WhatsApp is not connected for this lead', 'WHATSAPP_NOT_CONNECTED');

  const to = String(lead.phone).replace(/\D/g, '');
  let waMessageId = null;
  try {
    const sent = await axios.post(`https://graph.facebook.com/v21.0/${brand.phone_number_id}/messages`,
      { messaging_product: 'whatsapp', to, ...build(to) },
      { headers: { Authorization: `Bearer ${brand.wa_access_token}`, 'Content-Type': 'application/json' }, timeout: 15000 });
    waMessageId = sent.data?.messages?.[0]?.id || null;
  } catch (err) {
    throw new SendError(502, err.response?.data?.error?.message || 'WhatsApp refused the message', 'WHATSAPP_SEND_FAILED');
  }

  const conversation = await upsertOne(
    Conversations,
    { phone: to.slice(-10) },
    { $set: { lead_id: lead.id, last_message: content, last_message_at: new Date() } },
    { lead_id: lead.id, status: 'open', last_message: content, last_message_at: new Date(), created_at: new Date() }
  );
  const saved = await Messages.create({
    conversation_id: conversation.id, direction: 'outbound', content, msg_type: 'text',
    wa_msg_id: waMessageId, is_ai: true, status: 'sent', sent_at: new Date(),
  });
  io.emit('ai_typing', { lead_id: String(lead.id), typing: false });
  io.emit('outgoing_message', { lead_id: String(lead.id), message: {
    id: saved.id, direction: 'outbound', content, type: 'text', wa_msg_id: waMessageId, status: 'sent', is_ai: true, timestamp: saved.sent_at,
  } });
  return { success: true, wa_message_id: waMessageId, message_id: saved.id };
}

const sendRoute = (name, handler) => async (req, res) => {
  try {
    res.json(await handler(req));
  } catch (err) {
    if (err instanceof SendError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
    console.error(`[internal/${name}]`, err.message);
    res.status(500).json({ error: 'Server error' });
  }
};

// POST /api/internal/send-reply   { lead_id, message }
// n8n's AI reply (inside the 24-hour customer window).
app.post('/api/internal/send-reply', internalAuth, sendRoute('send-reply', (req) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message || message.length > 4096) throw new SendError(400, 'message must be 1 to 4096 characters');
  return sendToLead(req, req.body?.lead_id, message, () => ({ type: 'text', text: { body: message } }));
}));

// POST /api/internal/send-template   { lead_id, template, language?, body_params? }
// Approved templates (welcome, payment confirmation); work outside the window.
app.post('/api/internal/send-template', internalAuth, sendRoute('send-template', (req) => {
  const template = String(req.body?.template || '').trim();
  const language = String(req.body?.language || 'en').trim();
  const params = Array.isArray(req.body?.body_params) ? req.body.body_params : [];
  if (!/^[a-z0-9_]{1,512}$/.test(template)) throw new SendError(400, 'template must be an approved template name (a-z, 0-9, _)');
  if (!/^[a-zA-Z_]{2,10}$/.test(language)) throw new SendError(400, 'language must be a code such as en or en_US');
  if (params.length > 20 || params.some((v) => String(v ?? '').length > 1024)) throw new SendError(400, 'body_params: up to 20 values of 1024 characters');
  const components = params.length ? [{ type: 'body', parameters: params.map((v) => ({ type: 'text', text: String(v ?? '') })) }] : undefined;
  return sendToLead(req, req.body?.lead_id, `[Template] ${template}`, () => ({
    type: 'template', template: { name: template, language: { code: language }, ...(components ? { components } : {}) },
  }));
}));

// GET /api/internal/context?lead_id=&before_message_id=&limit=
// Everything WF1/WF3 need to write one reply: business settings, knowledge,
// the lead and its recent messages (older than before_message_id, which is
// the message being answered and is sent separately).
app.get('/api/internal/context', internalAuth, async (req, res) => {
  try {
    const leadId = Number(req.query.lead_id);
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: 'lead_id is required' });
    const lead = await Leads.findOne({ id: leadId }, { _id: 0 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' }); // tenant scope: another tenant's lead is 404
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 30);
    const before = Number(req.query.before_message_id);
    const conversationIds = await Conversations.distinct('id', { lead_id: lead.id });
    const filter = { conversation_id: { $in: conversationIds } };
    if (Number.isInteger(before) && before > 0) filter.id = { $lt: before };
    const [brain, messages] = await Promise.all([
      lead.client_id != null ? BrainDocs.find({ client_id: lead.client_id }, { _id: 0, doc_type: 1, content: 1 }).lean() : [],
      Messages.find(filter, { _id: 0, id: 1, direction: 1, content: 1, is_ai: 1, sent_at: 1 }).sort({ id: -1 }).limit(limit).lean(),
    ]);
    const tenant = req.tenant || {};
    res.json({
      business_name: tenant.name || null,
      language: tenant.ai_language || null,
      tone: tenant.ai_tone || null,
      rules: tenant.ai_rules || null,
      scoring_rules: tenant.scoring_rules || null,
      supervised: Boolean(tenant.ai_supervised),
      ai_paused: Boolean(lead.ai_paused) || ai.optedOut(lead),
      brain: brain.filter((b) => b.content).map((b) => ({ doc_type: b.doc_type, content: b.content })),
      lead: { id: lead.id, name: lead.name || null, status: lead.status || null, score: lead.score ?? null, interest: lead.interest || null },
      messages: messages.reverse().map((m) => ({ id: m.id, direction: m.direction, content: m.content || '', is_ai: Boolean(m.is_ai), at: m.sent_at })),
    });
  } catch (err) {
    console.error('[internal/context]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/internal/handover   { lead_id, reason, draft?, mode? }
// mode: pause (default: AI stops for this chat), notify (a person is told,
// AI continues), hot (hot-lead alert, once per lead).
app.post('/api/internal/handover', internalAuth, async (req, res) => {
  try {
    const leadId = Number(req.body?.lead_id);
    const mode = req.body?.mode || 'pause';
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: 'lead_id is required' });
    if (!['pause', 'notify', 'hot'].includes(mode)) return res.status(400).json({ error: 'mode must be pause, notify or hot' });
    const result = await ai.handover(io, { leadId, reason: req.body?.reason, draft: req.body?.draft, mode });
    if (!result) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[internal/handover]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/internal/followups/due   (service key, all tenants)
// Leads whose AI follow-up is due. Each returned lead is leased for an hour
// so an overlapping run cannot send it twice; /followups/mark sets the real
// next date. Paused, opted-out, closed and blocked leads never appear, and
// nothing is returned outside 9:00-21:00 in the workspace's time zone.
app.get('/api/internal/followups/due', internalPlatformAuth, async (req, res) => {
  try {
    const now = new Date();
    const leads = await Leads.find({
      ai_followup_due: { $ne: null, $lte: now },
      ai_followup_step: { $lt: ai.MAX_FOLLOWUP_STEPS },
      ai_paused: { $ne: true },
      needs_human: { $ne: true },
      opted_out: { $ne: true },
      whatsapp_opt_out: { $ne: true },
      status: { $nin: ai.CLOSED_STATUSES },
      phone: { $nin: [null, ''] },
    }, { _id: 0, id: 1, tenant_id: 1, name: 1, ai_followup_step: 1, ai_followup_due: 1, last_inbound_at: 1 }).sort({ ai_followup_due: 1 }).limit(100).lean();

    const tenants = new Map();
    const items = [];
    for (const lead of leads) {
      if (!tenants.has(lead.tenant_id)) {
        const { tenant } = await tenantLifecycle(lead.tenant_id);
        const usable = tenant && (await tenantCanSend(lead.tenant_id)) && tenant.ai_enabled !== false && tenant.ai_followups_enabled !== false;
        tenants.set(lead.tenant_id, usable ? tenant : null);
      }
      const tenant = tenants.get(lead.tenant_id);
      if (!tenant || !ai.inSendingHours(tenant, now)) continue;
      const leased = await Leads.updateOne(
        { id: lead.id, tenant_id: lead.tenant_id, ai_followup_due: lead.ai_followup_due },
        { $set: { ai_followup_due: new Date(now.getTime() + ai.HOUR_MS) } },
      );
      if (leased.modifiedCount !== 1) continue;
      const lastInbound = lead.last_inbound_at ? new Date(lead.last_inbound_at).getTime() : 0;
      items.push({
        tenant_id: lead.tenant_id,
        lead_id: lead.id,
        name: lead.name || null,
        step: Number(lead.ai_followup_step || 0) + 1,
        in_window: lastInbound > 0 && now.getTime() - lastInbound < ai.DAY_MS,
        template: tenant.followup_template || process.env.AI_FOLLOWUP_TEMPLATE || 'follow_up',
        language: tenant.language || 'en',
      });
    }
    res.json({ items });
  } catch (err) {
    console.error('[internal/followups/due]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/internal/followups/mark   { lead_id, step }
app.post('/api/internal/followups/mark', internalAuth, async (req, res) => {
  try {
    const ok = await ai.markFollowupSent(req.body?.lead_id, req.body?.step);
    if (!ok) return res.status(400).json({ error: `lead_id and a step from 1 to ${ai.MAX_FOLLOWUP_STEPS} are required` });
    res.json({ success: true });
  } catch (err) {
    console.error('[internal/followups/mark]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
