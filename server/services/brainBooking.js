/**
 * Google Meet booking for AI Brain replies. The model only proposes a meeting
 * (a local date-time, an optional email, or a cancel); this module does the
 * real Calendar work and writes the customer reply from the true outcome, so a
 * customer is never told "booked" or "cancelled" when it did not happen.
 * Runs inside the workspace's tenant context.
 */
const googleCalendar = require('./googleCalendar');
const { sendBookingNotification } = require('./bookingNotifications');
const { Leads } = require('../models');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** Cleans the model's `meeting` field; null when it proposes nothing usable. */
function cleanMeeting(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const start = typeof value.start === 'string' ? value.start.trim() : '';
  const email = typeof value.email === 'string' && EMAIL.test(value.email.trim()) ? value.email.trim().toLowerCase().slice(0, 200) : null;
  const cancel = value.cancel === true;
  if (!start && !email && !cancel) return null;
  return { start: start || null, email, cancel };
}

/**
 * "2026-11-10T15:30" in `timeZone` -> Date. A value that carries its own
 * offset ("Z", "+05:30") is taken as is. Returns null when it is not a time.
 */
function toDate(value, timeZone) {
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

const formatTime = (value, timeZone) => new Date(value).toLocaleString('en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' });

/** Booking facts for the prompt; never throws. */
async function context(lead) {
  const booking = await googleCalendar.getBookingContext();
  const tz = booking.settings.time_zone;
  const upcoming = lead?.booking_status === 'confirmed' && lead.call_booked_at && new Date(lead.call_booked_at) > new Date()
    ? formatTime(lead.call_booked_at, tz)
    : null;
  return { ...booking, upcoming, lead_email: lead?.email || null };
}

const setLead = (leadId, set) => Leads.updateOne({ id: leadId }, { $set: { ...set, updated_at: new Date() } });

/**
 * Acts on the model's proposal. Returns null when there is nothing to do, or
 * { reply, handoffReason } where reply (if set) replaces the model's reply.
 */
async function apply({ lead, meeting, booking, brandName }) {
  if (!meeting) return null;
  const tz = booking.settings.time_zone;
  if (meeting.email && meeting.email !== lead.email) await setLead(lead.id, { email: meeting.email });
  const email = meeting.email || lead.email || null;

  if (meeting.cancel) {
    try {
      const result = await googleCalendar.cancelMeeting(lead.id);
      if (result.cancelled) {
        await setLead(lead.id, { booking_status: 'cancelled', calendar_event_id: null, calendar_event_url: null, google_meet_link: null, call_booked_at: null });
      }
      if (!meeting.start) {
        return result.cancelled
          ? { reply: 'Your meeting has been cancelled.', handoffReason: 'Customer cancelled their meeting' }
          : { reply: "I couldn't find an upcoming meeting booked for you to cancel." };
      }
    } catch (err) {
      console.error(`[AI Brain booking] Cancel failed for lead ${lead.id}:`, err.message);
      return { reply: "I couldn't reach the calendar to cancel your meeting. Our team will help you shortly.", handoffReason: 'Customer wants to cancel their meeting: calendar was unreachable' };
    }
  }
  if (!meeting.start) return null;

  const start = toDate(meeting.start, tz);
  if (!start || start <= new Date()) {
    return { reply: 'Please share the date and time you would like for the meeting.' };
  }
  // The model repeating an already-booked time (e.g. on "thanks") is not a new
  // booking: keep its own reply instead of confirming again.
  if (lead.booking_status === 'confirmed' && lead.call_booked_at && Math.abs(new Date(lead.call_booked_at) - start) < 60000) return null;

  // No calendar (or booking off): note the time for the team instead.
  if (!booking.enabled) {
    await setLead(lead.id, { booking_status: 'requested', meeting_requested_for: start });
    return { reply: `Thanks! I've noted ${formatTime(start, tz)}. Our team will confirm your meeting shortly.`, handoffReason: `Meeting requested for ${formatTime(start, tz)}: please confirm` };
  }

  try {
    const result = await googleCalendar.bookMeeting({
      leadId: lead.id,
      brand: brandName,
      name: lead.name,
      email,
      phone: lead.phone,
      start,
      notes: 'Booked from the WhatsApp AI Brain conversation.',
    });
    if (result.booked) {
      await setLead(lead.id, {
        call_booked_at: result.start, status: 'booked', booking_status: 'confirmed',
        calendar_event_id: result.event_id, calendar_event_url: result.event_url, google_meet_link: result.meet_link,
      });
      await sendBookingNotification({
        eventId: result.event_id, brand: brandName, name: lead.name, email, phone: lead.phone, start: result.start,
        eventUrl: result.event_url, meetLink: result.meet_link, rescheduled: result.rescheduled, recipient: booking.notify_email, timeZone: tz,
      }).catch((err) => console.error('[AI Brain booking] Notification email failed:', err.message));
      const when = formatTime(result.start, tz);
      const link = result.meet_link ? `\nGoogle Meet: ${result.meet_link}` : '';
      const invite = email ? ' A calendar invite has been sent to your email.' : '';
      return {
        reply: `${result.rescheduled ? 'Your meeting has been moved to' : 'Your meeting is confirmed for'} ${when}.${invite}${link}`,
        handoffReason: `${result.rescheduled ? 'Meeting moved to' : 'Meeting booked for'} ${when}`,
      };
    }
    if (result.reason === 'outside_working_hours') {
      await setLead(lead.id, { booking_status: 'outside_working_hours' });
      return { reply: `Meetings can be booked ${result.working_hours}. Please share a date and time within these hours.` };
    }
    await setLead(lead.id, { booking_status: 'slot_unavailable' });
    return { reply: 'That time is already taken. Please share another date and time, and I will check.' };
  } catch (err) {
    console.error(`[AI Brain booking] Booking failed for lead ${lead.id}:`, err.message);
    const disconnected = googleCalendar.isDisconnectedError(err);
    await setLead(lead.id, { booking_status: disconnected ? 'calendar_not_connected' : 'calendar_error', meeting_requested_for: start });
    return {
      reply: `I've noted ${formatTime(start, tz)}. Our team will confirm your meeting shortly.`,
      handoffReason: `Meeting requested for ${formatTime(start, tz)}: calendar ${disconnected ? 'is not connected' : 'failed'}, please confirm`,
    };
  }
}

module.exports = { cleanMeeting, toDate, context, apply };
