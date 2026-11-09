/**
 * Billing notices to the workspace owner: AI allowance at 20 percent, wallet
 * at 20 percent, AI paused for lack of money. Each notice goes once per
 * period or top-up (unique alert_key), by email to the owner and as a live
 * event to the workspace. Never throws: a failed notice is logged.
 */
const { BillingAlerts, Tenants, Users } = require('../../models');
const { runAsSystem, requireTenantId } = require('../tenantContext');
const { insertIgnore } = require('../../db/mongo');
const notify = require('../notify');
const { notifyWorkspace } = require('../realtime');

async function ownerEmail(tenantId) {
  return runAsSystem(async () => {
    const tenant = await Tenants.findOne({ id: Number(tenantId) }, { _id: 0, id: 1, name: 1, owner_user_id: 1 }).lean();
    if (!tenant) return null;
    const owner = tenant.owner_user_id
      ? await Users.findOne({ id: tenant.owner_user_id, is_active: { $ne: false } }, { _id: 0, email: 1, name: 1 }).lean()
      : await Users.findOne({ tenant_id: tenant.id, role: 'owner', is_active: { $ne: false } }, { _id: 0, email: 1, name: 1 }).lean();
    return { tenant, owner };
  }, 'billing:alerts');
}

/**
 * raise({ key, kind, message, meta }) in the current tenant context.
 * Returns { sent: true } the first time for a key, { sent: false, duplicate: true } after.
 */
async function raise({ key, kind, message, meta = {} }) {
  const tenantId = requireTenantId();
  let row;
  try {
    row = await insertIgnore(BillingAlerts, { alert_key: key, kind, message, meta, created_at: new Date() });
  } catch (error) {
    console.error('[billing/alerts] Could not record alert:', error.message);
    return { sent: false, error: true };
  }
  if (!row) return { sent: false, duplicate: true };

  notifyWorkspace('billing_alert', { kind, message, meta });
  let delivered = false;
  try {
    const target = await ownerEmail(tenantId);
    if (target?.owner?.email) {
      const result = await notify.billingAlertEmail({ to: target.owner.email, name: target.owner.name, workspaceName: target.tenant.name, kind, message });
      delivered = Boolean(result?.delivered);
    }
  } catch (error) {
    console.error(`[billing/alerts] Could not email the owner of workspace ${tenantId}:`, error.message);
  }
  if (delivered) {
    // Delivery status is bookkeeping on the alert row (not a ledger row).
    await BillingAlerts.updateOne({ id: row.id }, { $set: { delivered: true } }).catch(() => {});
  }
  return { sent: true, delivered };
}

/** Recent notices for the billing page. */
async function recent(limit = 10) {
  requireTenantId();
  return BillingAlerts.find({}, { _id: 0, id: 1, kind: 1, message: 1, meta: 1, created_at: 1 }).sort({ id: -1 }).limit(Math.min(Number(limit) || 10, 50)).lean();
}

module.exports = { raise, recent };
