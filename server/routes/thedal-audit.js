const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { runAudit } = require('../services/auditService');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

// Run audit for a specific client
router.post('/run/:clientId', async (req, res) => {
  const { clientId } = req.params;

  try {
    // 1. Get client domain
    const clientRes = await pool.query('SELECT * FROM thedal_clients WHERE id = $1', [clientId]);
    if (clientRes.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    const client = clientRes.rows[0];

    if (!client.domain) return res.status(400).json({ error: 'Client has no domain configured' });

    // 2. Run Audit Engine
    const auditData = await runAudit(client.domain);

    // 3. Save to database
    await pool.query('BEGIN');
    
    // Create audit record
    const insertAuditRes = await pool.query(
      'INSERT INTO thedal_audits (client_id, overall_score) VALUES ($1, $2) RETURNING id',
      [clientId, auditData.score]
    );
    const auditId = insertAuditRes.rows[0].id;

    // Insert items
    for (const item of auditData.results) {
      await pool.query(
        `INSERT INTO thedal_audit_items (audit_id, check_name, status, score, missing_info, fix_guide)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [auditId, item.title, item.status, item.score, item.missing, item.fix]
      );
    }

    // Update client score
    await pool.query('UPDATE thedal_clients SET score = $1 WHERE id = $2', [auditData.score, clientId]);

    await pool.query('COMMIT');
    res.json({ message: 'Audit completed successfully', score: auditData.score });
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Server error running audit' });
  }
});

// Get latest audit for a client
router.get('/:clientId', async (req, res) => {
  const { clientId } = req.params;
  try {
    const auditRes = await pool.query(
      'SELECT * FROM thedal_audits WHERE client_id = $1 ORDER BY created_at DESC LIMIT 1',
      [clientId]
    );
    
    if (auditRes.rowCount === 0) {
      return res.json({ hasAudit: false });
    }

    const audit = auditRes.rows[0];
    const itemsRes = await pool.query('SELECT * FROM thedal_audit_items WHERE audit_id = $1', [audit.id]);
    
    res.json({
      hasAudit: true,
      ...audit,
      items: itemsRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching audit' });
  }
});

// Get all recent audits (for the main Audit page table if needed)
router.get('/all/recent', async (req, res) => {
  try {
    const query = `
      SELECT a.*, c.business_name, c.domain 
      FROM thedal_audits a
      JOIN thedal_clients c ON a.client_id = c.id
      ORDER BY a.created_at DESC
    `;
    const auditRes = await pool.query(query);
    res.json(auditRes.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching audits' });
  }
});

module.exports = router;
