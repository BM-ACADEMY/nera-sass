const express = require('express');
const { Organisations, Outreach } = require('../models');
const router = express.Router();

// GET /api/alliance-inbox
router.get('/', async (req, res) => {
  try {
    // Latest outreach per organisation (only organisations that have outreach)
    const latest = await Outreach.aggregate([
      { $sort: { sent_at: -1 } },
      { $group: { _id: '$org_id', last: { $first: '$content' }, time: { $first: '$sent_at' } } },
    ]);
    const latestByOrg = new Map(latest.map((item) => [item._id, item]));
    const orgs = await Organisations.find({ id: { $in: [...latestByOrg.keys()] } }, { _id: 0, id: 1, name: 1, type: 1, status: 1 }).lean();
    const rows = orgs.map((o) => ({
      id: o.id,
      name: o.name,
      brand: o.type,
      status: o.status,
      last: latestByOrg.get(o.id)?.last ?? null,
      time: latestByOrg.get(o.id)?.time ?? null,
      unread: 0,
    }));
    // ORDER BY time DESC NULLS LAST
    rows.sort((a, b) => (b.time ? new Date(b.time).getTime() : -Infinity) - (a.time ? new Date(a.time).getTime() : -Infinity));
    res.json(rows);
  } catch (err) {
    console.error('Alliance Inbox fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/alliance-inbox/:id
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const org = await Organisations.findOne({ id }).lean();
    if (!org) return res.status(404).json({ error: 'Not found' });

    // Convert outreach records to conversation format
    const outreach = await Outreach.find({ org_id: id }).sort({ sent_at: 1 }).lean();

    const conversations = [];
    for (const r of outreach) {
      // Outbound message
      if (r.content) {
        conversations.push({
          direction: 'outbound',
          message: r.content,
          sender: 'ai',
          sent_at: r.sent_at
        });
      }
      // Inbound reply
      if (r.replied && r.reply_text) {
        conversations.push({
          direction: 'inbound',
          message: r.reply_text,
          sender: 'lead',
          sent_at: r.replied_at || r.sent_at // fallback
        });
      }
    }

    // Sort combined conversations by time
    conversations.sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));

    res.json({ lead: org, conversations });
  } catch (err) {
    console.error('Alliance conversation fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/alliance-inbox/:id/send
router.post('/:id/send', async (req, res) => {
  const { id } = req.params;
  const { message } = req.body;
  try {
    const row = await Outreach.create({ org_id: id, channel: 'whatsapp', msg_type: 'text', content: message, sent_at: new Date() });
    res.json({ success: true, message: row.toObject() });
  } catch (err) {
    console.error('Alliance send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
