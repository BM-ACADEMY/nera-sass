/**
 * Reopening a started two-step setup after a page reload
 * (POST /api/auth/mfa/setup/resume): only the signed-in session that started
 * it, only behind a live confirmation, the same authenticator key and the code
 * already sent, nothing new sent and no other limit used up.
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
  process.env.MFA_EXTRA_METHODS_ENABLED = 'true';
  process.env.WHATSAPP_OTP_TEMPLATE_APPROVED = 'true';
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = 'test-phone-id';
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'test-token';
  delete process.env.MFA_REQUIRED_TENANT_ROLES;
  await startTestDb();
  ({ app } = require('../server'));
  require('../services/platformInbox').sendAuthCode = async ({ to, payload }) => {
    sent.push({ to, code: payload.template.components[0].parameters[0].text });
    return { wa_message_id: 'wamid.test' };
  };
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
  sent.length = 0;
  require('../services/whatsappOtp').resetSendCapForTests();
  require('../routes/authRoutes').resetLimitsForTests();
});

test('reopening a started two-step setup', async (t) => {
  const { Users, Tenants, UserSessions } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const customer = async (fields = {}) => {
    if (!(await sys(() => Tenants.exists({ id: 10 })))) await sys(() => Tenants.create({ id: 10, name: 'Workspace 10', status: 'active' }));
    return (await sys(() => Users.create({
      email: `resume${(seq += 1)}@example.com`, name: 'Member', password_hash: bcrypt.hashSync(PASSWORD, 4),
      is_active: true, token_version: 0, tenant_id: 10, role: 'owner', ...fields,
    }))).toObject();
  };
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());
  const post = (path, token, body = {}) => {
    const r = request(app).post(`/api/auth${path}`);
    if (token) r.set({ Authorization: `Bearer ${token}` });
    return r.send(body);
  };
  const resume = (token, method) => post('/mfa/setup/resume', token, { method });
  const signIn = async (user) => (await post('/login', null, { email: user.email, password: PASSWORD })).body.token;
  const confirmAdd = (token) => post('/mfa/step-up', token, { password: PASSWORD, purpose: 'add' });
  // Signed in with a live "adding" confirmation.
  const ready = async (fields) => {
    const user = await customer(fields);
    const token = await signIn(user);
    assert.strictEqual((await confirmAdd(token)).status, 200);
    return { user, token };
  };
  const lastMail = () => /Code: (\d{6})/.exec([...notify.outbox()].reverse().find((m) => /Code: \d{6}/.test(m.text))?.text || '')?.[1];
  const expireGrant = (user) => sys(() => UserSessions.updateMany({ user_id: user.id }, { $set: { stepup_until: new Date(Date.now() - 1000) } }));

  await t.test('R1. Authenticator: the same key comes back and still confirms', async () => {
    const { token } = await ready();
    const start = await post('/mfa/setup', token);
    for (let i = 0; i < 3; i += 1) {
      const again = await resume(token, 'totp');
      assert.strictEqual(again.status, 200, JSON.stringify(again.body));
      assert.strictEqual(again.body.pending, true);
      assert.strictEqual(again.body.secret, start.body.secret);
      assert.strictEqual(again.body.otpauth_url, start.body.otpauth_url);
      assert.strictEqual(again.headers['cache-control'], 'no-store');
    }
    assert.strictEqual(notify.outbox().length + sent.length, 0);
    const done = await post('/mfa/setup/confirm', token, { code: mfa.totp(start.body.secret) });
    assert.strictEqual(done.status, 200, JSON.stringify(done.body));
    const after = await resume(done.body.token, 'totp');
    assert.strictEqual(after.status, 409);
    assert.strictEqual(after.body.code, 'MFA_ALREADY_ON');
    assert.strictEqual(after.body.secret, undefined);
  });

  await t.test('R2. Needs a live confirmation; with a new one the key is still the same', async () => {
    const { user, token } = await ready();
    const start = await post('/mfa/setup', token);
    await expireGrant(user);
    const refused = await resume(token, 'totp');
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.code, 'PASSWORD_REQUIRED');
    assert.strictEqual(refused.body.secret, undefined);
    assert.strictEqual((await post('/mfa/setup/resume', token, { method: 'totp', password: PASSWORD })).status, 403, 'a password in this request is not a confirmation');
    await confirmAdd(token);
    assert.strictEqual((await resume(token, 'totp')).body.secret, start.body.secret);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { locked_until: new Date(Date.now() + 60000) } }));
    assert.strictEqual((await resume(token, 'totp')).status, 403, 'locked');
    assert.strictEqual((await resume(null, 'totp')).status, 401);
    assert.strictEqual((await resume(makeToken(user), 'totp')).status, 403, 'a token without a tracked session');
    assert.strictEqual((await resume(token, 'constructor')).status, 400);
  });

  await t.test('R3. Only the session that started the setup can reopen it', async () => {
    const { user, token } = await ready();
    await post('/mfa/setup', token);
    const second = await signIn(user);
    await confirmAdd(second);
    const other = await resume(second, 'totp');
    assert.deepStrictEqual(other.body, { pending: false });
    const stranger = await ready();
    assert.deepStrictEqual((await resume(stranger.token, 'totp')).body, { pending: false });
    // The second session starts its own: the first one no longer gets a key.
    await post('/mfa/setup', second);
    assert.deepStrictEqual((await resume(token, 'totp')).body, { pending: false });
  });

  await t.test('R4. With two-step on, reopening lets the confirm step through again; a setup it did not start does not', async () => {
    const secret = mfa.generateSecret();
    const user = await customer({ mfa_enabled: true, mfa_secret_enc: encrypt(secret) });
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const token = (await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(secret) })).body.token;
    await confirmAdd(token);
    // Planted: a pending number and nothing saying this session started it.
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_whatsapp_pending_number: '919000000001' } }));
    assert.deepStrictEqual((await resume(token, 'whatsapp')).body, { pending: false });
    assert.strictEqual((await fresh(user.id)).mfa_stepup_until, undefined);

    assert.strictEqual((await post('/mfa/email/setup', token)).status, 200);
    const code = lastMail();
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_stepup_until: new Date(Date.now() - 1000) } }));
    assert.strictEqual((await post('/mfa/email/setup/confirm', token, { code })).body.code, 'MFA_CODE_REQUIRED');
    assert.strictEqual((await resume(token, 'email')).body.pending, true);
    assert.strictEqual((await post('/mfa/email/setup/confirm', token, { code })).status, 200);
  });

  await t.test('R5. Email: no new mail, the same code, time left; nothing once it is used up or old', async () => {
    const { user, token } = await ready();
    await post('/mfa/email/setup', token);
    const code = lastMail();
    const mails = notify.outbox().length;
    const before = await fresh(user.id);
    const again = await resume(token, 'email');
    assert.strictEqual(again.body.pending, true);
    assert.ok(again.body.expires_in > 590 && again.body.expires_in <= 600);
    assert.ok(again.body.resend_after > 0 && again.body.resend_after <= 45);
    assert.match(again.body.sent_to, /\*/);
    assert.ok(!JSON.stringify(again.body).includes(code));
    assert.strictEqual(notify.outbox().length, mails);
    const after = await fresh(user.id);
    assert.strictEqual(after.mfa_email_code_hash, before.mfa_email_code_hash);
    assert.strictEqual(String(after.mfa_email_code_expires_at), String(before.mfa_email_code_expires_at));
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_email_code_attempts: 5 } }));
    assert.deepStrictEqual((await resume(token, 'email')).body, { pending: false });
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_email_code_attempts: 0, mfa_email_code_expires_at: new Date(Date.now() - 1000) } }));
    assert.deepStrictEqual((await resume(token, 'email')).body, { pending: false });
    assert.strictEqual(notify.outbox().length, mails);
  });

  await t.test('R6. WhatsApp: nothing sent, number masked, the code still confirms', async () => {
    const { user, token } = await ready({ mfa_enabled: false, mfa_email_enabled: false });
    const none = await resume(token, 'whatsapp');
    assert.strictEqual(none.body.code, 'WHATSAPP_NEEDS_PRIMARY');
    await post('/mfa/email/setup', token);
    const on = await post('/mfa/email/setup/confirm', token, { code: lastMail() });
    const next = on.body.token;
    await post('/mfa/whatsapp/setup', next, { phone: '9876543210' });
    const buckets = require('../services/whatsappOtp').sendBucketsForTests().join();
    const again = await resume(next, 'whatsapp');
    assert.strictEqual(again.body.pending, true, JSON.stringify(again.body));
    assert.ok(again.body.sent_to.endsWith('3210') && !again.body.sent_to.includes('98765'));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(require('../services/whatsappOtp').sendBucketsForTests().join(), buckets);
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, undefined);
    assert.strictEqual((await post('/mfa/whatsapp/setup/confirm', next, { code: sent[0].code })).status, 200);
  });

  await t.test('R7. A setup older than an hour is not reopened', async () => {
    const { user, token } = await ready();
    await post('/mfa/setup', token);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_totp_setup_at: new Date(Date.now() - 61 * 60000) } }));
    assert.deepStrictEqual((await resume(token, 'totp')).body, { pending: false });
  });

  await t.test('R8. Reloading does not use up the limits of the other two-step requests', async () => {
    const { token } = await ready();
    await post('/mfa/setup', token);
    require('../routes/authRoutes').resetLimitsForTests();
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      for (let i = 0; i < 60; i += 1) assert.strictEqual((await resume(token, 'totp')).status, 200);
      assert.strictEqual((await confirmAdd(token)).status, 200);
      assert.strictEqual((await post('/mfa/setup', token)).status, 200);
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });
});
