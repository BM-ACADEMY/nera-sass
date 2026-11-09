/**
 * Customer alerts (plan N4).
 *
 * Five kinds of problem a workspace owner must hear about:
 *   template_rejected   Meta did not approve (or paused) a template
 *   wallet_low          balance under 20% of the last top-up (the billing wallet ledger)
 *   number_quality      Meta's quality signal for the WhatsApp number dropped
 *   setup_unfinished    a setup step is still open after SETUP_ALERT_AFTER_HOURS
 *   payment_failed      a payment did not go through
 *
 * Each becomes a notice (collection customer_alerts) shown in the customer's
 * Notices box and in the platform "Needs your attention" list. Raising the same
 * problem again while it is open changes nothing (no second email); it closes
 * itself when the problem goes away and reopens, with a new email, if it comes
 * back.
 *
 * Delivery:
 *   email     always. A failed email is retried by the sweep (up to 5 attempts).
 *   WhatsApp  only for numbers opted in to alerts at signup, only through an
 *             approved utility template (services/alertWhatsapp.js).
 *
 * Notices hold plain sentences written here. Raw provider errors are never
 * stored or shown.
 *
 *   SETUP_ALERT_AFTER_HOURS   age of a workspace before unfinished setup is flagged (default 24)
 */
const { CustomerAlerts, Tenants, Users, Clients, Templates, MetaWhatsappTemplates, WhatsappNumberState } = require('../models');
const { NO_ID } = require('../db/mongo');
const { currentTenantId, runAsSystem, runAsTenant } = require('./tenantContext');
const { explainRejection, cleanReasonCode } = require('./templateRejection');
const alertWhatsapp = require('./alertWhatsapp');
const notify = require('./notify');
const billingWallet = require('./billing/wallet');
const { WARN_FRACTION } = require('./billing/aiAllowance');

const TYPES = Object.freeze({
  template_rejected: { severity: 'warning', path: '/templates', label: 'Template rejected' },
  wallet_low: { severity: 'warning', path: '/settings', label: 'Wallet low' },
  number_quality: { severity: 'critical', path: '/settings/whatsapp', label: 'Number quality dropped' },
  setup_unfinished: { severity: 'info', path: '/settings/whatsapp', label: 'Setup unfinished' },
  payment_failed: { severity: 'critical', path: '/settings', label: 'Payment failed' },
});
const MAX_EMAIL_ATTEMPTS = 5;
const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const BAD_RATINGS = new Set(['YELLOW', 'MEDIUM', 'RED', 'LOW']);

const hours = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

async function recipientsFor(tenantId) {
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0, id: 1, name: 1, owner_user_id: 1, alerts_whatsapp: 1 }).lean(), 'alerts-tenant');
  let owner = tenant?.owner_user_id ? await Users.findOne({ id: tenant.owner_user_id }, { _id: 0, id: 1, name: 1, email: 1 }).lean() : null;
  if (!owner) owner = await Users.findOne({ role: 'owner', is_active: { $ne: false } }, { _id: 0, id: 1, name: 1, email: 1 }).sort({ id: 1 }).lean();
  return { tenant, owner };
}

/** Sends the email (retried by the sweep) and, once, the WhatsApp copy. Never throws. */
async function deliver(alert, { whatsappSummary } = {}) {
  const set = {};
  try {
    const { tenant, owner } = await recipientsFor(alert.tenant_id ?? currentTenantId());
    if (alert.email_status !== 'sent') {
      if (!owner?.email) {
        set.email_status = 'no_recipient';
      } else {
        set.email_attempts = Number(alert.email_attempts || 0) + 1;
        try {
          const result = await notify.customerAlertEmail({
            to: owner.email, ownerName: owner.name, workspaceName: tenant?.name, title: alert.title,
            lines: [alert.message, alert.details?.advice].filter(Boolean), path: alert.action_path,
          });
          set.email_status = result?.delivered ? 'sent' : 'failed';
          if (result?.delivered) set.email_sent_at = new Date();
        } catch (error) {
          console.error(`[alerts] Email for notice ${alert.id} failed: ${error.message}`);
          set.email_status = 'failed';
        }
      }
    }
    if (!alert.whatsapp_status) {
      const result = await alertWhatsapp.sendAlert({ tenant, type: alert.type, summary: whatsappSummary || alert.title });
      set.whatsapp_status = result.status;
      if (result.status === 'sent') set.whatsapp_sent_at = new Date();
    }
  } catch (error) {
    console.error(`[alerts] Delivery for notice ${alert.id} failed: ${error.message}`);
    if (!set.email_status && alert.email_status !== 'sent') set.email_status = 'failed';
  }
  if (Object.keys(set).length) await CustomerAlerts.updateOne({ id: alert.id }, { $set: set });
  return { ...alert, ...set };
}

/**
 * Raises a notice in the current tenant. Returns { alert, created } where
 * created is true when the customer is being told now (new or reopened).
 *   type, key        what and which one (key makes it unique within the type)
 *   title, message   plain sentences for the customer
 *   advice           optional "what to do" sentence
 *   details          small facts for the panel (no secrets, no raw errors)
 *   whatsappSummary  one line for the WhatsApp template variable
 *   emailAlreadySent the caller just emailed the customer about this (no second email)
 */
async function raise({ type, key = '', title, message, advice = null, details = {}, severity = null, whatsappSummary = null, emailAlreadySent = false }) {
  const config = TYPES[type];
  if (!config) throw new Error(`Unknown alert type ${type}`);
  const tenantId = currentTenantId();
  if (!tenantId) throw new Error('A tenant context is required to raise an alert');
  const dedupeKey = `${type}:${key}`;
  const now = new Date();
  const fields = { title, message, severity: severity || config.severity, action_path: config.path, details: { ...details, ...(advice ? { advice } : {}) } };
  const emailFields = emailAlreadySent ? { email_status: 'sent', email_attempts: 0, email_sent_at: now } : { email_status: 'pending', email_attempts: 0 };

  const existing = await CustomerAlerts.findOne({ dedupe_key: dedupeKey }, NO_ID).lean();
  if (existing?.status === 'open') {
    const alert = await CustomerAlerts.findOneAndUpdate({ id: existing.id }, { $set: { ...fields, last_raised_at: now } }, { new: true, projection: NO_ID }).lean();
    return { alert, created: false };
  }
  let alert = null;
  if (existing) {
    // Reopen: the problem came back, so the customer is told again.
    alert = await CustomerAlerts.findOneAndUpdate(
      { id: existing.id, status: 'resolved' },
      { $set: { ...fields, ...emailFields, status: 'open', last_raised_at: now, created_at: now, read_at: null, resolved_at: null }, $unset: { whatsapp_status: '', whatsapp_sent_at: '', ...(emailAlreadySent ? {} : { email_sent_at: '' }) }, $inc: { raised_count: 1 } },
      { new: true, projection: NO_ID },
    ).lean();
    if (!alert) return { alert: await CustomerAlerts.findOne({ id: existing.id }, NO_ID).lean(), created: false };
  } else {
    try {
      alert = (await CustomerAlerts.create({ type, dedupe_key: dedupeKey, ...fields, ...emailFields, status: 'open', created_at: now, last_raised_at: now })).toObject();
    } catch (error) {
      if (error.code !== 11000) throw error;
      return { alert: await CustomerAlerts.findOne({ dedupe_key: dedupeKey }, NO_ID).lean(), created: false };
    }
  }
  alert = await deliver({ ...alert, tenant_id: tenantId }, { whatsappSummary });
  return { alert, created: true };
}

/** Closes open notices of a type (optionally one key) because the problem is gone. */
async function resolve(type, key = null) {
  const filter = { status: 'open', type };
  if (key != null) filter.dedupe_key = `${type}:${key}`;
  const result = await CustomerAlerts.updateMany(filter, { $set: { status: 'resolved', resolved_at: new Date() } });
  return result.modifiedCount || 0;
}

/** Closes open notices of a type whose key is not in `liveKeys`. */
async function resolveExcept(type, liveKeys) {
  const live = new Set(liveKeys.map((key) => `${type}:${key}`));
  const open = await CustomerAlerts.find({ status: 'open', type }, { _id: 0, id: 1, dedupe_key: 1 }).lean();
  const stale = open.filter((row) => !live.has(row.dedupe_key)).map((row) => row.id);
  if (stale.length) await CustomerAlerts.updateMany({ id: { $in: stale } }, { $set: { status: 'resolved', resolved_at: new Date() } });
  return stale.length;
}

// ── The five problems ────────────────────────────────────────

const money = (value, currency = 'INR') => {
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(value) || 0); } catch { return String(value); }
};

/**
 * Wallet notice from the billing ledger (services/billing/wallet.js): low when
 * the balance is at or under 20 percent of the last top-up, the same rule the
 * billing module's own email uses. Closes itself after a top-up.
 */
async function evaluateWallet({ emailAlreadySent = false } = {}) {
  const topup = await billingWallet.lastTopup();
  if (!topup) return resolve('wallet_low');
  const balance = await billingWallet.balancePaise();
  const percent = Math.max(0, Math.round((balance / Number(topup.amount_paise)) * 100));
  if (balance > Math.ceil(Number(topup.amount_paise) * WARN_FRACTION)) return resolve('wallet_low');
  return raise({
    type: 'wallet_low', key: 'wallet',
    title: balance <= 0 ? 'Your wallet is empty' : 'Your wallet is running low',
    message: balance <= 0
      ? 'Your wallet is empty. AI replies and paid extras stop until you top it up.'
      : `Your wallet is down to ${billingWallet.formatInr(balance)}, which is ${percent}% of your last top-up. Paid usage stops when it reaches zero.`,
    advice: 'Top up your wallet in Settings > Billing to keep going.',
    details: { balance_paise: balance, last_topup_paise: Number(topup.amount_paise), percent },
    whatsappSummary: `wallet at ${percent}% of your last top-up`,
    emailAlreadySent,
  });
}

async function paymentFailed({ reference, amount = null, currency = 'INR' } = {}) {
  const ref = String(reference || 'unknown').slice(0, 80);
  return raise({
    type: 'payment_failed', key: ref,
    title: 'A payment did not go through',
    message: `${amount != null ? `Your payment of ${money(amount, currency)}` : 'Your payment'} was not completed, so nothing was added to your account.`,
    advice: 'Try again with another card or UPI app. If money left your account, your bank usually returns it within a few days.',
    details: { reference: ref, amount, currency },
    whatsappSummary: 'a payment did not go through',
  });
}

async function evaluateQuality({ emailAlreadySent = false } = {}) {
  const states = await WhatsappNumberState.find({}, NO_ID).lean();
  const live = [];
  for (const state of states) {
    const bad = state.marketing_paused || BAD_RATINGS.has(String(state.quality_rating || '').toUpperCase());
    if (!bad) continue;
    live.push(String(state.phone_number_id));
    await raise({
      type: 'number_quality', key: String(state.phone_number_id),
      title: state.marketing_paused ? 'Marketing is paused on your WhatsApp number' : 'Your WhatsApp number quality dropped',
      message: `Meta reports a lower quality rating for your WhatsApp number${state.quality_rating && state.quality_rating !== 'UNKNOWN' ? ` (${String(state.quality_rating).toLowerCase()})` : ''}. ${state.marketing_paused ? 'Marketing messages are paused and your daily limit was lowered. Replies to customers and transactional messages continue.' : 'Slow down marketing sends to avoid a pause.'}`,
      advice: 'Send marketing only to people who opted in, and check recent campaigns. Marketing resumes when the rating recovers.',
      details: { quality_rating: state.quality_rating || null, marketing_paused: Boolean(state.marketing_paused), daily_cap: state.daily_cap },
      whatsappSummary: 'WhatsApp number quality dropped',
      emailAlreadySent,
    });
  }
  await resolveExcept('number_quality', live);
  return live.length;
}

const SETUP_STEPS = Object.freeze({
  whatsapp_connected: 'Connect your WhatsApp number',
  whatsapp_verified: 'Get your WhatsApp number verified',
  template_approved: 'Get your first message template approved',
});

/** Setup steps still open for the current workspace: [{ step, label }]. */
async function pendingSetup() {
  const client = await Clients.findOne({}, { _id: 0, phone_number_id: 1, wa_business_id: 1, whatsapp_status: 1 }).lean();
  const approved = await Templates.exists({ status: { $in: ['approved', 'active'] } });
  const done = {
    whatsapp_connected: Boolean(client?.phone_number_id && client?.wa_business_id),
    whatsapp_verified: client?.whatsapp_status === 'verified',
    template_approved: Boolean(approved),
  };
  return Object.entries(SETUP_STEPS).filter(([step]) => !done[step]).map(([step, label]) => ({ step, label }));
}

async function evaluateSetup(tenant) {
  const ageHours = (Date.now() - new Date(tenant?.created_at || Date.now()).getTime()) / 3600000;
  if (ageHours < hours('SETUP_ALERT_AFTER_HOURS', 24)) return resolve('setup_unfinished');
  const pending = await pendingSetup();
  if (!pending.length) return resolve('setup_unfinished');
  return raise({
    type: 'setup_unfinished', key: 'setup',
    title: 'Finish setting up your workspace',
    message: `${pending.length === 1 ? 'One step is' : `${pending.length} steps are`} still open: ${pending.map((p) => p.label.toLowerCase()).join(', ')}.`,
    advice: 'Finish these to start sending messages.',
    details: { steps: pending },
    whatsappSummary: `${pending.length} setup step${pending.length === 1 ? '' : 's'} still open`,
  });
}

const REJECTED_STATUSES = new Set(['REJECTED', 'PAUSED', 'DISABLED']);

/** Raises a notice for one rejected/paused template. `reason` is Meta's reason code. */
async function templateRejected({ id, name, status = 'REJECTED', reason = null }) {
  const why = explainRejection(status === 'REJECTED' ? reason : status);
  const paused = status !== 'REJECTED';
  return raise({
    type: 'template_rejected', key: String(id || name),
    title: paused ? `Template "${name}" was paused by Meta` : `Template "${name}" was not approved`,
    message: why.message,
    advice: `${why.fix} Open the template, edit it and send it for review again.`,
    details: { template: name, template_id: id ? String(id) : null, status, reason_code: why.code },
    whatsappSummary: `template ${String(name).slice(0, 40)} ${paused ? 'was paused' : 'was rejected'}`,
  });
}

/**
 * A template status change from Meta's webhook, resolved to its workspace
 * through the WABA of the cached template. Unknown templates are ignored.
 */
async function templateStatusChanged({ templateId, name, event, reason }) {
  const status = String(event || '').toUpperCase();
  const cached = await runAsSystem(() => MetaWhatsappTemplates.findOne({ template_id: String(templateId) }, { _id: 0, waba_id: 1, name: 1 }).lean(), 'alerts-template-status');
  if (!cached?.waba_id) return null;
  const client = await runAsSystem(() => Clients.findOne({ wa_business_id: cached.waba_id }, { _id: 0, tenant_id: 1 }).lean(), 'alerts-template-status');
  if (!client?.tenant_id) return null;
  return runAsTenant(client.tenant_id, () => (REJECTED_STATUSES.has(status)
    ? templateRejected({ id: templateId, name: name || cached.name, status, reason })
    : resolve('template_rejected', String(templateId))));
}

/** Closes the notice of a template that was edited and sent back for review. */
const templateResubmitted = (id) => resolve('template_rejected', String(id));

async function evaluateTemplates() {
  const client = await Clients.findOne({}, { _id: 0, wa_business_id: 1 }).lean();
  const live = [];
  const own = await Templates.find({ status: 'rejected' }, { _id: 0, id: 1, name: 1, meta_template_id: 1, rejection_reason: 1 }).lean();
  for (const t of own) {
    const id = t.meta_template_id || `local-${t.id}`;
    live.push(String(id));
    await templateRejected({ id, name: t.name, status: 'REJECTED', reason: t.rejection_reason });
  }
  if (client?.wa_business_id) {
    const cached = await runAsSystem(() => MetaWhatsappTemplates.find(
      { waba_id: client.wa_business_id, status: { $in: [...REJECTED_STATUSES] } },
      { _id: 0, template_id: 1, name: 1, status: 1, 'raw_data.rejected_reason': 1 },
    ).lean(), 'alerts-templates');
    for (const t of cached) {
      if (live.includes(String(t.template_id))) continue;
      live.push(String(t.template_id));
      await templateRejected({ id: t.template_id, name: t.name, status: String(t.status).toUpperCase(), reason: t.raw_data?.rejected_reason });
    }
  }
  await resolveExcept('template_rejected', live);
  return live.length;
}

/** Checks everything for one workspace. Each check is isolated: one failure never blocks the others. */
async function evaluateTenant(tenantId) {
  return runAsTenant(tenantId, async () => {
    const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0, id: 1, name: 1, created_at: 1 }).lean(), 'alerts-sweep');
    const checks = {
      templates: () => evaluateTemplates(),
      quality: () => evaluateQuality(),
      wallet: () => evaluateWallet(),
      setup: () => evaluateSetup(tenant),
      emails: () => retryEmails(),
    };
    const outcome = {};
    for (const [name, run] of Object.entries(checks)) {
      try { await run(); outcome[name] = 'ok'; } catch (error) { console.error(`[alerts] ${name} check failed for tenant ${tenantId}: ${error.message}`); outcome[name] = 'error'; }
    }
    return outcome;
  });
}

/** Sends again the emails that failed or were never sent. */
async function retryEmails() {
  const pending = await CustomerAlerts.find({ status: 'open', email_status: { $in: ['failed', 'pending', 'no_recipient'] }, email_attempts: { $lt: MAX_EMAIL_ATTEMPTS } }, NO_ID).limit(20).lean();
  for (const alert of pending) await deliver({ ...alert, tenant_id: currentTenantId() });
  return pending.length;
}

/** Periodic pass over every active workspace (see the cron in server.js). */
async function sweepAll() {
  const tenants = await runAsSystem(() => Tenants.find({ status: 'active' }, { _id: 0, id: 1 }).lean(), 'alerts-sweep');
  let ok = 0;
  for (const { id } of tenants) {
    const outcome = await evaluateTenant(id);
    if (Object.values(outcome).every((value) => value === 'ok')) ok += 1;
  }
  return { tenants: tenants.length, ok };
}

// ── Reading ──────────────────────────────────────────────────

const present = (alert) => ({
  id: alert.id, type: alert.type, severity: alert.severity, title: alert.title, message: alert.message,
  advice: alert.details?.advice || null, action_path: alert.action_path, status: alert.status,
  read: Boolean(alert.read_at), created_at: alert.created_at, resolved_at: alert.resolved_at || null,
});

/** The current workspace's notices (open first), as shown in the Notices box. */
async function listNotices({ includeResolved = false, limit = 50 } = {}) {
  const filter = includeResolved ? {} : { status: 'open' };
  const rows = await CustomerAlerts.find(filter, NO_ID).sort({ status: -1, created_at: -1 }).limit(Math.min(Number(limit) || 50, 200)).lean();
  const unread = await CustomerAlerts.countDocuments({ status: 'open', read_at: null });
  return { notices: rows.map(present), unread };
}

const markRead = (id) => CustomerAlerts.updateOne({ id: Number(id), status: 'open', read_at: null }, { $set: { read_at: new Date() } });
const markAllRead = () => CustomerAlerts.updateMany({ status: 'open', read_at: null }, { $set: { read_at: new Date() } });

/**
 * The platform "Needs your attention" list: every open notice across
 * workspaces, worst first, with the workspace name. Platform staff only.
 */
async function attentionList({ limit = 200 } = {}) {
  return runAsSystem(async () => {
    const rows = await CustomerAlerts.find({ status: 'open' }, NO_ID).sort({ created_at: -1 }).limit(Math.min(Number(limit) || 200, 500)).lean();
    const tenants = new Map((await Tenants.find({ id: { $in: [...new Set(rows.map((r) => r.tenant_id))] } }, { _id: 0, id: 1, name: 1, status: 1 }).lean()).map((t) => [t.id, t]));
    const items = rows
      .map((row) => ({
        id: row.id, tenant_id: row.tenant_id, workspace: tenants.get(row.tenant_id)?.name || `Workspace ${row.tenant_id}`,
        type: row.type, label: TYPES[row.type]?.label || row.type, severity: row.severity, title: row.title, message: row.message,
        created_at: row.created_at, email_status: row.email_status, whatsapp_status: row.whatsapp_status || null,
        // An email that never went out is itself a problem staff must see.
        email_problem: ['failed', 'no_recipient'].includes(row.email_status) && Number(row.email_attempts || 0) >= 1,
      }))
      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3) || new Date(b.created_at) - new Date(a.created_at));
    const counts = {};
    for (const item of items) counts[item.type] = (counts[item.type] || 0) + 1;
    return { items, counts, total: items.length };
  }, 'admin-attention');
}

module.exports = {
  TYPES, SETUP_STEPS, MAX_EMAIL_ATTEMPTS,
  raise, resolve, resolveExcept,
  evaluateWallet, paymentFailed, evaluateQuality, evaluateSetup, evaluateTemplates, evaluateTenant, sweepAll, pendingSetup,
  templateRejected, templateResubmitted, templateStatusChanged, cleanReasonCode,
  listNotices, markRead, markAllRead, attentionList, present, retryEmails,
};
