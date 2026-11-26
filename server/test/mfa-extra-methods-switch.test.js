/**
 * MFA_EXTRA_METHODS_ENABLED: the production switch for the email-code and
 * WhatsApp-code two-step methods. Off (unset or anything but 'true'): only
 * the authenticator app can be set up; the email / WhatsApp setup routes
 * answer 403 MFA_METHOD_DISABLED and /api/auth/me and the first-login setup
 * step say so. People who already use email or WhatsApp codes still sign in
 * with them and can turn them off. On ('true'): the setup routes work.
 * In-memory MongoDB; mail goes to the in-memory outbox; the WhatsApp send is
 * mocked.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
const sent = [];
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.LOGIN_RATE_LIMIT = '1000';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'true';
  process.env.WHATSAPP_OTP_TEMPLATE_APPROVED = 'true';
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = 'test-phone-id';
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'test-token';
  delete process.env.MFA_EXTRA_METHODS_ENABLED;
  await startTestDb();
  ({ app } = require('../server'));
  const platformInbox = require('../services/platformInbox');
  platformInbox.sendAuthCode = async ({ to, payload }) => {
    sent.push({ to, code: payload.template.components[0].parameters[0].text });
    return { wa_message_id: 'wamid.test' };
  };
});

test.after(async () => {
  delete process.env.MFA_EXTRA_METHODS_ENABLED;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
  sent.length = 0;
  delete process.env.MFA_EXTRA_METHODS_ENABLED;
  require('../services/whatsappOtp').resetSendCapForTests();
  require('../routes/authRoutes').resetLimitsForTests();
});

test('MFA_EXTRA_METHODS_ENABLED switch', async (t) => {
  const { Users } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const staff = async (fields = {}) => (await sys(() => Users.create({
    email: `staff${(seq += 1)}@example.com`, name: 'Staff', password_hash: bcrypt.hashSync(PASSWORD, 4),
    is_active: true, token_version: 0, is_platform_staff: true, staff_role: 'founder', ...fields,
  }))).toObject();
  const auth = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const login = (user) => request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  const lastMail = () => /Code: (\d{6})/.exec(notify.outbox().at(-1)?.text || '')?.[1];
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());

  await t.test('X1. Only the exact value "true" turns the switch on', () => {
    for (const value of [undefined, '', 'false', 'TRUE', 'True', '1', 'yes', ' true']) {
      if (value === undefined) delete process.env.MFA_EXTRA_METHODS_ENABLED; else process.env.MFA_EXTRA_METHODS_ENABLED = value;
      assert.strictEqual(mfa.extraMethodsEnabled(), false, `value ${JSON.stringify(value)}`);
    }
    process.env.MFA_EXTRA_METHODS_ENABLED = 'true';
    assert.strictEqual(mfa.extraMethodsEnabled(), true);
  });

  await t.test('X2. Off: every email / WhatsApp setup route refuses with 403 MFA_METHOD_DISABLED; the app still sets up', async () => {
    // First login without a method (setup token).
    const user = await staff();
    const res = await login(user);
    assert.strictEqual(res.body.mfa_setup_required, true);
    assert.strictEqual(res.body.email_setup_available, false, 'the setup step offers no email code');
    assert.strictEqual(res.body.whatsapp_available, false, 'the setup step offers no WhatsApp code');
    const token = res.body.mfa_token;
    for (const [path, body] of [
      ['/api/auth/mfa/email/setup', { mfa_token: token }],
      ['/api/auth/mfa/email/setup/confirm', { mfa_token: token, code: '123456' }],
      ['/api/auth/mfa/whatsapp/setup', { mfa_token: token, phone: '+919876543210' }],
      ['/api/auth/mfa/whatsapp/setup/confirm', { mfa_token: token, code: '123456' }],
    ]) {
      const r = await request(app).post(path).send(body);
      assert.strictEqual(r.status, 403, `${path}: ${JSON.stringify(r.body)}`);
      assert.strictEqual(r.body.code, 'MFA_METHOD_DISABLED', path);
    }
    // Signed in (Settings) too.
    const signedIn = await staff({ mfa_enabled: true, mfa_secret_enc: encrypt(mfa.generateSecret()) });
    for (const path of ['/api/auth/mfa/email/setup', '/api/auth/mfa/whatsapp/setup']) {
      const r = await request(app).post(path).set(auth(signedIn)).send({ password: PASSWORD, phone: '+919876543210' });
      assert.strictEqual(r.status, 403, path);
      assert.strictEqual(r.body.code, 'MFA_METHOD_DISABLED', path);
    }
    assert.strictEqual(notify.outbox().length, 0, 'no setup code was mailed');
    assert.strictEqual(sent.length, 0, 'no setup code was sent on WhatsApp');
    const row = await fresh(user.id);
    assert.ok(!row.mfa_email_enabled && !row.mfa_whatsapp_enabled && !row.mfa_whatsapp_pending_number);

    // The authenticator app still works, with recovery codes.
    const start = await request(app).post('/api/auth/mfa/setup').send({ mfa_token: token });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const confirm = await request(app).post('/api/auth/mfa/setup/confirm').send({ mfa_token: token, code: mfa.totp(start.body.secret) });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    assert.strictEqual(confirm.body.recovery_codes.length, 10);
  });

  await t.test('X3. Off: /api/auth/me reports the extra methods unavailable', async () => {
    const user = await staff({ mfa_enabled: true, mfa_secret_enc: encrypt(mfa.generateSecret()) });
    const me = await request(app).get('/api/auth/me').set(auth(user));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.mfa_extra_methods_enabled, false);
    process.env.MFA_EXTRA_METHODS_ENABLED = 'true';
    const on = await request(app).get('/api/auth/me').set(auth(user));
    assert.strictEqual(on.body.mfa_extra_methods_enabled, true);
  });

  await t.test('X4. Off: people who already use email or WhatsApp codes sign in with them and can turn them off', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({
      mfa_email_enabled: true, mfa_whatsapp_enabled: true, mfa_whatsapp_number: '919876543210',
      mfa_enabled: true, mfa_secret_enc: encrypt(secret),
    });
    const res = await login(user);
    assert.strictEqual(res.body.mfa_required, true);
    assert.deepStrictEqual([...res.body.methods].sort(), ['email', 'totp', 'whatsapp']);
    // Email code sign-in.
    const mailed = await request(app).post('/api/auth/mfa/email/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(mailed.status, 200, JSON.stringify(mailed.body));
    const viaMail = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'email', code: lastMail() });
    assert.strictEqual(viaMail.status, 200, JSON.stringify(viaMail.body));
    assert.ok(viaMail.body.token);
    // WhatsApp code sign-in.
    const res2 = await login(user);
    const waSent = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res2.body.mfa_token });
    assert.strictEqual(waSent.status, 200, JSON.stringify(waSent.body));
    const viaWa = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res2.body.mfa_token, method: 'whatsapp', code: sent.at(-1).code });
    assert.strictEqual(viaWa.status, 200, JSON.stringify(viaWa.body));
    // Turning them off still works (password + a current code).
    const offEmail = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'email', password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(offEmail.status, 200, JSON.stringify(offEmail.body));
    const offWa = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'whatsapp', password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(offWa.status, 200, JSON.stringify(offWa.body));
    assert.deepStrictEqual(offWa.body.mfa_methods, ['totp']);
  });

  await t.test('X5. On: the email and WhatsApp setup routes work', async () => {
    process.env.MFA_EXTRA_METHODS_ENABLED = 'true';
    const user = await staff();
    const res = await login(user);
    assert.strictEqual(res.body.email_setup_available, true);
    assert.strictEqual(res.body.whatsapp_available, true);
    const start = await request(app).post('/api/auth/mfa/email/setup').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const confirm = await request(app).post('/api/auth/mfa/email/setup/confirm').send({ mfa_token: res.body.mfa_token, code: lastMail() });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    assert.deepStrictEqual(confirm.body.user.mfa_methods, ['email']);

    const other = await staff();
    const res2 = await login(other);
    const waStart = await request(app).post('/api/auth/mfa/whatsapp/setup').send({ mfa_token: res2.body.mfa_token, phone: '+919876543210' });
    assert.strictEqual(waStart.status, 200, JSON.stringify(waStart.body));
    const waConfirm = await request(app).post('/api/auth/mfa/whatsapp/setup/confirm').send({ mfa_token: res2.body.mfa_token, code: sent.at(-1).code });
    assert.strictEqual(waConfirm.status, 200, JSON.stringify(waConfirm.body));
  });
});
