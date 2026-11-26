/**
 * Adding a two-step method takes the password only (customers). What that
 * password-only confirmation must never do:
 *  - turn a method or two-step off, change the default or make new recovery
 *    codes (those need password and a current code);
 *  - let the added method produce that "current code": it is on hold for a day
 *    for the whole account, and does not become the default by itself;
 *  - replace a method that is on, mint recovery codes, or wipe counted
 *    failures.
 * Platform staff still give a current code to add a method.
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

test('adding a method with the password only', async (t) => {
  const { Users, Tenants, AuditEvents } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const makeUser = async (fields = {}) => (await sys(() => Users.create({
    email: `member${(seq += 1)}@example.com`, name: 'Member', password_hash: bcrypt.hashSync(PASSWORD, 4),
    is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const customer = async (fields = {}) => {
    if (!(await sys(() => Tenants.exists({ id: 10 })))) await sys(() => Tenants.create({ id: 10, name: 'Workspace 10', status: 'active' }));
    return makeUser({ tenant_id: 10, role: 'owner', ...fields });
  };
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());
  const post = (path, token, body = {}) => {
    const r = request(app).post(`/api${path.startsWith('/account') ? '' : '/auth'}${path}`);
    if (token) r.set({ Authorization: `Bearer ${token}` });
    return r.send(body);
  };
  const get = (path, token) => request(app).get(`/api${path}`).set({ Authorization: `Bearer ${token}` });
  const me = async (token) => (await get('/auth/me', token)).body;
  const lastMail = () => /Code: (\d{6})/.exec([...notify.outbox()].reverse().find((m) => /Code: \d{6}/.test(m.text))?.text || '')?.[1];
  const coolDown = (user) => sys(() => Users.updateOne({ id: user.id }, { $unset: { mfa_wa_code_sent_at: '', mfa_email_code_sent_at: '' } }));
  const wrongCode = (code) => (code === '000000' ? '111111' : '000000');

  // A customer with email codes on (the owner's method), signed in.
  const ownerWithEmail = async (fields = {}) => {
    const user = await customer({ mfa_email_enabled: true, mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')], ...fields });
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const done = await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'email', code: lastMail() });
    assert.ok(done.body.token, JSON.stringify(done.body));
    await coolDown(user);
    notify.clearOutbox();
    sent.length = 0;
    return { user, token: done.body.token };
  };
  // Adds the authenticator app with the password only; returns its secret.
  const addApp = async (token) => {
    const start = await post('/mfa/setup', token, { password: PASSWORD });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const confirm = await post('/mfa/setup/confirm', token, { password: PASSWORD, code: mfa.totp(start.body.secret) });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    return { secret: start.body.secret, token: confirm.body.token, body: confirm.body };
  };

  await t.test('P1. App: password only, no code from the current method; the owner is emailed, audited, default unchanged', async () => {
    const { user, token } = await ownerWithEmail();
    const added = await addApp(token);
    assert.strictEqual(added.body.recovery_codes, undefined);
    assert.strictEqual(sent.length, 0);
    assert.ok(!notify.outbox().some((m) => /Code: \d{6}/.test(m.text)), 'no code went to the current method');
    assert.match(notify.outbox().at(-1).subject, /Two-step verification added/);
    assert.strictEqual(notify.outbox().at(-1).to, user.email);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'MFA_ENROLLED', target_id: String(user.id) })));
    const after = await fresh(user.id);
    assert.strictEqual(after.mfa_enabled, true);
    const hours = (new Date(after.mfa_totp_hold_until) - Date.now()) / 3600000;
    assert.ok(hours > 23.9 && hours <= 24, String(hours));
    assert.strictEqual(mfa.defaultMethodOf(after), 'email', 'the added app does not take over');
    const login = await post('/login', null, { email: user.email, password: PASSWORD });
    assert.strictEqual(login.body.default_method, 'email');
    const profile = await me(added.token);
    assert.deepStrictEqual(profile.mfa_methods_on_hold.map((h) => h.method), ['totp']);
  });

  await t.test('P2. Email and WhatsApp: one password-only confirmation adds both, and sends only the new method\'s code', async () => {
    const secret = mfa.generateSecret();
    const user = await customer({ mfa_enabled: true, mfa_secret_enc: encrypt(secret) });
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const token = (await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(secret) })).body.token;
    notify.clearOutbox();
    const confirmed = await post('/mfa/step-up', token, { password: PASSWORD, purpose: 'add' });
    assert.strictEqual(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.strictEqual(confirmed.body.strength, 'password');
    assert.strictEqual(notify.outbox().length + sent.length, 0, 'confirming sends nothing');
    assert.strictEqual((await post('/mfa/email/setup', token)).status, 200);
    const emailOn = await post('/mfa/email/setup/confirm', token, { code: lastMail() });
    assert.strictEqual(emailOn.status, 200, JSON.stringify(emailOn.body));
    assert.strictEqual((await post('/mfa/whatsapp/setup', emailOn.body.token, { phone: '9876543210' })).status, 200);
    assert.strictEqual(sent.length, 1);
    const waOn = await post('/mfa/whatsapp/setup/confirm', emailOn.body.token, { code: sent[0].code });
    assert.strictEqual(waOn.status, 200, JSON.stringify(waOn.body));
    const after = await fresh(user.id);
    assert.ok(mfa.onHold(after, 'email') && mfa.onHold(after, 'whatsapp') && !mfa.onHold(after, 'totp'));
    assert.strictEqual((await me(waOn.body.token)).mfa_stepup_full, false, 'adding never makes it a full confirmation');
  });

  await t.test('P3. A password-only confirmation (or the password alone) cannot do anything destructive', async () => {
    const { user, token } = await ownerWithEmail();
    assert.strictEqual((await post('/mfa/step-up', token, { password: PASSWORD, purpose: 'add' })).status, 200);
    const tries = [['/mfa/disable', { method: 'email' }], ['/mfa/disable-all', {}], ['/mfa/default', { method: 'email' }], ['/mfa/recovery-codes', {}]];
    for (const [path, body] of tries) {
      const bare = await post(path, token, body);
      assert.strictEqual(bare.status, 403, `${path}: ${JSON.stringify(bare.body)}`);
      assert.strictEqual(bare.body.code, 'PASSWORD_REQUIRED', path);
      const withPassword = await post(path, token, { ...body, password: PASSWORD });
      assert.strictEqual(withPassword.body.code, 'MFA_CODE_REQUIRED', path);
      const purpose = await post(path, token, { ...body, password: PASSWORD, purpose: 'add' });
      assert.strictEqual(purpose.body.code, 'MFA_CODE_REQUIRED', `${path} ignores purpose`);
    }
    const after = await fresh(user.id);
    assert.strictEqual(after.mfa_email_enabled, true);
    assert.strictEqual(after.mfa_recovery_hashes.length, 1);
  });

  await t.test('P4. The added method cannot confirm anything destructive, in this session or a new one', async () => {
    const { user, token } = await ownerWithEmail();
    const added = await addApp(token);
    // A new sign-in with the added app works (it is a sign-in method) ...
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const viaNew = await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(added.secret) });
    assert.strictEqual(viaNew.status, 200, JSON.stringify(viaNew.body));
    // ... but neither session can use it to change two-step or sign devices out.
    for (const session of [added.token, viaNew.body.token]) {
      for (const method of ['totp', undefined]) {
        const proof = { password: PASSWORD, code_method: method, code: mfa.totp(added.secret) };
        for (const [path, body] of [['/mfa/disable', { method: 'email' }], ['/mfa/disable-all', {}], ['/mfa/default', { method: 'totp' }], ['/mfa/recovery-codes', {}], ['/mfa/step-up', {}], ['/account/sessions/revoke-others', {}]]) {
          const res = await post(path, session, { ...body, ...proof });
          assert.strictEqual(res.status, 403, `${path}: ${JSON.stringify(res.body)}`);
          assert.strictEqual(res.body.code, 'MFA_METHOD_TOO_NEW', path);
        }
      }
    }
    // A wrong recovery code next to the held code changes nothing.
    const both = await post('/mfa/disable-all', added.token, { password: PASSWORD, code_method: 'totp', code: mfa.totp(added.secret), recovery_code: 'AAAAA-AAAAA' });
    assert.strictEqual(both.status, 403);
    const after = await fresh(user.id);
    assert.deepStrictEqual(mfa.methodsOf(after).sort(), ['email', 'totp']);
    assert.strictEqual(after.mfa_default_method, 'email');
    assert.ok(!after.failed_login_count, 'refused before anything was checked');
    const list = await get('/account/sessions', added.token);
    assert.deepStrictEqual(list.body.mfa_methods, ['email'], 'only the older method is offered');
  });

  await t.test('P5. The owner removes the added method with the older one or a recovery code', async () => {
    const { user, token } = await ownerWithEmail();
    const added = await addApp(token);
    assert.strictEqual((await post('/mfa/reauth/email/send', added.token)).status, 200);
    const off = await post('/mfa/disable', added.token, { method: 'totp', password: PASSWORD, code_method: 'email', code: lastMail() });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.strictEqual((await fresh(user.id)).mfa_totp_hold_until, undefined);
    const again = await addApp(added.token);
    const viaRecovery = await post('/mfa/disable', again.token, { method: 'totp', password: PASSWORD, recovery_code: 'RECOV-ERY1' });
    assert.strictEqual(viaRecovery.status, 200, JSON.stringify(viaRecovery.body));
  });

  await t.test('P6. After the hold the added method confirms changes like any other', async () => {
    const { user, token } = await ownerWithEmail();
    const added = await addApp(token);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_totp_hold_until: new Date(Date.now() - 1000) } }));
    const ok = await post('/mfa/disable', added.token, { method: 'email', password: PASSWORD, code_method: 'totp', code: mfa.totp(added.secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  });

  await t.test('P7. Adding a method does not hand out recovery codes when they are used up', async () => {
    const { user, token } = await ownerWithEmail({ mfa_recovery_hashes: [] });
    const added = await addApp(token);
    assert.strictEqual(added.body.recovery_codes, undefined);
    assert.deepStrictEqual((await fresh(user.id)).mfa_recovery_hashes, []);
  });

  await t.test('P8. A method that is on cannot be replaced by setting it up again', async () => {
    const secret = mfa.generateSecret();
    const planted = mfa.generateSecret();
    const user = await customer({
      mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_pending_secret_enc: encrypt(planted), mfa_email_enabled: true,
      mfa_whatsapp_enabled: true, mfa_whatsapp_number: '919876543210', mfa_whatsapp_pending_number: '919000000001', mfa_stepup_until: new Date(Date.now() + 60000),
    });
    const token = makeToken(user, { mfa: true });
    assert.strictEqual((await post('/mfa/setup', token, { password: PASSWORD })).status, 400);
    const app2 = await post('/mfa/setup/confirm', token, { password: PASSWORD, code: mfa.totp(planted) });
    assert.strictEqual(app2.status, 400, JSON.stringify(app2.body));
    assert.strictEqual((await post('/mfa/whatsapp/setup', token, { password: PASSWORD, phone: '9000000001' })).status, 400);
    assert.strictEqual((await post('/mfa/whatsapp/setup/confirm', token, { password: PASSWORD, code: '123456' })).status, 400);
    const after = await fresh(user.id);
    assert.strictEqual(require('../utils/crypto').decrypt(after.mfa_secret_enc), secret);
    assert.strictEqual(after.mfa_whatsapp_number, '919876543210');
  });

  await t.test('P9. Two first methods confirmed at once: at most one counts as the first', async () => {
    const user = await customer();
    const token = (await post('/login', null, { email: user.email, password: PASSWORD })).body.token;
    const start = await post('/mfa/setup', token, { password: PASSWORD });
    await post('/mfa/email/setup', token, { password: PASSWORD });
    const results = await Promise.all([
      post('/mfa/setup/confirm', token, { password: PASSWORD, code: mfa.totp(start.body.secret) }),
      post('/mfa/email/setup/confirm', token, { password: PASSWORD, code: lastMail() }),
    ]);
    const after = await fresh(user.id);
    const on = mfa.enrolledMethodsOf(after);
    assert.strictEqual(on.length, results.filter((r) => r.status === 200).length, results.map((r) => r.body.code || r.status).join(','));
    assert.ok(on.length >= 1);
    assert.ok(on.filter((m) => !mfa.onHold(after, m)).length <= 1, 'a second method is on hold');
    assert.strictEqual(results.filter((r) => r.body.recovery_codes).length, 1, 'one set of recovery codes');
  });

  await t.test('P10. A first method is not on hold', async () => {
    const user = await customer();
    const token = (await post('/login', null, { email: user.email, password: PASSWORD })).body.token;
    const added = await addApp(token);
    assert.strictEqual(added.body.recovery_codes.length, 10);
    const off = await post('/mfa/disable-all', added.token, { password: PASSWORD, code_method: 'totp', code: mfa.totp(added.secret) });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
  });

  await t.test('P11. Changing the default needs password and a current code, or a full confirmation', async () => {
    const secret = mfa.generateSecret();
    const user = await customer({ mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_email_enabled: true, mfa_default_method: 'totp' });
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const token = (await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(secret) })).body.token;
    assert.strictEqual((await post('/mfa/default', token, { method: 'email' })).body.code, 'PASSWORD_REQUIRED');
    assert.strictEqual((await post('/mfa/default', token, { method: 'email', password: PASSWORD, code_method: 'totp', code: wrongCode(mfa.totp(secret)) })).body.code, 'MFA_CODE_INCORRECT');
    const full = await post('/mfa/step-up', token, { password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(full.body.strength, 'full');
    assert.strictEqual((await post('/mfa/default', token, { method: 'email' })).status, 200);
    assert.strictEqual((await fresh(user.id)).mfa_default_method, 'email');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'PROFILE_UPDATED', target_id: String(user.id) })));
    // A full confirmation also covers adding, and stays full afterwards.
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_whatsapp_enabled: false } }));
    assert.strictEqual((await post('/mfa/whatsapp/setup', token, { phone: '9876543210' })).status, 200);
    const waOn = await post('/mfa/whatsapp/setup/confirm', token, { code: sent.at(-1).code });
    assert.strictEqual(waOn.status, 200, JSON.stringify(waOn.body));
    assert.strictEqual((await me(waOn.body.token)).mfa_stepup_full, true);
  });

  await t.test('P12. Password-only adding counts wrong passwords and does not wipe counted failures', async () => {
    const { user, token } = await ownerWithEmail({ failed_login_count: 0 });
    await sys(() => Users.updateOne({ id: user.id }, { $set: { failed_login_count: 3 } }));
    assert.strictEqual((await post('/mfa/step-up', token, { password: PASSWORD, purpose: 'add' })).status, 200);
    assert.strictEqual((await post('/mfa/setup', token, { password: PASSWORD })).status, 200);
    assert.strictEqual((await fresh(user.id)).failed_login_count, 3);
    assert.strictEqual((await post('/mfa/step-up', token, { password: 'wrong', purpose: 'add' })).body.code, 'PASSWORD_INCORRECT');
    const fifth = await post('/mfa/step-up', token, { password: 'wrong', purpose: 'add' });
    assert.strictEqual(fifth.status, 423);
    assert.strictEqual((await post('/mfa/setup', token)).status, 403, 'the confirmation does not work while locked');
  });

  await t.test('P13. Platform staff still give a current code to add a method', async () => {
    const secret = mfa.generateSecret();
    const staff = await makeUser({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', mfa_enabled: true, mfa_secret_enc: encrypt(secret) });
    const token = makeToken(staff, { mfa: true });
    assert.strictEqual((await post('/mfa/email/setup', token, { password: PASSWORD })).body.code, 'MFA_CODE_REQUIRED');
    const first = await post('/login', null, { email: staff.email, password: PASSWORD });
    const session = (await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(secret) })).body.token;
    assert.strictEqual((await post('/mfa/step-up', session, { password: PASSWORD, purpose: 'add' })).body.code, 'MFA_CODE_REQUIRED');
  });
});
