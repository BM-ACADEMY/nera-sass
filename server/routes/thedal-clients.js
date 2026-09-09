const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

// Helper to ensure updated_at column exists
let isTableAltered = false;
async function ensureUpdatedAtColumn() {
  if (isTableAltered) return;
  try {
    await pool.query(`ALTER TABLE thedal_clients ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    isTableAltered = true;
  } catch (e) {
    console.error('Error altering table:', e.message);
  }
}

// GET all clients (with auto-expiration check)
router.get('/', async (req, res) => {
  try {
    await ensureUpdatedAtColumn();
    // Keep Thedal clients connected to their GMB/Keyword Tracking record when
    // both records use the same website domain. Existing explicit mappings win.
    try {
      await pool.query(`
        UPDATE thedal_clients AS tc
           SET gmb_client_id = mgc.id,
               updated_at = NOW()
          FROM mafiya_gmb_clients AS mgc
         WHERE tc.gmb_client_id IS NULL
           AND NULLIF(TRIM(tc.domain), '') IS NOT NULL
           AND LOWER(REGEXP_REPLACE(REGEXP_REPLACE(tc.domain, '^https?://(www\\.)?', ''), '/.*$', '')) =
               LOWER(REGEXP_REPLACE(REGEXP_REPLACE(mgc.website_url, '^https?://(www\\.)?', ''), '/.*$', ''))
      `);
    } catch (mappingErr) {
      console.warn('Unable to auto-map Thedal clients to GMB clients:', mappingErr.message);
    }
    const result = await pool.query('SELECT * FROM thedal_clients ORDER BY created_at DESC');
    const clients = result.rows;

    // Fetch plans to get billing_cycle details
    const plansRes = await pool.query('SELECT * FROM thedal_plans');
    const plans = plansRes.rows || [];

    const now = Date.now();

    for (let client of clients) {
      if (!client.plan || client.plan === 'Free' || client.subscription_duration === 'Lifetime') {
        continue;
      }

      const planObj = plans.find(p => p.name === client.plan);
      let allowedDays = 30; // default 30 days

      if (planObj && Number(planObj.billing_cycle) === -1) {
        continue; // Lifetime plan
      } else if (planObj && Number(planObj.billing_cycle) > 0) {
        allowedDays = Number(planObj.billing_cycle);
      }

      // Parse custom subscription duration if set (e.g., "45 Days")
      if (client.subscription_duration) {
        const match = client.subscription_duration.match(/(\d+)\s*Days/i);
        if (match) {
          allowedDays = parseInt(match[1], 10);
        }
      }

      const startDate = new Date(client.updated_at || client.created_at || now).getTime();
      const daysElapsed = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));

      if (daysElapsed >= allowedDays) {
        console.log(`[Thedal Subscriptions] Client ${client.domain} (ID ${client.id}) plan ${client.plan} EXPIRED (${daysElapsed}/${allowedDays} days). Moving to Free plan.`);
        
        await pool.query(
          `UPDATE thedal_clients SET plan = 'Free', subscription_duration = 'Lifetime', updated_at = NOW() WHERE id = $1`,
          [client.id]
        );

        client.plan = 'Free';
        client.subscription_duration = 'Lifetime';
        client.is_expired_auto_downgraded = true;
      }
    }

    res.json(clients);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new client
router.post('/', async (req, res) => {
  const { domain, plan, client_name, phone, email, business_name, business_category, subscription_duration } = req.body;
  try {
    await ensureUpdatedAtColumn();
    const result = await pool.query(
      `INSERT INTO thedal_clients (domain, plan, client_name, phone, email, business_name, business_category, subscription_duration, status, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', NOW()) RETURNING *`,
      [domain, plan || 'Free', client_name, phone, email, business_name, business_category, subscription_duration || '1 Month']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update client
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { domain, plan, client_name, phone, email, business_name, business_category, subscription_duration, status } = req.body;
  try {
    await ensureUpdatedAtColumn();
    const result = await pool.query(
      `UPDATE thedal_clients
       SET domain = COALESCE($1, domain),
           plan = COALESCE($2, plan),
           client_name = COALESCE($3, client_name),
           phone = COALESCE($4, phone),
           email = COALESCE($5, email),
           business_name = COALESCE($6, business_name),
           business_category = COALESCE($7, business_category),
           subscription_duration = COALESCE($8, subscription_duration),
           status = COALESCE($9, status),
           updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [domain, plan, client_name, phone, email, business_name, business_category, subscription_duration, status, id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE client
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query('DELETE FROM thedal_clients WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ message: 'Client deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
