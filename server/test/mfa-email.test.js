/**
 * Two-step verification by email code next to the authenticator app:
 * login with one or both methods, setup at first login and from settings,
 * turning a method off, and the profile endpoint. In-memory MongoDB; mail
 * goes to the in-memory outbox.
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

test('Email two-step verification', async (t) => {
  const { Users } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  const staff = async (fields = {}) => (await sys(() => Users.create({
    email: `admin${Math.random().toString(36).slice(2, 8)}@example.com`, name: 'Admin',
    password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0,
    is_platform_staff: true, staff_role: 'founder', ...fields,
  }))).toObject();
  const lastCode = () => {
    const mail = notify.outbox().at(-1);
    return mail && /Code: (\d{6})/.exec(mail.text)?.[1];
  };
  const login = (user) => request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());

  await t.test('E1. Email only: the code is mailed at login and signs in once; the stored code is a hash', async () => {
    const user = await staff({ mfa_email_enabled: true });
    const res = await login(user);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.mfa_required, true);
    assert.deepStrictEqual(res.body.methods, ['email']);
    assert.ok(res.body.email?.sent_to.includes('@example.com'));
    const code = lastCode();
    assert.match(code, /^\d{6}$/);
    assert.ok(!notify.outbox().at(-1).subject.includes(code), 'the code is not in the (logged) subject');
    const stored = await fresh(user.id);
    assert.ok(stored.mfa_email_code_hash && stored.mfa_email_code_hash !== code);

    const ok = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'email', code });
    assert.strictEqual(ok.status, 200);
    assert.ok(ok.body.token);
    const again = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'email', code });
    assert.strictEqual(again.status, 401, 'a code works once');
  });

  await t.test('E2. Five wrong codes clear the code; resend has a cooldown', async () => {
    const user = await staff({ mfa_email_enabled: true });
    const res = await login(user);
    const code = lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'email', code: wrong });
      assert.strictEqual(r.status, 401);
      assert.strictEqual(r.body.code, 'INVALID_MFA_CODE');
    }
    const late = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'email', code });
    assert.strictEqual(late.status, 401, 'the right code no longer works after five wrong tries');
    const resend = await request(app).post('/api/auth/mfa/email/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(resend.status, 429);
    assert.strictEqual(resend.body.code, 'OTP_RESEND_WAIT');
  });

  await t.test('E3. Both methods: nothing is mailed until asked; either method signs in', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({ mfa_email_enabled: true, mfa_enabled: true, mfa_secret_enc: encrypt(secret) });
    const res = await login(user);
    assert.deepStrictEqual(res.body.methods.sort(), ['email', 'totp']);
    assert.strictEqual(notify.outbox().length, 0);
    const app1 = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(app1.status, 200);

    const res2 = await login(user);
    const sent = await request(app).post('/api/auth/mfa/email/send').send({ mfa_token: res2.body.mfa_token });
    assert.strictEqual(sent.status, 200);
    const viaMail = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res2.body.mfa_token, method: 'email', code: lastCode() });
    assert.strictEqual(viaMail.status, 200);
  });

  await t.test('E4. First login without a method: set up email, get recovery codes and a session', async () => {
    const user = await staff();
    const res = await login(user);
    assert.strictEqual(res.body.mfa_setup_required, true);
    const start = await request(app).post('/api/auth/mfa/email/setup').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(start.status, 200);
    const confirm = await request(app).post('/api/auth/mfa/email/setup/confirm').send({ mfa_token: res.body.mfa_token, code: lastCode() });
    assert.strictEqual(confirm.status, 200);
    assert.ok(confirm.body.token);
    assert.strictEqual(confirm.body.recovery_codes.length, 10);
    assert.deepStrictEqual(confirm.body.user.mfa_methods, ['email']);
  });

  await t.test('E5. Settings: add the app, keep recovery codes, refuse removing the last method, require the password', async () => {
    const user = await staff({ mfa_email_enabled: true, mfa_recovery_hashes: ['x'] });
    const auth = { Authorization: `Bearer ${makeToken(user, { mfa: true })}` };
    const setup = await request(app).post('/api/auth/mfa/setup').set(auth).send({});
    assert.strictEqual(setup.status, 200);
    const confirm = await request(app).post('/api/auth/mfa/setup/confirm').set(auth).send({ code: mfa.totp(setup.body.secret) });
    assert.strictEqual(confirm.status, 200);
    assert.strictEqual(confirm.body.recovery_codes, undefined, 'existing recovery codes are kept');

    const me = await request(app).get('/api/auth/me').set(auth);
    assert.deepStrictEqual(me.body.mfa_methods, ['email', 'totp']);

    const badPass = await request(app).post('/api/auth/mfa/disable').set(auth).send({ method: 'email', password: 'wrong' });
    assert.strictEqual(badPass.status, 400);
    const offEmail = await request(app).post('/api/auth/mfa/disable').set(auth).send({ method: 'email', password: PASSWORD });
    assert.strictEqual(offEmail.status, 200);
    assert.deepStrictEqual(offEmail.body.mfa_methods, ['totp']);
    const last = await request(app).post('/api/auth/mfa/disable').set(auth).send({ method: 'totp', password: PASSWORD });
    assert.strictEqual(last.status, 400);
    assert.strictEqual(last.body.code, 'MFA_LAST_METHOD');
  });

  await t.test('E6. Profile: name and phone change; bad input is refused', async () => {
    const user = await staff({ mfa_email_enabled: true });
    const auth = { Authorization: `Bearer ${makeToken(user, { mfa: true })}` };
    const ok = await request(app).patch('/api/auth/profile').set(auth).send({ name: 'Aakash K', phone: '+91 98765 43210' });
    assert.strictEqual(ok.status, 200);
    const stored = await fresh(user.id);
    assert.strictEqual(stored.name, 'Aakash K');
    assert.strictEqual(stored.phone, '+91 98765 43210');
    const bad = await request(app).patch('/api/auth/profile').set(auth).send({ name: 'A' });
    assert.strictEqual(bad.status, 400);
    const noAuth = await request(app).patch('/api/auth/profile').send({ name: 'Someone' });
    assert.strictEqual(noAuth.status, 401);
  });
});
