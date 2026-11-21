/**
 * One-time six-digit codes delivered over a channel (email, WhatsApp).
 * Shared rules for every channel:
 *  - only a hash of the code is stored (bound to the user, and to the
 *    destination when one is given); codes are never logged;
 *  - a code expires after OTP_TTL_MINUTES (10) and works once;
 *  - five wrong tries per code; a resend while the previous code is still
 *    valid keeps the tries already used (resending does not buy new guesses);
 *  - a new code at most every RESEND_SECONDS (a conditional update, so
 *    parallel requests cannot both send);
 *  - a code is only accepted for the purpose it was sent for
 *    (login / setup / reauth);
 *  - every wrong code also counts toward the per-account lock across all
 *    channels (codeFailures.js).
 * Tries are counted with one conditional $inc, and a match is accepted only by
 * the request that clears that exact code.
 */
const crypto = require('crypto');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const codeFailures = require('./codeFailures');

const TTL_MINUTES = Number(process.env.EMAIL_OTP_TTL_MINUTES || 10);
const RESEND_SECONDS = 45;
const MAX_ATTEMPTS = 5;
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
  const clearFields = () => ({ [f('hash')]: '', [f('purpose')]: '', [f('expires_at')]: '' });
  const lockedError = () => new ErrorClass(429, codeFailures.LOCKED_MESSAGE, 'MFA_CODE_LOCKED');

  async function sendCode(user, purpose, { to = null } = {}) {
    if (!PURPOSES.includes(purpose)) throw new ErrorClass(400, 'Unknown code purpose');
    if (await codeFailures.isLocked(user.id)) throw lockedError();
    const now = new Date();
    const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
    const live = Boolean(fresh?.[f('hash')] && fresh[f('expires_at')] && new Date(fresh[f('expires_at')]) > now);
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const set = {
      [f('hash')]: hashCode(user.id, code, to),
      [f('purpose')]: purpose,
      [f('expires_at')]: new Date(now.getTime() + TTL_MINUTES * 60000),
      [f('sent_at')]: now,
    };
    // A fresh count only when the previous code is gone or expired.
    if (!live) set[f('attempts')] = 0;
    // The cooldown also holds after a code was used up or cleared, so wrong
    // guesses cannot be followed by an instant fresh code.
    const res = await sys(() => Users.updateOne(
      { id: user.id, $or: [{ [f('sent_at')]: null }, { [f('sent_at')]: { $lte: new Date(now.getTime() - RESEND_SECONDS * 1000) } }] },
      { $set: set },
    ));
    if (res.matchedCount !== 1) {
      const last = fresh?.[f('sent_at')] ? new Date(fresh[f('sent_at')]).getTime() : now.getTime();
      const wait = Math.max(1, Math.ceil((last + RESEND_SECONDS * 1000 - now.getTime()) / 1000));
      throw new ErrorClass(429, `Please wait ${wait} seconds before asking for a new code`, 'OTP_RESEND_WAIT');
    }
    await deliver({ user, code, purpose, to, minutes: TTL_MINUTES });
    return { sent_to: describeTarget(user, to), expires_minutes: TTL_MINUTES, resend_after: RESEND_SECONDS };
  }

  // True when the code matches; a used, expired or over-tried code is cleared.
  async function verifyCode(user, code, purpose, { to = null } = {}) {
    if (await codeFailures.isLocked(user.id)) throw lockedError();
    const clean = String(code || '').replace(/\s/g, '');
    const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
    const hash = fresh?.[f('hash')];
    if (!hash || fresh[f('purpose')] !== purpose) return false;
    const clear = () => sys(() => Users.updateOne({ id: user.id, [f('hash')]: hash }, { $unset: clearFields(), $set: { [f('attempts')]: 0 } }));
    if (!fresh[f('expires_at')] || new Date(fresh[f('expires_at')]) <= new Date() || Number(fresh[f('attempts')] || 0) >= MAX_ATTEMPTS) {
      await clear();
      return false;
    }
    if (!/^\d{6}$/.test(clean)) return false;
    if (crypto.timingSafeEqual(Buffer.from(hashCode(user.id, clean, to)), Buffer.from(hash))) {
      const used = await sys(() => Users.updateOne(
        { id: user.id, [f('hash')]: hash, [f('attempts')]: { $lt: MAX_ATTEMPTS } },
        { $unset: clearFields(), $set: { [f('attempts')]: 0 } },
      ));
      return used.modifiedCount === 1;
    }
    const counted = await sys(() => Users.findOneAndUpdate(
      { id: user.id, [f('hash')]: hash, [f('attempts')]: { $lt: MAX_ATTEMPTS } },
      { $inc: { [f('attempts')]: 1 } },
      { new: true, projection: { _id: 0, [f('attempts')]: 1 } },
    ).lean());
    if (!counted || counted[f('attempts')] >= MAX_ATTEMPTS) await clear();
    // Only a try that was really checked against a live code counts.
    if (counted) await codeFailures.record(user.id);
    return false;
  }

  return { sendCode, verifyCode, clearFields };
}

module.exports = { createOtpStore, OtpError, PURPOSES, TTL_MINUTES, RESEND_SECONDS, MAX_ATTEMPTS };
