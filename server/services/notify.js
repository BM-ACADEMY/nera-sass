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

function smtpConfigured() {
  return Boolean(process.env.NERA_SMTP_HOST && process.env.NERA_SMTP_USER && process.env.NERA_SMTP_PASS && process.env.NERA_MAIL_FROM);
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
  const message = { from: process.env.NERA_MAIL_FROM || `${productName()} <no-reply@localhost>`, to, subject, text, html };

  if (mode === 'memory') {
    memoryOutbox.push({ ...message, at: new Date() });
  } else if (mode === 'outbox') {
    const dir = path.join(__dirname, '..', '.dev-outbox');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.json`);
    fs.writeFileSync(file, JSON.stringify({ ...message, at: new Date() }, null, 2));
  } else {
    if (!transport) {
      transport = nodemailer.createTransport({
        host: process.env.NERA_SMTP_HOST,
        port: Number(process.env.NERA_SMTP_PORT || 587),
        secure: process.env.NERA_SMTP_SECURE === 'true',
        auth: { user: process.env.NERA_SMTP_USER, pass: process.env.NERA_SMTP_PASS },
      });
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

function invitationEmail({ to, inviteeName, workspaceName, inviterName, role, url, expiresAt, staff }) {
  const product = productName();
  const where = staff ? `${product} platform staff` : `the ${workspaceName} workspace on ${product}`;
  const title = `You're invited to ${staff ? product : workspaceName}`;
  const lines = [
    `Hi ${inviteeName || 'there'},`,
    `${inviterName || 'An administrator'} invited you to join ${where} as ${role}.`,
    `Open the link below to set your own password. It works once and expires on ${new Date(expiresAt).toUTCString()}.`,
  ];
  return send({ to, subject: title, text: `${lines.join('\n\n')}\n\n${url}\n`, html: layout(title, lines, { url, label: 'Accept invitation' }) });
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

module.exports = {
  send,
  deliveryMode,
  invitationEmail,
  passwordResetEmail,
  appUrl,
  adminUrl,
  productName,
  outbox: () => memoryOutbox,
  clearOutbox: () => { memoryOutbox.length = 0; },
};
