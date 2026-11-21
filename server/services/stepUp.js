/**
 * Re-checking who is at the keyboard before a sensitive account action
 * (step-up): the current password and, when two-step verification is on, a
 * second-step code. The second-step check is the same one the login uses, and
 * wrong passwords count toward the same lockout as wrong logins.
 */
const bcrypt = require('bcryptjs');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const { decrypt } = require('../utils/crypto');
const mfa = require('./mfa');
const emailOtp = require('./emailOtp');
const audit = require('./audit');

const sys = (fn) => runAsSystem(fn, 'step-up');
const maxFailures = () => Number(process.env.LOGIN_MAX_FAILURES || 5);
const lockMinutes = () => Number(process.env.LOGIN_LOCK_MINUTES || 15);

const isLocked = (user) => Boolean(user?.locked_until && new Date(user.locked_until) > new Date());

/** One more wrong password (login or step-up); locks the account at the limit. */
async function recordPasswordFailure(user, req) {
  const failures = Number(user.failed_login_count || 0) + 1;
  const lock = failures >= maxFailures();
  await sys(() => Users.updateOne({ id: user.id }, {
    $set: lock ? { failed_login_count: 0, locked_until: new Date(Date.now() + lockMinutes() * 60000) } : { failed_login_count: failures },
  }));
  if (lock) {
    await audit.record(audit.EVENTS.LOGIN_FAILED_LOCKOUT, { tenantId: user.tenant_id ?? null, req, targetType: 'user', targetId: user.id, meta: { email: user.email } });
  }
  return lock;
}

const clearPasswordFailures = (user) => (Number(user.failed_login_count || 0) || user.locked_until
  ? sys(() => Users.updateOne({ id: user.id }, { $set: { failed_login_count: 0 }, $unset: { locked_until: '' } }))
  : null);

/**
 * An authenticator code, an emailed code (for `emailPurpose`) or a recovery
 * code (used up on success). Without `method`, an authenticator code is
 * assumed when the app is set up.
 * Returns { ok: true } or { ok: false, methodOff: true } for a method the user
 * has not turned on, else { ok: false }.
 */
async function verifySecondStep(user, { method, code, recoveryCode } = {}, emailPurpose = 'login') {
  const methods = mfa.methodsOf(user);
  let ok = false;
  if (code) {
    const use = method || (methods.includes('totp') ? 'totp' : 'email');
    if (!methods.includes(use)) return { ok: false, methodOff: true };
    ok = use === 'totp' ? mfa.verifyTotp(decrypt(user.mfa_secret_enc), code) : await emailOtp.verifyCode(user, code, emailPurpose);
  }
  if (!ok && recoveryCode) {
    const hash = mfa.hashRecoveryCode(recoveryCode);
    const updated = await sys(() => Users.updateOne({ id: user.id, mfa_recovery_hashes: hash }, { $pull: { mfa_recovery_hashes: hash } }));
    ok = updated.modifiedCount === 1;
  }
  return { ok };
}

const LOCKED = { status: 423, body: { error: 'Too many wrong attempts. Try again later or reset your password.', code: 'ACCOUNT_LOCKED' } };

/** Password only (counted toward the lockout). Returns null when it is right, else { status, body }. */
async function confirmPassword(user, body = {}, req = null) {
  if (isLocked(user)) return LOCKED;
  const password = body.password ?? body.current_password;
  if (typeof password !== 'string' || !password) {
    return { status: 403, body: { error: 'Enter your password to continue.', code: 'PASSWORD_REQUIRED' } };
  }
  if (!(await bcrypt.compare(password, user.password_hash || ''))) {
    if (await recordPasswordFailure(user, req)) return LOCKED;
    return { status: 403, body: { error: 'That password is not correct.', code: 'CONFIRM_FAILED' } };
  }
  return null;
}

/**
 * Password (always) and a second-step code (when the user has one turned on).
 * Returns null when both pass, else { status, body } to send back. Uses 403,
 * not 401: the session itself is still valid, so the apps must not sign out.
 *
 * With two-step on, a missing code is answered before the password is looked
 * at, and a wrong password or wrong code get the same answer, so the reply
 * never tells whether the password alone was right.
 */
async function confirmIdentity(user, body = {}, emailPurpose = 'confirm', req = null) {
  if (isLocked(user)) return LOCKED;
  const withMfa = mfa.hasMfa(user);
  const code = body.code ? String(body.code).trim() : '';
  const recoveryCode = body.recovery_code ? String(body.recovery_code).trim() : '';
  if (withMfa && !code && !recoveryCode) {
    return { status: 403, body: { error: 'Enter your password and your two-step verification code to continue.', code: 'MFA_CODE_REQUIRED', mfa_methods: mfa.methodsOf(user) } };
  }
  const refused = await confirmPassword(user, body, req);
  if (refused) {
    if (withMfa && refused.body.code === 'CONFIRM_FAILED') return { status: 403, body: { error: 'The password or the code is not correct.', code: 'CONFIRM_FAILED' } };
    return refused;
  }
  if (withMfa) {
    const check = await verifySecondStep(user, { method: body.method, code, recoveryCode }, emailPurpose);
    if (check.methodOff) return { status: 400, body: { error: 'This verification method is not turned on for this account' } };
    if (!check.ok) {
      const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
      if (await recordPasswordFailure(fresh || user, req)) return LOCKED;
      return { status: 403, body: { error: 'The password or the code is not correct.', code: 'CONFIRM_FAILED' } };
    }
  }
  await clearPasswordFailures(user);
  return null;
}

module.exports = { verifySecondStep, confirmIdentity, confirmPassword, recordPasswordFailure, isLocked };
