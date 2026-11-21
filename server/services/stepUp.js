/**
 * Re-checking who is at the keyboard before a sensitive account action
 * (step-up): the current password and, when two-step verification is on, a
 * second-step code. The second-step check is the same one the login uses.
 */
const bcrypt = require('bcryptjs');
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const { decrypt } = require('../utils/crypto');
const mfa = require('./mfa');
const emailOtp = require('./emailOtp');

const sys = (fn) => runAsSystem(fn, 'step-up');

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

/**
 * Password (always) and a second-step code (when the user has one turned on).
 * Returns null when both pass, else { status, body } to send back. Uses 403,
 * not 401: the session itself is still valid, so the apps must not sign out.
 */
async function confirmIdentity(user, body = {}, emailPurpose = 'confirm') {
  const password = body.password ?? body.current_password;
  if (typeof password !== 'string' || !password) {
    return { status: 403, body: { error: 'Enter your password to continue.', code: 'PASSWORD_REQUIRED' } };
  }
  if (!(await bcrypt.compare(password, user.password_hash || ''))) {
    return { status: 403, body: { error: 'That password is not correct.', code: 'PASSWORD_INCORRECT' } };
  }
  if (!mfa.hasMfa(user)) return null;
  const code = body.code ? String(body.code).trim() : '';
  const recoveryCode = body.recovery_code ? String(body.recovery_code).trim() : '';
  if (!code && !recoveryCode) {
    return { status: 403, body: { error: 'Enter your two-step verification code to continue.', code: 'MFA_CODE_REQUIRED', mfa_methods: mfa.methodsOf(user) } };
  }
  const check = await verifySecondStep(user, { method: body.method, code, recoveryCode }, emailPurpose);
  if (check.methodOff) return { status: 400, body: { error: 'This verification method is not turned on for this account' } };
  if (!check.ok) return { status: 403, body: { error: 'That verification code is not correct or has expired.', code: 'INVALID_MFA_CODE' } };
  return null;
}

module.exports = { verifySecondStep, confirmIdentity };
