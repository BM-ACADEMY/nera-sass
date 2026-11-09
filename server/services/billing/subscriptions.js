/**
 * Subscriptions: which plan a workspace is on and until when. One row per
 * workspace (models/Subscriptions.js); a renewal extends the paid period, a
 * plan change replaces the plan from now. Activation happens only from a
 * verified payment (services/billing/orders.js) or a staff grant.
 * Runs in the caller's tenant context unless a tenantId is given.
 */
const { Subscriptions } = require('../../models');
const { runAsTenant, currentTenantId } = require('../tenantContext');
const plansService = require('./plans');

const DAY_MS = 24 * 60 * 60 * 1000;

const inTenant = (tenantId, fn) => (tenantId != null && Number(tenantId) !== currentTenantId() ? runAsTenant(tenantId, fn) : fn());

/** One calendar month after `from` (31 Jan -> 28/29 Feb, as Razorpay does). */
function addOneMonth(from) {
  const date = new Date(from);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

const isLive = (sub, now = new Date()) => Boolean(sub && sub.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) > now);

/** The workspace's subscription row (any status) or null. */
async function current(tenantId = null) {
  return inTenant(tenantId, () => Subscriptions.findOne({}, { _id: 0 }).lean());
}

/** Active, paid subscription with its plan, or null. */
async function active(tenantId = null, now = new Date()) {
  const sub = await current(tenantId);
  if (!isLive(sub, now)) return null;
  const plan = await plansService.planById(sub.plan_id);
  return { subscription: sub, plan };
}

/** What the customer sees about their subscription. */
function publicSubscription(sub, now = new Date()) {
  if (!sub) return null;
  const live = isLive(sub, now);
  return {
    plan_id: sub.plan_id,
    plan_code: sub.plan_code,
    plan_name: sub.plan_name,
    price_inr: sub.price_inr,
    currency: sub.currency || 'INR',
    status: live ? 'active' : (sub.status === 'cancelled' ? 'cancelled' : 'expired'),
    current_period_start: sub.current_period_start,
    current_period_end: sub.current_period_end,
    days_left: live ? Math.max(0, Math.ceil((new Date(sub.current_period_end) - now) / DAY_MS)) : 0,
    extra_seats: Number(sub.extra_seats || 0),
    extra_numbers: Number(sub.extra_numbers || 0),
    activated_at: sub.activated_at || null,
  };
}

/**
 * Puts the workspace on `plan` for one month from now, or extends the current
 * period by a month when the same plan is still active (a renewal). Extras
 * carry over on a renewal; a plan change clears them (they are re-bought
 * against the new plan's prices).
 */
async function activate({ tenantId = null, plan, orderId = null, paymentId = null, now = new Date(), source = 'payment' }) {
  if (!plan) throw new Error('A plan is required to activate a subscription');
  return inTenant(tenantId, async () => {
    const existing = await Subscriptions.findOne({}, { _id: 0 }).lean();
    const renewal = isLive(existing, now) && existing.plan_id === plan.id;
    const periodStart = renewal ? new Date(existing.current_period_start) : now;
    const periodEnd = renewal ? addOneMonth(new Date(existing.current_period_end)) : addOneMonth(now);
    const set = {
      plan_id: plan.id,
      plan_code: plan.code,
      plan_name: plan.name,
      price_inr: plan.price_inr,
      currency: plan.currency || 'INR',
      status: 'active',
      current_period_start: periodStart,
      current_period_end: periodEnd,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      activated_at: existing?.activated_at || now,
      cancelled_at: null,
      updated_at: now,
      'meta.last_activation_source': source,
    };
    if (!renewal) Object.assign(set, { extra_seats: 0, extra_numbers: 0 });
    const sub = await Subscriptions.findOneAndUpdate({}, { $set: set, $setOnInsert: { created_at: now } }, { new: true, upsert: true, projection: { _id: 0 } }).lean();
    return { subscription: sub, renewal };
  });
}

/** Stops renewals at the end of the paid period (access stays until then). */
async function cancel({ tenantId = null, now = new Date() }) {
  return inTenant(tenantId, async () => {
    const sub = await Subscriptions.findOneAndUpdate({}, { $set: { status: 'cancelled', cancelled_at: now, updated_at: now } }, { new: true, projection: { _id: 0 } }).lean();
    return sub;
  });
}

/** Adds extras to the current period (the wallet debit happens in orders.js). */
async function addExtras({ tenantId = null, kind, quantity, now = new Date() }) {
  const field = kind === 'seat' ? 'extra_seats' : 'extra_numbers';
  return inTenant(tenantId, () => Subscriptions.findOneAndUpdate(
    { status: 'active', current_period_end: { $gt: now } },
    { $inc: { [field]: Number(quantity) }, $set: { updated_at: now } },
    { new: true, projection: { _id: 0 } },
  ).lean());
}

module.exports = { DAY_MS, addOneMonth, isLive, current, active, publicSubscription, activate, cancel, addExtras };
