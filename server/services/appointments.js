/**
 * Appointment storage and reminders (plan N2). Runs inside the workspace's
 * tenant context: every query goes through the tenant-scope plugin, so one
 * workspace can never read, book into or cancel another's calendar.
 *
 * Reminders are not sent from here: they are rows in the N1 send queue
 * (services/whatsappSendQueue.js), which applies the send policy, opt-out
 * handling, per-number limits and retries at the moment of sending.
 *
 *   WA_APPOINTMENT_REMINDER_TEMPLATE      approved template, English (default appointment_reminder)
 *   WA_APPOINTMENT_REMINDER_TEMPLATE_TA   approved template, Tamil   (default appointment_reminder_ta)
 *   APPOINTMENT_REMINDER_HOURS            hours before the visit     (default 24; the profile can override)
 * Template body parameters, in order: {{1}} name, {{2}} service, {{3}} date and time.
 */
const { Appointments, BrainProfiles, CampaignMessageQueue, Clients } = require('../models');
const sendQueue = require('./whatsappSendQueue');
const sendPolicy = require('./sendPolicy');
const rules = require('./appointmentRules');
const { formatWhen } = require('./appointmentText');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const NO_ID = { _id: 0 };

async function loadSettings() {
  const brain = await BrainProfiles.findOne({}, { _id: 0, profile: 1 }).lean();
  return rules.settingsFromProfile(brain?.profile || {});
}

/** Confirmed appointments overlapping [from, to). */
const busyBetween = (from, to) => Appointments.find(
  { status: 'confirmed', start_at: { $lt: to }, end_at: { $gt: from } },
  { _id: 0, id: 1, start_at: 1, end_at: 1 },
).lean();

/** The lead's own confirmed appointment at this start, if any. */
const upcomingAt = (leadId, start) => Appointments.findOne({
  lead_id: leadId, status: 'confirmed',
  start_at: { $gte: new Date(start.getTime() - MINUTE_MS), $lte: new Date(start.getTime() + MINUTE_MS) },
}, NO_ID).lean();

/** The lead's next confirmed appointment, if any. */
const nextFor = (leadId, now = new Date()) => Appointments.findOne({ lead_id: leadId, status: 'confirmed', start_at: { $gt: now } }, NO_ID).sort({ start_at: 1 }).lean();

/**
 * Takes the first free seat of the slot. The unique slot_key makes this safe
 * when two customers ask for the same time together: the second insert fails
 * with a duplicate key and tries the next seat, or gives up when all are taken.
 */
async function book({ lead, name, service, start, end, language, settings }) {
  for (const slotKey of rules.slotKeys(start, settings.capacity)) {
    try {
      const created = await Appointments.create({
        lead_id: lead.id, customer_name: name, phone: lead.phone || null, service, start_at: start, end_at: end,
        status: 'confirmed', slot_key: slotKey, language,
      });
      return { ok: true, appointment: created.toObject() };
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return { ok: false, reason: 'taken' };
}

/** Cancels the lead's next appointment, frees its seat and stops its reminder. Null when there is none. */
async function cancelUpcoming(leadId, now = new Date()) {
  const next = await nextFor(leadId, now);
  if (!next) return null;
  const done = await Appointments.updateOne(
    { id: next.id, status: 'confirmed' },
    { $set: { status: 'cancelled', slot_key: null, reminder_status: next.reminder_queue_id ? 'cancelled' : next.reminder_status, updated_at: now } },
  );
  if (done.modifiedCount !== 1) return null;
  if (next.reminder_queue_id) {
    await CampaignMessageQueue.updateOne({ id: next.reminder_queue_id, status: 'pending' }, { $set: { status: 'cancelled', skip_reason: 'Appointment cancelled', processed_at: now } });
  }
  return next;
}

/** When the reminder should go out, or null when it is too late to be useful. */
function reminderTime(start, settings, now) {
  const early = new Date(start.getTime() - settings.reminderHours * HOUR_MS);
  if (early.getTime() > now.getTime() + MINUTE_MS) return early;
  // Booked inside the reminder window: one reminder an hour before, if that is still ahead.
  const late = new Date(start.getTime() - HOUR_MS);
  return late.getTime() > now.getTime() + 5 * MINUTE_MS ? late : null;
}

/**
 * Queues the reminder template for an appointment. The queue re-checks the
 * send policy when the row is due. A template Meta has not confirmed as
 * UTILITY is queued as marketing, which needs the customer's opt-in.
 */
async function scheduleReminder(appointment, { lead, settings, now = new Date() }) {
  const at = reminderTime(new Date(appointment.start_at), settings, now);
  const mark = (changes) => Appointments.updateOne({ id: appointment.id }, { $set: { ...changes, updated_at: new Date() } });
  if (!at) {
    await mark({ reminder_status: 'skipped' });
    return { status: 'skipped' };
  }
  const lang = appointment.language === 'ta' ? 'ta' : 'en';
  const template = lang === 'ta'
    ? (process.env.WA_APPOINTMENT_REMINDER_TEMPLATE_TA || 'appointment_reminder_ta')
    : (process.env.WA_APPOINTMENT_REMINDER_TEMPLATE || 'appointment_reminder');
  const brand = lead.client_id != null ? await Clients.findOne({ id: lead.client_id }, { _id: 0, phone_number_id: 1 }).lean() : null;
  const when = formatWhen(appointment.start_at, settings.timeZone, lang);
  const params = [appointment.customer_name || 'Customer', appointment.service, when];
  const queued = await sendQueue.enqueue({
    leadId: lead.id,
    phone: lead.phone,
    phoneNumberId: brand?.phone_number_id || null,
    kind: await sendPolicy.templateKind(template),
    payload: { type: 'template', template: { name: template, language: { code: lang }, components: [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text: String(text).slice(0, 1024) })) }] } },
    content: `[Reminder] ${appointment.service} on ${when}`,
    msgType: 'template',
    source: 'appointment_reminder',
    sendAt: at,
  });
  await mark({ reminder_at: at, reminder_queue_id: queued.id, reminder_status: 'queued' });
  return { status: 'queued', at, queue_id: queued.id };
}

const store = { busyBetween, upcomingAt, book, cancelUpcoming, scheduleReminder };

module.exports = { loadSettings, busyBetween, upcomingAt, nextFor, book, cancelUpcoming, reminderTime, scheduleReminder, store };
