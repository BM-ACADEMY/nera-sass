/**
 * One per-account counter of wrong two-step codes across every channel
 * (authenticator app, email, WhatsApp). MFA_CODE_MAX_FAILURES (10) wrong
 * codes within an hour lock code checks for MFA_CODE_LOCK_MINUTES (60), so
 * resending codes cannot be used to keep guessing. Recovery codes are not
 * affected (they cannot be guessed). All updates are atomic.
 */
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');

const WINDOW_MS = 60 * 60 * 1000;
const maxFailures = () => Number(process.env.MFA_CODE_MAX_FAILURES || 10);
const lockMs = () => Number(process.env.MFA_CODE_LOCK_MINUTES || 60) * 60000;
const sys = (fn) => runAsSystem(fn, 'mfa-code-failures');

const LOCKED_MESSAGE = 'Too many wrong codes. Try again in an hour, or use a recovery code.';

async function isLocked(userId) {
  const user = await sys(() => Users.findOne({ id: userId }, { _id: 0, mfa_code_locked_until: 1 }).lean());
  return Boolean(user?.mfa_code_locked_until && new Date(user.mfa_code_locked_until) > new Date());
}

// Counts one wrong code; returns true when this failure locked code checks.
async function record(userId) {
  const now = new Date();
  // Start a new one-hour window when the last one is over.
  await sys(() => Users.updateOne(
    { id: userId, $or: [{ mfa_code_window_start: null }, { mfa_code_window_start: { $lte: new Date(now.getTime() - WINDOW_MS) } }] },
    { $set: { mfa_code_failures: 0, mfa_code_window_start: now } },
  ));
  const updated = await sys(() => Users.findOneAndUpdate({ id: userId }, { $inc: { mfa_code_failures: 1 } }, { new: true, projection: { _id: 0, mfa_code_failures: 1 } }).lean());
  if (Number(updated?.mfa_code_failures || 0) < maxFailures()) return false;
  const lock = await sys(() => Users.updateOne(
    { id: userId, mfa_code_failures: { $gte: maxFailures() } },
    { $set: { mfa_code_locked_until: new Date(now.getTime() + lockMs()), mfa_code_failures: 0, mfa_code_window_start: now } },
  ));
  return lock.modifiedCount === 1;
}

module.exports = { isLocked, record, LOCKED_MESSAGE, maxFailures };
