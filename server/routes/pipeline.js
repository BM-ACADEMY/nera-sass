const express = require('express');
const { Organisations, AiAnalysis } = require('../models');
const router = express.Router();

// GET /api/pipeline?type=college
router.get('/', async (req, res) => {
  const { type } = req.query;
  const orgType = type || 'college';
  try {
    const orgs = await Organisations.find({ type: orgType }, { _id: 0, id: 1, name: 1, district: 1, status: 1, created_at: 1 }).lean();
    const analyses = await AiAnalysis.find({ org_id: { $in: orgs.map((o) => o.id) } }, { _id: 0, org_id: 1, score: 1 }).lean();
    // LEFT JOIN ai_analysis — one output row per (organisation, analysis) pair
    const analysesByOrg = new Map();
    for (const a of analyses) {
      if (!analysesByOrg.has(a.org_id)) analysesByOrg.set(a.org_id, []);
      analysesByOrg.get(a.org_id).push(a);
    }
    const rows = orgs.flatMap((o) => (analysesByOrg.get(o.id) || [{ score: null }]).map((a) => ({
      id: o.id, name: o.name, district: o.district, status: o.status, score: a.score ?? null, created_at: o.created_at,
    })));
    rows.sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0)
      || (new Date(b.created_at || 0) - new Date(a.created_at || 0)));
    rows.forEach((r) => delete r.created_at);

    // Group by status (new, analysed, contacted, meeting, negotiation, closed)
    const pipeline = {
      new: [], analysed: [], contacted: [], meeting: [], negotiation: [], closed: []
    };
    
    rows.forEach(r => {
      const st = (r.status || 'new').toLowerCase();
      if (pipeline[st]) {
        pipeline[st].push(r);
      } else {
        pipeline['new'].push(r);
      }
    });
    
    res.json({ success: true, pipeline });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/pipeline/:id/stage
router.patch('/:id/stage', async (req, res) => {
  const { status } = req.body;
  try {
    await Organisations.updateOne({ id: req.params.id }, { $set: { status, updated_at: new Date() } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
