/**
 * Transactional email (plan A11): invitations and password resets.
 *
 * Delivery mode (EMAIL_DELIVERY, or chosen automatically):
 *   smtp    — NERA_SMTP_HOST/PORT/USER/PASS and NERA_MAIL_FROM are set
 *   outbox  — development only: each message is written to server/.dev-outbox/
 *             (git-ignored) so links can be opened locally
 *   memory  — automated tests: messages are kept in memory (outbox())
 *   off     — nothing is sent; callers get delivered: false
 * In production without SMTP, sending fails rather than silently dropping mail.
 * Message bodies contain one-time links, so they are never written to logs.
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const memoryOutbox = [];
let transport = null;

const productName = () => process.env.NERA_PRODUCT_NAME || 'Nera';
const appUrl = () => (process.env.NERA_APP_URL || process.env.PORTAL_URL || 'http://localhost:5173').replace(/\/+$/, '');
const adminUrl = () => (process.env.NERA_ADMIN_URL || process.env.ADMIN_PANEL_URL || 'http://localhost:5174').replace(/\/+$/, '');

// NERA_SMTP_* wins; otherwise the EMAIL_* settings the rest of the server
// already uses (bookings, Mafiya) are reused.
function smtpSettings() {
  const env = process.env;
  const host = env.NERA_SMTP_HOST || env.EMAIL_HOST;
  const user = env.NERA_SMTP_USER || env.EMAIL_USER;
  return {
    host,
    port: Number(env.NERA_SMTP_PORT || env.EMAIL_PORT || 587),
    secure: (env.NERA_SMTP_SECURE || env.EMAIL_SECURE) === 'true',
    user,
    pass: env.NERA_SMTP_PASS || env.EMAIL_PASS,
    from: env.NERA_MAIL_FROM || env.EMAIL_FROM || (user ? `${productName()} <${user}>` : null),
  };
}

function smtpConfigured() {
  const s = smtpSettings();
  return Boolean(s.host && s.user && s.pass && s.from);
}

function deliveryMode() {
  const configured = String(process.env.EMAIL_DELIVERY || '').toLowerCase();
  if (['smtp', 'outbox', 'memory', 'off'].includes(configured)) return configured;
  if (process.env.NODE_ENV === 'test') return 'memory';
  if (smtpConfigured()) return 'smtp';
  return process.env.NODE_ENV === 'production' ? 'unconfigured' : 'outbox';
}

const maskEmail = (email) => String(email || '').replace(/^(.{2})[^@]*(@.*)$/, '$1***$2');

async function send({ to, subject, text, html }) {
  const mode = deliveryMode();
  if (mode === 'off') return { delivered: false, mode };
  if (mode === 'unconfigured') throw new Error('Email delivery is not configured (set NERA_SMTP_* and NERA_MAIL_FROM)');
  const message = { from: smtpSettings().from || `${productName()} <no-reply@localhost>`, to, subject, text, html };

  if (mode === 'memory') {
    memoryOutbox.push({ ...message, at: new Date() });
  } else if (mode === 'outbox') {
    const dir = path.join(__dirname, '..', '.dev-outbox');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...message, at: new Date() }, null, 2));
  } else {
    if (!transport) {
      const s = smtpSettings();
      transport = nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: { user: s.user, pass: s.pass } });
    }
    await transport.sendMail(message);
  }
  console.log(`[notify] "${subject}" to ${maskEmail(to)} via ${mode}`);
  return { delivered: true, mode };
}

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, paragraphs, button) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${escapeHtml(p)}</p>`).join('');
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e293b;max-width:520px">
<h2 style="font-size:19px">${escapeHtml(title)}</h2>${body}
<p><a href="${escapeHtml(button.url)}" style="background:#2563eb;color:#fff;padding:11px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(button.label)}</a></p>
<p style="color:#64748b;font-size:13px">If the button does not work, copy this link into your browser:<br>${escapeHtml(button.url)}</p></div>`;
}

function invitationEmail({ to, inviteeName, workspaceName, inviterName, role, url, expiresAt, staff, passwordPreset = false }) {
  const product = productName();
  const where = staff ? `the ${product} admin panel` : `the ${workspaceName} workspace on ${product}`;
  const roleName = staff ? ({ founder: 'Admin (Owner)', ops: 'Staff' }[role] || role) : role;
  const title = `You're invited to ${staff ? product : workspaceName}`;
  const lines = [
    `Hi ${inviteeName || 'there'},`,
    `${inviterName || 'An administrator'} invited you to join ${where} as ${roleName}.`,
    passwordPreset
      ? `Open the link below and accept the invitation. We then email you your login details. The link works once and expires on ${new Date(expiresAt).toUTCString()}.`
      : `Open the link below to set your own password. It works once and expires on ${new Date(expiresAt).toUTCString()}.`,
  ];
  return send({ to, subject: title, text: `${lines.join('\n\n')}\n\n${url}\n`, html: layout(title, lines, { url, label: 'Accept invitation' }) });
}

const STAFF_ROLE_OVERVIEW = {
  founder: {
    name: 'Admin (Owner)',
    access: 'Full access: workspaces and billing, customers, WhatsApp numbers, reports, settings and managing the team.',
  },
  ops: {
    name: 'Staff',
    access: 'Workspaces, customers, WhatsApp numbers and reports. Billing and team changes stay with the Admin.',
  },
};

// Sent after a team member accepts an invitation whose password the Admin
// chose: what they can do, where to sign in, and the login details.
function staffWelcomeEmail({ to, name, role, password }) {
  const product = productName();
  const overview = STAFF_ROLE_OVERVIEW[role] || { name: role, access: '' };
  const loginUrl = `${adminUrl()}/login`;
  const title = `Welcome to the ${product} admin panel`;
  const lines = [
    `Hi ${name || 'there'},`,
    `Your account is ready. You joined the ${product} admin panel as ${overview.name}.`,
    `What you can do: ${overview.access}`,
    'Your login details:',
    `Login page: ${loginUrl}`,
    `Email: ${to}`,
    `Password: ${password}`,
    'For your safety, change this password after you sign in (Settings > Change Administrator Password) and delete this email.',
  ];
  return send({ to, subject: title, text: `${lines.join('\n\n')}\n`, html: layout(title, lines, { url: loginUrl, label: 'Sign in' }) });
}

function passwordResetEmail({ to, name, url, expiresMinutes }) {
  const title = `Reset your ${productName()} password`;
  const lines = [
    `Hi ${name || 'there'},`,
    `Someone asked to reset the password for this account. Open the link below to choose a new one. It works once and expires in ${expiresMinutes} minutes.`,
    'If this wasn\'t you, ignore this email; your password stays the same.',
  ];
  return send({ to, subject: title, text: `${lines.join('\n\n')}\n\n${url}\n`, html: layout(title, lines, { url, label: 'Choose a new password' }) });
}

// Six-digit sign-in / setup code. The code is the whole message, so it is
// shown large; nothing else in the mail is actionable.
function signInCodeEmail({ to, name, code, minutes, purpose }) {
  const product = productName();
  const title = purpose === 'setup' ? `Confirm email verification for ${product}` : `Your ${product} sign-in code`;
  const intro = purpose === 'setup'
    ? 'Use this code to turn on two-step verification by email.'
    : 'Use this code to finish signing in.';
  const lines = [
    `Hi ${name || 'there'},`,
    intro,
    `Code: ${code}`,
    `It expires in ${minutes} minutes and works once.`,
    'If you did not try to sign in, change your password now: someone may know it.',
  ];
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1e293b;max-width:520px;margin:0 auto;padding:8px">
<div style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:18px">${escapeHtml(product)}</div>
<h2 style="font-size:19px;margin:0 0 12px">${escapeHtml(title)}</h2>
<p style="margin:0 0 14px">Hi ${escapeHtml(name || 'there')},</p>
<p style="margin:0 0 18px">${escapeHtml(intro)}</p>
<div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:12px;padding:18px;text-align:center;margin:0 0 18px">
<div style="font-size:34px;font-weight:700;letter-spacing:10px;color:#0f172a;font-family:'Courier New',monospace">${escapeHtml(code)}</div>
<div style="font-size:13px;color:#64748b;margin-top:6px">Expires in ${escapeHtml(minutes)} minutes</div>
</div>
<p style="color:#64748b;font-size:13px;margin:0">If you did not try to sign in, change your password now: someone may know it. Never share this code with anyone, including ${escapeHtml(product)} staff.</p>
</div>`;
  // The subject is logged by send(), so it never carries the code.
  return send({ to, subject: title, text: `${lines.join('\n\n')}\n`, html });
}

module.exports = {
  send,
  signInCodeEmail,
  deliveryMode,
  invitationEmail,
  staffWelcomeEmail,
  passwordResetEmail,
  appUrl,
  adminUrl,
  productName,
  outbox: () => memoryOutbox,
  clearOutbox: () => { memoryOutbox.length = 0; },
};
