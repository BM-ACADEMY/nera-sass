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
const { tenantCanSend } = require('../../services/lifecycle');
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
};
