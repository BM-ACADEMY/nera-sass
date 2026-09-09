const nodemailer = require('nodemailer');
const pool = require('../db/connection');

const notificationLogReady = pool.query(`
  CREATE TABLE IF NOT EXISTS booking_notification_log (
    id BIGSERIAL PRIMARY KEY,
    calendar_event_id TEXT NOT NULL,
    meeting_start TIMESTAMPTZ NOT NULL,
    recipient TEXT NOT NULL,
    message_id TEXT,
    sent_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE (calendar_event_id, meeting_start, recipient)
  )
`).catch(error => console.error('[Booking Notification] Log table initialization failed:', error.message));

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
  await notificationLogReady;
  const recipient = supportEmail();
  const existing = await pool.query(`
    SELECT id, message_id FROM booking_notification_log
    WHERE calendar_event_id = $1 AND meeting_start = $2::timestamptz AND recipient = $3
    LIMIT 1
  `, [eventId, start, recipient]);
  if (existing.rows[0]) return { sent: true, deduplicated: true, recipient, message_id: existing.rows[0].message_id };

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
  await pool.query(`
    INSERT INTO booking_notification_log (calendar_event_id, meeting_start, recipient, message_id)
    VALUES ($1, $2::timestamptz, $3, $4)
    ON CONFLICT (calendar_event_id, meeting_start, recipient) DO NOTHING
  `, [eventId, start, recipient, result.messageId]);
  return { sent: true, recipient, message_id: result.messageId };
};

module.exports = { sendBookingNotification };
