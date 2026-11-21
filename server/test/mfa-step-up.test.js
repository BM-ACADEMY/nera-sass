/**
 * Security fixes:
 *  H1. Adding a two-step method, turning one off or replacing recovery codes
 *      with a normal session needs the current password, plus a current code
 *      when two-step verification is already on (403, never 401). Forced
 *      enrolment right after the password at login (mfa_setup token) is
 *      unchanged.
 *  R.  POST /api/admin/users/:id/reset-mfa: ops may reset customer users
 *      only; a staff account needs the founder; nobody resets their own.
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
