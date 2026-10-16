/**
 * Plan entitlements (plan B9) and write-time limits (plan B10).
 * Limits come from the subscription, which copied them from the plan
 * catalogue when it was created; nothing is hard-coded here.
 */
const { Users, Invitations } = require('../models');
const { runAsSystem } = require('./tenantContext');
const { activeSubscription } = require('./lifecycle');

class LimitError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'LimitError';
    this.status = 409;
    this.details = details;
  }
}

async function getEntitlements(tenantId) {
  const subscription = await activeSubscription(tenantId);
  return {
    subscription,
    plan_code: subscription?.plan_code || null,
    limits: subscription?.limits || {},
    features: subscription?.features || {},
  };
}

// A limit of null/undefined means "not granted"; -1 means "no cap".
function limitValue(limits, key) {
  const value = limits?.[key];
  if (value === -1) return Infinity;
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

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

async function assertSeatAvailable(tenantId, adding = 1) {
  const { limits } = await getEntitlements(tenantId);
  const max = limitValue(limits, 'max_users');
  const usage = await seatUsage(tenantId);
  if (usage.used + adding > max) {
    throw new LimitError(
      max === 0
        ? 'This workspace has no active plan that includes users'
        : `Your plan includes ${max} user${max === 1 ? '' : 's'}; remove a user or upgrade to add more`,
      { max_users: Number.isFinite(max) ? max : -1, ...usage },
    );
  }
  return { max, ...usage };
}

module.exports = { LimitError, getEntitlements, limitValue, seatUsage, assertSeatAvailable };
