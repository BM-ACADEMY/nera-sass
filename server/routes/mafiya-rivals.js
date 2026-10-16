const express = require('express');
const router = express.Router();
const { MafiyaRivals, MafiyaRivalMetrics, MafiyaGeogridScansLog } = require('../models');
const { deleteCascade } = require('../db/cascade');

const NO_ID = { _id: 0 };
const countRecentScans = (clientId) => MafiyaGeogridScansLog.countDocuments({
  client_id: clientId,
  scanned_at: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
});

// Generates simulated metrics for a rival (prototype data)
const simulatedMetrics = (rivalId) => {
  const ourRank = Math.floor(Math.random() * 5) + 1;
  const theirRank = Math.floor(Math.random() * 5) + 1;
  const ourReviews = Math.floor(Math.random() * 200) + 50;
  const theirReviews = Math.floor(Math.random() * 200) + 50;
  const theirRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
  const ourRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);

  let status = 'watch_closely';
  if (ourRank < theirRank) status = 'winning';
  else if (ourRank > theirRank) status = 'losing';

  return {
    rival_id: rivalId,
    their_rank: theirRank,
    our_rank: ourRank,
    their_reviews: theirReviews,
    our_reviews: ourReviews,
    their_rating: theirRating,
    our_rating: ourRating,
    status,
    last_updated: new Date(),
  };
};

// GET all rivals for a business
router.get('/:business_id', async (req, res) => {
  const { business_id } = req.params;
  try {
    const rivals = await MafiyaRivals.find({ business_id }, NO_ID).sort({ created_at: 1 }).lean();

    // Fetch latest metrics for each rival
    for (let i = 0; i < rivals.length; i++) {
      const metrics = await MafiyaRivalMetrics.findOne({ rival_id: rivals[i].id }, NO_ID).sort({ last_updated: -1 }).lean();
      rivals[i].metrics = metrics || null;
    }

    res.json(rivals);
  } catch (err) {
    console.error('[Mafiya] GET /rivals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST register/check a live geogrid scan
router.post('/scan', async (req, res) => {
  const { client_id } = req.body;
  if (!client_id) {
    return res.status(400).json({ error: 'client_id is required' });
  }

  const { checkLimit } = require('../utils/limit-checker');

  try {
    const limitCheck = await checkLimit(client_id, 'mafiya_geogrid_scans', () => countRecentScans(client_id));

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Limit reached',
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.`
      });
    }

    // Log the scan
    await MafiyaGeogridScansLog.create({ client_id });

    res.json({ success: true, allowed: true });
  } catch (err) {
    console.error('[Mafiya] POST /rivals/scan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST new rival
router.post('/', async (req, res) => {
  const { business_id, competitor_name, gbp_url, city, keyword, place_id } = req.body;

  if (!business_id || !competitor_name) {
    return res.status(400).json({ error: 'business_id and competitor_name are required' });
  }

  const { checkLimit } = require('../utils/limit-checker');

  try {
    // Check Rivals map scan limit
    const limitCheck = await checkLimit(business_id, 'mafiya_geogrid_scans', () => countRecentScans(business_id));

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Limit reached',
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.`
      });
    }

    // Log the scan
    await MafiyaGeogridScansLog.create({ client_id: business_id });

    const newRival = (await MafiyaRivals.create({ business_id, competitor_name, gbp_url, city, keyword, place_id })).toObject();

    // Generate initial simulated metrics
    newRival.metrics = (await MafiyaRivalMetrics.create(simulatedMetrics(newRival.id))).toObject();

    res.status(201).json(newRival);
  } catch (err) {
    console.error('[Mafiya] POST /rivals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE a rival
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await deleteCascade('mafiya_rivals', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Rival not found' });
    res.json({ message: 'Rival deleted successfully' });
  } catch (err) {
    console.error('[Mafiya] DELETE /rivals error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST trigger manual refresh for a business's rivals
router.post('/refresh/:business_id', async (req, res) => {
  const { business_id } = req.params;

  const { checkLimit } = require('../utils/limit-checker');

  try {
    // Check Rivals map scan limit
    const limitCheck = await checkLimit(business_id, 'mafiya_geogrid_scans', () => countRecentScans(business_id));

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Limit reached',
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.`
      });
    }

    // Log the scan
    await MafiyaGeogridScansLog.create({ client_id: business_id });

    // 1. Fetch rivals for this business
    const rivals = await MafiyaRivals.find({ business_id }, { id: 1 }).lean();

    for (const rival of rivals) {
      // 2. Simulate API data (Randomized for prototype) and 3. store metrics
      await MafiyaRivalMetrics.create(simulatedMetrics(rival.id));
    }

    res.json({ success: true, message: 'Refresh triggered successfully' });
  } catch (err) {
    console.error('[Mafiya] POST /rivals/refresh error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Daily Cron Job for Rival Metrics (Runs at midnight)
const cron = require('node-cron');
cron.schedule('0 0 * * *', async () => {
  console.log('[Mafiya Rivals] Running daily metrics refresh...');
  try {
    const businessIds = await MafiyaRivals.distinct('business_id');
    for (const businessId of businessIds) {
      const rivals = await MafiyaRivals.find({ business_id: businessId }, { id: 1 }).lean();

      for (const rival of rivals) {
        await MafiyaRivalMetrics.create(simulatedMetrics(rival.id));
      }
    }
    console.log('[Mafiya Rivals] Daily metrics refresh completed.');
  } catch (err) {
    console.error('[Mafiya Rivals] Daily cron job error:', err);
  }
});

module.exports = router;
