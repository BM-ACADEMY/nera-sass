/**
 * The 7-day free trial (N7).
 *
 *   start      no card; needs the business name and website; one trial per
 *              business, website, WhatsApp number, owner email and phone
 *              (repeats are refused, logged in billing_trial_attempts and audited)
 *   extend     staff only, to 14 days at most, every extension audited with a reason
 *   status     on_trial / expired for the current tenant (send policy, guards)
 *   sendBlock  the one rule the N1 send policy asks: replies only, to people
 *              who wrote first (kind 'service', no templates); nothing once
 *              the trial has ended
 *   featureBlock  campaigns, bulk sends, exports and extras are not in the trial
 *   sweep      daily: the day-5 notice and the end-of-trial notice to the owner
 *
 * Limits themselves live in trialLimits.js; the subscription row carries the
 * dates (services/billing/subscriptions.js); this module owns billing_trials.
 */
const { BillingTrials, BillingTrialAttempts, Subscriptions, Tenants, Users, Clients } = require('../../models');
const { runAsSystem, runAsTenant, requireTenantId, currentTenantId } = require('../tenantContext');
const { insertIgnore } = require('../../db/mongo');
const audit = require('../audit');
const subscriptions = require('./subscriptions');
const alerts = require('./alerts');
const { TRIAL, trialPlan } = require('./trialLimits');

const DAY_MS = 24 * 60 * 60 * 1000;

class TrialError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const MESSAGES = Object.freeze({
  repliesOnly: 'The free trial can only reply to people who message you first. Upgrade to a plan to send templates, campaigns and follow-ups.',
  ended: 'Your free trial has ended. Upgrade to a plan in Settings > Billing to continue.',
  alreadyUsed: 'A free trial was already used for this business, website, WhatsApp number, email or phone. Choose a plan to continue.',
  onPlan: 'This workspace already has a plan; a trial is not needed.',
  feature: (what) => `${what} is not included in the free trial. Upgrade to a plan in Settings > Billing to use it.`,
  aiUsed: `Your free trial's ${TRIAL.aiRepliesTotal} AI replies are used up. Upgrade to a plan to keep the AI replying.`,
});

const FEATURES = Object.freeze({
  campaigns: 'Sending campaigns',
  bulk_sends: 'Bulk sending',
  exports: 'Exporting data',
  extras: 'Adding seats or numbers',
});

// ── normalised dedupe keys ───────────────────────────────────────────────────
const businessKey = (name) => String(name || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '') || null;
const emailKey = (email) => { const v = String(email || '').trim().toLowerCase(); return v.includes('@') ? v : null; };
const phoneKey = (phone) => { const digits = String(phone || '').replace(/\D/g, ''); return digits.length >= 10 ? digits.slice(-10) : null; };
function websiteKey(url) {
  const raw = String(url || '').trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!host.includes('.') || /\s/.test(host)) return null;
    return host;
  } catch {
    return null;
  }
}

function publicTrial(trial, now = new Date()) {
  if (!trial) return null;
  const endsAt = new Date(trial.ends_at);
  const expired = trial.status === 'expired' || endsAt <= now;
  return {
    status: trial.status === 'converted' ? 'converted' : (expired ? 'expired' : 'active'),
    started_at: trial.started_at,
    ends_at: trial.ends_at,
    days: Number(trial.days || TRIAL.days),
    max_days: TRIAL.maxDays,
    days_left: expired ? 0 : Math.max(0, Math.ceil((endsAt - now) / DAY_MS)),
    ai_replies_total: Number(trial.ai_replies_total || TRIAL.aiRepliesTotal),
    extended: Array.isArray(trial.extensions) && trial.extensions.length > 0,
    can_extend: Number(trial.days || TRIAL.days) < TRIAL.maxDays && trial.status !== 'converted',
    business_name: trial.business_name,
    website: trial.website,
  };
}

/** The current tenant's trial row, or null. */
async function current(tenantId = null) {
  const read = () => BillingTrials.findOne({}, { _id: 0 }).lean();
  return tenantId != null && Number(tenantId) !== currentTenantId() ? runAsTenant(tenantId, read) : read();
}

/** { on_trial, expired, subscription } for the current tenant (one query). */
async function status(now = new Date()) {
  requireTenantId();
  const sub = await Subscriptions.findOne({}, { _id: 0, is_trial: 1, status: 1, current_period_end: 1 }).lean();
  if (!sub?.is_trial) return { on_trial: false, expired: false, subscription: sub };
  const live = subscriptions.isLive(sub, now);
  return { on_trial: live, expired: !live, subscription: sub };
}

async function logAttempt({ userId, businessName, website, matched, reason, matchedTenantId = null, ip = null }) {
  const tenantId = requireTenantId();
  try {
    await BillingTrialAttempts.create({ user_id: userId, business_name: String(businessName || '').slice(0, 200), website: String(website || '').slice(0, 300), matched, reason, matched_tenant_id: matchedTenantId, ip, created_at: new Date() });
  } catch (error) {
    console.error('[billing/trial] Could not log a refused trial attempt:', error.message);
  }
  await audit.record(audit.EVENTS.TRIAL_BLOCKED, {
    tenantId, targetType: 'trial', targetId: null,
    actor: { actor_type: 'user', actor_user_id: userId, ip },
    meta: { matched, reason, matched_tenant_id: matchedTenantId },
  });
}

/**
 * start({ businessName, website, userId, ip, now }) in the tenant context.
 * Returns { trial, subscription }.
 */
async function start({ businessName, website, userId = null, ip = null, now = new Date() }) {
  const tenantId = requireTenantId();
  const name = String(businessName || '').trim();
  const site = String(website || '').trim();
  if (name.length < 2 || name.length > 120) throw new TrialError(400, 'Please enter your business name (2 to 120 characters)', 'BUSINESS_NAME_REQUIRED');
  const siteKey = websiteKey(site);
  if (!siteKey || site.length > 300) throw new TrialError(400, 'Please enter your business website, for example www.example.in', 'WEBSITE_REQUIRED');

  const existingSub = await Subscriptions.findOne({}, { _id: 0 }).lean();
  if (subscriptions.isLive(existingSub, now) && !existingSub.is_trial) throw new TrialError(409, MESSAGES.onPlan, 'ALREADY_ON_PLAN');
  const own = await BillingTrials.findOne({}, { _id: 0, id: 1 }).lean();
  if (own) {
    await logAttempt({ userId, businessName: name, website: site, matched: ['workspace'], reason: 'trial already used by this workspace', matchedTenantId: tenantId, ip });
    throw new TrialError(409, MESSAGES.alreadyUsed, 'TRIAL_ALREADY_USED');
  }

  // The identity of the business: owner email, brand phone and WhatsApp number.
  const [tenant, owner, brand] = await Promise.all([
    runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, id: 1, name: 1, owner_user_id: 1 }).lean(), 'billing:trial'),
    runAsSystem(() => Users.findOne(userId ? { id: userId } : { tenant_id: tenantId, role: 'owner' }, { _id: 0, id: 1, email: 1, phone: 1 }).lean(), 'billing:trial'),
    Clients.findOne({}, { _id: 0, id: 1, phone: 1, whatsapp_number: 1 }).lean(),
  ]);
  const keys = {
    business_key: businessKey(name),
    website_key: siteKey,
    email_key: emailKey(owner?.email),
    phone_key: phoneKey(brand?.phone || owner?.phone),
    whatsapp_key: phoneKey(brand?.whatsapp_number),
  };
  const or = Object.entries(keys).filter(([, value]) => value).map(([field, value]) => ({ [field]: value }));
  const clash = await runAsSystem(() => BillingTrials.findOne({ $or: or }, { _id: 0, tenant_id: 1, business_key: 1, website_key: 1, email_key: 1, phone_key: 1, whatsapp_key: 1 }).lean(), 'billing:trial');
  if (clash) {
    const matched = Object.entries(keys).filter(([field, value]) => value && clash[field] === value).map(([field]) => field.replace('_key', ''));
    await logAttempt({ userId, businessName: name, website: site, matched, reason: 'a trial exists for the same identity', matchedTenantId: clash.tenant_id, ip });
    throw new TrialError(409, MESSAGES.alreadyUsed, 'TRIAL_ALREADY_USED');
  }

  const endsAt = new Date(now.getTime() + TRIAL.days * DAY_MS);
  const row = await insertIgnore(BillingTrials, {
    business_name: name, website: site, owner_email: owner?.email || null, phone: brand?.phone || owner?.phone || null, whatsapp_number: brand?.whatsapp_number || null,
    ...keys, status: 'active', started_at: now, ends_at: endsAt, original_ends_at: endsAt, days: TRIAL.days, ai_replies_total: TRIAL.aiRepliesTotal,
    extensions: [], created_by: userId, created_at: now, updated_at: now,
  });
  if (!row) {
    // Two requests raced: the unique indexes kept one. Log the other.
    await logAttempt({ userId, businessName: name, website: site, matched: ['race'], reason: 'a trial with the same identity was created at the same time', ip });
    throw new TrialError(409, MESSAGES.alreadyUsed, 'TRIAL_ALREADY_USED');
  }
  const subscription = await subscriptions.startTrial({ days: TRIAL.days, now });
  await audit.record(audit.EVENTS.TRIAL_STARTED, {
    tenantId, targetType: 'trial', targetId: row.id,
    actor: { actor_type: 'user', actor_user_id: userId, ip },
    meta: { business_name: name, website: siteKey, days: TRIAL.days, ends_at: endsAt, workspace_name: tenant?.name || null },
  });
  return { trial: publicTrial(row, now), subscription };
}

/**
 * Staff extension, to 14 days in all. `days` adds to the current length
 * (default: whatever takes it to 14). The reason is required and audited.
 */
async function extend({ tenantId, days = null, reason, staffUserId = null, ip = null, now = new Date() }) {
  const note = String(reason || '').trim();
  if (note.length < 3 || note.length > 300) throw new TrialError(400, 'A reason of 3 to 300 characters is required', 'REASON_REQUIRED');
  return runAsTenant(tenantId, async () => {
    const trial = await BillingTrials.findOne({}, { _id: 0 }).lean();
    if (!trial) throw new TrialError(404, 'This workspace has no trial to extend', 'NO_TRIAL');
    if (trial.status === 'converted') throw new TrialError(409, 'This workspace already paid for a plan', 'TRIAL_CONVERTED');
    const currentDays = Number(trial.days || TRIAL.days);
    const extra = days == null ? TRIAL.maxDays - currentDays : Number(days);
    if (!Number.isInteger(extra) || extra < 1) throw new TrialError(400, 'days must be a whole number of at least 1', 'INVALID_DAYS');
    if (currentDays + extra > TRIAL.maxDays) throw new TrialError(400, `A trial can run for ${TRIAL.maxDays} days at most (this one has ${currentDays})`, 'TRIAL_MAX_DAYS');
    const totalDays = currentDays + extra;
    const endsAt = new Date(new Date(trial.started_at).getTime() + totalDays * DAY_MS);
    const extension = { by: staffUserId, at: now, days: extra, reason: note, ends_at: endsAt };
    const updated = await BillingTrials.findOneAndUpdate(
      { id: trial.id },
      { $set: { days: totalDays, ends_at: endsAt, status: endsAt > now ? 'active' : 'expired', expiry_notice_at: endsAt > now ? null : trial.expiry_notice_at, updated_at: now }, $push: { extensions: extension } },
      { new: true, projection: { _id: 0 } },
    ).lean();
    const subscription = await subscriptions.setTrialEnd({ endsAt, now });
    await audit.record(audit.EVENTS.TRIAL_EXTENDED, {
      tenantId, targetType: 'trial', targetId: trial.id,
      actor: { actor_type: 'staff', actor_user_id: staffUserId, ip },
      meta: { days_added: extra, total_days: totalDays, ends_at: endsAt, reason: note },
    });
    return { trial: publicTrial(updated, now), subscription };
  });
}

/** A paid plan replaced the trial (called from orders.fulfil, tenant context). */
async function markConverted(now = new Date()) {
  requireTenantId();
  await BillingTrials.updateOne({ status: { $ne: 'converted' } }, { $set: { status: 'converted', converted_at: now, updated_at: now } });
}

/** The trial's period ended (called from orders.expireLapsed, tenant context). */
async function markExpired(now = new Date()) {
  const tenantId = requireTenantId();
  const trial = await BillingTrials.findOneAndUpdate({ status: 'active' }, { $set: { status: 'expired', expiry_notice_at: now, updated_at: now } }, { new: true, projection: { _id: 0 } }).lean();
  if (!trial) return { expired: false };
  await alerts.raise({ key: `trial_expired:${trial.id}:${new Date(trial.ends_at).toISOString()}`, kind: 'trial_expired', message: 'Your 7-day free trial has ended. Upgrade to a plan with one click in Settings > Billing to keep replying to customers.', meta: { trial_id: trial.id, ends_at: trial.ends_at } });
  await audit.record(audit.EVENTS.TRIAL_EXPIRED, { tenantId, targetType: 'trial', targetId: trial.id, actor: { actor_type: 'system', actor_user_id: null }, meta: { ends_at: trial.ends_at } });
  return { expired: true };
}

/**
 * Daily sweep (system context): the day-5 email to every owner whose trial
 * started 5 or more days ago and is still running, once. Expiry notices come
 * from orders.expireLapsed, which also closes the subscription row.
 */
async function sweep(now = new Date()) {
  const due = await runAsSystem(() => BillingTrials.find(
    { status: 'active', day5_notice_at: null, started_at: { $lte: new Date(now.getTime() - 5 * DAY_MS) }, ends_at: { $gt: now } },
    { _id: 0, id: 1, tenant_id: 1, ends_at: 1 },
  ).lean(), 'billing:trial');
  let notified = 0;
  for (const trial of due) {
    await runAsTenant(trial.tenant_id, async () => {
      const daysLeft = Math.max(1, Math.ceil((new Date(trial.ends_at) - now) / DAY_MS));
      const result = await alerts.raise({
        key: `trial_day5:${trial.id}`, kind: 'trial_day5',
        message: `Your free trial ends in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. Upgrade to a plan in Settings > Billing to keep WhatsApp replies and the AI running without a break.`,
        meta: { trial_id: trial.id, days_left: daysLeft, ends_at: trial.ends_at },
      });
      await BillingTrials.updateOne({ id: trial.id }, { $set: { day5_notice_at: now, updated_at: now } });
      if (result.sent) notified += 1;
    });
  }
  return { notified };
}

/**
 * Asked by the N1 send policy for every send. Returns null when the send may
 * go ahead, else { status, code, message }. A running trial allows only a
 * reply inside the conversation (kind 'service', not a template); an ended
 * trial allows nothing.
 */
async function sendBlock({ kind, messageType = 'text', now = new Date() }) {
  if (!currentTenantId()) return null;
  const state = await status(now);
  if (state.expired) return { status: 403, code: 'TRIAL_ENDED', message: MESSAGES.ended };
  if (!state.on_trial) return null;
  if (kind !== 'service' || messageType === 'template') return { status: 403, code: 'TRIAL_REPLIES_ONLY', message: MESSAGES.repliesOnly };
  return null;
}

/** For routes: null, or { status: 403, code, message } when `feature` is outside the trial. */
async function featureBlock(feature, now = new Date()) {
  if (!currentTenantId()) return null;
  const state = await status(now);
  if (state.expired) return { status: 403, code: 'TRIAL_ENDED', message: MESSAGES.ended };
  if (!state.on_trial) return null;
  return { status: 403, code: 'TRIAL_FEATURE_BLOCKED', message: MESSAGES.feature(FEATURES[feature] || 'This feature') };
}

/** Express middleware: refuses the route for a workspace on (or after) a trial. */
const guard = (feature) => async (req, res, next) => {
  try {
    const block = await featureBlock(feature);
    if (block) return res.status(block.status).json({ error: block.message, code: block.code });
    return next();
  } catch (error) {
    console.error('[billing/trial] guard failed:', error.message);
    return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
  }
};

module.exports = { TRIAL, TrialError, MESSAGES, FEATURES, trialPlan, publicTrial, businessKey, websiteKey, emailKey, phoneKey, current, status, start, extend, markConverted, markExpired, sweep, sendBlock, featureBlock, guard };
