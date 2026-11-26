/**
 * Re-checking who is at the keyboard before a sensitive account action
 * (step-up): the current password and, when two-step verification is on, a
 * second-step code. The second-step check is the same one the login uses, and
 * wrong passwords (and wrong codes) count toward the same lockout as wrong
 * logins: counting and locking live in passwordAttempts.js only.
 */
const { Users, UserSessions } = require('../models');
const { runAsSystem } = require('./tenantContext');
const { decrypt } = require('../utils/crypto');
const mfa = require('./mfa');
const emailOtp = require('./emailOtp');
const whatsappOtp = require('./whatsappOtp');
const codeFailures = require('./codeFailures');
const passwordAttempts = require('./passwordAttempts');

const sys = (fn) => runAsSystem(fn, 'step-up');
const { isLocked } = passwordAttempts;

/**
 * The one second-step check (login, #43 step-up, My sessions): an
 * authenticator code, an emailed or WhatsApp code (for `codePurpose`) or a
 * recovery code (used up on success). Without `method`, an authenticator code
 * is assumed when the app is on, else the first usable method.
 * Wrong codes count toward the per-account code lock across all channels
 * (codeFailures.js): app codes are counted before they are checked, email and
 * WhatsApp codes in otpStore.js. While code checks are locked a recovery code
 * is still tried.
 * Returns { ok }, plus methodOff for a method the user has not turned on,
 * locked when a code was refused because code checks are locked, and
 * recoveryFailedWhileLocked for a wrong recovery code while they are locked.
 */
// Which method a code is checked with: `method`, else the app when it is on,
// else the first usable method. Null when that method is not turned on.
function codeMethod(user, method) {
  const methods = mfa.methodsOf(user);
  const use = method || (methods.includes('totp') ? 'totp' : methods[0]);
  return methods.includes(use) ? use : null;
}

async function verifySecondStep(user, { method, code, recoveryCode } = {}, codePurpose = 'login') {
  let ok = false;
  let locked = false;
  if (code) {
    const use = codeMethod(user, method);
    if (!use) return { ok: false, methodOff: true };
    if (use === 'totp') {
      if (await codeFailures.take(user.id)) {
        ok = mfa.verifyTotp(decrypt(user.mfa_secret_enc), code);
        await codeFailures.settle(user.id, ok);
      } else {
        locked = true;
      }
    } else {
      try {
        ok = use === 'whatsapp' ? await whatsappOtp.verifyCode(user, code, codePurpose) : await emailOtp.verifyCode(user, code, codePurpose);
      } catch (error) {
        if (error.code !== 'MFA_CODE_LOCKED') throw error;
        locked = true;
      }
    }
  }
  if (!ok && recoveryCode) {
    const hash = mfa.hashRecoveryCode(recoveryCode);
    const updated = await sys(() => Users.updateOne({ id: user.id, mfa_recovery_hashes: hash }, { $pull: { mfa_recovery_hashes: hash } }));
    ok = updated.modifiedCount === 1;
    // A wrong recovery code while code checks are locked: the caller counts it
    // toward the account lock, so guessing them still moves toward a lockout.
    if (!ok && (locked || await codeFailures.isLocked(user.id))) return { ok, locked, recoveryFailedWhileLocked: true };
  }
  return { ok, locked: !ok && locked };
}

const LOCKED = { status: 423, body: { error: passwordAttempts.LOCKED_MESSAGE, code: 'ACCOUNT_LOCKED' } };

/**
 * Password only (counted toward the lockout). Returns null when it is right,
 * else { status, body }. A right password does not reset the counter here:
 * that happens in confirmIdentity once every part has passed.
 */
async function confirmPassword(user, body = {}, req = null) {
  if (isLocked(user)) return LOCKED;
  const password = body.password ?? body.current_password;
  if (typeof password !== 'string' || !password) {
    return { status: 403, body: { error: 'Enter your password to continue.', code: 'PASSWORD_REQUIRED' } };
  }
  const check = await passwordAttempts.checkPassword(user, password, { req, resetOnSuccess: false });
  if (check.result === 'locked' || check.lockedNow) return LOCKED;
  if (check.result !== 'ok') return { status: 403, body: { error: 'That password is not correct.', code: 'CONFIRM_FAILED' } };
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
  // code_method (as in the two-step settings) or method (My sessions UIs).
  const method = body.code_method || body.method;
  if (withMfa) {
    // Answered before the password is looked at, so neither reply tells
    // whether the password was right: a method that is not turned on, and
    // locked code checks when no recovery code was sent.
    if (code && !codeMethod(user, method)) return { status: 400, body: { error: 'This verification method is not turned on for this account' } };
    if (!recoveryCode && await codeFailures.isLocked(user.id)) return { status: 429, body: { error: codeFailures.LOCKED_MESSAGE, code: 'MFA_CODE_LOCKED' } };
  }
  const refused = await confirmPassword(user, body, req);
  if (refused) {
    if (withMfa && refused.body.code === 'CONFIRM_FAILED') return { status: 403, body: { error: 'The password or the code is not correct.', code: 'CONFIRM_FAILED' } };
    return refused;
  }
  if (withMfa) {
    const check = await verifySecondStep(user, { method, code, recoveryCode }, emailPurpose);
    if (check.methodOff) return { status: 400, body: { error: 'This verification method is not turned on for this account' } };
    // Locked since the check above (a parallel request). With a recovery code
    // sent, a wrong one is counted below like a wrong password instead.
    if (check.locked && !recoveryCode) return { status: 429, body: { error: codeFailures.LOCKED_MESSAGE, code: 'MFA_CODE_LOCKED' } };
    if (!check.ok) {
      const { locked } = await passwordAttempts.recordPasswordFailure(user, { req });
      if (locked) return LOCKED;
      return { status: 403, body: { error: 'The password or the code is not correct.', code: 'CONFIRM_FAILED' } };
    }
  }
  // Conditional reset: refused when a parallel burst locked the account meanwhile.
  if (!(await passwordAttempts.recordPasswordSuccess(user))) return LOCKED;
  return null;
}

/**
 * The remembered confirmation for two-step changes: after one successful check
 * (password, plus a code when two-step verification is on) the same signed-in
 * session may add or turn off methods for STEP_UP_GRANT_MINUTES without typing
 * the password again. It is stored on the session row (never in the browser),
 * is not extended by use, and stops counting when the session is signed out,
 * the password or token version changes, or the account is locked. A
 * confirmation made without a code does not count once two-step is on.
 */
const STEP_UP_GRANT_MINUTES = 10;

// Seconds the confirmation of this request's session is still valid (0 = none).
// `user` is the account as just read from the database.
function grantSecondsLeft(user, req) {
  const row = req?.authSession;
  if (!user || !row?.stepup_until || Number(row.user_id) !== Number(user.id)) return 0;
  if (Number(row.stepup_token_version) !== Number(user.token_version || 0)) return 0;
  if (mfa.hasMfa(user) && row.stepup_second_factor !== true) return 0;
  if (isLocked(user)) return 0;
  return Math.max(0, Math.ceil((new Date(row.stepup_until).getTime() - Date.now()) / 1000));
}

async function writeGrant(user, req, set) {
  const res = await sys(() => UserSessions.updateOne({ id: req.authSession.id, user_id: user.id, revoked_at: null }, { $set: set }));
  if (res.matchedCount !== 1) return false;
  Object.assign(req.authSession, set);
  return true;
}

// Call only right after the identity check passed. False for a token without a
// tracked session (nothing to bind the confirmation to).
async function saveGrant(user, req) {
  if (!req?.authSession) return false;
  return writeGrant(user, req, {
    stepup_until: new Date(Date.now() + STEP_UP_GRANT_MINUTES * 60000),
    stepup_token_version: Number(user.token_version || 0),
    stepup_second_factor: mfa.hasMfa(user),
  });
}

// After a method was turned on in this session (its code was just entered), a
// live confirmation also covers the account now that two-step is on. The expiry
// stays as it was. `user` is the account as read before the change.
async function upgradeGrant(user, req) {
  if (grantSecondsLeft(user, req)) await writeGrant(user, req, { stepup_second_factor: true });
}

async function clearGrant(user, req) {
  if (req?.authSession) await writeGrant(user, req, { stepup_until: null });
}

module.exports = {
  codeMethod, verifySecondStep, confirmIdentity, confirmPassword, isLocked,
  STEP_UP_GRANT_MINUTES, grantSecondsLeft, saveGrant, upgradeGrant, clearGrant,
};
