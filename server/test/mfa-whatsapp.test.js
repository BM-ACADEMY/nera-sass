/**
 * Two-step verification by WhatsApp code (third method next to the
 * authenticator app and email): enrolment with a verified number, login with
 * method switching and a default method, purpose separation, cooldown,
 * attempt and rate limits, and the "not available" switch
 * (WHATSAPP_OTP_TEMPLATE_APPROVED). The platform send is mocked: no real
 * WhatsApp message leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
let app;
const sent = []; // { to, code, name }

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.LOGIN_RATE_LIMIT = '1000'; // the per-IP limiter is not what these tests measure
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'true';
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = 'test-phone-id';
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'test-token';
  await startTestDb();
  ({ app } = require('../server'));
  const platformInbox = require('../services/platformInbox');
  platformInbox.sendAuthCode = async ({ to, payload }) => {
    sent.push({ to, code: payload.template.components[0].parameters[0].text, name: payload.template.name, payload });
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
  process.env.WHATSAPP_OTP_TEMPLATE_APPROVED = 'true';
  delete process.env.WHATSAPP_OTP_COUNTRY_CODES;
  delete process.env.WHATSAPP_OTP_HOURLY_CAP;
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = 'test-phone-id';
  require('../services/whatsappOtp').resetSendCapForTests();
  require('../routes/authRoutes').resetLimitsForTests();
});

test('WhatsApp two-step verification', async (t) => {
  const { Users } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { encrypt } = require('../utils/crypto');
  const mfa = require('../services/mfa');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;
  const staff = async (fields = {}) => (await sys(() => Users.create({
    email: `staff${(seq += 1)}@example.com`, name: 'Staff', password_hash: bcrypt.hashSync(PASSWORD, 4),
    is_active: true, token_version: 0, is_platform_staff: true, staff_role: 'ops', ...fields,
  }))).toObject();
  const auth = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const fresh = (id) => sys(() => Users.findOne({ id }).lean());
  const login = (user) => request(app).post('/api/auth/login').send({ email: user.email, password: PASSWORD });
  const lastWa = () => sent.at(-1)?.code;
  const coolDown = (user) => sys(() => Users.updateOne({ id: user.id }, { $unset: { mfa_wa_code_sent_at: '' } }));
  const waOn = { mfa_whatsapp_enabled: true, mfa_whatsapp_number: '919876543210' };

  await t.test('W1. Enrol from Settings: password step-up, number verified by a code sent to it, hash only', async () => {
    const user = await staff();
    const me0 = await request(app).get('/api/auth/me').set(auth(user));
    assert.strictEqual(me0.body.whatsapp_otp_available, true);

    const noPass = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ phone: '+91 98765 43210' });
    assert.strictEqual(noPass.status, 403);
    assert.strictEqual(noPass.body.code, 'PASSWORD_REQUIRED');
    const badNumber = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ phone: '12345', password: PASSWORD });
    assert.strictEqual(badNumber.status, 400);
    assert.strictEqual(badNumber.body.code, 'WHATSAPP_NUMBER_INVALID');
    assert.strictEqual(sent.length, 0);

    const start = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ phone: '98765 43210', password: PASSWORD });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, '919876543210', 'a 10-digit Indian number gets 91');
    assert.strictEqual(sent[0].name, 'getnera_login_code');
    assert.match(sent[0].code, /^\d{6}$/);
    assert.deepStrictEqual(sent[0].payload.template.components[1], { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: sent[0].code }] });
    assert.ok(!JSON.stringify(start.body).includes(sent[0].code), 'the code is not in the answer');
    assert.ok(start.body.sent_to.endsWith('3210') && !start.body.sent_to.includes('98765'));
    const stored = await fresh(user.id);
    assert.ok(stored.mfa_wa_code_hash && !stored.mfa_wa_code_hash.includes(sent[0].code));
    assert.strictEqual(stored.mfa_whatsapp_enabled, false, 'not on before the code is entered');

    const wrong = await request(app).post('/api/auth/mfa/whatsapp/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: sent[0].code === '000000' ? '111111' : '000000' });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.body.code, 'INVALID_MFA_CODE');
    const ok = await request(app).post('/api/auth/mfa/whatsapp/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: lastWa() });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.recovery_codes.length, 10);
    const again = await request(app).post('/api/auth/mfa/whatsapp/setup/confirm').set(auth(user)).send({ password: PASSWORD, code: lastWa() });
    assert.notStrictEqual(again.status, 200, 'single use');

    const me = await request(app).get('/api/auth/me').set(auth(user));
    assert.deepStrictEqual(me.body.mfa_methods, ['whatsapp']);
    assert.strictEqual(me.body.mfa_default_method, 'whatsapp');
    assert.ok(me.body.mfa_whatsapp_number.endsWith('3210') && !me.body.mfa_whatsapp_number.includes('98765'));
    assert.strictEqual((await fresh(user.id)).mfa_whatsapp_number, '919876543210');
  });

  await t.test('W2. Forced enrolment at login can use WhatsApp (mfa_setup token, no password again)', async () => {
    const user = await staff();
    const res = await login(user);
    assert.strictEqual(res.body.mfa_setup_required, true);
    assert.strictEqual(res.body.whatsapp_available, true);
    const foreign = await request(app).post('/api/auth/mfa/whatsapp/setup').send({ mfa_token: res.body.mfa_token, phone: '+44 7700 900123' });
    assert.strictEqual(foreign.status, 400, 'only allowed country codes (default +91)');
    assert.strictEqual(foreign.body.code, 'WHATSAPP_NUMBER_INVALID');
    process.env.WHATSAPP_OTP_COUNTRY_CODES = '91,44';
    const start = await request(app).post('/api/auth/mfa/whatsapp/setup').send({ mfa_token: res.body.mfa_token, phone: '+44 7700 900123' });
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    assert.strictEqual(sent.at(-1).to, '447700900123');
    const confirm = await request(app).post('/api/auth/mfa/whatsapp/setup/confirm').send({ mfa_token: res.body.mfa_token, code: lastWa() });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    assert.ok(confirm.body.token);
  });

  await t.test('W3. Login: the default method is sent first; the user can switch; a recovery code still works', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({ ...waOn, mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_default_method: 'whatsapp', mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY1')] });
    const res = await login(user);
    assert.strictEqual(res.body.mfa_required, true);
    assert.deepStrictEqual(res.body.methods.sort(), ['totp', 'whatsapp']);
    assert.strictEqual(res.body.default_method, 'whatsapp');
    assert.ok(res.body.whatsapp?.sent_to, 'WhatsApp code sent straight away');
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].to, '919876543210');

    // Switch to the authenticator app.
    const viaApp = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(viaApp.status, 200, JSON.stringify(viaApp.body));

    // Next sign-in with the WhatsApp code; it works once.
    await coolDown(user);
    const res2 = await login(user);
    const code = lastWa();
    const ok = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res2.body.mfa_token, method: 'whatsapp', code });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    const reuse = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res2.body.mfa_token, method: 'whatsapp', code });
    assert.strictEqual(reuse.status, 401);

    const res3 = await login(user); // inside the cooldown: no new code, the error is reported
    assert.ok(res3.body.whatsapp_error);
    const recovery = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res3.body.mfa_token, recovery_code: 'RECOV-ERY1' });
    assert.strictEqual(recovery.status, 200);

    // Default changed to the app: nothing is sent at login.
    const setDefault = await request(app).post('/api/auth/mfa/default').set(auth(user)).send({ method: 'totp' });
    assert.strictEqual(setDefault.status, 200);
    const before = sent.length;
    await coolDown(user);
    const res4 = await login(user);
    assert.strictEqual(res4.body.default_method, 'totp');
    assert.strictEqual(sent.length, before);
    const onDemand = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res4.body.mfa_token });
    assert.strictEqual(onDemand.status, 200, 'switching to WhatsApp sends a code on demand');
    assert.strictEqual(sent.length, before + 1);
    const badDefault = await request(app).post('/api/auth/mfa/default').set(auth(user)).send({ method: 'email' });
    assert.strictEqual(badDefault.status, 400, 'only a method that is on');
  });

  await t.test('W4. Purpose separation: login, setup and reauth codes are not interchangeable', async () => {
    const user = await staff({ ...waOn });
    const res = await login(user); // default whatsapp: a login code is sent
    const loginCode = lastWa();
    const asReauth = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, code_method: 'whatsapp', code: loginCode });
    assert.strictEqual(asReauth.status, 403);
    assert.strictEqual(asReauth.body.code, 'MFA_CODE_INCORRECT');

    await coolDown(user);
    const reauth = await request(app).post('/api/auth/mfa/reauth/whatsapp/send').set(auth(user)).send({});
    assert.strictEqual(reauth.status, 200, JSON.stringify(reauth.body));
    const reauthCode = lastWa();
    const asLogin = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code: reauthCode });
    assert.strictEqual(asLogin.status, 401, 'a reauth code does not sign in');

    await coolDown(user);
    await request(app).post('/api/auth/mfa/reauth/whatsapp/send').set(auth(user)).send({});
    const ok = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(user)).send({ password: PASSWORD, code_method: 'whatsapp', code: lastWa() });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));

    // A setup code (sent to a new number) is not a login code either.
    const other = await staff();
    const start = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(other)).send({ password: PASSWORD, phone: '+91 91234 56789' });
    assert.strictEqual(start.status, 200);
    await sys(() => Users.updateOne({ id: other.id }, { $set: { mfa_whatsapp_enabled: true, mfa_whatsapp_number: '919123456789' } }));
    const otherLogin = await login(other);
    const setupAsLogin = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: otherLogin.body.mfa_token, method: 'whatsapp', code: sent.find((s) => s.to === '919123456789').code });
    assert.strictEqual(setupAsLogin.status, 401);
  });

  await t.test('W5. Cooldown between codes and five wrong tries clear the code', async () => {
    const user = await staff({ ...waOn, mfa_default_method: 'whatsapp' });
    const res = await login(user);
    const code = lastWa();
    const resend = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(resend.status, 429);
    assert.strictEqual(resend.body.code, 'OTP_RESEND_WAIT');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const r = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code: wrong });
      assert.strictEqual(r.status, 401);
    }
    const late = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code });
    assert.strictEqual(late.status, 401, 'cleared after five wrong tries');
  });

  await t.test('W6. Turning WhatsApp off needs the password and a current code', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({ ...waOn, mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_default_method: 'whatsapp' });
    const noCode = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'whatsapp', password: PASSWORD });
    assert.strictEqual(noCode.status, 403);
    const off = await request(app).post('/api/auth/mfa/disable').set(auth(user)).send({ method: 'whatsapp', password: PASSWORD, code_method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(off.status, 200, JSON.stringify(off.body));
    assert.deepStrictEqual(off.body.mfa_methods, ['totp']);
    assert.strictEqual(off.body.mfa_default_method, 'totp');
    const stored = await fresh(user.id);
    assert.strictEqual(stored.mfa_whatsapp_number, undefined);
    assert.strictEqual(stored.mfa_default_method, undefined);
  });

  await t.test('W7. Flag off: WhatsApp is not offered; a WhatsApp-only account signs in with a recovery code', async () => {
    process.env.WHATSAPP_OTP_TEMPLATE_APPROVED = 'false';
    const fresher = await staff();
    const me = await request(app).get('/api/auth/me').set(auth(fresher));
    assert.strictEqual(me.body.whatsapp_otp_available, false);
    const setup = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(fresher)).send({ password: PASSWORD, phone: '+91 98765 43210' });
    assert.strictEqual(setup.status, 400);
    assert.strictEqual(setup.body.code, 'WHATSAPP_NOT_AVAILABLE');
    const forced = await login(fresher);
    assert.strictEqual(forced.body.whatsapp_available, false);

    const user = await staff({ ...waOn, mfa_email_enabled: true, mfa_default_method: 'whatsapp' });
    const res = await login(user);
    assert.deepStrictEqual(res.body.methods, ['email'], 'WhatsApp not offered');
    assert.strictEqual(res.body.default_method, 'email');
    const send = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(send.status, 400);

    const onlyWa = await staff({ ...waOn, mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY2')] });
    const res2 = await login(onlyWa);
    assert.strictEqual(res2.body.mfa_required, true, 'two-step stays on');
    assert.strictEqual(res2.body.recovery_only, true);
    assert.deepStrictEqual(res2.body.methods, []);
    const viaRecovery = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res2.body.mfa_token, recovery_code: 'RECOV-ERY2' });
    assert.strictEqual(viaRecovery.status, 200);
    assert.strictEqual(sent.length, 0, 'nothing was sent while the flag is off');
  });

  await t.test('W9. A resend inside the code life keeps the wrong tries already used', async () => {
    const user = await staff({ ...waOn });
    const res = await login(user);
    const wrong = (c) => (c === '000000' ? '111111' : '000000');
    for (let i = 0; i < 3; i += 1) {
      await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code: wrong(lastWa()) });
    }
    await coolDown(user);
    const resend = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(resend.status, 200);
    const code = lastWa();
    for (let i = 0; i < 2; i += 1) {
      await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code: wrong(code) });
    }
    const right = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code });
    assert.strictEqual(right.status, 401, 'five wrong tries in total used the code up');
  });

  await t.test('W10. Ten wrong codes across channels lock code checks for an hour; recovery codes still work', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({ ...waOn, mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_default_method: 'whatsapp', mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY3')] });
    const res = await login(user);
    const waWrong = lastWa() === '000000' ? '111111' : '000000';
    const appWrong = mfa.totp(secret) === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      assert.strictEqual((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'whatsapp', code: waWrong })).status, 401);
    }
    for (let i = 0; i < 6; i += 1) {
      assert.strictEqual((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: appWrong })).status, 401);
    }
    const locked = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(locked.status, 429);
    assert.strictEqual(locked.body.code, 'MFA_CODE_LOCKED');
    await coolDown(user);
    const send = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token });
    assert.strictEqual(send.status, 429, 'no new codes while locked');
    const recovery = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, recovery_code: 'RECOV-ERY3' });
    assert.strictEqual(recovery.status, 200);
  });

  await t.test('W11. At most five different setup numbers per account per day', async () => {
    const user = await staff();
    const numbers = ['919000000001', '919000000002', '919000000003', '919000000004', '919000000005'];
    for (const phone of numbers) {
      await coolDown(user);
      const r = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone });
      assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    }
    await coolDown(user);
    const sixth = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone: '919000000006' });
    assert.strictEqual(sixth.status, 429);
    assert.strictEqual(sixth.body.code, 'WHATSAPP_NUMBER_LIMIT');
    await coolDown(user);
    const again = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone: numbers[0] });
    assert.strictEqual(again.status, 200, 'a number already tried today is fine');
  });

  await t.test('W12. Platform-wide hourly cap on WhatsApp code sends', async () => {
    process.env.WHATSAPP_OTP_HOURLY_CAP = '2';
    const a = await staff({ ...waOn });
    const b = await staff({ ...waOn, mfa_whatsapp_number: '919111111111' });
    const c = await staff({ ...waOn, mfa_whatsapp_number: '919222222222' });
    assert.ok((await login(a)).body.whatsapp);
    assert.ok((await login(b)).body.whatsapp);
    const third = await login(c);
    assert.match(third.body.whatsapp_error, /busy/i);
    assert.strictEqual(sent.length, 2);
  });

  await t.test('W13. WhatsApp is not offered when the platform number is missing; the last usable method stays on', async () => {
    delete process.env.PLATFORM_WA_PHONE_NUMBER_ID;
    const user = await staff({ ...waOn, mfa_email_enabled: true, mfa_default_method: 'whatsapp' });
    const res = await login(user);
    assert.deepStrictEqual(res.body.methods, ['email']);
    const secret = mfa.generateSecret();
    const admin = await staff({ ...waOn, mfa_enabled: true, mfa_secret_enc: encrypt(secret) });
    const off = await request(app).post('/api/auth/mfa/disable').set(auth(admin)).send({ method: 'totp', password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(off.status, 400);
    assert.strictEqual(off.body.code, 'MFA_LAST_METHOD');
    const reauthBad = await request(app).post('/api/auth/mfa/reauth/constructor/send').set(auth(admin)).send({});
    assert.strictEqual(reauthBad.status, 404, 'only own channel names');
  });

  await t.test('W14. Setup with the sign-in token is limited per account, not per address', async () => {
    const a = await staff();
    const b = await staff();
    const ta = (await login(a)).body.mfa_token;
    const tb = (await login(b)).body.mfa_token;
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      let last;
      for (let i = 0; i < 21; i += 1) {
        last = await request(app).post('/api/auth/mfa/whatsapp/setup').send({ mfa_token: ta, phone: '12' });
      }
      assert.strictEqual(last.status, 429, 'the 21st request for one account');
      const other = await request(app).post('/api/auth/mfa/whatsapp/setup').send({ mfa_token: tb, phone: '12' });
      assert.strictEqual(other.status, 400, 'another account from the same address is not limited');
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });

  await t.test('W15. Forged sign-in tokens do not fill the victim bucket; the sign-in step has its own bucket', async () => {
    const jwt = require('jsonwebtoken');
    const victim = await staff({ ...waOn });
    const forged = jwt.sign({ id: victim.id, typ: 'mfa' }, 'not-the-server-secret');
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      for (let i = 0; i < 25; i += 1) {
        await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: forged });
      }
      // The victim's own session bucket is untouched.
      const own = await request(app).post('/api/auth/change-password').set(auth(victim)).send({ current: 'wrong', newPassword: 'Brand-New-Pass-9' });
      assert.notStrictEqual(own.status, 429, 'forged tokens were keyed by address, not by the victim');

      // A real sign-in token uses mfa:<id>, not the session bucket user:<id>.
      const realToken = (await login(victim)).body.mfa_token;
      for (let i = 0; i < 21; i += 1) {
        await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: realToken });
      }
      const limited = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: realToken });
      assert.strictEqual(limited.status, 429, 'the sign-in step is limited per account');
      assert.strictEqual(limited.body.code, undefined, 'the rate limiter answered, not the resend wait');
      const session = await request(app).post('/api/auth/mfa/recovery-codes').set(auth(victim)).send({ password: PASSWORD });
      assert.notStrictEqual(session.status, 429, 'the session bucket is separate');
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });

  await t.test('W16. Parallel app-code guesses cannot get past the 10-per-hour lock', async () => {
    const secret = mfa.generateSecret();
    const user = await staff({ mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_recovery_hashes: [mfa.hashRecoveryCode('RECOV-ERY4')] });
    const res = await login(user);
    const wrong = mfa.totp(secret) === '000000' ? '111111' : '000000';
    const results = await Promise.all(Array.from({ length: 25 }, () => request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: wrong })));
    const checked = results.filter((r) => r.status === 401).length;
    assert.ok(checked <= 10, `at most 10 guesses were checked (got ${checked})`);
    assert.strictEqual(results.filter((r) => r.status === 429).length, 25 - checked);
    const right = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: mfa.totp(secret) });
    assert.strictEqual(right.status, 429, 'locked');
    // With both a code and a recovery code, the recovery code is still tried.
    const both = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: res.body.mfa_token, method: 'totp', code: mfa.totp(secret), recovery_code: 'RECOV-ERY4' });
    assert.strictEqual(both.status, 200, JSON.stringify(both.body));
  });

  await t.test('W17. Parallel setups cannot add more than five different numbers', async () => {
    const user = await staff();
    const phones = Array.from({ length: 9 }, (_, i) => `91900000010${i}`);
    const results = await Promise.all(phones.map((phone) => request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone })));
    // Only numbers a code really went to keep a slot (the parallel ones hit the resend wait).
    const stored = (await fresh(user.id)).mfa_whatsapp_setup_set || [];
    assert.ok(stored.length <= 5, stored.join(','));
    assert.strictEqual(stored.length, results.filter((r) => r.status === 200).length, results.map((r) => r.body.code || r.status).join(','));
  });

  await t.test('W18. At most N WhatsApp codes per account and per number in an hour', async () => {
    process.env.WHATSAPP_OTP_PER_TARGET_HOURLY = '2';
    try {
      const user = await staff({ ...waOn });
      const res = await login(user); // 1
      await coolDown(user);
      assert.strictEqual((await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token })).status, 200); // 2
      await coolDown(user);
      const third = await request(app).post('/api/auth/mfa/whatsapp/send').send({ mfa_token: res.body.mfa_token });
      assert.strictEqual(third.status, 429);
      assert.strictEqual(third.body.code, 'WHATSAPP_TOO_MANY');

      // Per number: another account with the same number shares the number limit.
      const other = await staff({ ...waOn });
      const otherLogin = await login(other);
      assert.match(otherLogin.body.whatsapp_error || '', /too many/i);
    } finally {
      delete process.env.WHATSAPP_OTP_PER_TARGET_HOURLY;
    }
  });

  await t.test('W19. Setup without the password, or a failed send, does not use up the daily number slots', async () => {
    const user = await staff();
    for (let i = 0; i < 6; i += 1) {
      const r = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ phone: `91900000020${i}` });
      assert.strictEqual(r.status, 403, 'no password');
    }
    assert.ok(!((await fresh(user.id)).mfa_whatsapp_setup_set || []).length, 'no slot taken without the password');

    const platformInbox = require('../services/platformInbox');
    const realSend = platformInbox.sendAuthCode;
    platformInbox.sendAuthCode = async () => { throw new Error('Meta is down'); };
    try {
      const failed = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone: '919000000300' });
      assert.strictEqual(failed.status, 502);
    } finally {
      platformInbox.sendAuthCode = realSend;
    }
    assert.ok(!((await fresh(user.id)).mfa_whatsapp_setup_set || []).includes('919000000300'), 'the slot is given back');

    await coolDown(user);
    const ok = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(user)).send({ password: PASSWORD, phone: '919000000301' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  });

  await t.test('W20. Setup sends to a verified number do not block its login codes', async () => {
    process.env.WHATSAPP_OTP_PER_TARGET_HOURLY = '1';
    try {
      const owner = await staff({ ...waOn }); // verified number 919876543210
      const other = await staff();
      const setup = await request(app).post('/api/auth/mfa/whatsapp/setup').set(auth(other)).send({ password: PASSWORD, phone: '919876543210' });
      assert.strictEqual(setup.status, 200, JSON.stringify(setup.body));
      const ownerLogin = await login(owner);
      assert.ok(ownerLogin.body.whatsapp?.sent_to, `login code still sent: ${ownerLogin.body.whatsapp_error || ''}`);
      const buckets = require('../services/whatsappOtp').sendBucketsForTests();
      assert.ok(buckets.includes('num:setup:919876543210') && buckets.includes('num:919876543210'), buckets.join(','));
    } finally {
      delete process.env.WHATSAPP_OTP_PER_TARGET_HOURLY;
    }
  });

  await t.test('W8. Rate limit: per-account limit on code requests', async () => {
    const user = await staff({ ...waOn });
    process.env.AUTH_RATE_LIMIT = 'on';
    try {
      const statuses = [];
      for (let i = 0; i < 21; i += 1) {
        statuses.push((await request(app).post('/api/auth/mfa/reauth/whatsapp/send').set(auth(user)).send({})).status);
      }
      assert.strictEqual(statuses[0], 200);
      assert.ok(statuses.slice(1, 20).every((s) => s === 429), 'cooldown answers 429 OTP_RESEND_WAIT in between');
      const last = await request(app).post('/api/auth/mfa/reauth/whatsapp/send').set(auth(user)).send({});
      assert.strictEqual(last.status, 429);
      assert.strictEqual(last.body.code, undefined, 'the rate limiter, not the cooldown');
      assert.strictEqual(sent.length, 1);
    } finally {
      process.env.AUTH_RATE_LIMIT = 'off';
    }
  });
});
