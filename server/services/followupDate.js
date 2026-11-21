/**
 * A customer says "I'll contact you on Monday" or "call me after 25th":
 * the AI proposes that date, and this module decides whether it is usable and
 * when the follow-up goes out. Pure: no database, no network.
 *
 * The model only proposes {date, time}; the server checks it is a real future
 * date within 60 days and moves the time into the sending hours (9:00-21:00
 * local by default), so a bad guess can never send at night or far away.
 */
const MAX_DAYS_AHEAD = 60;
const MIN_LEAD_MS = 60 * 60 * 1000;
const DEFAULT_TIME = '10:00';

/** Accepts {date: "YYYY-MM-DD", time?: "HH:mm"}; anything else is null. */
function cleanProposal(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const date = String(raw.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(raw.time || '').trim()) ? String(raw.time).trim() : null;
  return { date, time };
}

// Offset (ms) of a time zone from UTC at a given instant.
function zoneOffsetMs(utcMs, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000;
}

/** The UTC instant for a wall-clock date and time in a time zone. */
function zonedToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - zoneOffsetMs(guess, tz);
  return new Date(guess - zoneOffsetMs(first, tz));
}

function sendingHours() {
  const [from, to] = String(process.env.AI_SENDING_HOURS || '9-21').split('-').map(Number);
  return [Number.isFinite(from) ? from : 9, Number.isFinite(to) ? to : 21];
}

/**
 * When the follow-up should go out, as a Date, or null when the proposal
 * cannot be used (not a real date, in the past, under an hour away, over 60 days).
 */
function resolve(proposal, { now = new Date(), tz = 'Asia/Kolkata' } = {}) {
  const p = cleanProposal(proposal);
  if (!p) return null;
  const [from, to] = sendingHours();
  let time = p.time || DEFAULT_TIME;
  const hour = Number(time.slice(0, 2));
  if (hour < from) time = `${String(from).padStart(2, '0')}:00`;
  else if (hour >= to) time = `${String(to - 1).padStart(2, '0')}:00`;
  let at;
  try {
    at = zonedToUtc(p.date, time, tz);
  } catch {
    return null;
  }
  if (Number.isNaN(at.getTime())) return null;
  // Reject impossible dates such as 2026-02-31 (they roll over into March).
  const back = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  if (back !== p.date) return null;
  const ahead = at.getTime() - now.getTime();
  if (ahead < MIN_LEAD_MS || ahead > MAX_DAYS_AHEAD * 24 * 3600 * 1000) return null;
  return at;
}

module.exports = { cleanProposal, resolve, zonedToUtc, MAX_DAYS_AHEAD };
