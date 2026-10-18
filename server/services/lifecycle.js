/**
 * Tenant lifecycle. There are no plans or subscriptions: a workspace has full
 * access from the day it is created, with no expiry and no limits.
 *
 *   active     full access
 *   suspended  staff suspended the workspace (status 'suspended') — no login, data kept
 *   deleted    the workspace was deleted
 */
const { Tenants } = require('../models');
const { runAsSystem } = require('./tenantContext');

const DAY_MS = 24 * 60 * 60 * 1000;

const ACCESS = Object.freeze({
  active: 'full',
  suspended: 'none',
  deleted: 'none',
});

function computeLifecycle(tenant) {
  if (!tenant || tenant.status === 'deleted' || tenant.deleted_at) return { state: 'deleted', access: ACCESS.deleted };
  if (tenant.status === 'suspended') return { state: 'suspended', access: ACCESS.suspended, manual: true };
  return { state: 'active', access: ACCESS.active };
}

async function tenantLifecycle(tenantId) {
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0 }).lean(), 'lifecycle');
  return { tenant, ...computeLifecycle(tenant) };
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
  tenantLifecycle,
  canLogIn,
  canWrite,
  canSend,
  tenantCanSend,
};
