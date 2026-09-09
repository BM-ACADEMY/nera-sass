const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// Auto-initialize table & seed default data
const initTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mafiya_orders (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        priority VARCHAR(20) DEFAULT 'High',
        tag_category VARCHAR(100),
        assignee VARCHAR(100) DEFAULT 'Satish',
        client_name VARCHAR(255),
        description TEXT,
        box_type VARCHAR(50) DEFAULT 'steps',
        box_content JSONB DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'open',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    const countRes = await pool.query('SELECT COUNT(*) FROM mafiya_orders');
    if (parseInt(countRes.rows[0].count) === 0) {
      // Seed default orders matching the screenshot
      await pool.query(`
        INSERT INTO mafiya_orders (title, priority, tag_category, assignee, client_name, description, box_type, box_content, status)
        VALUES
        (
          'Fix Justdial listing — Namma Pondy Properties',
          'High',
          'Citation mismatch',
          'Satish',
          'Namma Pondy Properties',
          'Name mismatch between Justdial and Google. This tells Google your business info can''t be trusted — rank drops.',
          'steps',
          '{"steps": ["Go to justdial.com/business-owner-login", "Find ''Namma Pondy Realty'' listing — Click Edit", "Change name to: Namma Pondy Properties", "Save and mark done"]}',
          'open'
        ),
        (
          'Upload 3 photos to GMB — BM Academy',
          'Medium',
          'Photo freshness',
          'Babila',
          'BM Academy',
          'No new photos in 16 days. Google rewards active profiles with higher visibility.',
          'photos',
          '{"photosNeeded": "Office interior · Team photo · Class in session", "captions": ["BM Academy — Pondicherry''s #1 digital marketing training centre", "Expert faculty with 14+ years of industry experience", "Hands-on practical training — not just theory, real results"]}',
          'open'
        ),
        (
          'Add services list to GBP — BM TechX',
          'Low',
          'Profile completeness',
          'Satish',
          'BM TechX',
          'GBP services list is empty. Competitors have 8-12 services. Missing = missing keyword matches.',
          'services',
          '{"servicesText": "Services to add (copy-paste into GBP → Edit → Services):", "servicesList": ["Social Media Marketing", "Google Ads Management", "SEO Services", "Website Design & Development", "Branding & Logo Design", "Google Business Profile Management", "Meta Ads", "Content Creation"]}',
          'open'
        );
      `);
      console.log('✅ mafiya_orders table seeded with initial orders');
    }
  } catch (err) {
    console.error('Error initializing mafiya_orders table:', err.message);
  }
};

initTable();

// GET all orders
router.get('/', async (req, res) => {
  try {
    const { status, priority, client } = req.query;
    let query = 'SELECT * FROM mafiya_orders WHERE 1=1';
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND status = $${params.length}`;
    }
    if (priority) {
      params.push(priority);
      query += ` AND priority = $${params.length}`;
    }
    if (client) {
      params.push(`%${client}%`);
      query += ` AND client_name ILIKE $${params.length}`;
    }

    query += ' ORDER BY id ASC';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[Mafiya Orders] GET / error:', err);
    res.status(500).json({ error: 'Server error fetching orders' });
  }
});

// POST new order
router.post('/', async (req, res) => {
  const { title, priority, tag_category, assignee, client_name, description, box_type, box_content } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Order title is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO mafiya_orders (title, priority, tag_category, assignee, client_name, description, box_type, box_content, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'open')
       RETURNING *`,
      [
        title,
        priority || 'High',
        tag_category || 'General',
        assignee || 'Satish',
        client_name || 'General Client',
        description || '',
        box_type || 'steps',
        JSON.stringify(box_content || {})
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[Mafiya Orders] POST / error:', err);
    res.status(500).json({ error: 'Server error creating order' });
  }
});

// PATCH toggle status (open/completed)
router.patch('/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      'UPDATE mafiya_orders SET status = $1 WHERE id = $2 RETURNING *',
      [status || 'completed', id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Mafiya Orders] PATCH /:id/status error:', err);
    res.status(500).json({ error: 'Server error updating order status' });
  }
});

// PATCH update assignee
router.patch('/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { assignee } = req.body;

  try {
    const result = await pool.query(
      'UPDATE mafiya_orders SET assignee = $1 WHERE id = $2 RETURNING *',
      [assignee, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[Mafiya Orders] PATCH /:id/assign error:', err);
    res.status(500).json({ error: 'Server error updating assignee' });
  }
});

// DELETE order
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM mafiya_orders WHERE id = $1', [id]);
    res.json({ success: true, id });
  } catch (err) {
    console.error('[Mafiya Orders] DELETE /:id error:', err);
    res.status(500).json({ error: 'Server error deleting order' });
  }
});

module.exports = router;
