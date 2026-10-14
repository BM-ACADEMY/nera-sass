const express = require('express');
const router = express.Router();
const { MafiyaPlans, MafiyaPlanFeatures, MafiyaGmbClients } = require('../models');
const { deleteCascade } = require('../db/cascade');

const NO_ID = { _id: 0 };

const createFeatures = async (planId, features) => {
  const inserted = [];
  for (const f of features) {
    if (f.feature_key) {
      const feature = await MafiyaPlanFeatures.create({
        plan_id: planId,
        feature_key: f.feature_key,
        feature_name: f.feature_name,
        limit_value: f.limit_value !== undefined ? parseInt(f.limit_value) : -1,
        daily_limit: f.daily_limit !== undefined ? parseInt(f.daily_limit) : -1,
      });
      inserted.push(feature.toObject());
    }
  }
  return inserted;
};

// GET all plans with their features
router.get('/', async (req, res) => {
  try {
    const plans = await MafiyaPlans.find({}, NO_ID).sort({ price: 1 }).lean();
    const features = await MafiyaPlanFeatures.find({}, NO_ID).lean();

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

  let newPlan;
  try {
    newPlan = (await MafiyaPlans.create({
      name,
      price: price || 0,
      currency: currency || 'INR',
      billing_cycle: billing_cycle || 'Monthly',
      status: 'active',
    })).toObject();

    const insertedFeatures = features && Array.isArray(features) ? await createFeatures(newPlan.id, features) : [];

    res.status(201).json({ ...newPlan, features: insertedFeatures });
  } catch (err) {
    // Roll back the partially created plan
    if (newPlan) await deleteCascade('mafiya_plans', { id: newPlan.id }).catch(() => {});
    console.error('[Mafiya Plans] POST / error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT update plan
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { name, price, currency, billing_cycle, status, features } = req.body;
  try {
    const changes = Object.fromEntries(
      Object.entries({ name, price, currency, billing_cycle, status }).filter(([, value]) => value !== undefined && value !== null)
    );
    const updatedPlan = await MafiyaPlans.findOneAndUpdate({ id }, { $set: changes }, { new: true, projection: NO_ID }).lean();

    if (!updatedPlan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // If features are provided, rewrite them completely
    if (features && Array.isArray(features)) {
      await MafiyaPlanFeatures.deleteMany({ plan_id: id });
      updatedPlan.features = await createFeatures(updatedPlan.id, features);
    } else {
      updatedPlan.features = await MafiyaPlanFeatures.find({ plan_id: id }, NO_ID).lean();
    }

    res.json(updatedPlan);
  } catch (err) {
    console.error('[Mafiya Plans] PUT /:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE plan
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if any client is currently subscribed to this plan
    const activeSubscribers = await MafiyaGmbClients.countDocuments({ plan_id: id });
    if (activeSubscribers > 0) {
      return res.status(400).json({
        error: `Cannot delete plan. There are ${activeSubscribers} clients currently subscribed to this plan.`
      });
    }

    const deleted = await deleteCascade('mafiya_plans', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Plan not found' });
    res.json({ message: 'Plan deleted' });
  } catch (err) {
    console.error('[Mafiya Plans] DELETE /:id error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
