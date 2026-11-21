/**
 * One-time six-digit codes delivered over a channel (email, WhatsApp).
 * Shared rules for every channel: only a hash of the code is stored (bound to
 * the user, and to the destination when one is given); it expires after
 * OTP_TTL_MINUTES (10), allows five wrong tries, works once, cannot be resent
 * more than once every RESEND_SECONDS, and is only accepted for the purpose it
 * was sent for (login / setup / reauth). Codes are never logged.
 */
const crypto = require('crypto');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');

const TTL_MINUTES = Number(process.env.EMAIL_OTP_TTL_MINUTES || 10);
const RESEND_SECONDS = 45;
const MAX_ATTEMPTS = 5;
// login: second sign-in step; setup: turning a method on; reauth: confirming
// a security change while signed in.
const PURPOSES = ['login', 'setup', 'reauth'];

class OtpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * prefix: user fields `${prefix}_hash|_purpose|_expires_at|_sent_at|_attempts`.
 * deliver({ user, code, purpose, to, minutes }): sends the code; throws on failure.
 * describeTarget(user, to): what the answer shows as `sent_to` (masked).
 */
function createOtpStore({ prefix, deliver, describeTarget, scope, ErrorClass = OtpError }) {
  const f = (name) => `${prefix}_${name}`;
  const sys = (fn) => runAsSystem(fn, scope);
  const hashCode = (userId, code, to) => crypto.createHash('sha256').update(to ? `${userId}:${to}:${code}` : `${userId}:${code}`).digest('hex');

  async function sendCode(user, purpose, { to = null } = {}) {
    if (!PURPOSES.includes(purpose)) throw new ErrorClass(400, 'Unknown code purpose');
    const lastSent = user[f('sent_at')] ? new Date(user[f('sent_at')]).getTime() : 0;
    const wait = Math.ceil((lastSent + RESEND_SECONDS * 1000 - Date.now()) / 1000);
    // The cooldown also holds after a code was used up or cleared, so wrong
    // guesses cannot be followed by an instant fresh code.
    if (wait > 0) {
      throw new ErrorClass(429, `Please wait ${wait} seconds before asking for a new code`, 'OTP_RESEND_WAIT');
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    await sys(() => Users.updateOne({ id: user.id }, {
      $set: {
        [f('hash')]: hashCode(user.id, code, to),
        [f('purpose')]: purpose,
        [f('expires_at')]: new Date(Date.now() + TTL_MINUTES * 60000),
        [f('sent_at')]: new Date(),
        [f('attempts')]: 0,
      },
    }));
    await deliver({ user, code, purpose, to, minutes: TTL_MINUTES });
    return { sent_to: describeTarget(user, to), expires_minutes: TTL_MINUTES, resend_after: RESEND_SECONDS };
  }

  // True when the code matches; a used, expired or over-tried code is cleared.
  async function verifyCode(user, code, purpose, { to = null } = {}) {
    const clean = String(code || '').replace(/\s/g, '');
    const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
    if (!fresh?.[f('hash')] || fresh[f('purpose')] !== purpose) return false;
    const clear = () => sys(() => Users.updateOne({ id: user.id }, {
      $unset: { [f('hash')]: '', [f('purpose')]: '', [f('expires_at')]: '' },
      $set: { [f('attempts')]: 0 },
    }));
    if (!fresh[f('expires_at')] || new Date(fresh[f('expires_at')]) <= new Date()) {
      await clear();
      return false;
    }
    if (!/^\d{6}$/.test(clean)) return false;
    const ok = crypto.timingSafeEqual(Buffer.from(hashCode(user.id, clean, to)), Buffer.from(fresh[f('hash')]));
    if (ok) {
      await clear();
      return true;
    }
    const attempts = Number(fresh[f('attempts')] || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) await clear();
    else await sys(() => Users.updateOne({ id: user.id }, { $set: { [f('attempts')]: attempts } }));
    return false;
  }

  const clearFields = () => ({ [f('hash')]: '', [f('purpose')]: '', [f('expires_at')]: '' });

  return { sendCode, verifyCode, clearFields };
}

module.exports = { createOtpStore, OtpError, PURPOSES, TTL_MINUTES, RESEND_SECONDS, MAX_ATTEMPTS };
