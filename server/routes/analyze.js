const express = require('express');
const { analyzeBatch } = require('../services/openai');
const db = require('../db/connection');
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
    const { rows } = await db.query(
      'SELECT * FROM ai_analysis WHERE org_id = $1 ORDER BY created_at DESC LIMIT 1',
      [req.params.orgId]
    );
    res.json({ success: true, analysis: rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
