/**
 * Two-step settings and WhatsApp sign-in limits:
 *  G. "Confirm it's you" once: one check gives a short confirmation, kept on
 *     the server for that user and session, that adding and turning off
 *     methods can use instead of the password.
 *  A. Turning two-step verification off completely (policy, audit, mail).
 *  P. For customers WhatsApp codes are only an extra method.
 *  L. At most 3 WhatsApp sign-in codes per user per India-time day, each valid
 *     for 10 minutes.
 * In-memory MongoDB; mail goes to the in-memory outbox; the WhatsApp send is
 * mocked: no real message leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
const sent = []; // { to, code }
let app;
let sendFailure = null; // set to make the mocked WhatsApp send fail

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.LOGIN_RATE_LIMIT = '1000';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'true';
  process.env.MFA_EXTRA_METHODS_ENABLED = 'true'; // these tests cover the email / WhatsApp methods
  process.env.WHATSAPP_OTP_TEMPLATE_APPROVED = 'true';
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = 'test-phone-id';
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'test-token';
  delete process.env.MFA_REQUIRED_TENANT_ROLES;
  await startTestDb();
  ({ app } = require('../server'));
  const platformInbox = require('../services/platformInbox');
  platformInbox.sendAuthCode = async ({ to, payload }) => {
    if (sendFailure) throw sendFailure;
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
  sendFailure = null;
  delete process.env.MFA_REQUIRED_TENANT_ROLES;
  require('../services/whatsappOtp').resetSendCapForTests();
  require('../routes/authRoutes').resetLimitsForTests();
});

test('two-step confirmation, switch-off and WhatsApp sign-in limit', async (t) => {
  const { Users, Tenants, UserSessions, AuditEvents } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const notify = require('../services/notify');
  const whatsappOtp = require('../services/whatsappOtp');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const makeUser = async (fields = {}) => (await sys(() => Users.create({
    email: `person${(seq += 1)}@example.com`, name: 'Person', password_hash: bcrypt.hashSync(PASSWORD, 4),
    is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const customer = async (fields = {}) => {
    if (!(await sys(() => Tenants.exists({ id: 10 })))) await sys(() => Tenants.create({ id: 10, name: 'Workspace 10', status: 'active' }));
    return makeUser({ tenant_id: 10, role: 'agent', ...fields });
  };
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());
  const bearer = (token) => ({ Authorization: `Bearer ${token}` });
  const post = (path, token, body = {}) => {
    const r = request(app).post(`/api/auth${path}`);
    if (token) r.set(bearer(token));
    return r.send(body);
  };
  const me = (token) => request(app).get('/api/auth/me').set(bearer(token));
  // A real sign-in (with a tracked session) for an account without two-step.
  const signIn = async (user) => {
    const res = await post('/login', null, { email: user.email, password: PASSWORD });
    assert.ok(res.body.token, JSON.stringify(res.body));
    return res.body.token;
  };
  // A tracked session for an account with two-step on (the authenticator app).
  const signInWithApp = async (user, secret) => {
    const first = await post('/login', null, { email: user.email, password: PASSWORD });
    const res = await post('/mfa/verify', null, { mfa_token: first.body.mfa_token, method: 'totp', code: mfa.totp(secret) });
    assert.ok(res.body.token, JSON.stringify(res.body));
    return res.body.token;
  };
  const lastMail = () => /Code: (\d{6})/.exec(notify.outbox().at(-1)?.text || '')?.[1];
  const lastWa = () => sent.at(-1)?.code;
  const coolDown = (user) => sys(() => Users.updateOne({ id: user.id }, { $unset: { mfa_wa_code_sent_at: '' } }));
  const appOn = (secret) => ({ mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')] });
  const waOn = { mfa_whatsapp_enabled: true, mfa_whatsapp_number: '919876543210' };
  const wrongCode = (code) => (code === '000000' ? '111111' : '000000');

  // ── Confirm once ──────────────────────────────────────────
  await t.test('G1. One confirmation covers starting and finishing the app, then email, without the password again', async () => {
    const user = await customer();
    const token = await signIn(user);
    assert.strictEqual((await post('/mfa/setup', token)).body.code, 'PASSWORD_REQUIRED', 'nothing without a confirmation');
    assert.strictEqual((await me(token)).body.mfa_stepup_seconds, 0);
    const wrong = await post('/mfa/step-up', token, { password: 'not-it' });
    assert.strictEqual(wrong.status, 403);
    assert.strictEqual(wrong.body.code, 'PASSWORD_INCORRECT');
    assert.strictEqual((await post('/mfa/setup', token)).status, 403, 'a failed check confirms nothing');

    const ok = await post('/mfa/step-up', token, { password: PASSWORD });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.expires_in, 600);
    assert.ok(!JSON.stringify(ok.body).includes(PASSWORD));
    const left = (await me(token)).body.mfa_stepup_seconds;
    assert.ok(left > 590 && left <= 600, String(left));

    const start = await post('/mfa/setup', token);
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    const confirm = await post('/mfa/setup/confirm', token, { code: mfa.totp(start.body.secret) });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    const next = confirm.body.token;
    // Two-step is on now: the same confirmation still covers a second method.
    const email = await post('/mfa/email/setup', next);
    assert.strictEqual(email.status, 200, JSON.stringify(email.body));
    assert.strictEqual(email.body.expires_in, 600);
    const emailOn = await post('/mfa/email/setup/confirm', next, { code: lastMail() });
    assert.strictEqual(emailOn.status, 200, JSON.stringify(emailOn.body));
    assert.deepStrictEqual(mfa.methodsOf(await fresh(user.id)).sort(), ['email', 'totp']);
    // And turning one off.
    const off = await post('/mfa/disable', emailOn.body.token, { method: 'email' });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    // New recovery codes always ask for the password.
    assert.strictEqual((await post('/mfa/recovery-codes', emailOn.body.token)).body.code, 'PASSWORD_REQUIRED');
  });

  await t.test('G2. With two-step on, the confirmation needs a current code; it then replaces password and code', async () => {
    const secret = mfa.generateSecret();
    const user = await customer(appOn(secret));
    const token = await signInWithApp(user, secret);
    const noCode = await post('/mfa/step-up', token, { password: PASSWORD });
    assert.strictEqual(noCode.body.code, 'MFA_CODE_REQUIRED');
    const bad = await post('/mfa/step-up', token, { password: PASSWORD, code: wrongCode(mfa.totp(secret)) });
    assert.strictEqual(bad.body.code, 'MFA_CODE_INCORRECT');
    assert.strictEqual((await post('/mfa/disable', token, { method: 'totp' })).status, 403);
    assert.strictEqual((await post('/mfa/disable-all', token)).status, 403);
    assert.strictEqual((await fresh(user.id)).mfa_enabled, true);
    const ok = await post('/mfa/step-up', token, { password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual((await post('/mfa/disable-all', token)).status, 200);
  });

  await t.test('G3. The confirmation belongs to one session of one user, and expires', async () => {
    const user = await customer();
    const first = await signIn(user);
    const second = await signIn(user);
    const other = await signIn(await customer());
    assert.strictEqual((await post('/mfa/step-up', first, { password: PASSWORD })).status, 200);
    assert.strictEqual((await post('/mfa/setup', second)).body.code, 'PASSWORD_REQUIRED', 'another device');
    assert.strictEqual((await post('/mfa/setup', other)).body.code, 'PASSWORD_REQUIRED', 'another user');
    assert.strictEqual((await post('/mfa/setup', first)).status, 200);
    // A wrong password sent with the request is still refused.
    assert.strictEqual((await post('/mfa/email/setup', first, { password: 'wrong' })).body.code, 'PASSWORD_INCORRECT');

    await sys(() => UserSessions.updateMany({ user_id: user.id }, { $set: { stepup_until: new Date(Date.now() - 1000) } }));
    assert.strictEqual((await post('/mfa/email/setup', first)).body.code, 'PASSWORD_REQUIRED', 'expired');
    assert.strictEqual((await me(first)).body.mfa_stepup_seconds, 0);
    const pending = await post('/mfa/setup', first, { password: PASSWORD });
    assert.strictEqual((await post('/mfa/setup/confirm', first, { code: mfa.totp(pending.body.secret) })).body.code, 'PASSWORD_REQUIRED', 'confirm needs it too');
  });

  await t.test('G4. A token version change, an account lock and signing out end the confirmation', async () => {
    const user = await customer();
    const token = await signIn(user);
    assert.strictEqual((await post('/mfa/step-up', token, { password: PASSWORD })).status, 200);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { locked_until: new Date(Date.now() + 60000) } }));
    assert.strictEqual((await post('/mfa/setup', token)).status, 403, 'locked');
    assert.strictEqual((await post('/mfa/step-up', token, { password: PASSWORD })).status, 423);
    await sys(() => Users.updateOne({ id: user.id }, { $unset: { locked_until: '' } }));

    const changed = await post('/change-password', token, { current: PASSWORD, newPassword: 'Brand-New-Pass-9' });
    assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));
    assert.strictEqual((await post('/mfa/setup', changed.body.token)).body.code, 'PASSWORD_REQUIRED', 'same session, new password');

    assert.strictEqual((await post('/mfa/step-up', changed.body.token, { password: 'Brand-New-Pass-9' })).status, 200);
    await post('/logout', changed.body.token);
    assert.strictEqual((await post('/mfa/setup', changed.body.token)).status, 401);
  });

  await t.test('G5. A confirmation made while two-step was off does not count once it is on', async () => {
    const user = await customer();
    const token = await signIn(user);
    assert.strictEqual((await post('/mfa/step-up', token, { password: PASSWORD })).status, 200);
    // Turned on elsewhere (another device) after the confirmation.
    const secret = mfa.generateSecret();
    await sys(() => Users.updateOne({ id: user.id }, { $set: appOn(secret) }));
    assert.strictEqual((await post('/mfa/disable', token, { method: 'totp' })).status, 403);
    assert.strictEqual((await post('/mfa/disable-all', token)).status, 403);
    assert.strictEqual((await post('/mfa/email/setup', token)).status, 403);
    assert.strictEqual((await me(token)).body.mfa_stepup_seconds, 0);
    assert.strictEqual((await fresh(user.id)).mfa_enabled, true);
  });

  await t.test('G6. A token without a tracked session cannot store a confirmation', async () => {
    const user = await customer();
    const res = await post('/mfa/step-up', makeToken(user), { password: PASSWORD });
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'SESSION_UNTRACKED');
  });

  // ── Switching two-step off ────────────────────────────────
  await t.test('A1. Turning two-step off removes every method and the recovery codes, is audited and mailed', async () => {
    const secret = mfa.generateSecret();
    const user = await customer({ ...appOn(secret), mfa_email_enabled: true, ...waOn, mfa_default_method: 'email', mfa_wa_login_day: whatsappOtp.indiaDay(), mfa_wa_login_sends: 2 });
    const token = await signInWithApp(user, secret);
    assert.strictEqual((await post('/mfa/disable-all', token)).body.code, 'PASSWORD_REQUIRED');
    assert.strictEqual((await post('/mfa/disable-all', token, { password: PASSWORD })).body.code, 'MFA_CODE_REQUIRED');
    const ok = await post('/mfa/disable-all', token, { password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const after = await fresh(user.id);
    assert.strictEqual(mfa.hasMfa(after), false);
    for (const field of ['mfa_secret_enc', 'mfa_recovery_hashes', 'mfa_whatsapp_number', 'mfa_default_method']) assert.strictEqual(after[field], undefined, field);
    assert.strictEqual(after.mfa_wa_login_sends, 2, 'off and on again does not reset the daily count');
    const events = await sys(() => AuditEvents.find({ event: 'MFA_METHOD_DISABLED', target_id: String(user.id) }).lean());
    assert.strictEqual(events.length, 1);
    assert.deepStrictEqual(events[0].meta.methods, ['email', 'totp', 'whatsapp']);
    assert.match(notify.outbox().at(-1).subject, /Two-step verification removed/);
    assert.strictEqual((await me(token)).body.mfa_enabled, false);
    const again = await post('/mfa/disable-all', token, { password: PASSWORD });
    assert.strictEqual(again.status, 400, 'already off');
  });

  await t.test('A2. Turning it off ends the confirmation', async () => {
    const secret = mfa.generateSecret();
    const user = await customer(appOn(secret));
    const token = await signInWithApp(user, secret);
    await post('/mfa/step-up', token, { password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual((await post('/mfa/disable-all', token)).status, 200);
    assert.strictEqual((await post('/mfa/setup', token)).body.code, 'PASSWORD_REQUIRED');
  });

  await t.test('A3. Accounts that must use two-step verification cannot turn it off', async () => {
    process.env.MFA_REQUIRED_TENANT_ROLES = 'owner';
    const secret = mfa.generateSecret();
    const owner = await customer({ role: 'owner', ...appOn(secret) });
    const token = await signInWithApp(owner, secret);
    assert.strictEqual((await me(token)).body.mfa_required_by_policy, true);
    const res = await post('/mfa/disable-all', token, { password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'MFA_REQUIRED_BY_POLICY');
    assert.strictEqual((await fresh(owner.id)).mfa_enabled, true);
    const agent = await customer();
    assert.strictEqual((await me(await signIn(agent))).body.mfa_required_by_policy, false);
  });

  // ── WhatsApp as an extra method (customers) ───────────────
  await t.test('P1. A customer needs the app or email codes before adding WhatsApp', async () => {
    const user = await customer();
    const token = await signIn(user);
    await post('/mfa/step-up', token, { password: PASSWORD });
    const alone = await post('/mfa/whatsapp/setup', token, { phone: '9876543210' });
    assert.strictEqual(alone.status, 400);
    assert.strictEqual(alone.body.code, 'WHATSAPP_NEEDS_PRIMARY');
    assert.strictEqual(sent.length, 0);

    await post('/mfa/email/setup', token);
    const emailOn = await post('/mfa/email/setup/confirm', token, { code: lastMail() });
    const next = emailOn.body.token;
    const start = await post('/mfa/whatsapp/setup', next, { phone: '9876543210' });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    assert.strictEqual(start.body.expires_in, 600);
    assert.strictEqual(start.body.sends_left, undefined, 'a setup code is not a sign-in code');
    const on = await post('/mfa/whatsapp/setup/confirm', next, { code: lastWa() });
    assert.strictEqual(on.status, 200, JSON.stringify(on.body));
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, undefined, 'setup does not count toward the daily limit');

    const removePrimary = await post('/mfa/disable', on.body.token, { method: 'email' });
    assert.strictEqual(removePrimary.status, 400);
    assert.strictEqual(removePrimary.body.code, 'MFA_LAST_METHOD');
    assert.strictEqual((await fresh(user.id)).mfa_email_enabled, true);
    assert.strictEqual((await post('/mfa/disable', on.body.token, { method: 'whatsapp' })).status, 200);
    assert.strictEqual((await post('/mfa/disable', on.body.token, { method: 'email' })).status, 200);
  });

  await t.test('P2. Forced first-time setup does not offer a customer WhatsApp', async () => {
    process.env.MFA_REQUIRED_TENANT_ROLES = 'owner';
    const owner = await customer({ role: 'owner' });
    const res = await post('/login', null, { email: owner.email, password: PASSWORD });
    assert.strictEqual(res.body.mfa_setup_required, true);
    assert.strictEqual(res.body.whatsapp_available, false);
    const start = await post('/mfa/whatsapp/setup', null, { mfa_token: res.body.mfa_token, phone: '9876543210' });
    assert.strictEqual(start.body.code, 'WHATSAPP_NEEDS_PRIMARY');
  });

  // ── Sign-in limit ─────────────────────────────────────────
  const signInStep = (user) => post('/login', null, { email: user.email, password: PASSWORD });
  const resend = (mfaToken) => post('/mfa/whatsapp/send', null, { mfa_token: mfaToken });

  await t.test('L1. Three sign-in codes a day, resends included; the last one still works', async () => {
    const user = await customer({ ...waOn, mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY2')] });
    const login = await signInStep(user);
    assert.strictEqual(login.body.whatsapp.sends_left, 2);
    assert.strictEqual(login.body.whatsapp_status.sends_left, 2);
    assert.strictEqual(login.body.whatsapp_status.daily_limit, 3);
    assert.ok(login.body.whatsapp_status.expires_in > 590 && login.body.whatsapp_status.expires_in <= 600);
    const token = login.body.mfa_token;
    // Resend wait: nothing sent, nothing counted.
    const early = await resend(token);
    assert.strictEqual(early.body.code, 'OTP_RESEND_WAIT');
    assert.strictEqual(early.body.whatsapp_status.sends_left, 2);
    for (const left of [1, 0]) {
      await coolDown(user);
      const r = await resend(token);
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
      assert.strictEqual(r.body.sends_left, left);
      assert.ok(r.body.whatsapp_status.step_expires_in <= 600);
    }
    await coolDown(user);
    const fourth = await resend(token);
    assert.strictEqual(fourth.status, 429);
    assert.strictEqual(fourth.body.code, 'WHATSAPP_DAILY_LIMIT');
    assert.match(fourth.body.error, /recovery code/);
    assert.match(fourth.body.error, /India time/);
    assert.ok(fourth.body.whatsapp_status.expires_in > 0, 'the third code is still valid');
    assert.strictEqual(sent.length, 3);
    assert.strictEqual((await post('/mfa/verify', null, { mfa_token: token, method: 'whatsapp', code: lastWa() })).status, 200);

    // A new sign-in the same day sends nothing; the recovery code still works.
    await coolDown(user);
    const later = await signInStep(user);
    assert.match(later.body.whatsapp_error, /all 3 WhatsApp sign-in codes/);
    assert.strictEqual(later.body.whatsapp_status.sends_left, 0);
    assert.strictEqual(later.body.whatsapp_status.expires_in, 0);
    assert.strictEqual(sent.length, 3);
    assert.strictEqual((await post('/mfa/verify', null, { mfa_token: later.body.mfa_token, recovery_code: 'RECOV-ERY2' })).status, 200);
  });

  await t.test('L2. The code sent at each sign-in counts too', async () => {
    const user = await customer({ ...waOn });
    for (const left of [2, 1, 0]) {
      await coolDown(user);
      assert.strictEqual((await signInStep(user)).body.whatsapp.sends_left, left);
    }
    await coolDown(user);
    const fourth = await signInStep(user);
    assert.ok(fourth.body.whatsapp_error);
    assert.strictEqual(fourth.body.mfa_required, true, 'the sign-in step is still offered');
    assert.strictEqual(sent.length, 3);
  });

  await t.test('L3. A code is refused after ten minutes', async () => {
    const user = await customer({ ...waOn });
    const login = await signInStep(user);
    const stored = await fresh(user.id);
    const life = new Date(stored.mfa_wa_code_expires_at) - new Date(stored.mfa_wa_code_sent_at);
    assert.strictEqual(life, 10 * 60000);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_wa_code_expires_at: new Date(Date.now() - 1000) } }));
    const res = await post('/mfa/verify', null, { mfa_token: login.body.mfa_token, method: 'whatsapp', code: lastWa() });
    assert.strictEqual(res.status, 401);
  });

  await t.test('L4. Parallel requests cannot take more than three', async () => {
    const user = await customer({ ...waOn });
    const results = await Promise.all(Array.from({ length: 25 }, () => whatsappOtp.takeLoginSend(user.id)));
    assert.strictEqual(results.filter(Boolean).length, 3);
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, 3);
    // Parallel resend requests with nothing left: nothing goes out.
    const login = await signInStep(user);
    const answers = await Promise.all(Array.from({ length: 10 }, () => resend(login.body.mfa_token)));
    assert.ok(answers.every((r) => r.body.code === 'WHATSAPP_DAILY_LIMIT'));
    assert.strictEqual(sent.length, 0);
  });

  await t.test('L5. Parallel resends with one send left deliver one message', async () => {
    const user = await customer({ ...waOn });
    const login = await signInStep(user);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_wa_login_sends: 2 }, $unset: { mfa_wa_code_sent_at: '' } }));
    const answers = await Promise.all(Array.from({ length: 10 }, () => resend(login.body.mfa_token)));
    assert.strictEqual(answers.filter((r) => r.status === 200).length, 1);
    assert.strictEqual(sent.length, 2);
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, 3);
  });

  await t.test('L6. The day is the India day', async () => {
    assert.strictEqual(whatsappOtp.indiaDay(new Date('2026-11-26T18:29:59Z')), '2026-11-26');
    assert.strictEqual(whatsappOtp.indiaDay(new Date('2026-11-26T18:30:00Z')), '2026-11-27');
    const user = await customer({ ...waOn });
    const before = new Date('2026-11-26T18:00:00Z');
    for (let i = 0; i < 3; i += 1) assert.ok(await whatsappOtp.takeLoginSend(user.id, before));
    assert.strictEqual(await whatsappOtp.takeLoginSend(user.id, new Date('2026-11-26T18:29:00Z')), null);
    const after = await whatsappOtp.takeLoginSend(user.id, new Date('2026-11-26T18:31:00Z'));
    assert.strictEqual(after.used, 1);
    // A request stamped on the old day cannot restart the count.
    assert.strictEqual(await whatsappOtp.takeLoginSend(user.id, before), null);
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, 1);
  });

  await t.test('L7. A message Meta refused is not counted; an unclear failure is', async () => {
    const user = await customer({ ...waOn });
    sendFailure = Object.assign(new Error('refused'), { refused: true });
    const login = await signInStep(user);
    assert.ok(login.body.whatsapp_error);
    assert.strictEqual(login.body.whatsapp_status.sends_left, 3);
    sendFailure = new Error('timeout');
    await coolDown(user);
    const unclear = await signInStep(user);
    assert.strictEqual(unclear.body.whatsapp_status.sends_left, 2);
  });

  await t.test('L8. Confirmation codes while signed in are not counted', async () => {
    const secret = mfa.generateSecret();
    const user = await customer({ ...appOn(secret), ...waOn });
    const token = await signInWithApp(user, secret);
    await sys(() => Users.updateOne({ id: user.id }, { $set: { mfa_wa_login_day: whatsappOtp.indiaDay(), mfa_wa_login_sends: 3 } }));
    const reauth = await post('/mfa/reauth/whatsapp/send', token);
    assert.strictEqual(reauth.status, 200, JSON.stringify(reauth.body));
    assert.strictEqual((await fresh(user.id)).mfa_wa_login_sends, 3);
  });

  await t.test('L9. Codes and passwords are not logged', async () => {
    const lines = [];
    const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const key of Object.keys(real)) console[key] = (...args) => lines.push(args.map(String).join(' '));
    try {
      const user = await customer({ ...waOn });
      await signInStep(user);
      const plain = await customer();
      const token = await signIn(plain);
      await post('/mfa/step-up', token, { password: `${PASSWORD}x` });
      await post('/mfa/step-up', token, { password: PASSWORD });
      sendFailure = new Error('timeout');
      await coolDown(user);
      await signInStep(user);
    } finally {
      Object.assign(console, real);
    }
    const all = lines.join('\n');
    assert.ok(!all.includes(PASSWORD));
    for (const message of sent) assert.ok(!all.includes(message.code));
  });
});
