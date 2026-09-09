const pool = require('../db/connection');
const { runCheckForBusiness } = require('../services/citations/citation.service');

async function runCheck(req, res) {
  const { businessId, forceRefresh = false } = req.body;
  if (!businessId) {
    return res.status(400).json({ error: 'businessId is required' });
  }

  const { checkLimit } = require('../utils/limit-checker');

  try {
    const limitCheck = await checkLimit(businessId, 'mafiya_citations_scans', async () => {
      const countRes = await pool.query(
        'SELECT COUNT(*) FROM mafiya_citations_scans_log WHERE client_id = $1 AND scanned_at >= NOW() - INTERVAL \'30 days\'',
        [businessId]
      );
      return parseInt(countRes.rows[0].count, 10);
    });

    if (!limitCheck.allowed) {
      return res.status(403).json({ 
        error: 'Limit reached', 
        message: `Plan limit reached. Up to ${limitCheck.limit} Citations Audits/month. Please upgrade.`,
        limit: limitCheck.limit,
        current: limitCheck.current
      });
    }

    // Log the manual check
    await pool.query(
      'INSERT INTO mafiya_citations_scans_log (client_id) VALUES ($1)',
      [businessId]
    );

    const io = req.app ? req.app.get('io') : null;
    const result = await runCheckForBusiness(businessId, forceRefresh, io);
    res.json(result);
  } catch (err) {
    console.error('[Citation Controller] runCheck error:', err);
    res.status(500).json({ error: err.message || 'Failed to run citation check' });
  }
}

async function getScan(req, res) {
  const { businessId } = req.params;
  if (!businessId) {
    return res.status(400).json({ error: 'businessId is required' });
  }

  try {
    // 1. Get latest scan
    const scanRes = await pool.query(
      `SELECT * FROM citation_scans 
       WHERE "businessId" = $1 
       ORDER BY id DESC LIMIT 1`,
      [businessId]
    );

    if (scanRes.rowCount === 0) {
      return res.json({ scan: null, results: [] });
    }

    const scan = scanRes.rows[0];

    // 2. Get results for that scan
    const resultsRes = await pool.query(
      `SELECT * FROM citation_results 
       WHERE "scanId" = $1 
       ORDER BY directory ASC`,
      [scan.id]
    );

    res.json({
      scan,
      results: resultsRes.rows,
      debugData: scan.debugData || null
    });
  } catch (err) {
    console.error('[Citation Controller] getScan error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

async function markFixed(req, res) {
  const { resultId } = req.body;
  if (!resultId) {
    return res.status(400).json({ error: 'resultId is required' });
  }

  try {
    // 1. Find the result to get the scanId
    const resultQuery = await pool.query('SELECT "scanId" FROM citation_results WHERE id = $1', [resultId]);
    if (resultQuery.rowCount === 0) {
      return res.status(404).json({ error: 'Citation result not found' });
    }
    
    const scanId = resultQuery.rows[0].scanId;

    // 2. Update the status of this result to 'Match'
    await pool.query(
      `UPDATE citation_results 
       SET status = 'Match' 
       WHERE id = $1`,
      [resultId]
    );

    // 3. Recalculate the scan summary counts and score
    const countsRes = await pool.query(
      `SELECT 
         COUNT(*) FILTER (WHERE status = 'Match') as matched,
         COUNT(*) FILTER (WHERE status = 'Mismatch') as mismatched,
         COUNT(*) FILTER (WHERE status = 'Missing') as missing,
         COUNT(*) as total
       FROM citation_results WHERE "scanId" = $1`,
      [scanId]
    );

    const matched = parseInt(countsRes.rows[0].matched || '0', 10);
    const mismatched = parseInt(countsRes.rows[0].mismatched || '0', 10);
    const missing = parseInt(countsRes.rows[0].missing || '0', 10);
    const total = parseInt(countsRes.rows[0].total || '0', 10);

    const score = total > 0 ? Math.round((matched / total) * 100) : 0;

    // 4. Update the scan record
    const updatedScanRes = await pool.query(
      `UPDATE citation_scans
       SET score = $1, matched = $2, mismatched = $3, missing = $4
       WHERE id = $5
       RETURNING *`,
      [score, matched, mismatched, missing, scanId]
    );

    res.json({
      success: true,
      scan: updatedScanRes.rows[0]
    });
  } catch (err) {
    console.error('[Citation Controller] markFixed error:', err);
    res.status(500).json({ error: 'Server error' });
  }
}

module.exports = {
  runCheck,
  getScan,
  markFixed
};
