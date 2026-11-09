/**
 * Subscriptions: which plan a workspace is on and until when. One row per
 * workspace (models/Subscriptions.js); a renewal extends the paid period, a
 * plan change replaces the plan from now. Activation happens only from a
 * verified payment (services/billing/orders.js) or a staff grant.
 * N7: a period is 1, 3 or 6 months paid at once; the AI allowance resets on
 * every monthly anniversary inside it (cycleStart). A free trial is a
 * subscription row with is_trial and the synthetic trial plan.
 * Runs in the caller's tenant context unless a tenantId is given.
 */
const { Subscriptions } = require('../../models');
const { runAsTenant, currentTenantId } = require('../tenantContext');
const plansService = require('./plans');
const { TRIAL, trialPlan } = require('./trialLimits');

const DAY_MS = 24 * 60 * 60 * 1000;

const inTenant = (tenantId, fn) => (tenantId != null && Number(tenantId) !== currentTenantId() ? runAsTenant(tenantId, fn) : fn());

/** `months` calendar months after `from` (31 Jan + 1 -> 28/29 Feb, as Razorpay does). */
function addMonths(from, months) {
  const date = new Date(from);
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + Number(months), 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}
const addOneMonth = (from) => addMonths(from, 1);

/**
 * The monthly allowance cycle `now` falls in: a 3 or 6 month plan resets its
 * AI allowance on each monthly anniversary of the period start. A 1 month
 * plan and a trial have one cycle, the whole period.
 */
function cycleStart(sub, now = new Date()) {
  const start = new Date(sub.current_period_start);
  const end = new Date(sub.current_period_end);
  if (sub.is_trial) return { start, end };
  // A renewal keeps the original start, so count anniversaries from there.
  let cycle = { start, end: addMonths(start, 1) };
  for (let k = 1; k < 1000; k += 1) {
    const candidate = addMonths(start, k);
    if (candidate > now || candidate >= end) break;
    cycle = { start: candidate, end: addMonths(start, k + 1) };
  }
  if (cycle.end > end) cycle.end = end;
  return cycle;
}

const isLive = (sub, now = new Date()) => Boolean(sub && sub.status === 'active' && sub.current_period_end && new Date(sub.current_period_end) > now);

/**
 * Writes the workspace's single subscription row: an update when it exists,
 * else an insert through create() so the numeric id is assigned (a raw upsert
 * never runs the id hook, which made the second workspace ever to subscribe
 * collide on id null). Two first-time writes racing: the unique tenant_id
 * index keeps one and the other becomes an update.
 */
async function writeSubscription(existing, set, { now, source }) {
  const projection = { _id: 0 };
  if (existing) {
    return Subscriptions.findOneAndUpdate({ id: existing.id }, { $set: { ...set, 'meta.last_activation_source': source } }, { new: true, projection }).lean();
  }
  try {
    return (await Subscriptions.create({ ...set, meta: { last_activation_source: source }, created_at: now })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    const row = await Subscriptions.findOne({}, projection).lean();
    return Subscriptions.findOneAndUpdate({ id: row.id }, { $set: { ...set, 'meta.last_activation_source': source } }, { new: true, projection }).lean();
  }
}

/** The workspace's subscription row (any status) or null. */
async function current(tenantId = null) {
  return inTenant(tenantId, () => Subscriptions.findOne({}, { _id: 0 }).lean());
}

/** Active subscription (paid or trial) with its plan, or null. */
async function active(tenantId = null, now = new Date()) {
  const sub = await current(tenantId);
  if (!isLive(sub, now)) return null;
  const plan = sub.is_trial ? trialPlan() : await plansService.planById(sub.plan_id);
  return { subscription: sub, plan };
}

/** What the customer sees about their subscription. */
function publicSubscription(sub, now = new Date()) {
  if (!sub) return null;
  const live = isLive(sub, now);
  const cycle = live ? cycleStart(sub, now) : null;
  return {
    plan_id: sub.plan_id,
    plan_code: sub.plan_code,
    plan_name: sub.plan_name,
    price_inr: sub.price_inr,
    period_months: Number(sub.period_months || (sub.is_trial ? 0 : 1)),
    is_trial: Boolean(sub.is_trial),
    currency: sub.currency || 'INR',
    status: live ? 'active' : (sub.status === 'cancelled' ? 'cancelled' : 'expired'),
    current_period_start: sub.current_period_start,
    current_period_end: sub.current_period_end,
    // When the AI allowance next resets (the period end on a 1 month plan or trial).
    allowance_resets_at: cycle ? cycle.end : null,
    days_left: live ? Math.max(0, Math.ceil((new Date(sub.current_period_end) - now) / DAY_MS)) : 0,
    extra_seats: Number(sub.extra_seats || 0),
    extra_numbers: Number(sub.extra_numbers || 0),
    activated_at: sub.activated_at || null,
  };
}

/**
 * Puts the workspace on `plan` for `months` (1, 3 or 6) from now, or extends
 * the current period by that much when the same plan is still active (a
 * renewal). Extras carry over on a renewal; a plan change clears them (they
 * are re-bought against the new plan's prices). A trial is never renewed: a
 * paid plan always starts a fresh period from now.
 */
async function activate({ tenantId = null, plan, months = 1, priceInr = null, orderId = null, paymentId = null, now = new Date(), source = 'payment' }) {
  if (!plan) throw new Error('A plan is required to activate a subscription');
  const periodMonths = plansService.PERIODS.includes(Number(months)) ? Number(months) : 1;
  return inTenant(tenantId, async () => {
    const existing = await Subscriptions.findOne({}, { _id: 0 }).lean();
    const renewal = isLive(existing, now) && !existing.is_trial && existing.plan_id === plan.id;
    const periodStart = renewal ? new Date(existing.current_period_start) : now;
    const periodEnd = renewal ? addMonths(new Date(existing.current_period_end), periodMonths) : addMonths(now, periodMonths);
    const set = {
      plan_id: plan.id,
      plan_code: plan.code,
      plan_name: plan.name,
      // Price before GST for the period bought, from the table at order time.
      price_inr: priceInr != null ? Number(priceInr) : (plansService.periodPriceInr(plan, periodMonths) ?? plan.price_inr),
      period_months: periodMonths,
      is_trial: false,
      currency: plan.currency || 'INR',
      status: 'active',
      current_period_start: periodStart,
      current_period_end: periodEnd,
      razorpay_order_id: orderId,
      razorpay_payment_id: paymentId,
      activated_at: existing?.activated_at || now,
      cancelled_at: null,
      updated_at: now,
    };
    if (!renewal) Object.assign(set, { extra_seats: 0, extra_numbers: 0 });
    const sub = await writeSubscription(existing, set, { now, source });
    return { subscription: sub, renewal };
  });
}

/**
 * Starts the free trial: `days` from now on the synthetic trial plan. The
 * caller (services/billing/trial.js) has already checked the one-trial rules.
 */
async function startTrial({ tenantId = null, days = TRIAL.days, now = new Date() }) {
  const plan = trialPlan();
  return inTenant(tenantId, async () => {
    const existing = await Subscriptions.findOne({}, { _id: 0 }).lean();
    if (isLive(existing, now)) throw new Error('This workspace already has an active plan');
    const set = {
      plan_id: null, plan_code: plan.code, plan_name: plan.name, price_inr: 0, period_months: 0, is_trial: true,
      currency: 'INR', status: 'active', current_period_start: now, current_period_end: new Date(now.getTime() + days * DAY_MS),
      extra_seats: 0, extra_numbers: 0, razorpay_order_id: null, razorpay_payment_id: null,
      activated_at: existing?.activated_at || now, cancelled_at: null, updated_at: now,
    };
    return writeSubscription(existing, set, { now, source: 'trial' });
  });
}

/** Moves the trial end (a staff extension); reactivates an expired trial. */
async function setTrialEnd({ tenantId = null, endsAt, now = new Date() }) {
  return inTenant(tenantId, () => Subscriptions.findOneAndUpdate(
    { is_trial: true },
    { $set: { current_period_end: new Date(endsAt), status: new Date(endsAt) > now ? 'active' : 'expired', updated_at: now } },
    { new: true, projection: { _id: 0 } },
  ).lean());
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

module.exports = { DAY_MS, addMonths, addOneMonth, cycleStart, isLive, current, active, publicSubscription, activate, startTrial, setTrialEnd, cancel, addExtras };
