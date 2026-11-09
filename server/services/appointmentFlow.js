/**
 * The booking conversation (plan N2): name, then service, then a time; check
 * availability; ask the customer to confirm; book; schedule a reminder.
 *
 * The model only *proposes* what the customer said (`appointment` in its JSON:
 * name, service, start, confirm, cancel). This module decides what happens and
 * writes the customer's reply from the real outcome, in the customer's
 * language, so nobody is told "booked" unless a booking row exists, and a
 * booking is never made without an explicit confirmation of the exact name,
 * service and time that were shown.
 *
 * Storage is passed in as `store`, so the flow is the same in production
 * (services/appointments.js) and in tests (an in-memory store).
 */
const rules = require('./appointmentRules');
const { say, formatWhen } = require('./appointmentText');

const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Cleans the model's `appointment` field; null when the customer is not booking. */
function cleanProposal(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[<>\u0000-\u001f]/g, ' ').trim().slice(0, max) : '');
  return {
    name: text(value.name, 80) || null,
    service: text(value.service, 80) || null,
    start: text(value.start, 40) || null,
    confirm: value.confirm === true,
    cancel: value.cancel === true,
  };
}

/** The saved draft, or an empty one when it is missing or older than two hours. */
function freshDraft(draft, now) {
  if (!draft || typeof draft !== 'object') return {};
  const at = new Date(draft.updated_at || 0).getTime();
  if (!at || now.getTime() - at > DRAFT_TTL_MS) return {};
  return { name: draft.name || null, service: draft.service || null, start: draft.start ? new Date(draft.start) : null, awaiting_confirm: draft.awaiting_confirm === true };
}

const sameTime = (a, b) => a && b && Math.abs(new Date(a) - new Date(b)) < MINUTE_MS;

/**
 * One customer message in the booking flow.
 * Returns { reply, draft, booked, cancelled, handoffReason }:
 *   draft  what to save on the lead (null clears it)
 *   booked / cancelled  the appointment row when one was made or cancelled
 */
async function advance({ lead, proposal, lang, settings, store, now = new Date() }) {
  const tz = settings.timeZone;
  const t = (key, vars) => say(key, lang, vars);
  const when = (date) => formatWhen(date, tz, lang);
  const saved = freshDraft(lead?.booking_draft, now);
  const keep = (draft) => ({ ...draft, updated_at: now });

  if (proposal.cancel) {
    const cancelled = await store.cancelUpcoming(lead.id, now);
    if (!cancelled) return { reply: t('nothingToCancel'), draft: null };
    return { reply: t('cancelled', { when: when(cancelled.start_at) }), draft: null, cancelled, handoffReason: `Appointment cancelled by the customer: ${cancelled.service} on ${when(cancelled.start_at)}` };
  }

  const name = proposal.name || saved.name || null;
  let service = saved.service || null;
  if (proposal.service) {
    service = rules.matchService(proposal.service, settings.services);
  }
  const proposedStart = proposal.start ? rules.localToDate(proposal.start, tz) : null;
  const start = proposedStart || saved.start || null;
  // A different time than the one the customer was asked to confirm: ask again.
  const timeChanged = Boolean(proposedStart && saved.start && !sameTime(proposedStart, saved.start));
  const wasAwaiting = saved.awaiting_confirm && !timeChanged && name === saved.name && service === saved.service;
  const draft = { name, service, start, awaiting_confirm: false };

  if (!name) return { reply: t('askName'), draft: keep(draft) };
  if (!service) {
    if (!settings.services.length) return { reply: t('bookingError'), draft: null, handoffReason: 'Booking asked but no services are saved for this business' };
    return { reply: t('askService', { services: settings.services }), draft: keep(draft) };
  }
  if (!start) return { reply: t('askTime', { hours: rules.describeHours(settings) }), draft: keep(draft) };

  const problem = rules.timeProblem(start, settings, now);
  if (problem) {
    return { reply: t(problem, { hours: rules.describeHours(settings) }), draft: keep({ ...draft, start: null }) };
  }

  const end = new Date(start.getTime() + settings.minutes * MINUTE_MS);
  const unavailable = async () => {
    const searchEnd = new Date(start.getTime() + 8 * 24 * 60 * MINUTE_MS);
    const busy = await store.busyBetween(start, searchEnd);
    const slots = rules.nextFreeSlots({ from: start, settings, busy, now });
    const kept = keep({ ...draft, start: null });
    if (!slots.length) return { reply: t('noSlots'), draft: kept, handoffReason: `No free time for ${service} near ${when(start)}: please contact the customer` };
    return { reply: t('unavailable', { slots: slots.map(when) }), draft: kept };
  };

  const existing = await store.upcomingAt(lead.id, start);
  if (existing) return { reply: t('alreadyBooked', { service: existing.service, when: when(existing.start_at) }), draft: null };

  const busyNow = await store.busyBetween(start, end);
  if (rules.overlapping(busyNow, start, end) >= settings.capacity) return unavailable();

  if (!(proposal.confirm && wasAwaiting)) {
    return { reply: t('confirmAsk', { name, service, when: when(start) }), draft: keep({ ...draft, awaiting_confirm: true }) };
  }

  const made = await store.book({ lead, name, service, start, end, language: lang, settings });
  if (!made.ok) return unavailable();
  const reminder = await store.scheduleReminder(made.appointment, { lead, settings, now }).catch((err) => {
    console.error(`[Appointments] Reminder not scheduled for appointment ${made.appointment.id}:`, err.message);
    return { status: 'failed' };
  });
  return {
    reply: t('booked', { service, when: when(start) }),
    draft: null,
    booked: made.appointment,
    reminder,
    handoffReason: `Appointment booked: ${service} for ${name} on ${when(start)}${reminder?.status === 'failed' ? ' (reminder could not be scheduled)' : ''}`,
  };
}

module.exports = { DRAFT_TTL_MS, cleanProposal, freshDraft, advance };
