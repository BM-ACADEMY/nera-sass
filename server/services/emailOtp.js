/**
 * One-time sign-in codes by email (second-step method next to the
 * authenticator app). Only a hash of the code is stored; it expires after
 * EMAIL_OTP_TTL_MINUTES, allows five wrong tries and cannot be resent
 * more than once every RESEND_SECONDS.
 */
const crypto = require('crypto');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const notify = require('./notify');

const TTL_MINUTES = Number(process.env.EMAIL_OTP_TTL_MINUTES || 10);
const RESEND_SECONDS = 45;
const MAX_ATTEMPTS = 5;
const PURPOSES = ['login', 'setup'];

class EmailOtpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sys = (fn) => runAsSystem(fn, 'email-otp');
const hashCode = (userId, code) => crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex');
const maskEmail = (email) => String(email || '').replace(/^(.)(.*)(.@.*)$/, (m, a, mid, b) => `${a}${'*'.repeat(Math.min(mid.length, 6))}${b}`);

async function sendCode(user, purpose) {
  if (!PURPOSES.includes(purpose)) throw new EmailOtpError(400, 'Unknown code purpose');
  const lastSent = user.mfa_email_code_sent_at ? new Date(user.mfa_email_code_sent_at).getTime() : 0;
  const wait = Math.ceil((lastSent + RESEND_SECONDS * 1000 - Date.now()) / 1000);
  // The cooldown also holds after a code was used up or cleared, so wrong
  // guesses cannot be followed by an instant fresh code.
  if (wait > 0) {
    throw new EmailOtpError(429, `Please wait ${wait} seconds before asking for a new code`, 'OTP_RESEND_WAIT');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  await sys(() => Users.updateOne({ id: user.id }, {
    $set: {
      mfa_email_code_hash: hashCode(user.id, code),
      mfa_email_code_purpose: purpose,
      mfa_email_code_expires_at: new Date(Date.now() + TTL_MINUTES * 60000),
      mfa_email_code_sent_at: new Date(),
      mfa_email_code_attempts: 0,
    },
  }));
  await notify.signInCodeEmail({ to: user.email, name: user.name, code, minutes: TTL_MINUTES, purpose });
  return { sent_to: maskEmail(user.email), expires_minutes: TTL_MINUTES, resend_after: RESEND_SECONDS };
}

// True when the code matches; a used, expired or over-tried code is cleared.
async function verifyCode(user, code, purpose) {
  const clean = String(code || '').replace(/\s/g, '');
  const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
  if (!fresh?.mfa_email_code_hash || fresh.mfa_email_code_purpose !== purpose) return false;
  const clear = () => sys(() => Users.updateOne({ id: user.id }, {
    $unset: { mfa_email_code_hash: '', mfa_email_code_purpose: '', mfa_email_code_expires_at: '' },
    $set: { mfa_email_code_attempts: 0 },
  }));
  if (!fresh.mfa_email_code_expires_at || new Date(fresh.mfa_email_code_expires_at) <= new Date()) {
    await clear();
    return false;
  }
  if (!/^\d{6}$/.test(clean)) return false;
  const ok = crypto.timingSafeEqual(Buffer.from(hashCode(user.id, clean)), Buffer.from(fresh.mfa_email_code_hash));
  if (ok) {
    await clear();
    return true;
  }
  const attempts = Number(fresh.mfa_email_code_attempts || 0) + 1;
  if (attempts >= MAX_ATTEMPTS) await clear();
  else await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_email_code_attempts: attempts } }));
  return false;
}

module.exports = { sendCode, verifyCode, maskEmail, EmailOtpError, MAX_ATTEMPTS };
