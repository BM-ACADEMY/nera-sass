const express = require('express');
const db = require('../db/connection');
const router = express.Router();

// GET /api/pipeline?type=college
router.get('/', async (req, res) => {
  const { type } = req.query;
  const orgType = type || 'college';
  try {
    const { rows } = await db.query(`
      SELECT o.id, o.name, o.district, o.status, a.score
      FROM organisations o
      LEFT JOIN ai_analysis a ON a.org_id = o.id
      WHERE o.type = $1
      ORDER BY COALESCE(a.score, 0) DESC, o.created_at DESC
    `, [orgType]);
    
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
    await db.query(`UPDATE organisations SET status=$1, updated_at=NOW() WHERE id=$2`, [status, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
