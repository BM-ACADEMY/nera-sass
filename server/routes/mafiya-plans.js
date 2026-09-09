const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET all plans with their features
router.get('/', async (req, res) => {
  try {
    const plansRes = await pool.query('SELECT * FROM mafiya_plans ORDER BY price ASC');
    const plans = plansRes.rows;

    const featuresRes = await pool.query('SELECT * FROM mafiya_plan_features');
    const features = featuresRes.rows;

    const plansWithFeatures = plans.map(p => ({
      ...p,
      features: features.filter(f => f.plan_id === p.id)
    }));

    res.json(plansWithFeatures);
  } catch (err) {
    console.error('[Mafiya Plans] GET / error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new plan
router.post('/', async (req, res) => {
  const { name, price, currency, billing_cycle, features } = req.body;
  if (!name) return res.status(400).json({ error: 'Plan name is required' });
  
  try {
    await pool.query('BEGIN');
    
    const planRes = await pool.query(
      `INSERT INTO mafiya_plans (name, price, currency, billing_cycle, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING *`,
      [name, price || 0, currency || 'INR', billing_cycle || 'Monthly']
    );
    const newPlan = planRes.rows[0];

    const insertedFeatures = [];
    if (features && Array.isArray(features)) {
      for (const f of features) {
        if (f.feature_key) {
          const featRes = await pool.query(
            'INSERT INTO mafiya_plan_features (plan_id, feature_key, feature_name, limit_value, daily_limit) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [newPlan.id, f.feature_key, f.feature_name, f.limit_value !== undefined ? parseInt(f.limit_value) : -1, f.daily_limit !== undefined ? parseInt(f.daily_limit) : -1]
          );
          insertedFeatures.push(featRes.rows[0]);
        }
      }
    }

    await pool.query('COMMIT');
    res.status(201).json({ ...newPlan, features: insertedFeatures });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('[Mafiya Plans] POST / error:', err);
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
      `UPDATE mafiya_plans
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

    // If features are provided, rewrite them completely
    const insertedFeatures = [];
    if (features && Array.isArray(features)) {
      await pool.query('DELETE FROM mafiya_plan_features WHERE plan_id = $1', [id]);
      for (const f of features) {
        if (f.feature_key) {
          const featRes = await pool.query(
            'INSERT INTO mafiya_plan_features (plan_id, feature_key, feature_name, limit_value, daily_limit) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [id, f.feature_key, f.feature_name, f.limit_value !== undefined ? parseInt(f.limit_value) : -1, f.daily_limit !== undefined ? parseInt(f.daily_limit) : -1]
          );
          insertedFeatures.push(featRes.rows[0]);
        }
      }
      updatedPlan.features = insertedFeatures;
    } else {
      const featRes = await pool.query('SELECT * FROM mafiya_plan_features WHERE plan_id = $1', [id]);
      updatedPlan.features = featRes.rows;
    }

    await pool.query('COMMIT');
    res.json(updatedPlan);
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error('[Mafiya Plans] PUT /:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE plan
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if any client is currently subscribed to this plan
    const clientsRes = await pool.query('SELECT COUNT(*) FROM mafiya_gmb_clients WHERE plan_id = $1', [id]);
    const activeSubscribers = parseInt(clientsRes.rows[0].count, 10);
    if (activeSubscribers > 0) {
      return res.status(400).json({ 
        error: `Cannot delete plan. There are ${activeSubscribers} clients currently subscribed to this plan.` 
      });
    }

    const result = await pool.query('DELETE FROM mafiya_plans WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('[Mafiya Plans] DELETE /:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
