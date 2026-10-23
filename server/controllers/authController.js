/**
 * Account endpoints: login (with lockout and MFA), profile, password change,
 * logout everywhere, forgotten-password reset, MFA enrolment, invitations.
 * Plans S9, A3, A4, A5, A6.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Users } = require('../models');
const { runAsSystem } = require('../services/tenantContext');
const { describeUser, mfaRequired } = require('../services/permissions');
const { tenantLifecycle } = require('../services/lifecycle');
const { encrypt, decrypt } = require('../utils/crypto');
const mfa = require('../services/mfa');
const emailOtp = require('../services/emailOtp');
const notify = require('../services/notify');
const audit = require('../services/audit');
const invitations = require('../services/invitations');
const { passwordProblem, normalizeEmail } = require('../utils/passwordPolicy');
const {
  issueAccessToken, issueMfaToken, resolveIdentity, publicUser, AuthError,
} = require('../middleware/authMiddleware');

const MAX_FAILED_LOGINS = Number(process.env.LOGIN_MAX_FAILURES || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 15);
const RESET_TTL_MINUTES = Number(process.env.PASSWORD_RESET_TTL_MINUTES || 60);
const sha256 = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const sys = (fn) => runAsSystem(fn, 'account');

function fail(res, error) {
  if (error instanceof AuthError || error instanceof invitations.InvitationError || error instanceof emailOtp.EmailOtpError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  console.error('[account]', error.message);
  return res.status(500).json({ error: 'Internal server error' });
}

async function sessionPayload(user, { mfaPassed }) {
  const identity = describeUser(user);
  const lifecycle = identity.kind === 'tenant' ? await tenantLifecycle(identity.tenantId) : null;
  return {
    token: issueAccessToken(user, { mfa: mfaPassed }),
    user: publicUser(user, identity, lifecycle?.tenant),
    workspace: lifecycle ? { state: lifecycle.state, access: lifecycle.access } : null,
  };
}

const mfaEnforcedFor = (user) => process.env.MFA_ENFORCED !== 'false' && mfaRequired(describeUser(user));

// Decides what happens after a correct password: a full session, an MFA
// challenge (with the methods the user may pick from), or mandatory enrolment.
// With email as the only method the code is mailed straight away.
async function afterPassword(user) {
  const methods = mfa.methodsOf(user);
  if (methods.length) {
    const out = { mfa_required: true, mfa_token: issueMfaToken(user, 'mfa'), methods };
    if (methods.includes('email')) out.email_hint = emailOtp.maskEmail(user.email);
    if (methods.length === 1 && methods[0] === 'email') {
      try {
        out.email = await emailOtp.sendCode(user, 'login');
      } catch (error) {
        out.email_error = error instanceof emailOtp.EmailOtpError ? error.message : 'The code could not be emailed. Try sending it again.';
        if (!(error instanceof emailOtp.EmailOtpError)) console.error('[account] Sign-in code not sent:', error.message);
      }
    }
    return out;
  }
  if (mfaEnforcedFor(user)) {
    return { mfa_setup_required: true, mfa_token: issueMfaToken(user, 'mfa_setup'), email_hint: emailOtp.maskEmail(user.email) };
  }
  return sessionPayload(user, { mfaPassed: false });
}

// A wrong two-factor code (the session or sign-in step itself is still valid).
// The code lets apps tell it apart from an expired session, which is also 401.
const INVALID_MFA_CODE = Object.freeze({ error: 'Invalid verification code', code: 'INVALID_MFA_CODE' });

exports.login = async (req, res) => {
  const { email, password } = req.body || {};
  try {
    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const user = await sys(() => Users.findOne({ email: normalizeEmail(email) }, { _id: 0 }).lean());
    if (!user || !user.password_hash || user.is_active === false) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return res.status(423).json({ error: 'Too many failed attempts. Try again later or reset your password.', code: 'ACCOUNT_LOCKED' });
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      const failures = Number(user.failed_login_count || 0) + 1;
      const lock = failures >= MAX_FAILED_LOGINS;
      await sys(() => Users.updateOne({ id: user.id }, {
        $set: lock ? { failed_login_count: 0, locked_until: new Date(Date.now() + LOCK_MINUTES * 60000) } : { failed_login_count: failures },
      }));
      if (lock) {
        await audit.record(audit.EVENTS.LOGIN_FAILED_LOCKOUT, { tenantId: user.tenant_id ?? null, req, targetType: 'user', targetId: user.id, meta: { email: user.email } });
      }
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const identity = describeUser(user);
    if (identity.kind === 'none') return res.status(403).json({ error: 'This account is not assigned to a workspace' });
    if (identity.kind === 'tenant') {
      const lifecycle = await tenantLifecycle(identity.tenantId);
      if (!lifecycle.tenant || lifecycle.access === 'none') {
        return res.status(403).json({ error: 'This workspace is suspended. Contact support.', code: 'TENANT_SUSPENDED' });
      }
    }
    await sys(() => Users.updateOne({ id: user.id }, { $set: { failed_login_count: 0, last_login: new Date() }, $unset: { locked_until: '' } }));
    return res.json(await afterPassword(user));
  } catch (error) {
    return fail(res, error);
  }
};

// Second step of login: an authenticator code, an emailed code, or a
// recovery code. Without `method`, an authenticator code is assumed when the
// app is set up (older clients send only `code`).
exports.verifyMfa = async (req, res) => {
  try {
    const { mfa_token: mfaToken, method, code, recovery_code: recoveryCode } = req.body || {};
    const { user } = await resolveIdentity(mfaToken, { purpose: 'mfa' });
    const methods = mfa.methodsOf(user);
    if (!methods.length) return res.status(400).json({ error: 'MFA is not enabled for this account' });
    let ok = false;
    if (code) {
      const use = method || (methods.includes('totp') ? 'totp' : 'email');
      if (!methods.includes(use)) return res.status(400).json({ error: 'This verification method is not turned on for this account' });
      ok = use === 'totp' ? mfa.verifyTotp(decrypt(user.mfa_secret_enc), code) : await emailOtp.verifyCode(user, code, 'login');
    }
    if (!ok && recoveryCode) {
      const hash = mfa.hashRecoveryCode(recoveryCode);
      const updated = await sys(() => Users.updateOne({ id: user.id, mfa_recovery_hashes: hash }, { $pull: { mfa_recovery_hashes: hash } }));
      ok = updated.modifiedCount === 1;
    }
    if (!ok) return res.status(401).json(INVALID_MFA_CODE);
    return res.json(await sessionPayload(user, { mfaPassed: true }));
  } catch (error) {
    return fail(res, error);
  }
};

// Sends (or resends) the sign-in code by email during the second login step.
exports.sendMfaEmail = async (req, res) => {
  try {
    const { user } = await resolveIdentity(req.body?.mfa_token, { purpose: 'mfa' });
    if (!mfa.methodsOf(user).includes('email')) return res.status(400).json({ error: 'Email codes are not turned on for this account' });
    return res.json(await emailOtp.sendCode(user, 'login'));
  } catch (error) {
    if (!(error instanceof emailOtp.EmailOtpError) && !(error instanceof AuthError)) {
      console.error('[account] Sign-in code not sent:', error.message);
      return res.status(502).json({ error: 'The code could not be emailed. Try again in a minute.' });
    }
    return fail(res, error);
  }
};

// Starts enrolment: with the mfa_setup token from login, or a normal session.
async function enrolmentUser(req) {
  const mfaToken = req.body?.mfa_token;
  if (mfaToken) return (await resolveIdentity(mfaToken, { purpose: 'mfa_setup' })).user;
  if (req.user?.id) return sys(() => Users.findOne({ id: req.user.id }, { _id: 0 }).lean());
  throw new AuthError(401, 'Not signed in');
}

exports.startMfaSetup = async (req, res) => {
  try {
    const user = await enrolmentUser(req);
    if (user.mfa_enabled) return res.status(400).json({ error: 'The authenticator app is already set up' });
    const secret = mfa.generateSecret();
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_pending_secret_enc: encrypt(secret) } }));
    return res.json({ secret, otpauth_url: mfa.otpauthUrl(secret, user.email, notify.productName()) });
  } catch (error) {
    return fail(res, error);
  }
};

exports.confirmMfaSetup = async (req, res) => {
  try {
    const user = await enrolmentUser(req);
    if (!user.mfa_pending_secret_enc) return res.status(400).json({ error: 'Start MFA setup first' });
    const secret = decrypt(user.mfa_pending_secret_enc);
    if (!mfa.verifyTotp(secret, req.body?.code)) return res.status(401).json(INVALID_MFA_CODE);
    const recovery = newRecoveryCodes(user);
    await sys(() => Users.updateOne({ id: user.id }, {
      $set: { mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_enrolled_at: user.mfa_enrolled_at || new Date(), ...(recovery ? { mfa_recovery_hashes: recovery.hashes } : {}) },
      $unset: { mfa_pending_secret_enc: '' },
    }));
    await audit.record(audit.EVENTS.MFA_ENROLLED, { tenantId: user.tenant_id ?? null, actor: actorOf(user), targetType: 'user', targetId: user.id, meta: { method: 'totp' } });
    const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
    return res.json({ ...(await sessionPayload(fresh, { mfaPassed: true })), ...(recovery ? { recovery_codes: recovery.codes } : {}) });
  } catch (error) {
    return fail(res, error);
  }
};

// Recovery codes are issued with the first method only; adding a second
// method keeps the codes the user already saved.
function newRecoveryCodes(user) {
  if (mfa.hasMfa(user) && user.mfa_recovery_hashes?.length) return null;
  return mfa.generateRecoveryCodes();
}

const actorOf = (user) => ({ actor_type: user.tenant_id ? 'user' : 'staff', actor_user_id: user.id });

// Email as a second step: a code is mailed, and entering it turns it on.
exports.startEmailSetup = async (req, res) => {
  try {
    const user = await enrolmentUser(req);
    if (user.mfa_email_enabled) return res.status(400).json({ error: 'Email codes are already turned on' });
    return res.json(await emailOtp.sendCode(user, 'setup'));
  } catch (error) {
    if (!(error instanceof emailOtp.EmailOtpError) && !(error instanceof AuthError)) {
      console.error('[account] Setup code not sent:', error.message);
      return res.status(502).json({ error: 'The code could not be emailed. Check the email settings and try again.' });
    }
    return fail(res, error);
  }
};

exports.confirmEmailSetup = async (req, res) => {
  try {
    const user = await enrolmentUser(req);
    if (user.mfa_email_enabled) return res.status(400).json({ error: 'Email codes are already turned on' });
    if (!(await emailOtp.verifyCode(user, req.body?.code, 'setup'))) return res.status(401).json(INVALID_MFA_CODE);
    const recovery = newRecoveryCodes(user);
    await sys(() => Users.updateOne({ id: user.id }, {
      $set: { mfa_email_enabled: true, mfa_enrolled_at: user.mfa_enrolled_at || new Date(), ...(recovery ? { mfa_recovery_hashes: recovery.hashes } : {}) },
    }));
    await audit.record(audit.EVENTS.MFA_ENROLLED, { tenantId: user.tenant_id ?? null, actor: actorOf(user), targetType: 'user', targetId: user.id, meta: { method: 'email' } });
    const fresh = await sys(() => Users.findOne({ id: user.id }, { _id: 0 }).lean());
    return res.json({ ...(await sessionPayload(fresh, { mfaPassed: true })), ...(recovery ? { recovery_codes: recovery.codes } : {}) });
  } catch (error) {
    return fail(res, error);
  }
};

// Turns one method off (password required). Accounts that must use two-step
// verification keep at least one method.
exports.disableMfaMethod = async (req, res) => {
  try {
    const { method, password } = req.body || {};
    const user = await sys(() => Users.findOne({ id: req.user.id }, { _id: 0 }).lean());
    if (!user || typeof password !== 'string' || !(await bcrypt.compare(password, user.password_hash || ''))) {
      return res.status(400).json({ error: 'Password incorrect' });
    }
    const methods = mfa.methodsOf(user);
    if (!methods.includes(method)) return res.status(400).json({ error: 'This method is not turned on' });
    const remaining = methods.filter((m) => m !== method);
    if (!remaining.length && mfaEnforcedFor(user)) {
      return res.status(400).json({ error: 'Admin accounts must keep one two-step method. Turn on the other method first.', code: 'MFA_LAST_METHOD' });
    }
    const update = method === 'totp'
      ? { $set: { mfa_enabled: false }, $unset: { mfa_secret_enc: '', mfa_pending_secret_enc: '' } }
      : { $set: { mfa_email_enabled: false }, $unset: { mfa_email_code_hash: '', mfa_email_code_purpose: '', mfa_email_code_expires_at: '' } };
    if (!remaining.length) update.$unset = { ...update.$unset, mfa_recovery_hashes: '', mfa_enrolled_at: '' };
    await sys(() => Users.updateOne({ id: user.id }, update));
    await audit.record(audit.EVENTS.MFA_METHOD_DISABLED, { tenantId: user.tenant_id ?? null, req, targetType: 'user', targetId: user.id, meta: { method } });
    return res.json({ success: true, mfa_methods: remaining });
  } catch (error) {
    return fail(res, error);
  }
};

// Replaces the recovery codes (password required); the old ones stop working.
exports.regenerateRecoveryCodes = async (req, res) => {
  try {
    const user = await sys(() => Users.findOne({ id: req.user.id }, { _id: 0 }).lean());
    if (!user || typeof req.body?.password !== 'string' || !(await bcrypt.compare(req.body.password, user.password_hash || ''))) {
      return res.status(400).json({ error: 'Password incorrect' });
    }
    if (!mfa.hasMfa(user)) return res.status(400).json({ error: 'Turn on two-step verification first' });
    const { codes, hashes } = mfa.generateRecoveryCodes();
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_recovery_hashes: hashes } }));
    return res.json({ recovery_codes: codes });
  } catch (error) {
    return fail(res, error);
  }
};

// The signed-in user's own name and phone. Email stays as it is (it is the login).
exports.updateProfile = async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.trim() : '';
    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Name must be 2 to 80 characters' });
    if (phone && !/^\+?[0-9 ()-]{7,20}$/.test(phone)) return res.status(400).json({ error: 'Enter a valid phone number' });
    await sys(() => Users.updateOne({ id: req.user.id }, { $set: { name, phone: phone || null, updated_at: new Date() } }));
    await audit.record(audit.EVENTS.PROFILE_UPDATED, { tenantId: req.user.tenant_id ?? null, req, targetType: 'user', targetId: req.user.id });
    return res.json({ success: true, user: { ...req.user, name, phone: phone || null } });
  } catch (error) {
    return fail(res, error);
  }
};

exports.me = async (req, res) => {
  try {
    const fresh = await sys(() => Users.findOne({ id: req.user.id }, { _id: 0 }).lean());
    const lifecycle = req.lifecycle;
    return res.json({
      ...req.user,
      mfa_enabled: mfa.hasMfa(fresh),
      mfa_methods: mfa.methodsOf(fresh),
      recovery_codes_left: fresh?.mfa_recovery_hashes?.length || 0,
      last_login: fresh?.last_login || null,
      workspace: lifecycle ? { id: lifecycle.tenant.id, name: lifecycle.tenant.name, state: lifecycle.state, access: lifecycle.access } : null,
    });
  } catch (error) {
    return fail(res, error);
  }
};

exports.changePassword = async (req, res) => {
  try {
    const current = req.body?.current ?? req.body?.current_password;
    const next = req.body?.newPassword ?? req.body?.new_password;
    const user = await sys(() => Users.findOne({ id: req.user.id }, { _id: 0 }).lean());
    if (!user || typeof current !== 'string' || !(await bcrypt.compare(current, user.password_hash || ''))) {
      return res.status(400).json({ error: 'Current password incorrect' });
    }
    const problem = passwordProblem(next, user.email);
    if (problem) return res.status(400).json({ error: problem });
    const password_hash = await bcrypt.hash(next, 12);
    const updated = await sys(() => Users.findOneAndUpdate(
      { id: user.id },
      { $set: { password_hash, password_changed_at: new Date() }, $inc: { token_version: 1 } },
      { new: true, projection: { _id: 0 } },
    ).lean());
    await audit.record(audit.EVENTS.PASSWORD_CHANGED, { tenantId: user.tenant_id ?? null, req, targetType: 'user', targetId: user.id });
    // Every other session is revoked; this one gets a fresh token. A signed-in
    // user with MFA enabled has already passed it in this session.
    return res.json({ success: true, token: issueAccessToken(updated, { mfa: mfa.hasMfa(updated) }) });
  } catch (error) {
    return fail(res, error);
  }
};

exports.logoutAll = async (req, res) => {
  try {
    await sys(() => Users.updateOne({ id: req.user.id }, { $inc: { token_version: 1 } }));
    await audit.record(audit.EVENTS.SESSIONS_REVOKED, { tenantId: req.user.tenant_id, req, targetType: 'user', targetId: req.user.id, meta: { self: true } });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
};

// Always answers the same way, whether or not the email exists.
exports.forgotPassword = async (req, res) => {
  const answer = { success: true, message: 'If an account exists for that email, a reset link has been sent.' };
  try {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.json(answer);
    const user = await sys(() => Users.findOne({ email, is_active: { $ne: false } }, { _id: 0 }).lean());
    if (!user) return res.json(answer);
    const token = crypto.randomBytes(32).toString('base64url');
    await sys(() => Users.updateOne({ id: user.id }, {
      $set: { reset_token_hash: sha256(token), reset_token_expires_at: new Date(Date.now() + RESET_TTL_MINUTES * 60000) },
    }));
    const base = describeUser(user).kind === 'staff' ? notify.adminUrl() : notify.appUrl();
    await notify.passwordResetEmail({ to: user.email, name: user.name, url: `${base}/reset-password/${token}`, expiresMinutes: RESET_TTL_MINUTES })
      .catch((error) => console.error('[account] Reset email not sent:', error.message));
    return res.json(answer);
  } catch (error) {
    console.error('[account] forgot-password:', error.message);
    return res.json(answer);
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (!token || typeof token !== 'string') return res.status(400).json({ error: 'Reset link is not valid' });
    const user = await sys(() => Users.findOne({ reset_token_hash: sha256(token) }, { _id: 0 }).lean());
    if (!user || !user.reset_token_expires_at || new Date(user.reset_token_expires_at) <= new Date()) {
      return res.status(410).json({ error: 'This reset link is not valid or has expired' });
    }
    const problem = passwordProblem(password, user.email);
    if (problem) return res.status(400).json({ error: problem });
    const password_hash = await bcrypt.hash(password, 12);
    // Conditional on the same token hash: the link works only once.
    const result = await sys(() => Users.updateOne(
      { id: user.id, reset_token_hash: sha256(token), reset_token_expires_at: { $gt: new Date() } },
      {
        $set: { password_hash, password_changed_at: new Date(), failed_login_count: 0 },
        $unset: { reset_token_hash: '', reset_token_expires_at: '', locked_until: '' },
        $inc: { token_version: 1 },
      },
    ));
    if (result.modifiedCount !== 1) return res.status(410).json({ error: 'This reset link is not valid or has expired' });
    await audit.record(audit.EVENTS.PASSWORD_RESET, { tenantId: user.tenant_id ?? null, actor: { actor_type: 'user', actor_user_id: user.id }, targetType: 'user', targetId: user.id });
    return res.json({ success: true });
  } catch (error) {
    return fail(res, error);
  }
};

exports.previewInvitation = async (req, res) => {
  try {
    return res.json({ invitation: await invitations.previewInvitation(req.params.token) });
  } catch (error) {
    return fail(res, error);
  }
};

exports.acceptInvitation = async (req, res) => {
  try {
    const { token, name, password, phone } = req.body || {};
    const user = await invitations.acceptInvitation({ token, name, password, phone });
    return res.status(201).json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
      welcome_email_sent: user.welcome_delivery ? user.welcome_delivery.delivered !== false : undefined,
    });
  } catch (error) {
    return fail(res, error);
  }
};
