const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/alliance-inbox
router.get('/', async (req, res) => {
  try {
    const q = `
      SELECT 
        o.id, 
        o.name, 
        o.type as brand, 
        o.status,
        (SELECT content FROM outreach WHERE org_id = o.id ORDER BY sent_at DESC LIMIT 1) as last,
        (SELECT sent_at FROM outreach WHERE org_id = o.id ORDER BY sent_at DESC LIMIT 1) as time,
        0 as unread
      FROM organisations o
      WHERE EXISTS (SELECT 1 FROM outreach WHERE org_id = o.id)
      ORDER BY time DESC NULLS LAST
    `;
    const { rows } = await db.query(q);
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
    const org = await db.query('SELECT * FROM organisations WHERE id = $1', [id]);
    if (!org.rows.length) return res.status(404).json({ error: 'Not found' });
    
    // Convert outreach records to conversation format
    const outreach = await db.query('SELECT * FROM outreach WHERE org_id = $1 ORDER BY sent_at ASC', [id]);
    
    const conversations = [];
    for (const r of outreach.rows) {
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

    res.json({ lead: org.rows[0], conversations });
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
    const q = `
      INSERT INTO outreach (org_id, channel, msg_type, content, sent_at)
      VALUES ($1, 'whatsapp', 'text', $2, NOW())
      RETURNING *
    `;
    const { rows } = await db.query(q, [id, message]);
    res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('Alliance send message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
