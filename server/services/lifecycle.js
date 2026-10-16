/**
 * Tenant lifecycle (plan U6; Full Scope p11-12, Pricing Spec section 12):
 *
 *   active        subscription period not yet ended
 *   grace         days 1-7 after expiry   — full access (top-ups blocked)
 *   restricted    days 8-21               — read and export only, no sends
 *   suspended     day 22 onwards          — no login, data kept
 *   archived      day 90 onwards          — no login; data exported and archived
 *   deletion_due  day 180 onwards         — no login; deletion is a separately
 *                                            approved staff procedure, never automatic
 *
 * A tenant suspended by staff (status 'suspended') is suspended regardless of
 * dates. A tenant with no active subscription is treated as restricted.
 */
const { Tenants, Subscriptions } = require('../models');
const { runAsSystem } = require('./tenantContext');

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCESS = Object.freeze({
  active: 'full',
  grace: 'full',
  restricted: 'read_export',
  no_subscription: 'read_export',
  suspended: 'none',
  archived: 'none',
  deletion_due: 'none',
  deleted: 'none',
});

function daysPastEnd(periodEnd, now) {
  return Math.ceil((now.getTime() - new Date(periodEnd).getTime()) / DAY_MS);
}

function computeLifecycle(tenant, subscription, now = new Date()) {
  if (!tenant || tenant.status === 'deleted' || tenant.deleted_at) return { state: 'deleted', access: ACCESS.deleted };
  if (tenant.status === 'suspended') return { state: 'suspended', access: ACCESS.suspended, manual: true };
  if (!subscription || !subscription.current_period_end) {
    return { state: 'no_subscription', access: ACCESS.no_subscription };
  }
  const days = daysPastEnd(subscription.current_period_end, now);
  let state = 'active';
  if (days >= 180) state = 'deletion_due';
  else if (days >= 90) state = 'archived';
  else if (days >= 22) state = 'suspended';
  else if (days >= 8) state = 'restricted';
  else if (days >= 1) state = 'grace';
  return { state, access: ACCESS[state], daysPastEnd: Math.max(days, 0), periodEnd: subscription.current_period_end };
}

// The subscription that currently governs the tenant (latest active period).
async function activeSubscription(tenantId) {
  return runAsSystem(() => Subscriptions.findOne(
    { tenant_id: Number(tenantId), status: 'active' },
    { _id: 0 },
  ).sort({ current_period_end: -1 }).lean(), 'lifecycle');
}

async function tenantLifecycle(tenantId, now = new Date()) {
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0 }).lean(), 'lifecycle');
  const subscription = tenant ? await activeSubscription(tenant.id) : null;
  return { tenant, subscription, ...computeLifecycle(tenant, subscription, now) };
}

const canLogIn = (lifecycle) => lifecycle.access !== 'none';
const canWrite = (lifecycle) => lifecycle.access === 'full';
// Sending WhatsApp messages (campaigns, AI replies, manual sends).
const canSend = (lifecycle) => lifecycle.access === 'full';

async function tenantCanSend(tenantId) {
  return canSend(await tenantLifecycle(tenantId));
}

module.exports = {
  DAY_MS,
  ACCESS,
  computeLifecycle,
  activeSubscription,
  tenantLifecycle,
  canLogIn,
  canWrite,
  canSend,
  tenantCanSend,
};
