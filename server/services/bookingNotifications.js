const nodemailer = require('nodemailer');
const { BookingNotificationLog } = require('../models');

const supportEmail = () => process.env.SUPPORT_NOTIFICATION_EMAIL ||
  process.env.GOOGLE_CALENDAR_SUPPORT_EMAIL ||
  process.env.GOOGLE_CALENDAR_ID ||
  'bmacademypondy@gmail.com';

const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
}[character]));

const getTransport = () => {
  const host = process.env.EMAIL_HOST || process.env.ALLIANCE_EMAIL_SMTP_HOST;
  const port = Number(process.env.EMAIL_PORT || process.env.ALLIANCE_EMAIL_SMTP_PORT || 465);
  const user = process.env.EMAIL_USER || process.env.ALLIANCE_EMAIL_SMTP_USER;
  const password = process.env.EMAIL_PASS || process.env.ALLIANCE_EMAIL_SMTP_PASSWORD;
  const secureValue = process.env.EMAIL_SECURE ?? process.env.ALLIANCE_EMAIL_SMTP_SECURE;
  if (!host || !user || !password) throw new Error('Support notification SMTP is not configured');
  return {
    transporter: nodemailer.createTransport({
      host,
      port,
      secure: secureValue == null ? port === 465 : ['true', '1', 'yes'].includes(String(secureValue).toLowerCase()),
      auth: { user, pass: password },
    }),
    from: process.env.EMAIL_FROM || process.env.EMAIL_USER || process.env.ALLIANCE_EMAIL_FROM || user,
  };
};

const sendBookingNotification = async ({ eventId, brand, name, email, phone, start, eventUrl, meetLink, rescheduled = false }) => {
  const recipient = supportEmail();
  const existing = await BookingNotificationLog.findOne(
    { calendar_event_id: eventId, meeting_start: new Date(start), recipient },
    { id: 1, message_id: 1 }
  ).lean();
  if (existing) return { sent: true, deduplicated: true, recipient, message_id: existing.message_id };

  const { transporter, from } = getTransport();
  const meetingTime = new Date(start).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short',
  });
  const action = rescheduled ? 'rescheduled' : 'booked';
  const subject = `[LeadOS] Meeting ${action}: ${name || phone || 'New lead'} — ${meetingTime}`;
  const html = `
    <h2>Meeting ${escapeHtml(action)}</h2>
    <p>A customer meeting has been ${escapeHtml(action)} through LeadOS.</p>
    <table cellpadding="6" cellspacing="0" border="0">
      <tr><td><strong>Brand</strong></td><td>${escapeHtml(brand || 'ABM Groups')}</td></tr>
      <tr><td><strong>Customer</strong></td><td>${escapeHtml(name || 'Not provided')}</td></tr>
      <tr><td><strong>Mobile</strong></td><td>${escapeHtml(phone || 'Not provided')}</td></tr>
      <tr><td><strong>Email</strong></td><td>${escapeHtml(email || 'Not provided')}</td></tr>
      <tr><td><strong>Date & time</strong></td><td>${escapeHtml(meetingTime)} (Asia/Kolkata)</td></tr>
    </table>
    ${meetLink ? `<p><a href="${escapeHtml(meetLink)}">Join Google Meet</a></p>` : ''}
    ${eventUrl ? `<p><a href="${escapeHtml(eventUrl)}">Open Google Calendar event</a></p>` : ''}
  `;
  const result = await transporter.sendMail({
    from: `LeadOS Booking <${from}>`,
    to: recipient,
    subject,
    html,
  });
  await BookingNotificationLog.create({
    calendar_event_id: eventId, meeting_start: new Date(start), recipient, message_id: result.messageId,
  }).catch((error) => { if (error.code !== 11000) throw error; });
  return { sent: true, recipient, message_id: result.messageId };
};

module.exports = { sendBookingNotification };
