/**
 * Counted password checks, shared by login and every signed-in password
 * prompt (change password, two-step changes). Wrong passwords add to one
 * counter per account with a single atomic $inc, so parallel guesses cannot
 * all read the same old count; at LOGIN_MAX_FAILURES the account locks for
 * LOGIN_LOCK_MINUTES. A locked account is refused before the password is
 * compared. A correct password resets the counter.
 */
const bcrypt = require('bcryptjs');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const audit = require('./audit');

const MAX_FAILED_LOGINS = Number(process.env.LOGIN_MAX_FAILURES || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const sys = (fn) => runAsSystem(fn, 'password-attempts');

const isLocked = (user) => Boolean(user?.locked_until && new Date(user.locked_until) > new Date());

/**
 * Counts one wrong password. Returns { count, locked } where locked is true
 * when this failure locked the account. Only the request that crosses the
 * limit sets the lock (and writes the audit record).
 */
async function recordPasswordFailure(user, { req } = {}) {
  const updated = await sys(() => Users.findOneAndUpdate(
    { id: user.id },
    { $inc: { failed_login_count: 1 } },
    { new: true, projection: { _id: 0, failed_login_count: 1 } },
  ).lean());
  const count = Number(updated?.failed_login_count || 0);
  if (count < MAX_FAILED_LOGINS) return { count, locked: false };
  const now = new Date();
  const lock = await sys(() => Users.updateOne(
    { id: user.id, failed_login_count: { $gte: MAX_FAILED_LOGINS }, $or: [{ locked_until: null }, { locked_until: { $lte: now } }] },
    { $set: { failed_login_count: 0, locked_until: new Date(now.getTime() + LOCK_MINUTES * 60000) } },
  ));
  const locked = lock.modifiedCount === 1;
  // Already locked by a parallel request: start the count again, no second lock.
  if (!locked) await sys(() => Users.updateOne({ id: user.id, failed_login_count: { $gte: MAX_FAILED_LOGINS } }, { $set: { failed_login_count: 0 } }));
  if (locked) {
    await audit.record(audit.EVENTS.LOGIN_FAILED_LOCKOUT, { tenantId: user.tenant_id ?? null, req, targetType: 'user', targetId: user.id, meta: { email: user.email } });
  }
  return { count, locked };
}

// Resets the counter after a correct password, but only while the account is
// not locked in the database: the caller's copy of the user may be stale (a
// parallel burst of guesses can lock it after the copy was read). Returns
// false when the account is locked, so the caller refuses with 423.
async function recordPasswordSuccess(user, extraSet = {}) {
  const now = new Date();
  const res = await sys(() => Users.updateOne(
    { id: user.id, $or: [{ locked_until: null }, { locked_until: { $lte: now } }] },
    { $set: { failed_login_count: 0, ...extraSet }, $unset: { locked_until: '' } },
  ));
  return res.matchedCount === 1;
}

/**
 * Checks a password against the account with the counter and lock:
 * 'locked' (refused; also when the database says locked although the given
 * copy did not), 'wrong' (counted; lockedNow when this attempt locked the
 * account) or 'ok' (counter reset; `extraSet` is written with the reset, for
 * example last_login).
 * resetOnSuccess: false leaves the counter as it is on a correct password, for
 * checks with a second part still to pass (password + code, stepUp.js): the
 * caller calls recordPasswordSuccess only when every part passed, so wrong
 * codes after a right password keep counting toward the lock.
 */
async function checkPassword(user, password, { req, extraSet = {}, resetOnSuccess = true } = {}) {
  if (isLocked(user)) return { result: 'locked' };
  if (typeof password !== 'string' || !password || !(await bcrypt.compare(password, user.password_hash || ''))) {
    const { locked } = await recordPasswordFailure(user, { req });
    return { result: 'wrong', lockedNow: locked };
  }
  if (!resetOnSuccess) return { result: 'ok' };
  if (!(await recordPasswordSuccess(user, extraSet))) return { result: 'locked' };
  return { result: 'ok' };
}

const LOCKED_MESSAGE = 'Too many failed attempts. Try again later or reset your password.';

module.exports = { checkPassword, recordPasswordFailure, recordPasswordSuccess, isLocked, MAX_FAILED_LOGINS, LOCK_MINUTES, LOCKED_MESSAGE };
