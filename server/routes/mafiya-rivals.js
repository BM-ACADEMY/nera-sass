const express = require('express');
const router = express.Router();
const pool = require('../db/connection');

// GET all rivals for a business
router.get('/:business_id', async (req, res) => {
  const { business_id } = req.params;
  try {
    const rivalsResult = await pool.query(
      'SELECT * FROM mafiya_rivals WHERE business_id = $1 ORDER BY created_at ASC',
      [business_id]
    );
    
    const rivals = rivalsResult.rows;
    
    // Fetch latest metrics for each rival
    for (let i = 0; i < rivals.length; i++) {
      const metricsResult = await pool.query(
        'SELECT * FROM mafiya_rival_metrics WHERE rival_id = $1 ORDER BY last_updated DESC LIMIT 1',
        [rivals[i].id]
      );
      rivals[i].metrics = metricsResult.rows.length > 0 ? metricsResult.rows[0] : null;
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
    const limitCheck = await checkLimit(client_id, 'mafiya_geogrid_scans', async () => {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM mafiya_geogrid_scans_log 
         WHERE client_id = $1 AND scanned_at >= NOW() - INTERVAL '30 days'`,
        [client_id]
      );
      return parseInt(countRes.rows[0].count, 10);
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({
        error: 'Limit reached',
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.`
      });
    }

    // Log the scan
    await pool.query(
      'INSERT INTO mafiya_geogrid_scans_log (client_id) VALUES ($1)',
      [client_id]
    );

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
    const limitCheck = await checkLimit(business_id, 'mafiya_geogrid_scans', async () => {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM mafiya_geogrid_scans_log 
         WHERE client_id = $1 AND scanned_at >= NOW() - INTERVAL '30 days'`,
        [business_id]
      );
      return parseInt(countRes.rows[0].count, 10);
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: 'Limit reached', 
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.` 
      });
    }

    // Log the scan
    await pool.query(
      'INSERT INTO mafiya_geogrid_scans_log (client_id) VALUES ($1)',
      [business_id]
    );

    const result = await pool.query(
      `INSERT INTO mafiya_rivals (business_id, competitor_name, gbp_url, city, keyword, place_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [business_id, competitor_name, gbp_url, city, keyword, place_id]
    );

    const newRival = result.rows[0];

    // Generate initial simulated metrics
    const ourRank = Math.floor(Math.random() * 5) + 1;
    const theirRank = Math.floor(Math.random() * 5) + 1;
    const ourReviews = Math.floor(Math.random() * 200) + 50;
    const theirReviews = Math.floor(Math.random() * 200) + 50;
    const theirRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
    const ourRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
    
    let status = 'watch_closely';
    if (ourRank < theirRank) status = 'winning';
    else if (ourRank > theirRank) status = 'losing';

    const metricsResult = await pool.query(
      `INSERT INTO mafiya_rival_metrics (rival_id, their_rank, our_rank, their_reviews, our_reviews, their_rating, our_rating, status, last_updated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
      [newRival.id, theirRank, ourRank, theirReviews, ourReviews, theirRating, ourRating, status]
    );
    newRival.metrics = metricsResult.rows[0];

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
    const result = await pool.query('DELETE FROM mafiya_rivals WHERE id = $1 RETURNING *', [id]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'Rival not found' });
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
    const limitCheck = await checkLimit(business_id, 'mafiya_geogrid_scans', async () => {
      const countRes = await pool.query(
        `SELECT COUNT(*) FROM mafiya_geogrid_scans_log 
         WHERE client_id = $1 AND scanned_at >= NOW() - INTERVAL '30 days'`,
        [business_id]
      );
      return parseInt(countRes.rows[0].count, 10);
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: 'Limit reached', 
        message: `Your current plan allows up to ${limitCheck.limit} Rivals map scans per month. Please upgrade your plan to run more scans.` 
      });
    }

    // Log the scan
    await pool.query(
      'INSERT INTO mafiya_geogrid_scans_log (client_id) VALUES ($1)',
      [business_id]
    );

    // 1. Fetch rivals for this business
    const rivalsResult = await pool.query('SELECT * FROM mafiya_rivals WHERE business_id = $1', [business_id]);
    const rivals = rivalsResult.rows;

    for (const rival of rivals) {
      // 2. Simulate API data (Randomized for prototype)
      const ourRank = Math.floor(Math.random() * 5) + 1;
      const theirRank = Math.floor(Math.random() * 5) + 1;
      const ourReviews = Math.floor(Math.random() * 200) + 50;
      const theirReviews = Math.floor(Math.random() * 200) + 50;
      const theirRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
      const ourRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
      
      let status = 'watch_closely';
      if (ourRank < theirRank) status = 'winning';
      else if (ourRank > theirRank) status = 'losing';

      // 3. Store metrics
      await pool.query(
        `INSERT INTO mafiya_rival_metrics (rival_id, their_rank, our_rank, their_reviews, our_reviews, their_rating, our_rating, status, last_updated)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [rival.id, theirRank, ourRank, theirReviews, ourReviews, theirRating, ourRating, status]
      );
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
    const businessesResult = await pool.query('SELECT DISTINCT business_id FROM mafiya_rivals');
    for (const b of businessesResult.rows) {
      const rivalsResult = await pool.query('SELECT * FROM mafiya_rivals WHERE business_id = $1', [b.business_id]);
      const rivals = rivalsResult.rows;

      for (const rival of rivals) {
        const ourRank = Math.floor(Math.random() * 5) + 1;
        const theirRank = Math.floor(Math.random() * 5) + 1;
        const ourReviews = Math.floor(Math.random() * 200) + 50;
        const theirReviews = Math.floor(Math.random() * 200) + 50;
        const theirRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
        const ourRating = (Math.random() * (4.9 - 3.8) + 3.8).toFixed(1);
        
        let status = 'watch_closely';
        if (ourRank < theirRank) status = 'winning';
        else if (ourRank > theirRank) status = 'losing';

        await pool.query(
          `INSERT INTO mafiya_rival_metrics (rival_id, their_rank, our_rank, their_reviews, our_reviews, their_rating, our_rating, status, last_updated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
          [rival.id, theirRank, ourRank, theirReviews, ourReviews, theirRating, ourRating, status]
        );
      }
    }
    console.log('[Mafiya Rivals] Daily metrics refresh completed.');
  } catch (err) {
    console.error('[Mafiya Rivals] Daily cron job error:', err);
  }
});

module.exports = router;
