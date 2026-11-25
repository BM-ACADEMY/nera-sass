/**
 * GET /api/activity — the signed-in workspace's activity log (Settings >
 * Activity). Owner and admin only ('activity.view'). The workspace always
 * comes from the login, never from the request.
 * Query: user_id, group (leads|chat|campaigns|settings|team|security),
 * from, to (YYYY-MM-DD, India time), page, limit. Newest first.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const activity = require('../services/activity');

const router = express.Router();

router.get('/', auth, requirePermission('activity.view'), async (req, res) => {
  try {
    if (req.identity?.kind !== 'tenant') return res.status(403).json({ error: 'This is for a workspace login' });
    return res.json(await activity.list(req.identity.tenantId, req.query, { audience: 'customer' }));
  } catch (error) {
    if (error instanceof activity.ActivityQueryError) return res.status(400).json({ error: error.message });
    console.error('[activity]', error.message);
    return res.status(500).json({ error: 'Could not load the activity log. Please try again.' });
  }
});

module.exports = router;
