/**
 * Per-number sending health (plan N1): rate limits, a daily cap that grows
 * slowly for new numbers, Meta quality signals and the marketing pause.
 *
 * One `whatsapp_number_state` row per (tenant, phone_number_id). Counters are
 * reserved atomically so several API instances can share a number safely.
 *
 *   WA_SEND_PER_MINUTE   messages per minute per number            (default 60)
 *   WA_DAILY_CAP_START   business-initiated messages/day, new number (default 250)
 *   WA_DAILY_CAP_MAX     ceiling the cap can grow to                (default 10000)
 *
 * Growth: after a UTC day in which the number used at least half of its cap
 * with GREEN quality and no pause, the cap doubles (at most once a day), never
 * above Meta's messaging tier for the number when known, nor WA_DAILY_CAP_MAX.
 * A quality drop (YELLOW, RED, FLAGGED, DOWNGRADE, account restriction) pauses
 * marketing on the number, halves the cap and tells the workspace owner.
 * Service and utility messages are not paused.
 *
 * Inbound watch: every customer message and status receipt the webhook gets
 * for a number stamps `last_message_received_at` / `last_status_received_at`.
 * A live number with neither for WA_SILENT_ALERT_HOURS (default 24) is
 * "silent" and shows up in the platform "Needs your attention" list
 * (services/alerts.js, type number_silent).
 *
 *   WA_SILENT_ALERT_HOURS  hours without an inbound event before a live number is flagged (default 24)
 */
const { WhatsappNumberState, Users, Tenants } = require('../models');
const { NO_ID } = require('../db/mongo');
const { currentTenantId, runAsSystem } = require('./tenantContext');
const { notifyWorkspace } = require('./realtime');
const notify = require('./notify');

const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const perMinute = () => envInt('WA_SEND_PER_MINUTE', 60);
const startCap = () => envInt('WA_DAILY_CAP_START', 250);
const maxCap = () => envInt('WA_DAILY_CAP_MAX', 10000);
const silenceHours = () => envInt('WA_SILENT_ALERT_HOURS', 24);
// Inbound timestamps are written at most this often per number and kind, so a
// busy number does not turn every webhook into a write.
const INBOUND_WRITE_EVERY_MS = 60 * 1000;
const MIN_CAP = 50;
const GROWTH_FACTOR = 2;
const GROWTH_MIN_USE = 0.5;

const TIER_LIMITS = Object.freeze({
  TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null,
});
const GOOD_RATINGS = new Set(['GREEN', 'HIGH']);
const BAD_RATINGS = new Set(['YELLOW', 'MEDIUM', 'RED', 'LOW']);
const PAUSE_EVENTS = new Set(['FLAGGED', 'DOWNGRADE', 'DISABLED_UPDATE', 'ACCOUNT_RESTRICTION', 'ACCOUNT_VIOLATION', 'RESTRICTED']);
const RECOVER_EVENTS = new Set(['UNFLAGGED', 'UPGRADE', 'ACCOUNT_RESTRICTION_LIFTED']);
// Meta error codes that say the number itself is being throttled or flagged.
const RATE_LIMIT_CODES = new Set([130429, 131056, 80007, 4, 17, 32]);
const SPAM_RATE_LIMIT_CODE = 131048;

const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
const utcMinute = (d = new Date()) => d.toISOString().slice(0, 16);
const nextUtcMidnight = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
const nextMinute = (d = new Date()) => new Date(Math.floor(d.getTime() / 60000) * 60000 + 60000);

const tierLimit = (messagingLimit) => (messagingLimit && messagingLimit in TIER_LIMITS ? TIER_LIMITS[messagingLimit] : undefined);

function boundedCap(cap, messagingLimit) {
  const tier = tierLimit(messagingLimit);
  let value = Math.max(MIN_CAP, Math.floor(Number(cap) || startCap()));
  value = Math.min(value, maxCap());
  if (tier) value = Math.min(value, tier);
  return value;
}

/** The state row for a number, created on first use. */
async function stateFor(phoneNumberId, { clientId = null } = {}) {
  const id = String(phoneNumberId || '');
  if (!id) throw new Error('phone_number_id is required');
  const existing = await WhatsappNumberState.findOne({ phone_number_id: id }, NO_ID).lean();
  if (existing) return existing;
  try {
    return (await WhatsappNumberState.create({
      phone_number_id: id, client_id: clientId, day: utcDay(), minute: utcMinute(), daily_cap: startCap(), quality_rating: 'UNKNOWN',
    })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return WhatsappNumberState.findOne({ phone_number_id: id }, NO_ID).lean();
  }
}

const qualityGood = (state) => !state.quality_rating || state.quality_rating === 'UNKNOWN' || GOOD_RATINGS.has(state.quality_rating);

/** Next day's cap, given yesterday's use. Exported for tests. */
function nextDailyCap(state) {
  const cap = boundedCap(state.daily_cap, state.messaging_limit);
  const used = Number(state.templates_today || 0);
  const healthy = qualityGood(state) && !state.marketing_paused;
  if (!healthy || used < cap * GROWTH_MIN_USE) return cap;
  return boundedCap(cap * GROWTH_FACTOR, state.messaging_limit);
}

/** Moves the counters to the current day and minute; grows the cap after a healthy day. */
async function rollover(phoneNumberId, now = new Date()) {
  const state = await stateFor(phoneNumberId);
  const day = utcDay(now);
  const minute = utcMinute(now);
  if (state.day !== day) {
    const cap = nextDailyCap(state);
    await WhatsappNumberState.updateOne(
      { phone_number_id: state.phone_number_id, day: { $ne: day } },
      { $set: { day, sent_today: 0, templates_today: 0, daily_cap: cap, ...(cap > (state.daily_cap || 0) ? { cap_raised_at: now } : {}), updated_at: now } },
    );
  }
  if (state.minute !== minute) {
    await WhatsappNumberState.updateOne(
      { phone_number_id: state.phone_number_id, minute: { $ne: minute } },
      { $set: { minute, sent_this_minute: 0, updated_at: now } },
    );
  }
  return WhatsappNumberState.findOne({ phone_number_id: state.phone_number_id }, NO_ID).lean();
}

/**
 * Reserves one send slot on the number. Business-initiated messages
 * (`countsTowardDailyCap`, i.e. templates) also take one of today's cap.
 * Returns { ok: true, state } or { ok: false, reason, retryAt, message }.
 */
async function reserveSlot(phoneNumberId, { countsTowardDailyCap = true, now = new Date() } = {}) {
  const state = await rollover(phoneNumberId, now);
  const limit = perMinute();
  const cap = boundedCap(state.daily_cap, state.messaging_limit);
  const conditions = [{ $lt: ['$sent_this_minute', limit] }];
  if (countsTowardDailyCap) conditions.push({ $lt: ['$templates_today', cap] });
  const inc = { sent_this_minute: 1, sent_today: 1 };
  if (countsTowardDailyCap) inc.templates_today = 1;
  const reserved = await WhatsappNumberState.findOneAndUpdate(
    { phone_number_id: state.phone_number_id, minute: utcMinute(now), day: utcDay(now), $expr: { $and: conditions } },
    { $inc: inc, $set: { updated_at: now, ...(state.first_send_at ? {} : { first_send_at: now }) } },
    { new: true, projection: NO_ID },
  ).lean();
  if (reserved) return { ok: true, state: reserved };
  const fresh = await WhatsappNumberState.findOne({ phone_number_id: state.phone_number_id }, NO_ID).lean();
  if (countsTowardDailyCap && Number(fresh?.templates_today || 0) >= cap) {
    return { ok: false, reason: 'daily_cap', retryAt: nextUtcMidnight(now), message: `Daily limit of ${cap} business-initiated messages reached for this number`, state: fresh };
  }
  return { ok: false, reason: 'minute_limit', retryAt: nextMinute(now), message: `Limit of ${limit} messages per minute reached for this number`, state: fresh };
}

/** Why marketing may not go out on this number right now, or null. */
async function marketingBlock(phoneNumberId) {
  const state = await stateFor(phoneNumberId);
  if (!state.marketing_paused) return null;
  return { code: 'NUMBER_PAUSED', message: `Marketing is paused on this number: ${state.marketing_paused_reason || 'quality drop'}`, state };
}

async function workspaceOwner() {
  const tenantId = currentTenantId();
  const tenant = tenantId ? await runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, id: 1, name: 1, owner_user_id: 1 }).lean(), 'number-health') : null;
  let owner = tenant?.owner_user_id ? await Users.findOne({ id: tenant.owner_user_id }, { _id: 0, id: 1, name: 1, email: 1 }).lean() : null;
  if (!owner) owner = await Users.findOne({ role: 'owner', is_active: { $ne: false } }, { _id: 0, id: 1, name: 1, email: 1 }).sort({ id: 1 }).lean();
  return { tenant, owner };
}

/** Tells the workspace (live event) and its owner (email) about a quality change. Never throws. */
async function notifyOwner(state, { kind, detail }) {
  const payload = {
    phone_number_id: state.phone_number_id, quality_rating: state.quality_rating || null, event: state.quality_event || null,
    marketing_paused: Boolean(state.marketing_paused), reason: state.marketing_paused_reason || null, daily_cap: state.daily_cap, kind,
  };
  notifyWorkspace('whatsapp_quality_changed', payload);
  let emailed = false;
  try {
    const { tenant, owner } = await workspaceOwner();
    if (owner?.email) {
      await notify.qualityAlertEmail({
        to: owner.email, ownerName: owner.name, workspaceName: tenant?.name, kind, detail,
        rating: state.quality_rating, event: state.quality_event, paused: Boolean(state.marketing_paused), dailyCap: state.daily_cap,
      });
      emailed = true;
    }
    await WhatsappNumberState.updateOne({ phone_number_id: state.phone_number_id }, { $set: { owner_notified_at: new Date() } });
  } catch (error) {
    console.error('[numberHealth] Owner alert failed:', error.message);
  }
  // The customer's Notices box (and the WhatsApp copy for opted-in numbers).
  // The email above is the notice's email, so none is sent twice.
  try {
    await require('./alerts').evaluateQuality({ emailAlreadySent: emailed });
  } catch (error) {
    console.error('[numberHealth] Notice failed:', error.message);
  }
  return payload;
}

/**
 * Applies a Meta quality signal (webhook or inventory sync).
 *   rating:  GREEN | YELLOW | RED | UNKNOWN
 *   event:   FLAGGED | UNFLAGGED | DOWNGRADE | UPGRADE | ONBOARDING | DISABLED_UPDATE | ...
 *   messagingLimit: TIER_250 | TIER_1K | ...
 * Returns { state, paused, resumed, notified }.
 */
async function recordQuality(phoneNumberId, { rating, event, messagingLimit, source = 'webhook', clientId = null, detail = null } = {}) {
  const before = await stateFor(phoneNumberId, { clientId });
  const now = new Date();
  const newRating = rating ? String(rating).toUpperCase() : null;
  const newEvent = event ? String(event).toUpperCase() : null;
  const set = { quality_updated_at: now, quality_source: source, updated_at: now };
  if (clientId != null && before.client_id == null) set.client_id = clientId;
  if (newRating) set.quality_rating = newRating;
  if (newEvent) set.quality_event = newEvent;
  if (messagingLimit && messagingLimit in TIER_LIMITS) set.messaging_limit = messagingLimit;

  const wasGood = qualityGood(before);
  const dropped = (newRating && BAD_RATINGS.has(newRating)) || (newEvent && PAUSE_EVENTS.has(newEvent));
  const recovered = (newRating && GOOD_RATINGS.has(newRating) && !(newEvent && PAUSE_EVENTS.has(newEvent)))
    || (newEvent && RECOVER_EVENTS.has(newEvent) && !(newRating && BAD_RATINGS.has(newRating)));

  let paused = false;
  let resumed = false;
  if (dropped && !before.marketing_paused) {
    paused = true;
    const reason = newEvent && PAUSE_EVENTS.has(newEvent) ? `Meta ${newEvent.toLowerCase().replace(/_/g, ' ')}` : `Meta quality rating ${newRating}`;
    Object.assign(set, {
      marketing_paused: true, marketing_paused_reason: reason, marketing_paused_at: now, marketing_paused_by: null,
      daily_cap: Math.max(MIN_CAP, Math.floor(boundedCap(before.daily_cap, set.messaging_limit || before.messaging_limit) / 2)),
    });
  } else if (dropped && before.marketing_paused) {
    // Already paused: keep the newest reason so the owner sees what Meta says now.
    if (newEvent && PAUSE_EVENTS.has(newEvent)) set.marketing_paused_reason = `Meta ${newEvent.toLowerCase().replace(/_/g, ' ')}`;
  } else if (recovered && before.marketing_paused && before.marketing_paused_by == null) {
    // An automatic pause lifts when Meta says the number is healthy again; a
    // pause a person set stays until a person lifts it.
    resumed = true;
    Object.assign(set, { marketing_paused: false, marketing_resumed_at: now, marketing_resumed_by: null });
  }
  if (set.messaging_limit) set.daily_cap = boundedCap(set.daily_cap ?? before.daily_cap, set.messaging_limit);

  const state = await WhatsappNumberState.findOneAndUpdate({ phone_number_id: before.phone_number_id }, { $set: set }, { new: true, projection: NO_ID }).lean();
  let notified = false;
  if (paused) { await notifyOwner(state, { kind: 'paused', detail }); notified = true; }
  else if (resumed) { await notifyOwner(state, { kind: 'resumed', detail }); notified = true; }
  else if (dropped && wasGood) { await notifyOwner(state, { kind: 'warning', detail }); notified = true; }
  return { state, paused, resumed, notified };
}

/** A Meta send error on this number: rate limits are counted, a spam-rate pause is a quality drop. */
async function recordSendError(phoneNumberId, { code, message } = {}) {
  const errorCode = Number(code);
  if (!Number.isFinite(errorCode)) return null;
  if (errorCode === SPAM_RATE_LIMIT_CODE) {
    return recordQuality(phoneNumberId, { event: 'FLAGGED', source: 'send_error', detail: message || 'Meta paused the number for a high spam rate (error 131048)' });
  }
  if (RATE_LIMIT_CODES.has(errorCode)) {
    await WhatsappNumberState.updateOne({ phone_number_id: String(phoneNumberId) }, { $inc: { rate_limit_hits: 1 }, $set: { last_rate_limited_at: new Date() } });
  }
  return null;
}

const isRateLimitCode = (code) => RATE_LIMIT_CODES.has(Number(code)) || Number(code) === SPAM_RATE_LIMIT_CODE;

/** The owner resumes marketing by hand. Refused while Meta still rates the number RED or flagged. */
async function resumeMarketing(phoneNumberId, { by = null } = {}) {
  const state = await stateFor(phoneNumberId);
  if (!state.marketing_paused) return { ok: true, state };
  if (['RED', 'LOW'].includes(state.quality_rating) || state.quality_event === 'FLAGGED') {
    return { ok: false, code: 'QUALITY_STILL_LOW', message: 'Meta still rates this number low. Marketing stays paused until the rating recovers.', state };
  }
  const now = new Date();
  const updated = await WhatsappNumberState.findOneAndUpdate(
    { phone_number_id: state.phone_number_id },
    { $set: { marketing_paused: false, marketing_resumed_at: now, marketing_resumed_by: by, updated_at: now } },
    { new: true, projection: NO_ID },
  ).lean();
  notifyWorkspace('whatsapp_quality_changed', { phone_number_id: updated.phone_number_id, marketing_paused: false, kind: 'resumed_manually' });
  return { ok: true, state: updated };
}

/** The owner pauses marketing by hand (for example before a campaign is fixed). */
async function pauseMarketing(phoneNumberId, { by = null, reason = 'Paused by the workspace' } = {}) {
  const now = new Date();
  await stateFor(phoneNumberId);
  const updated = await WhatsappNumberState.findOneAndUpdate(
    { phone_number_id: String(phoneNumberId) },
    { $set: { marketing_paused: true, marketing_paused_reason: String(reason).slice(0, 200), marketing_paused_at: now, marketing_paused_by: by ?? 0, updated_at: now } },
    { new: true, projection: NO_ID },
  ).lean();
  return { ok: true, state: updated };
}

const asDate = (value) => (value ? new Date(value) : null);

/**
 * The number's last inbound webhook event and whether it has gone silent.
 *   since  when the number went live (verified); a number that never got an
 *          event is measured from here, so a fresh number has a full grace period.
 */
function inboundActivity(state, { since = null, now = new Date() } = {}) {
  const message = asDate(state?.last_message_received_at);
  const status = asDate(state?.last_status_received_at);
  const last = message && status ? (message >= status ? message : status) : (message || status);
  const reference = last || asDate(since) || asDate(state?.created_at);
  const silentMs = reference ? now.getTime() - reference.getTime() : 0;
  return {
    last_inbound_event_at: last,
    last_inbound_event_kind: last ? (last === message ? 'message' : 'status') : null,
    last_message_received_at: message,
    last_status_received_at: status,
    silent: silentMs >= silenceHours() * 3600000,
    silent_after_hours: silenceHours(),
  };
}

/**
 * The webhook got an event for this number: `kind` is 'message' (a customer
 * wrote) or 'status' (a delivery/read/failed receipt). Closes the
 * number_silent notice when the number had gone quiet. Never throws.
 */
async function recordInboundEvent(phoneNumberId, { kind = 'message', clientId = null, at = new Date() } = {}) {
  try {
    const field = kind === 'status' ? 'last_status_received_at' : 'last_message_received_at';
    const state = await stateFor(phoneNumberId, { clientId });
    const before = await WhatsappNumberState.findOneAndUpdate(
      { phone_number_id: state.phone_number_id, $or: [{ [field]: null }, { [field]: { $lt: new Date(at.getTime() - INBOUND_WRITE_EVERY_MS) } }] },
      { $max: { [field]: at } },
      { new: false, projection: NO_ID },
    ).lean();
    if (!before) return false;
    const previous = inboundActivity(before, { now: at });
    if (previous.silent || !previous.last_inbound_event_at) {
      await require('./alerts').resolve('number_silent', state.phone_number_id);
    }
    return true;
  } catch (error) {
    console.error('[numberHealth] Inbound event not recorded:', error.message);
    return false;
  }
}

/** What the workspace sees about its number. */
async function summary(phoneNumberId, now = new Date(), { since = null } = {}) {
  const state = await rollover(phoneNumberId, now);
  const cap = boundedCap(state.daily_cap, state.messaging_limit);
  return {
    phone_number_id: state.phone_number_id,
    quality_rating: state.quality_rating || 'UNKNOWN',
    quality_event: state.quality_event || null,
    quality_updated_at: state.quality_updated_at || null,
    messaging_limit: state.messaging_limit || null,
    marketing_paused: Boolean(state.marketing_paused),
    marketing_paused_reason: state.marketing_paused_reason || null,
    marketing_paused_at: state.marketing_paused_at || null,
    marketing_paused_by: state.marketing_paused_by ?? null,
    daily_cap: cap,
    templates_today: state.templates_today || 0,
    sent_today: state.sent_today || 0,
    remaining_today: Math.max(0, cap - (state.templates_today || 0)),
    per_minute_limit: perMinute(),
    sent_this_minute: state.sent_this_minute || 0,
    cap_raised_at: state.cap_raised_at || null,
    first_send_at: state.first_send_at || null,
    rate_limit_hits: state.rate_limit_hits || 0,
    last_rate_limited_at: state.last_rate_limited_at || null,
    ...inboundActivity(state, { since, now }),
  };
}

module.exports = {
  TIER_LIMITS,
  MIN_CAP,
  perMinute,
  startCap,
  maxCap,
  utcDay,
  utcMinute,
  nextUtcMidnight,
  boundedCap,
  nextDailyCap,
  stateFor,
  rollover,
  reserveSlot,
  marketingBlock,
  recordQuality,
  recordSendError,
  isRateLimitCode,
  resumeMarketing,
  pauseMarketing,
  notifyOwner,
  summary,
  silenceHours,
  inboundActivity,
  recordInboundEvent,
};
