/**
 * LeadOS routes: Inbox list and read state.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerInboxRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  Leads,
  auth,
  phoneTailRegex,
} = ctx;
// ══════════════════════════════════════════════════════════
// INBOX ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/inbox
app.get('/api/inbox', auth, async (req, res) => {
  try {
    // Fetch latest message per lead
    // Latest conversation per lead — matched by lead_id, or by phone (last 10 digits) for unlinked conversations
    const phoneTail = (value) => (value == null ? null : String(value).replace(/[^0-9]/g, '').slice(-10));
    const conversations = await Conversations.find({}, { lead_id: 1, phone: 1, last_message: 1, last_message_at: 1, unread_count: 1 }).lean();
    const byLead = new Map();
    const byTail = new Map();
    for (const cv of conversations) {
      if (cv.lead_id != null) {
        if (!byLead.has(cv.lead_id)) byLead.set(cv.lead_id, []);
        byLead.get(cv.lead_id).push(cv);
      } else if (phoneTail(cv.phone) != null) {
        if (!byTail.has(phoneTail(cv.phone))) byTail.set(phoneTail(cv.phone), []);
        byTail.get(phoneTail(cv.phone)).push(cv);
      }
    }
    const leads = await Leads.find({}, { id: 1, name: 1, client_id: 1, status: 1, phone: 1 }).lean();
    const clientNames = new Map((await Clients.find({}, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const rows = [];
    for (const l of leads) {
      const matched = [...(byLead.get(l.id) || []), ...(phoneTail(l.phone) != null ? byTail.get(phoneTail(l.phone)) || [] : [])];
      if (!matched.length) continue;
      const latest = [...matched].sort((a, b) => (b.last_message_at ? new Date(b.last_message_at).getTime() : -Infinity)
        - (a.last_message_at ? new Date(a.last_message_at).getTime() : -Infinity))[0];
      rows.push({
        id: l.id,
        name: l.name,
        brand: clientNames.get(l.client_id) ?? null,
        status: l.status,
        last: latest.last_message ?? null,
        time: latest.last_message_at ?? null,
        unread: matched.reduce((sum, cv) => sum + (Number(cv.unread_count) || 0), 0),
      });
    }
    rows.sort((a, b) => (b.time ? new Date(b.time).getTime() : -Infinity) - (a.time ? new Date(a.time).getTime() : -Infinity));
    res.json(rows);
  } catch (err) {
    console.error('Inbox fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/conversations/:lead_id/read
app.put('/api/conversations/:lead_id/read', auth, async (req, res) => {
  try {
    const readLead = await Leads.findOne({ id: req.params.lead_id }, { phone: 1 }).lean();
    const readFilter = [{ lead_id: req.params.lead_id }];
    if (readLead && readLead.phone != null) readFilter.push({ phone: phoneTailRegex(readLead.phone) });
    await Conversations.updateMany({ $or: readFilter }, { $set: { unread_count: 0 } });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
};
