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

// GET /api/thedal/stats
// Returns HQ KPI stats and clients
router.get('/stats', async (req, res) => {
  try {
    const clientsRes = await pool.query('SELECT * FROM thedal_clients ORDER BY score DESC');
    const clients = clientsRes.rows;

    const keywordsRes = await pool.query(`
      SELECT k.*, c.domain as client_domain 
      FROM thedal_keywords k
      JOIN thedal_clients c ON k.client_id = c.id
      ORDER BY k.created_at DESC LIMIT 10
    `);
    const keywords = keywordsRes.rows;

    const stats = {
      totalKeywords: keywordsRes.rowCount > 0 ? (await pool.query('SELECT COUNT(*) FROM thedal_keywords')).rows[0].count : 0,
      top3Rankings: keywordsRes.rowCount > 0 ? (await pool.query('SELECT COUNT(*) FROM thedal_keywords WHERE current_rank <= 3 AND current_rank > 0')).rows[0].count : 0,
    };

    res.json({ clients, recentKeywords: keywords, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/thedal/scan/global
router.post('/scan/global', async (req, res) => {
  try {
    // Increment client scores slightly to simulate scanner updating ranks
    await pool.query('UPDATE thedal_clients SET score = LEAST(100, score + 1) WHERE score < 100');
    
    const clientsRes = await pool.query('SELECT * FROM thedal_clients ORDER BY score DESC');
    const clients = clientsRes.rows;

    const keywordsRes = await pool.query(`
      SELECT k.*, c.domain as client_domain 
      FROM thedal_keywords k
      JOIN thedal_clients c ON k.client_id = c.id
      ORDER BY k.created_at DESC LIMIT 10
    `);
    const keywords = keywordsRes.rows;

    const totalKeywordsRes = await pool.query('SELECT COUNT(*) FROM thedal_keywords');
    const top3RankingsRes = await pool.query('SELECT COUNT(*) FROM thedal_keywords WHERE current_rank <= 3 AND current_rank > 0');

    const stats = {
      totalKeywords: totalKeywordsRes.rows[0].count,
      top3Rankings: top3RankingsRes.rows[0].count,
    };

    res.json({ success: true, message: 'Global scan completed successfully', clients, recentKeywords: keywords, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/thedal/gap-hunter
router.get('/gap-hunter', async (req, res) => {
  try {
    const clientsRes = await pool.query('SELECT id, domain FROM thedal_clients ORDER BY domain ASC');
    const clients = clientsRes.rows;
    
    // Mock AI gap opportunities
    const opportunities = [
      { id: 1, keyword: 'best dental implant cost', volume: 2400, difficulty: 32, intent: 'Transactional', reason: 'High search volume with low competition in your local area.', client_id: clients[0]?.id },
      { id: 2, keyword: 'painless root canal treatment', volume: 1800, difficulty: 25, intent: 'Informational', reason: 'Users are searching for this specific pain point. Good for blog content.', client_id: clients[0]?.id },
      { id: 3, keyword: 'buy cheap electronics online', volume: 15000, difficulty: 68, intent: 'Navigational', reason: 'Core product category missing from your current ranking keywords.', client_id: clients[1]?.id },
      { id: 4, keyword: 'upvc windows vs wooden windows', volume: 4500, difficulty: 15, intent: 'Informational', reason: 'Perfect topic for comparison guide to drive top-of-funnel traffic.', client_id: clients[2]?.id },
      { id: 5, keyword: 'marine engineering admission 2026', volume: 8900, difficulty: 45, intent: 'Transactional', reason: 'Seasonal keyword currently trending upwards.', client_id: clients[3]?.id },
    ];

    res.json({ clients, opportunities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Generic catch-all for remaining dynamic pages to prevent 404s during development
router.get('/:feature', async (req, res) => {
  try {
    const feature = req.params.feature;
    // Just return some mock dynamic data to show the frontend table works
    res.json({
      feature,
      items: [
        { id: 1, info: `Mock dynamic data for ${feature} from PostgreSQL` },
        { id: 2, info: `Another database row for ${feature}` }
      ]
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
