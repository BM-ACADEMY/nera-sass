/**
 * Campaign schedule times in the workspace's own time zone.
 *
 * The Campaigns page sends a wall-clock time ("2026-11-21T10:00") as the owner
 * typed it. It means 10:00 in the workspace's time zone (tenants.timezone,
 * Asia/Kolkata by default), not in the server's or the browser's zone. An
 * absolute time (ending in Z or an offset) is taken as it is.
 */
const { Tenants } = require('../models');
const { currentTenantId, runAsSystem } = require('./tenantContext');

const DEFAULT_TZ = 'Asia/Kolkata';
const NAIVE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
// A schedule in the past by more than this is refused (the form may take a
// moment to submit; anything older is a mistake).
const PAST_GRACE_MS = 2 * 60 * 1000;
const MAX_AHEAD_DAYS = 90;

const validZone = (tz) => {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
};

/** The current workspace's time zone. */
async function tenantTimezone() {
  const tenantId = currentTenantId();
  if (!tenantId) return DEFAULT_TZ;
  const tenant = await runAsSystem(() => Tenants.findOne({ id: tenantId }, { _id: 0, timezone: 1 }).lean(), 'campaign-schedule');
  return tenant?.timezone && validZone(tenant.timezone) ? tenant.timezone : DEFAULT_TZ;
}

/** Minutes the zone is ahead of UTC at `date`. */
function offsetMinutes(date, tz) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

/** The UTC instant of a wall-clock time in `tz`. */
function zonedToUtc({ year, month, day, hour, minute, second = 0 }, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let at = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  // Second pass settles times next to a daylight-saving change.
  at = new Date(guess - offsetMinutes(at, tz) * 60000);
  return at;
}

/**
 * Parses a schedule. Returns { at: Date|null, error: string|null }.
 * Empty means "send now".
 */
function parseSchedule(value, tz = DEFAULT_TZ) {
  if (value == null || value === '') return { at: null, error: null };
  const text = String(value).trim();
  const naive = text.match(NAIVE);
  const at = naive
    ? zonedToUtc({ year: +naive[1], month: +naive[2], day: +naive[3], hour: +naive[4], minute: +naive[5], second: +(naive[6] || 0) }, tz)
    : new Date(text);
  if (Number.isNaN(at.getTime())) return { at: null, error: 'The schedule is not a valid date and time.' };
  return { at, error: null };
}

/** Why a schedule cannot be used, or null. */
function scheduleProblem(at, now = new Date()) {
  if (!at) return null;
  if (at.getTime() < now.getTime() - PAST_GRACE_MS) return 'The scheduled time has already passed. Pick a time in the future.';
  if (at.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86400000) return `Campaigns can be scheduled up to ${MAX_AHEAD_DAYS} days ahead.`;
  return null;
}

/** "21 Nov 2026, 10:00 am" in the zone. */
function formatInZone(date, tz = DEFAULT_TZ) {
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(date);
}

module.exports = { DEFAULT_TZ, tenantTimezone, offsetMinutes, zonedToUtc, parseSchedule, scheduleProblem, formatInZone };
