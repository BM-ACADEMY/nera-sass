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

// GET all plans with their features
router.get('/', async (req, res) => {
  try {
    const plansRes = await pool.query('SELECT * FROM thedal_plans WHERE status = $1 ORDER BY price ASC', ['active']);
    const plans = plansRes.rows;

    const featuresRes = await pool.query('SELECT * FROM thedal_plan_features');
    const features = featuresRes.rows;

    const plansWithFeatures = plans.map(p => ({
      ...p,
      features: features.filter(f => f.plan_id === p.id)
    }));

    res.json(plansWithFeatures);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new plan
router.post('/', async (req, res) => {
  const { name, price, currency, billing_cycle, features } = req.body;
  try {
    await pool.query('BEGIN');
    
    const planRes = await pool.query(
      `INSERT INTO thedal_plans (name, price, currency, billing_cycle, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
      [name, price, currency || 'INR', billing_cycle || 'Monthly']
    );
    const newPlan = planRes.rows[0];

    const insertedFeatures = [];
    if (features && Array.isArray(features)) {
      for (const f of features) {
        if (f.feature_key) {
          const featRes = await pool.query(
            'INSERT INTO thedal_plan_features (plan_id, feature_key, feature_name, limit_value, text_value) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [newPlan.id, f.feature_key, f.feature_name, f.limit_value !== undefined ? f.limit_value : -1, f.text_value || null]
          );
          insertedFeatures.push(featRes.rows[0]);
        }
      }
    }

    await pool.query('COMMIT');
    res.status(201).json({ ...newPlan, features: insertedFeatures });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update plan
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, currency, billing_cycle, status, features } = req.body;
  try {
    await pool.query('BEGIN');
    
    const planRes = await pool.query(
      `UPDATE thedal_plans
       SET name = COALESCE($1, name),
           price = COALESCE($2, price),
           currency = COALESCE($3, currency),
           billing_cycle = COALESCE($4, billing_cycle),
           status = COALESCE($5, status)
       WHERE id = $6 RETURNING *`,
      [name, price, currency, billing_cycle, status, id]
    );
    
    if (planRes.rowCount === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Plan not found' });
    }
    const updatedPlan = planRes.rows[0];

    // If features are provided, rewrite them completely for simplicity
    const insertedFeatures = [];
    if (features && Array.isArray(features)) {
      await pool.query('DELETE FROM thedal_plan_features WHERE plan_id = $1', [id]);
      for (const f of features) {
        if (f.feature_key) {
          const featRes = await pool.query(
            'INSERT INTO thedal_plan_features (plan_id, feature_key, feature_name, limit_value, text_value) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, f.feature_key, f.feature_name, f.limit_value !== undefined ? f.limit_value : -1, f.text_value || null]
          );
          insertedFeatures.push(featRes.rows[0]);
        }
      }
      updatedPlan.features = insertedFeatures;
    } else {
      const featRes = await pool.query('SELECT id, plan_id, feature_key, feature_name, limit_value, text_value FROM thedal_plan_features WHERE plan_id = $1', [id]);
      updatedPlan.features = featRes.rows;
    }

    await pool.query('COMMIT');
    res.json(updatedPlan);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error updating plan' });
  }
});

// ── MASTER FEATURE DEFINITIONS ──

// GET all available feature definitions
router.get('/features/list', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM thedal_feature_definitions ORDER BY id ASC');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch features' });
  }
});

// POST new feature definition
router.post('/features/list', async (req, res) => {
  const { key, name, type } = req.body;
  if (!key || !name) return res.status(400).json({ error: 'Key and Name are required.' });
  try {
    // Validate key uniqueness
    const checkUnique = await pool.query('SELECT id FROM thedal_feature_definitions WHERE key = $1', [key]);
    if (checkUnique.rows.length > 0) {
      return res.status(400).json({ error: 'Feature key must be unique.' });
    }

    const { rows } = await pool.query(
      'INSERT INTO thedal_feature_definitions (key, name, type) VALUES ($1, $2, $3) RETURNING *',
      [key, name, type || 'boolean']
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create feature definition' });
  }
});

// PUT update feature definition
router.put('/features/list/:id', async (req, res) => {
  const { id } = req.params;
  const { key, name, type } = req.body;
  try {
    await pool.query('BEGIN');
    
    // Get the old key first
    const oldFeatureRes = await pool.query('SELECT key FROM thedal_feature_definitions WHERE id = $1', [id]);
    if (oldFeatureRes.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ error: 'Feature not found' });
    }
    const oldKey = oldFeatureRes.rows[0].key;

    // Check key uniqueness if it changed
    if (key && key !== oldKey) {
      const checkUnique = await pool.query('SELECT id FROM thedal_feature_definitions WHERE key = $1', [key]);
      if (checkUnique.rows.length > 0) {
        await pool.query('ROLLBACK');
        return res.status(400).json({ error: 'Feature key must be unique.' });
      }
    }

    // Update the definition
    const { rows } = await pool.query(
      'UPDATE thedal_feature_definitions SET key = COALESCE($1, key), name = COALESCE($2, name), type = COALESCE($3, type) WHERE id = $4 RETURNING *',
      [key, name, type, id]
    );

    // If key changed, cascade update to all assigned plans
    if (key && key !== oldKey) {
      await pool.query(
        'UPDATE thedal_plan_features SET feature_key = $1 WHERE feature_key = $2',
        [key, oldKey]
      );
    }

    await pool.query('COMMIT');
    res.json(rows[0]);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Failed to update feature definition. Key must be unique.' });
  }
});

// DELETE feature definition
router.delete('/features/list/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM thedal_feature_definitions WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Feature not found' });
    res.json({ message: 'Feature deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to delete feature definition' });
  }
});

// DELETE plan
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Get plan details first
    const planRes = await pool.query('SELECT name FROM thedal_plans WHERE id = $1', [id]);
    if (planRes.rows.length === 0) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    const planName = planRes.rows[0].name;

    // Check if any client is currently subscribed to this plan
    const clientsRes = await pool.query('SELECT COUNT(*) FROM thedal_clients WHERE plan = $1', [planName]);
    const activeSubscribers = parseInt(clientsRes.rows[0].count, 10);
    if (activeSubscribers > 0) {
      return res.status(400).json({ 
        error: `Cannot delete plan. There are ${activeSubscribers} clients currently subscribed to this plan.` 
      });
    }

    const result = await pool.query('DELETE FROM thedal_plans WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error deleting plan' });
  }
});

module.exports = router;
