/**
 * Security fixes:
 *  H1. Adding a two-step method, turning one off or replacing recovery codes
 *      with a normal session needs the current password, plus a current code
 *      when two-step verification is already on (403, never 401). Forced
 *      enrolment right after the password at login (mfa_setup token) is
 *      unchanged.
 *  R.  POST /api/admin/users/:id/reset-mfa: ops may reset customer users
 *      only; a staff account needs the founder; nobody resets their own.
 *  M2. Parallel wrong logins still lock the account (atomic counter).
 *  M3. Signed-in password prompts (change password, 2FA changes) are counted
 *      the same way, refused while locked, and /change-password is rate limited.
 *  Mail: the owner is emailed when a 2FA method is added or removed.
 * In-memory MongoDB; mail goes to the in-memory outbox.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'true';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
});

test('2FA changes need re-authentication; reset-mfa respects staff roles', async (t) => {
  const { Users, Tenants, AuditEvents } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const makeUser = async (fields = {}) => (await sys(() => Users.create({
    email: `user${(seq += 1)}-${Math.random().toString(36).slice(2, 7)}@example.com`, name: 'Person',
    password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const tenantUser = async (fields = {}) => {
    if (!(await sys(() => Tenants.exists({ id: 10 })))) await sys(() => Tenants.create({ id: 10, name: 'Workspace 10', status: 'active' }));
    return makeUser({ tenant_id: 10, role: 'agent', ...fields });
  };
  const staff = (role, fields = {}) => makeUser({ tenant_id: null, is_platform_staff: true, staff_role: role, ...fields });
  const auth = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());
  const lastCode = () => /Code: (\d{6})/.exec(notify.outbox().at(-1)?.text || '')?.[1];
  const withApp = (secret, fields = {}) => ({ mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')], ...fields });

  await t.test('H1. Session enrolment (app) is refused without the password or with a wrong one; the right one works', async () => {
    const user = await tenantUser();
    const none = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({});
    assert.strictEqual(none.status, 403);
    assert.strictEqual(none.body.code, 'PASSWORD_REQUIRED');
    const wrong = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: 'not-my-password' });
    assert.strictEqual(wrong.status, 403);
    assert.strictEqual(wrong.body.code, 'PASSWORD_INCORRECT');
    assert.strictEqual((await fresh(user.id)).mfa_pending_secret_enc, undefined, 'nothing started');

    const start = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const noPass = await request(app).post('/api/auth/mfa/setup/confirm').set(auth(user)).send({ code: mfa.totp(start.body.secret) });
    assert.strictEqual(noPass.status, 403, 'confirm also needs the password');
    assert.strictEqual(noPass.body.code, 'PASSWORD_REQUIRED');
    const badPass = await request(app).post('/api/auth/mfa/setup/confirm').set(auth(user)).send({ password: 'nope', code: mfa.totp(start.body.secret) });
    assert.strictEqual(badPass.body.code, 'PASSWORD_INCORRECT');
    assert.strictEqual((await fresh(user.id)).mfa_enabled ?? false, false);

    const ok = await request(app).post('/api/auth/mfa/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: mfa.totp(start.body.secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.recovery_codes.length, 10);
    assert.strictEqual((await fresh(user.id)).mfa_enabled, true);
    const mail = notify.outbox().at(-1);
    assert.strictEqual(mail.to, user.email);
    assert.match(mail.subject, /Two-step verification added/, 'the owner is told about the new method');
  });

  await t.test('H1. Session enrolment (email) is refused without / with a wrong password; the right one works', async () => {
    const user = await tenantUser();
    const none = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({});
    assert.strictEqual(none.status, 403);
    assert.strictEqual(none.body.code, 'PASSWORD_REQUIRED');
    const wrong = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: 'wrong-one' });
    assert.strictEqual(wrong.body.code, 'PASSWORD_INCORRECT');
    assert.strictEqual(notify.outbox().length, 0, 'no code mailed');

    const start = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const noPass = await request(app).post('/api/auth/mfa/email/setup/confirm').set(auth(user)).send({ code: lastCode() });
    assert.strictEqual(noPass.status, 403);
    assert.strictEqual(noPass.body.code, 'PASSWORD_REQUIRED');
    const ok = await request(app).post('/api/auth/mfa/email/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: lastCode() });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.recovery_codes.length, 10);
  });

  await t.test('H1. With two-step already on, adding a method needs a current code too', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret));
    const noCode = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(noCode.status, 403);
    assert.strictEqual(noCode.body.code, 'MFA_CODE_REQUIRED');
    const wrongCode = mfa.totp(secret) === '000000' ? '111111' : '000000';
    const badCode = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: PASSWORD, code: wrongCode });
    assert.strictEqual(badCode.status, 403);
    assert.strictEqual(badCode.body.code, 'MFA_CODE_INCORRECT');
    const badPassGoodCode = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: 'wrong', code: mfa.totp(secret) });
    assert.strictEqual(badPassGoodCode.body.code, 'PASSWORD_INCORRECT');
    assert.strictEqual(notify.outbox().length, 0, 'no setup code mailed');

    const start = await request(app).post('/api/auth/mfa/email/setup').set(auth(user)).send({ password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const ok = await request(app).post('/api/auth/mfa/email/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: lastCode() });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.recovery_codes, undefined, 'existing recovery codes are kept');
    assert.deepStrictEqual(mfa.methodsOf(await fresh(user.id)).sort(), ['email', 'totp']);
    assert.strictEqual((await fresh(user.id)).mfa_stepup_until, undefined, 'step-up used up');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'MFA_ENROLLED', target_id: String(user.id) })));
  });

  await t.test('H1. Email-only account adds the app with an emailed confirmation code', async () => {
    const user = await staff('founder', { mfa_email_enabled: true, mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')] });
    const sent = await request(app).post('/api/auth/mfa/reauth/email/send').set(auth(user)).send({});
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
    assert.match(notify.outbox().at(-1).subject, /security change/i);
    const start = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: PASSWORD, code_method: 'email', code: lastCode() });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const ok = await request(app).post('/api/auth/mfa/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: mfa.totp(start.body.secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await fresh(user.id)).mfa_enabled, true);
  });

  await t.test('H1. A recovery code works as the current code and is used up', async () => {
    const user = await staff('founder', { mfa_email_enabled: true, mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')] });
    const res = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, recovery_code: 'RECOV-ERY1' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const again = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, recovery_code: 'RECOV-ERY1' });
    assert.strictEqual(again.status, 403);
    assert.strictEqual(again.body.code, 'MFA_CODE_INCORRECT');
  });

  await t.test('H1. With two-step on, confirm is refused when the setup was not started with a code', async () => {
    const pending = mfa.generateSecret();
    // A pending secret left over from before (or planted): password alone must not finish it.
    const user = await staff('ops', { mfa_email_enabled: true, mfa_pending_secret_enc: encrypt(pending) });
    const res = await request(app).post('/api/auth/mfa/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: mfa.totp(pending) });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'MFA_CODE_REQUIRED');
    assert.strictEqual((await fresh(user.id)).mfa_enabled ?? false, false);
  });

  await t.test('H1. Turning a method off and new recovery codes need the password and a current code', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret, { mfa_email_enabled: true }));
    const noPass = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({});
    assert.strictEqual(noPass.status, 403);
    assert.strictEqual(noPass.body.code, 'PASSWORD_REQUIRED');
    const noCode = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(noCode.status, 403);
    assert.strictEqual(noCode.body.code, 'MFA_CODE_REQUIRED');
    const codes = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(codes.status, 200, JSON.stringify(codes.body));
    assert.strictEqual(codes.body.recovery_codes.length, 10);

    const offNoCode = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'email', password: PASSWORD });
    assert.strictEqual(offNoCode.status, 403);
    assert.strictEqual(offNoCode.body.code, 'MFA_CODE_REQUIRED');
    assert.strictEqual((await fresh(user.id)).mfa_email_enabled, true);
    const off = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'email', password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.deepStrictEqual(off.body.mfa_methods, ['totp']);
    assert.match(notify.outbox().at(-1).subject, /Two-step verification removed/);
  });

  await t.test('H1. Refusals are 403 and keep the session', async () => {
    const user = await tenantUser();
    const token = auth(user);
    await request(app).post('/api/auth/mfa/setup').set(token).send({ password: 'wrong' });
    assert.strictEqual((await request(app).get('/api/auth/me').set(token)).status, 200);
  });

  await t.test('H1. Forced enrolment at login (mfa_setup token) still works without a password', async () => {
    const user = await staff('ops');
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    assert.strictEqual(login.body.mfa_setup_required, true, JSON.stringify(login.body));
    const start = await request(app).post('/api/auth/mfa/setup').send({ mfa_token: login.body.mfa_token });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const confirm = await request(app).post('/api/auth/mfa/setup/confirm').send({ mfa_token: login.body.mfa_token, code: mfa.totp(start.body.secret) });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    assert.ok(confirm.body.token);
    assert.strictEqual(confirm.body.recovery_codes.length, 10);
  });

  // ── reset-mfa ─────────────────────────────────────────────
  const reset = (actor, target) => request(app).post(`/api/admin/users/${target.id}/reset-mfa`).set(auth(actor)).send({});
  const mfaOn = (u) => fresh(u.id).then((x) => mfa.methodsOf(x).length > 0);

  await t.test('R. Ops cannot reset 2FA of the founder or other staff; can for a customer user', async () => {
    const founder = await staff('founder', { mfa_email_enabled: true });
    const ops = await staff('ops', { mfa_email_enabled: true });
    const otherOps = await staff('ops', { mfa_email_enabled: true });
    const customer = await tenantUser({ mfa_email_enabled: true });

    for (const target of [founder, otherOps]) {
      const res = await reset(ops, target);
      assert.strictEqual(res.status, 403, `ops on ${target.staff_role}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(await mfaOn(target), true, 'unchanged');
    }
    const self = await reset(ops, ops);
    assert.strictEqual(self.status, 403, 'not their own');
    assert.strictEqual(await mfaOn(ops), true);

    const ok = await reset(ops, customer);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(await mfaOn(customer), false);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'MFA_RESET', target_id: String(customer.id) })), 'audited');
    assert.ok(notify.outbox().some((m) => m.to === customer.email && /removed/.test(m.subject)), 'the customer is told');
  });

  // ── Lockout ───────────────────────────────────────────────
  await t.test('M2. Ten parallel wrong logins lock the account', async () => {
    const user = await tenantUser();
    const results = await Promise.all(Array.from({ length: 10 }, () => request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-password' })));
    assert.ok(results.every((r) => [401, 423].includes(r.status)), results.map((r) => r.status).join(','));
    const stored = await fresh(user.id);
    assert.ok(stored.locked_until && new Date(stored.locked_until) > new Date(), 'locked');
    const right = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    assert.strictEqual(right.status, 423, 'even the right password is refused while locked');
    assert.strictEqual(right.body.code, 'ACCOUNT_LOCKED');
    assert.strictEqual(await sys(() => AuditEvents.countDocuments({ event: 'LOGIN_FAILED_LOCKOUT', target_id: String(user.id) })), 1, 'one lockout record');
  });

  await t.test('M3. Change password: wrong attempts count, lock the account, and are refused while locked', async () => {
    const user = await tenantUser();
    const change = (current) => request(app).post('/api/auth/change-password').set(auth(user)).send({ current, newPassword: 'Brand-New-Pass-9' });
    for (let i = 1; i <= 4; i += 1) {
      const r = await change('wrong');
      assert.strictEqual(r.status, 400);
      assert.strictEqual((await fresh(user.id)).failed_login_count, i, 'counted like a login');
    }
    const fifth = await change('wrong');
    assert.strictEqual(fifth.status, 423);
    const right = await change(PASSWORD);
    assert.strictEqual(right.status, 423, 'refused while locked');
    assert.strictEqual((await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD })).status, 423, 'login is locked too');
    assert.strictEqual((await request(app).get('/api/auth/me').set(auth(user))).status, 200, 'the session itself stays');
  });

  await t.test('M3. A correct password resets the counter; 2FA prompts count too and respect the lock', async () => {
    const user = await tenantUser();
    await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: 'wrong' });
    await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: 'wrong' });
    assert.strictEqual((await fresh(user.id)).failed_login_count, 2, '2FA password prompts are counted');
    const ok = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual((await fresh(user.id)).failed_login_count, 0, 'reset on success');
    await sys(() => Users.updateOne({ id: user.id }, { $set: { locked_until: new Date(Date.now() + 60000) } }));
    const locked = await request(app).post('/api/auth/mfa/setup').set(auth(user)).send({ password: PASSWORD });
    assert.strictEqual(locked.status, 423);
    assert.strictEqual(locked.body.code, 'ACCOUNT_LOCKED');
  });

  await t.test('Review 1. A correct password does not clear a lock set after the user copy was read', async () => {
    const passwordAttempts = require('../services/passwordAttempts');
    const user = await tenantUser();
    const stale = await fresh(user.id); // read before the lock, as a parallel request would
    await sys(() => Users.updateOne({ id: user.id }, { $set: { locked_until: new Date(Date.now() + 10 * 60000) } }));
    const check = await passwordAttempts.checkPassword(stale, PASSWORD);
    assert.strictEqual(check.result, 'locked');
    assert.ok((await fresh(user.id)).locked_until, 'the lock stays');
  });

  await t.test('Review 2. The mfa_setup token stops working once a method is on', async () => {
    const user = await staff('ops');
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    const token = login.body.mfa_token;
    const start = await request(app).post('/api/auth/mfa/email/setup').send({ mfa_token: token });
    assert.strictEqual(start.status, 200);
    const confirm = await request(app).post('/api/auth/mfa/email/setup/confirm').send({ mfa_token: token, code: lastCode() });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    const second = await request(app).post('/api/auth/mfa/setup').send({ mfa_token: token });
    assert.strictEqual(second.status, 401, 'no second method without a current code');
    assert.strictEqual(second.body.code, 'MFA_SETUP_DONE');
  });

  await t.test('Review 3. An email code is accepted once even when sent twice in parallel; wrong tries stop at five', async () => {
    const emailOtp = require('../services/emailOtp');
    const user = await staff('ops', { mfa_email_enabled: true });
    await emailOtp.sendCode(user, 'login');
    const code = lastCode();
    const results = await Promise.all([emailOtp.verifyCode(user, code, 'login'), emailOtp.verifyCode(user, code, 'login')]);
    assert.strictEqual(results.filter(Boolean).length, 1, 'accepted exactly once');

    await sys(() => Users.updateOne({ id: user.id }, { $unset: { mfa_email_code_sent_at: '' } }));
    await emailOtp.sendCode(await fresh(user.id), 'login');
    const right = lastCode();
    const wrong = right === '000000' ? '111111' : '000000';
    await Promise.all(Array.from({ length: 12 }, () => emailOtp.verifyCode(user, wrong, 'login')));
    const after = await fresh(user.id);
    assert.ok(!after.mfa_email_code_hash, 'cleared after five wrong tries');
    assert.strictEqual(await emailOtp.verifyCode(user, right, 'login'), false);
  });

  await t.test('Review 4/5. Change password without the current one is 403 and not counted; new recovery codes are emailed', async () => {
    const user = await tenantUser();
    const res = await request(app).post('/api/auth/change-password').set(auth(user)).send({ newPassword: 'Brand-New-Pass-9' });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'PASSWORD_REQUIRED');
    assert.strictEqual((await fresh(user.id)).failed_login_count || 0, 0);

    const secret = mfa.generateSecret();
    const withApp2 = await staff('ops', withApp(secret));
    const codes = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(withApp2)).send({ password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(codes.status, 200);
    assert.match(notify.outbox().at(-1).subject, /New recovery codes/);
  });

  await t.test('Review 6. Re-auth while code checks are locked: wrong recovery codes count, a right password does not reset them', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret, { mfa_code_locked_until: new Date(Date.now() + 60 * 60000) }));
    const post = (body) => request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, ...body });
    const appCode = await post({ code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(appCode.status, 429);
    assert.strictEqual(appCode.body.code, 'MFA_CODE_LOCKED');
    assert.ok(!(await fresh(user.id)).failed_login_count, 'a locked app code is not a password failure');
    for (let i = 0; i < 4; i += 1) {
      const r = await post(i % 2 ? { recovery_code: 'AAAAA-AAAAA' } : { code_method: 'totp', code: '123456', recovery_code: 'AAAAA-AAAAA' });
      assert.strictEqual(r.status, i % 2 ? 403 : 429, JSON.stringify(r.body));
    }
    assert.strictEqual((await fresh(user.id)).failed_login_count, 4, 'counted although each request had the right password');
    const fifth = await post({ recovery_code: 'AAAAA-AAAAA' });
    assert.strictEqual(fifth.status, 423);
    assert.strictEqual(fifth.body.code, 'ACCOUNT_LOCKED');
  });

  await t.test('Review 6. Re-auth resets the password counter only after the code passed', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret, { failed_login_count: 2 }));
    const wrong = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) === '123456' ? '654321' : '123456' });
    assert.strictEqual(wrong.body.code, 'MFA_CODE_INCORRECT');
    assert.strictEqual((await fresh(user.id)).failed_login_count, 2, 'a right password with a wrong code does not reset');
    const ok = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await fresh(user.id)).failed_login_count, 0);
  });

  await t.test('Review 6. Login second step while code checks are locked: wrong recovery codes lock the account', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret));
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    assert.ok(login.body.mfa_token, JSON.stringify(login.body));
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_code_locked_until: new Date(Date.now() + 60 * 60000) } }));
    const verify = (body) => request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, ...body });
    for (let i = 0; i < 4; i += 1) assert.strictEqual((await verify({ code: '123456', recovery_code: 'AAAAA-AAAAA' })).status, 429);
    const fifth = await verify({ recovery_code: 'AAAAA-AAAAA' });
    assert.strictEqual(fifth.status, 423);
    assert.strictEqual(fifth.body.code, 'ACCOUNT_LOCKED');
    // The same mfa token cannot finish the sign-in while the account is locked,
    // even with a right authenticator code.
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_code_locked_until: null } }));
    const right = await verify({ code: mfa.totp(secret) });
    assert.strictEqual(right.status, 423, JSON.stringify(right.body));
    assert.strictEqual(right.body.code, 'ACCOUNT_LOCKED');
  });

  await t.test('Review 7. A finished login second step clears failures counted during it', async () => {
    const secret = mfa.generateSecret();
    const user = await staff('ops', withApp(secret));
    const login = await request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
    assert.ok(login.body.mfa_token, JSON.stringify(login.body));
    await sys(() => Users.updateOne({ id: user.id }, { $set: { failed_login_count: 2 } }));
    const ok = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, code: mfa.totp(secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const after = await sys(() => Users.findOne({ id: user.id }, { _id: 0, failed_login_count: 1 }).lean());
    assert.strictEqual(after.failed_login_count || 0, 0);
  });

  await t.test('M3. /change-password has a per-account rate limit', async () => {
    const user = await tenantUser();
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      const statuses = [];
      for (let i = 0; i < 21; i += 1) {
        statuses.push((await request(app).post('/api/auth/change-password').set(auth(user)).send({ current: 'wrong', newPassword: 'Brand-New-Pass-9' })).status);
      }
      assert.ok(statuses.slice(0, 20).every((s) => s !== 429), statuses.join(','));
      assert.strictEqual(statuses[20], 429, 'the 21st request in 15 minutes is refused');
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });

  await t.test('R. The founder can reset a staff account, but not their own', async () => {
    const founder = await staff('founder', { mfa_email_enabled: true });
    const ops = await staff('ops', { mfa_email_enabled: true });
    const ok = await reset(founder, ops);
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(await mfaOn(ops), false);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'MFA_RESET', target_id: String(ops.id) })));
    const self = await reset(founder, founder);
    assert.strictEqual(self.status, 403);
    assert.strictEqual(await mfaOn(founder), true);
  });
});
