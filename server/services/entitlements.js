/**
 * Seat usage of a workspace. There are no plans, so there are no limits; the
 * one-login-per-workspace rule lives in services/invitations.js.
 */
const { Users, Invitations } = require('../models');
const { runAsSystem } = require('./tenantContext');

// Active users plus invitations still waiting to be accepted.
async function seatUsage(tenantId) {
  return runAsSystem(async () => {
    const [activeUsers, pendingInvitations] = await Promise.all([
      Users.countDocuments({ tenant_id: Number(tenantId), is_active: { $ne: false } }),
      Invitations.countDocuments({ tenant_id: Number(tenantId), accepted_at: null, revoked_at: null, expires_at: { $gt: new Date() } }),
    ]);
    return { activeUsers, pendingInvitations, used: activeUsers + pendingInvitations };
  }, 'entitlements');
}

module.exports = { seatUsage };
