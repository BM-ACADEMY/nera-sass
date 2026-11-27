/**
 * Reports > Team (owner, admin, manager: 'reports.team').
 *   GET /api/reports/team?range=7d|30d|90d  or  ?range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *       one row per member of the workspace, a totals row and an AI row
 *       (definitions in services/teamReport.js).
 *   GET /api/reports/team/:userId/activity?range=...
 *       that member's latest actions in the range (the Settings > Activity log,
 *       limited to one person), for the row's detail panel.
 * The workspace always comes from the login; `auth` runs the request in its
 * tenant context, so every read is limited to this workspace.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission } = require('../services/permissions');
const teamReport = require('../services/teamReport');
const activity = require('../services/activity');

const router = express.Router();

const workspaceOnly = (req, res, next) => (req.identity?.kind === 'tenant'
  ? next()
  : res.status(403).json({ error: 'This is for a workspace login' }));

router.get('/', auth, requirePermission('reports.team'), workspaceOnly, async (req, res) => {
  try {
    return res.json(await teamReport.build(req.query));
  } catch (error) {
    if (error instanceof teamReport.TeamReportError) return res.status(400).json({ error: error.message });
    console.error('[reports/team]', error.message);
    return res.status(500).json({ error: 'Could not load the team report. Please try again.' });
  }
});

router.get('/:userId/activity', auth, requirePermission('reports.team'), workspaceOnly, async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ error: 'Choose a team member from the list.' });
    const { from, to } = teamReport.parseRange(req.query);
    // activity.list always filters by this workspace, so another workspace's
    // user id simply has no events here.
    const result = await activity.list(req.identity.tenantId, {
      user_id: userId, from: from.toISOString(), to: to.toISOString(), limit: Math.min(Number(req.query.limit) || 20, 50),
    }, { audience: 'customer' });
    return res.json({ events: result.events, total: result.total });
  } catch (error) {
    if (error instanceof teamReport.TeamReportError || error instanceof activity.ActivityQueryError) return res.status(400).json({ error: error.message });
    console.error('[reports/team/activity]', error.message);
    return res.status(500).json({ error: 'Could not load this person\'s activity. Please try again.' });
  }
});

module.exports = router;
