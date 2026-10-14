const express = require('express');
const { analyzeBatch } = require('../services/openai');
const { AiAnalysis } = require('../models');
const router = express.Router();

// POST /api/analyze/batch
router.post('/batch', async (req, res) => {
  const { orgIds } = req.body;
  if (!orgIds || !orgIds.length) {
    return res.status(400).json({ success: false, message: 'No orgs provided' });
  }

  // Run asynchronously without blocking the response
  analyzeBatch(orgIds)
    .then(results => console.log(`Batch analysis complete for ${results.length} orgs.`))
    .catch(err => console.error('Batch analysis error:', err));

  res.json({ success: true, message: `Analysis started for ${orgIds.length} organisations. This may take a few minutes.` });
});

// GET /api/analyze/:orgId/result
router.get('/:orgId/result', async (req, res) => {
  try {
    const analysis = await AiAnalysis.findOne({ org_id: req.params.orgId }).sort({ created_at: -1 }).lean();
    res.json({ success: true, analysis: analysis || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
