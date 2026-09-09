const express = require('express');
const router = express.Router();
const {
  getAccountUsageSummary,
  getClientUsageList,
  getClientUsageDetails,
  updateSettings
} = require('../services/usage/usage.service');

// GET /api/mafiya/usage/summary
router.get('/summary', async (req, res) => {
  try {
    const provider = req.query.provider || 'valueserp';
    const summary = await getAccountUsageSummary(provider);
    res.json(summary);
  } catch (err) {
    console.error('[Usage Route] GET /summary error:', err);
    res.status(500).json({ error: 'Failed to fetch usage summary' });
  }
});

// GET /api/mafiya/usage/clients
router.get('/clients', async (req, res) => {
  try {
    const {
      provider = 'valueserp',
      search = '',
      filter = '',
      sort = 'credits',
      order = 'desc',
      page = 1,
      limit = 10
    } = req.query;

    const data = await getClientUsageList({
      provider,
      search,
      filter,
      sort,
      order,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 10
    });

    res.json(data);
  } catch (err) {
    console.error('[Usage Route] GET /clients error:', err);
    res.status(500).json({ error: 'Failed to fetch client usage table' });
  }
});

// GET /api/mafiya/usage/clients/:clientId
router.get('/clients/:clientId', async (req, res) => {
  try {
    const { clientId } = req.params;
    const provider = req.query.provider || 'valueserp';
    const details = await getClientUsageDetails(clientId, provider);
    res.json(details);
  } catch (err) {
    console.error('[Usage Route] GET /clients/:clientId error:', err);
    res.status(500).json({ error: err.message || 'Failed to fetch client usage details' });
  }
});

// POST /api/mafiya/usage/settings
router.post('/settings', async (req, res) => {
  try {
    const { warningThresholdPct } = req.body;
    if (warningThresholdPct === undefined) {
      return res.status(400).json({ error: 'warningThresholdPct is required' });
    }
    const result = await updateSettings('warning_threshold_pct', warningThresholdPct);
    res.json({ success: true, settings: result });
  } catch (err) {
    console.error('[Usage Route] POST /settings error:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

module.exports = router;
