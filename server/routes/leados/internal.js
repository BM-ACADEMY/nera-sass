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

// POST /api/internal/send-reply
// n8n sends the AI reply text here; the server sends it with the brand's own
// WhatsApp token (never handed to n8n) and stores it on the lead's thread.
app.post('/api/internal/send-reply', internalAuth, async (req, res) => {
  try {
    const leadId = Number(req.body?.lead_id);
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!Number.isInteger(leadId) || leadId <= 0) return res.status(400).json({ error: 'lead_id is required' });
    if (!message || message.length > 4096) return res.status(400).json({ error: 'message must be 1 to 4096 characters' });
    if (!(await tenantCanSend(req.tenant.id))) return res.status(403).json({ error: 'This workspace cannot send messages', code: 'SEND_BLOCKED' });

    const lead = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, phone: 1, client_id: 1 }).lean();
    if (!lead || !lead.phone) return res.status(404).json({ error: 'Lead not found' });
    const brand = lead.client_id != null
      ? await Clients.findOne({ id: lead.client_id }, { _id: 0, id: 1, phone_number_id: 1, wa_access_token: 1 }).lean()
      : null;
    if (!brand?.phone_number_id || !brand?.wa_access_token) return res.status(409).json({ error: 'WhatsApp is not connected for this lead', code: 'WHATSAPP_NOT_CONNECTED' });

    let waMessageId = null;
    try {
      const sent = await axios.post(`https://graph.facebook.com/v21.0/${brand.phone_number_id}/messages`,
        { messaging_product: 'whatsapp', to: String(lead.phone).replace(/\D/g, ''), type: 'text', text: { body: message } },
        { headers: { Authorization: `Bearer ${brand.wa_access_token}`, 'Content-Type': 'application/json' }, timeout: 15000 });
      waMessageId = sent.data?.messages?.[0]?.id || null;
    } catch (err) {
      return res.status(502).json({ error: err.response?.data?.error?.message || 'WhatsApp refused the message', code: 'WHATSAPP_SEND_FAILED' });
    }

    const normalizedPhone = String(lead.phone).replace(/\D/g, '').slice(-10);
    const conversation = await upsertOne(
      Conversations,
      { phone: normalizedPhone },
      { $set: { lead_id: lead.id, last_message: message, last_message_at: new Date() } },
      { lead_id: lead.id, status: 'open', last_message: message, last_message_at: new Date(), created_at: new Date() }
    );
    const saved = await Messages.create({
      conversation_id: conversation.id, direction: 'outbound', content: message, msg_type: 'text',
      wa_msg_id: waMessageId, is_ai: true, status: 'sent', sent_at: new Date(),
    });
    io.emit('ai_typing', { lead_id: String(lead.id), typing: false });
    io.emit('outgoing_message', { lead_id: String(lead.id), message: {
      id: saved.id, direction: 'outbound', content: message, type: 'text', wa_msg_id: waMessageId, status: 'sent', is_ai: true, timestamp: saved.sent_at,
    } });
    res.json({ success: true, wa_message_id: waMessageId, message_id: saved.id });
  } catch (err) {
    console.error('[internal/send-reply]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
