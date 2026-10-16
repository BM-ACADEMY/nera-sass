/**
 * LeadOS routes: Internal endpoints called by n8n.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerInternalRoutes(app, ctx) {
const {
  Conversations,
  Leads,
  Messages,
  internalAuth,
  upsertOne,
} = ctx;
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
};
