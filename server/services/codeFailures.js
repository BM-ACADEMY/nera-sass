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

/**
 * Counts a code check BEFORE it is made (one conditional $inc below the limit
 * and not locked), so a parallel burst of guesses cannot all slip in under
 * the limit. Returns false when no check may be made (locked or full).
 * Call settle(userId, ok) after the check: a correct code gives the count
 * back; a wrong one at the limit sets the lock.
 */
async function take(userId) {
  const now = new Date();
  await sys(() => Users.updateOne(
    { id: userId, $or: [{ mfa_code_window_start: null }, { mfa_code_window_start: { $lte: new Date(now.getTime() - WINDOW_MS) } }] },
    { $set: { mfa_code_failures: 0, mfa_code_window_start: now } },
  ));
  const taken = await sys(() => Users.findOneAndUpdate(
    {
      id: userId,
      $and: [
        { $or: [{ mfa_code_failures: null }, { mfa_code_failures: { $lt: maxFailures() } }] },
        { $or: [{ mfa_code_locked_until: null }, { mfa_code_locked_until: { $lte: now } }] },
      ],
    },
    { $inc: { mfa_code_failures: 1 } },
    { new: true, projection: { _id: 0, mfa_code_failures: 1 } },
  ).lean());
  return Boolean(taken);
}

async function settle(userId, ok) {
  if (ok) {
    await sys(() => Users.updateOne({ id: userId, mfa_code_failures: { $gt: 0 } }, { $inc: { mfa_code_failures: -1 } }));
    return false;
  }
  const now = new Date();
  const lock = await sys(() => Users.updateOne(
    { id: userId, mfa_code_failures: { $gte: maxFailures() } },
    { $set: { mfa_code_locked_until: new Date(now.getTime() + lockMs()), mfa_code_failures: 0, mfa_code_window_start: now } },
  ));
  return lock.modifiedCount === 1;
}

module.exports = { isLocked, record, take, settle, LOCKED_MESSAGE, maxFailures };
