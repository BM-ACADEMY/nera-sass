/**
 * /api/summary: what the AI did overnight, for the signed-in workspace, and the
 * owner's switch for the morning email.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const { Tenants } = require('../models');
const { runAsSystem } = require('../services/tenantContext');
const overnight = require('../services/overnightSummary');

const router = express.Router();
router.use(auth);

// GET /api/summary/overnight — last night's counts (any signed-in member).
router.get('/overnight', async (req, res) => {
  try {
    const tenant = await runAsSystem(() => Tenants.findOne({ id: req.identity.tenantId }, { _id: 0, overnight_summary_enabled: 1 }).lean(), 'summary');
    const summary = await overnight.buildSummary(overnight.lastWindow());
    res.json({ ...summary, email_enabled: tenant?.overnight_summary_enabled !== false });
  } catch (error) {
    console.error('[summary] overnight:', error.message);
    res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
});

// PUT /api/summary/overnight { email_enabled } — owner/admin switch for the morning email.
router.put('/overnight', requirePermission('billing.manage'), async (req, res) => {
  try {
    if (typeof req.body?.email_enabled !== 'boolean') return res.status(400).json({ error: 'email_enabled must be true or false' });
    await runAsSystem(() => Tenants.updateOne({ id: req.identity.tenantId }, { $set: { overnight_summary_enabled: req.body.email_enabled, updated_at: new Date() } }), 'summary');
    return res.json({ email_enabled: req.body.email_enabled });
  } catch (error) {
    console.error('[summary] overnight switch:', error.message);
    return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
});

module.exports = router;
