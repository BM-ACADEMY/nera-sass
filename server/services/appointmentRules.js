/**
 * Pure rules of the appointment booking flow (plan N2): which service the
 * customer meant, whether a time is inside business hours, which times are
 * free. No database, no clock of its own: everything comes in as arguments.
 */
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STEP_MINUTES = 15;
const MIN_NOTICE_MINUTES = 30;
const SEARCH_DAYS = 7;
const MINUTE_MS = 60 * 1000;

const num = (value, fallback, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** "Cleaning - from Rs 500" -> "Cleaning" */
const serviceName = (item) => String(item || '').split(/\s*[-–—:|]\s*/)[0].trim().slice(0, 80);

/** Booking settings read from a saved brain profile, with safe defaults. */
function settingsFromProfile(profile = {}, env = process.env) {
  const hours = profile.business_hours || {};
  const services = [...new Set((profile.products_and_services || []).map(serviceName).filter(Boolean))];
  return {
    timeZone: profile.timezone || 'Asia/Kolkata',
    days: Array.isArray(hours.days) ? hours.days : [],
    open: hours.open || '',
    close: hours.close || '',
    minutes: [15, 30, 45, 60, 90, 120].includes(Number(profile.appointment_minutes)) ? Number(profile.appointment_minutes) : 30,
    capacity: num(profile.appointment_capacity, 1, 1, 20),
    reminderHours: num(profile.reminder_hours, num(env.APPOINTMENT_REMINDER_HOURS, 24, 1, 72), 1, 72),
    services,
  };
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/**
 * "2026-11-10T15:30" in `timeZone` -> Date. A value that carries its own
 * offset ("Z", "+05:30") is taken as is. Returns null when it is not a time.
 */
function localToDate(value, timeZone) {
  const text = String(value || '').trim();
  const local = text.match(LOCAL_TIME);
  if (!local) {
    if (!/(Z|[+-]\d{2}:?\d{2})$/.test(text)) return null;
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const [, y, mo, d, h, mi] = local.map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at that moment; checked twice so a DST edge settles.
  const offsetAt = (ms) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - ms;
  };
  let ms = asUtc - offsetAt(asUtc);
  ms = asUtc - offsetAt(ms);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Weekday (0 = Sunday) and "HH:MM" of a moment in a time zone. */
function localParts(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: DAY_NAMES.indexOf(parts.weekday), time: `${parts.hour}:${parts.minute}` };
}

/** True when the whole appointment [start, end) sits inside one day's opening hours. */
function withinHours(start, end, settings) {
  if (!settings.days.length || !settings.open || !settings.close || settings.open >= settings.close) return false;
  const from = localParts(start, settings.timeZone);
  const to = localParts(new Date(end.getTime() - 1), settings.timeZone);
  return from.day === to.day && settings.days.includes(from.day) && from.time >= settings.open && to.time < settings.close;
}

const describeHours = (settings) => (settings.days.length
  ? `${settings.days.map((d) => DAY_NAMES[d]).join(', ')} ${settings.open} to ${settings.close}`
  : 'not set');

const normal = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The saved service the customer named, or null. Exact match first, then one
 * name that contains the other. Two services that both match is ambiguous: null.
 */
function matchService(input, services) {
  const wanted = normal(input);
  if (!wanted) return null;
  const exact = services.find((s) => normal(s) === wanted);
  if (exact) return exact;
  const loose = services.filter((s) => {
    const name = normal(s);
    return name && (name.includes(wanted) || wanted.includes(name));
  });
  return loose.length === 1 ? loose[0] : null;
}

/** Number of existing appointments (any start) that overlap [start, end). */
const overlapping = (busy, start, end) => busy.filter((b) => new Date(b.start_at) < end && new Date(b.end_at) > start).length;

/** Why a time cannot be booked at all, or null. Availability is checked separately. */
function timeProblem(start, settings, now) {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return 'pastTime';
  if (start.getTime() < now.getTime() + MIN_NOTICE_MINUTES * MINUTE_MS) return 'pastTime';
  const end = new Date(start.getTime() + settings.minutes * MINUTE_MS);
  if (!withinHours(start, end, settings) || start.getTime() % (STEP_MINUTES * MINUTE_MS) !== 0) return 'outsideHours';
  return null;
}

/** The next `count` free starts after `from`, on the 15-minute grid, inside hours. */
function nextFreeSlots({ from, settings, busy, now, count = 3 }) {
  const out = [];
  const step = STEP_MINUTES * MINUTE_MS;
  let cursor = Math.ceil(Math.max(from.getTime(), now.getTime() + MIN_NOTICE_MINUTES * MINUTE_MS) / step) * step;
  const limit = from.getTime() + SEARCH_DAYS * 24 * 60 * MINUTE_MS;
  while (cursor <= limit && out.length < count) {
    const start = new Date(cursor);
    const end = new Date(cursor + settings.minutes * MINUTE_MS);
    if (withinHours(start, end, settings) && overlapping(busy, start, end) < settings.capacity) out.push(start);
    cursor += step;
  }
  return out;
}

/** Seats of a slot, in the order they are tried: "<start ISO>#1" .. "#capacity". */
const slotKeys = (start, capacity) => Array.from({ length: capacity }, (_, i) => `${new Date(start).toISOString()}#${i + 1}`);

module.exports = {
  localToDate,
  STEP_MINUTES,
  MIN_NOTICE_MINUTES,
  serviceName,
  settingsFromProfile,
  localParts,
  withinHours,
  describeHours,
  matchService,
  overlapping,
  timeProblem,
  nextFreeSlots,
  slotKeys,
};
