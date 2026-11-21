/**
 * My sessions: signed-in devices per user. Isolation (same tenant, other
 * tenant, staff), immediate revocation (HTTP and socket handshake), no raw
 * token or session id stored, masked IP and local location, last-seen
 * throttling, password change / reset / logout-all, MFA claim kept, and
 * tokens from before sessions existed. In-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
const NEW_PASSWORD = 'Brand-New-Pass-22';
const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const SAFARI_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
  process.env.MFA_ENFORCED = 'false';
  delete process.env.SESSION_TOUCH_INTERVAL_MS;
});

test('My sessions', async (t) => {
  const { Users, Tenants, UserSessions } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { socketAuth } = require('../middleware/authMiddleware');
  const sessions = require('../services/sessions');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  let seq = 0;

  const createUser = async (fields) => (await sys(() => Users.create({
    email: `user${++seq}@acme.test`, name: `User ${seq}`, password_hash: bcrypt.hashSync(PASSWORD, 4),
    is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const tenant = (id) => sys(() => Tenants.create({ id, name: `Workspace ${id}`, status: 'active', language: 'en', timezone: 'Asia/Kolkata' }));
  const owner = (tenantId, fields = {}) => createUser({ tenant_id: tenantId, role: 'owner', ...fields });
  const staff = (fields = {}) => createUser({ is_platform_staff: true, staff_role: 'founder', ...fields });

  const login = async (user, { ua = CHROME_WIN, ip = '8.8.8.8' } = {}) => {
    const res = await request(app).post('/api/auth/login').set('User-Agent', ua).set('X-Forwarded-For', ip)
      .send({ email: user.email, password: PASSWORD });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.token, 'a session token');
    return res.body.token;
  };
  const as = (token) => ({ Authorization: `Bearer ${token}` });
  const list = (token) => request(app).get('/api/account/sessions').set(as(token));
  const me = (token) => request(app).get('/api/auth/me').set(as(token));
  const sidOf = (token) => jwt.decode(token).sid;
  const rowOf = (token) => sys(() => UserSessions.findOne({ session_hash: sessions.hashSessionId(sidOf(token)) }).lean());
  const fakeSocket = (token) => {
    const rooms = [];
    return { handshake: { auth: { token }, headers: {}, address: '127.0.0.1' }, data: {}, rooms, join: (r) => rooms.push(r) };
  };
  const handshake = (token) => new Promise((resolve) => {
    const socket = fakeSocket(token);
    socketAuth(socket, (err) => resolve({ err, socket }));
  });

  await t.test('S1. Login creates a session; only a hash is stored, never the token or session id', async () => {
    await tenant(1);
    const user = await owner(1);
    const token = await login(user);
    const sid = sidOf(token);
    assert.ok(sid && sid.length >= 40, 'token carries a random session id');
    const raw = await mongoose.connection.collection('user_sessions').find({}).toArray();
    assert.strictEqual(raw.length, 1);
    const stored = JSON.stringify(raw);
    assert.ok(!stored.includes(token), 'raw token not stored');
    assert.ok(!stored.includes(sid), 'raw session id not stored');
    assert.strictEqual(raw[0].session_hash, crypto.createHash('sha256').update(`session:${sid}`).digest('hex'));
    assert.strictEqual(raw[0].user_id, user.id);
    assert.strictEqual(raw[0].tenant_id, 1, 'customer session is tenant-stamped');
    assert.ok(!stored.includes('8.8.8.8'), 'full IP not stored');
    assert.strictEqual(raw[0].ip_masked, '8.8.8.x');
  });

  await t.test('S2. The list shows device, OS, masked IP, local location and "This device"', async () => {
    await tenant(1);
    const user = await owner(1);
    const desk = await login(user, { ua: CHROME_WIN, ip: '8.8.8.8' });
    await login(user, { ua: SAFARI_IPHONE, ip: '192.168.1.20' });
    const res = await list(desk);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.current_session_tracked, true);
    assert.strictEqual(res.body.sessions.length, 2);
    const [first, second] = res.body.sessions;
    assert.strictEqual(first.current, true, 'this device first');
    assert.strictEqual(first.browser, 'Chrome 131');
    assert.strictEqual(first.os, 'Windows');
    assert.strictEqual(first.device_type, 'desktop');
    assert.strictEqual(first.ip, '8.8.8.x');
    if (first.location) assert.strictEqual(first.location.country, 'United States', 'local GeoLite lookup');
    assert.ok(first.created_at && first.last_seen_at);
    assert.strictEqual(second.current, false);
    assert.strictEqual(second.device_type, 'mobile');
    assert.strictEqual(second.os, 'iOS');
    assert.strictEqual(second.browser, 'Safari 17');
    assert.strictEqual(second.location?.private, true, 'private network address');
    for (const key of ['session_hash', 'user_agent', 'user_id', 'tenant_id', 'token_version']) {
      assert.ok(!(key in first), `${key} not exposed`);
    }
  });

  await t.test('S3. Isolation: no user sees or ends another user\'s sessions (same tenant, other tenant, staff)', async () => {
    await tenant(1);
    await tenant(2);
    const a = await owner(1);
    const mate = await createUser({ tenant_id: 1, role: 'admin' });
    const b = await owner(2);
    const s = await staff();
    const tokA = await login(a);
    const tokMate = await login(mate);
    const tokB = await login(b);
    const tokS = await login(s);
    const rowA = await rowOf(tokA);
    const rowB = await rowOf(tokB);
    const rowS = await rowOf(tokS);
    assert.strictEqual(rowS.tenant_id, null, 'staff session is platform-level');

    for (const [label, token, own] of [['A', tokA, rowA], ['mate', tokMate, null], ['B', tokB, rowB], ['staff', tokS, rowS]]) {
      const res = await list(token);
      assert.strictEqual(res.status, 200, label);
      assert.strictEqual(res.body.sessions.length, 1, `${label} sees only own session`);
      if (own) assert.strictEqual(res.body.sessions[0].id, own.id);
    }

    for (const [label, token, target] of [['same tenant', tokMate, rowA], ['other tenant', tokB, rowA], ['customer to staff', tokA, rowS], ['staff to customer', tokS, rowB]]) {
      const res = await request(app).delete(`/api/account/sessions/${target.id}`).set(as(token));
      assert.strictEqual(res.status, 404, `${label}: answered like a missing session`);
    }
    for (const token of [tokA, tokB, tokS]) assert.strictEqual((await me(token)).status, 200, 'sessions still live');
    const live = await sys(() => UserSessions.countDocuments({ revoked_at: null }));
    assert.strictEqual(live, 4);

    // revoke-others only touches the caller's own sessions.
    const res = await request(app).post('/api/account/sessions/revoke-others').set(as(tokMate)).send({ password: PASSWORD });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.revoked, 0);
    for (const token of [tokA, tokB, tokS]) assert.strictEqual((await me(token)).status, 200);

    // Invalid ids.
    for (const bad of ['abc', '0', '-1', '1.5']) {
      assert.strictEqual((await request(app).delete(`/api/account/sessions/${bad}`).set(as(tokA))).status, 404);
    }
  });

  await t.test('S4. Signing one session out works immediately (HTTP, workspace route, socket)', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokKeep = await login(user);
    const tokGone = await login(user, { ua: SAFARI_IPHONE });
    const gone = await rowOf(tokGone);
    assert.strictEqual((await handshake(tokGone)).err, undefined, 'socket allowed before');

    const res = await request(app).delete(`/api/account/sessions/${gone.id}`).set(as(tokKeep));
    assert.strictEqual(res.status, 200);
    const after = await me(tokGone);
    assert.strictEqual(after.status, 401);
    assert.strictEqual(after.body.code, 'SESSION_REVOKED');
    assert.strictEqual((await request(app).get('/api/tenant').set(as(tokGone))).status, 401, 'workspace route refused');
    assert.ok((await handshake(tokGone)).err, 'socket handshake refused');
    assert.strictEqual((await me(tokKeep)).status, 200, 'the other session is unaffected');
    assert.strictEqual((await request(app).delete(`/api/account/sessions/${gone.id}`).set(as(tokKeep))).status, 404, 'already ended');
    const listed = await list(tokKeep);
    assert.deepStrictEqual(listed.body.sessions.map((s) => s.id), [(await rowOf(tokKeep)).id]);
  });

  await t.test('S5. A live socket of a signed-out session is disconnected', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokKeep = await login(user);
    const tokGone = await login(user);
    const { socket } = await handshake(tokGone);
    const gone = await rowOf(tokGone);
    assert.ok(socket.rooms.includes(`session:${gone.id}`), 'socket joins its session room');
    const dropped = [];
    sessions.setDisconnector((ids) => dropped.push(...ids));
    try {
      await request(app).delete(`/api/account/sessions/${gone.id}`).set(as(tokKeep)).expect(200);
    } finally {
      // Later tests do not rely on live sockets.
      sessions.setDisconnector(null);
    }
    assert.deepStrictEqual(dropped, [gone.id]);
  });

  await t.test('S6. The current session cannot be ended from the list', async () => {
    await tenant(1);
    const user = await owner(1);
    const token = await login(user);
    const res = await request(app).delete(`/api/account/sessions/${(await rowOf(token)).id}`).set(as(token));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'CURRENT_SESSION');
    assert.strictEqual((await me(token)).status, 200);
  });

  await t.test('S7. Sign out all other devices: others and old-style tokens end, this one gets a fresh token', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokMine = await login(user);
    const tokOther1 = await login(user);
    const tokOther2 = await login(user, { ua: SAFARI_IPHONE });
    const legacy = makeToken(user);
    assert.strictEqual((await me(legacy)).status, 200, 'old-style token works before');

    const res = await request(app).post('/api/account/sessions/revoke-others').set(as(tokMine)).send({ password: PASSWORD });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.revoked, 2);
    assert.ok(res.body.token);
    assert.strictEqual(sidOf(res.body.token), sidOf(tokMine), 'same session continues');
    for (const token of [tokOther1, tokOther2, legacy, tokMine]) assert.strictEqual((await me(token)).status, 401);
    assert.strictEqual((await me(res.body.token)).status, 200);
    const listed = await list(res.body.token);
    assert.strictEqual(listed.body.sessions.length, 1);
    assert.strictEqual(listed.body.sessions[0].current, true);
  });

  await t.test('S8. Old-style tokens (before sessions) keep working and get tracked after revoke-others', async () => {
    await tenant(1);
    const user = await owner(1);
    const legacy = makeToken(user);
    const res = await list(legacy);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.current_session_tracked, false);
    assert.deepStrictEqual(res.body.sessions, []);
    const out = await request(app).post('/api/account/sessions/revoke-others').set(as(legacy)).set('User-Agent', CHROME_WIN).send({ password: PASSWORD });
    assert.strictEqual(out.status, 200);
    assert.ok(sidOf(out.body.token), 'now a tracked session');
    const again = await list(out.body.token);
    assert.strictEqual(again.body.current_session_tracked, true);
    assert.strictEqual(again.body.sessions.length, 1);
    assert.strictEqual(again.body.sessions[0].current, true);
  });

  await t.test('S9. Last active is written at most once per interval', async () => {
    await tenant(1);
    const user = await owner(1);
    const token = await login(user);
    const first = await rowOf(token);
    await me(token);
    await me(token);
    const unchanged = await rowOf(token);
    assert.strictEqual(unchanged.last_seen_at.getTime(), first.last_seen_at.getTime(), 'no write within the interval');

    const old = new Date(Date.now() - 10 * 60 * 1000);
    await sys(() => UserSessions.updateOne({ id: first.id }, { $set: { last_seen_at: old } }));
    await me(token);
    let touched;
    for (let i = 0; i < 20; i += 1) { // the write is not awaited by the request
      touched = await rowOf(token);
      if (touched.last_seen_at.getTime() !== old.getTime()) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    assert.ok(touched.last_seen_at.getTime() > old.getTime(), 'stale last_seen_at refreshed');
    const stamp = touched.last_seen_at.getTime();
    await me(token);
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual((await rowOf(token)).last_seen_at.getTime(), stamp, 'throttled again');
  });

  await t.test('S10. Password change ends other sessions and keeps this one', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokMine = await login(user);
    const tokOther = await login(user);
    const res = await request(app).post('/api/auth/change-password').set(as(tokMine)).send({ current: PASSWORD, newPassword: NEW_PASSWORD });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(sidOf(res.body.token), sidOf(tokMine));
    assert.strictEqual((await me(res.body.token)).status, 200);
    assert.strictEqual((await me(tokOther)).status, 401);
    const other = await rowOf(tokOther);
    assert.ok(other.revoked_at);
    assert.strictEqual(other.revoked_reason, 'password_changed');
    assert.strictEqual((await list(res.body.token)).body.sessions.length, 1);
  });

  await t.test('S11. Logout everywhere and password reset end every session row', async () => {
    await tenant(1);
    const user = await owner(1);
    const t1 = await login(user);
    const t2 = await login(user);
    await request(app).post('/api/auth/logout-all').set(as(t1)).expect(200);
    for (const tok of [t1, t2]) {
      assert.strictEqual((await me(tok)).status, 401);
      assert.ok((await rowOf(tok)).revoked_at);
    }
    const t3 = await login(user);
    await request(app).post('/api/auth/password/forgot').send({ email: user.email }).expect(200);
    const link = /reset-password\/([A-Za-z0-9_-]+)/.exec(notify.outbox().at(-1).text)[1];
    await request(app).post('/api/auth/password/reset').send({ token: link, password: NEW_PASSWORD }).expect(200);
    assert.strictEqual((await me(t3)).status, 401);
    assert.strictEqual((await rowOf(t3)).revoked_reason, 'password_reset');
  });

  await t.test('S12. Staff with two-step: the MFA claim survives sign-out of others; staff routes work', async () => {
    process.env.MFA_ENFORCED = 'true';
    const s = await staff({ mfa_email_enabled: true });
    const step = await request(app).post('/api/auth/login').set('User-Agent', CHROME_WIN).send({ email: s.email, password: PASSWORD });
    assert.strictEqual(step.body.mfa_required, true);
    const code = /Code: (\d{6})/.exec(notify.outbox().at(-1).text)[1];
    const ok = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: step.body.mfa_token, method: 'email', code });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(jwt.decode(ok.body.token).mfa, true);
    assert.ok(sidOf(ok.body.token));
    assert.strictEqual((await list(ok.body.token)).body.sessions.length, 1);
    // Password alone is not enough with two-step on: an emailed code is needed too.
    const listed = await list(ok.body.token);
    assert.deepStrictEqual(listed.body.mfa_methods, ['email']);
    const noCode = await request(app).post('/api/account/sessions/revoke-others').set(as(ok.body.token)).send({ password: PASSWORD });
    assert.strictEqual(noCode.status, 403);
    assert.strictEqual(noCode.body.code, 'MFA_CODE_REQUIRED');
    // (the login code was sent moments ago; skip the resend wait)
    await sys(() => Users.updateOne({ id: s.id }, { $set: { mfa_email_code_sent_at: new Date(Date.now() - 60000) } }));
    const sent = await request(app).post('/api/account/sessions/revoke-others/code').set(as(ok.body.token));
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
    const mail = notify.outbox().at(-1);
    assert.match(mail.subject, /confirmation code/);
    const confirmCode = /Code: (\d{6})/.exec(mail.text)[1];
    const wrong = await request(app).post('/api/account/sessions/revoke-others').set(as(ok.body.token))
      .send({ password: PASSWORD, method: 'email', code: confirmCode === '000000' ? '111111' : '000000' });
    assert.strictEqual(wrong.status, 403);
    assert.strictEqual(wrong.body.code, 'INVALID_MFA_CODE');
    const out = await request(app).post('/api/account/sessions/revoke-others').set(as(ok.body.token))
      .send({ password: PASSWORD, method: 'email', code: confirmCode });
    assert.strictEqual(out.status, 200, JSON.stringify(out.body));
    assert.strictEqual(jwt.decode(out.body.token).mfa, true, 'two-step state kept');
    assert.strictEqual((await me(out.body.token)).status, 200);
    // The MFA step token itself is not a session.
    assert.strictEqual((await list(step.body.mfa_token)).status, 401);
  });

  await t.test('S13. A token_version bump ends tracked sessions; a forged or borrowed sid is refused', async () => {
    await tenant(1);
    const user = await owner(1);
    const token = await login(user);
    const { iat, exp, ...claims } = jwt.decode(token);
    assert.ok(iat && exp);
    const forged = jwt.sign({ ...claims, sid: 'not-a-real-session' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const res = await me(forged);
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'SESSION_REVOKED');
    // Another user's sid inside my token is refused too.
    const other = await owner(1);
    const otherTok = await login(other);
    const swapped = jwt.sign({ id: user.id, tid: 1, tv: 0, mfa: false, typ: 'access', sid: sidOf(otherTok) }, process.env.JWT_SECRET, { expiresIn: '1h' });
    assert.strictEqual((await me(swapped)).status, 401);

    await sys(() => Users.updateOne({ id: user.id }, { $inc: { token_version: 1 } }));
    assert.strictEqual((await me(token)).status, 401);
  });

  await t.test('S15. Log out ends this session at once; other devices and other users are unaffected', async () => {
    await tenant(1);
    const user = await owner(1);
    const other = await owner(1);
    const tokMine = await login(user);
    const tokPhone = await login(user, { ua: SAFARI_IPHONE });
    const tokOther = await login(other);
    const res = await request(app).post('/api/auth/logout').set(as(tokMine));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.session_ended, true);
    const row = await rowOf(tokMine);
    assert.ok(row.revoked_at, 'revoked_at set');
    assert.strictEqual(row.revoked_reason, 'logged_out');
    const after = await me(tokMine);
    assert.strictEqual(after.status, 401, 'token refused on the next request');
    assert.strictEqual(after.body.code, 'SESSION_REVOKED');
    assert.ok((await handshake(tokMine)).err, 'socket refused');
    const listed = await list(tokPhone);
    assert.strictEqual(listed.body.sessions.length, 1, 'the device left the list');
    assert.strictEqual(listed.body.sessions[0].current, true);
    assert.strictEqual((await me(tokOther)).status, 200);
    assert.strictEqual((await request(app).post('/api/auth/logout').set(as(tokMine))).status, 401, 'second logout refused');
    // A token from before sessions: nothing to end, still answers success.
    const legacy = await request(app).post('/api/auth/logout').set(as(makeToken(other)));
    assert.strictEqual(legacy.status, 200);
    assert.strictEqual(legacy.body.session_ended, false);
    assert.strictEqual((await request(app).post('/api/auth/logout')).status, 401, 'needs a token');
  });

  await t.test('S16. Sign out all other devices needs the password; wrong or missing is refused and changes nothing', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokMine = await login(user);
    const tokOther = await login(user, { ua: SAFARI_IPHONE });
    const revokeOthers = (body) => request(app).post('/api/account/sessions/revoke-others').set(as(tokMine)).send(body);

    const missing = await revokeOthers({});
    assert.strictEqual(missing.status, 403);
    assert.strictEqual(missing.body.code, 'PASSWORD_REQUIRED');
    assert.ok(!missing.body.token);
    const wrong = await revokeOthers({ password: 'not-the-password' });
    assert.strictEqual(wrong.status, 403);
    assert.strictEqual(wrong.body.code, 'PASSWORD_INCORRECT');
    assert.match(wrong.body.error, /password is not correct/);
    assert.ok(!wrong.body.token);
    // Nothing happened: both devices still signed in, no token_version bump.
    assert.strictEqual((await me(tokMine)).status, 200, 'a wrong password does not sign this device out');
    assert.strictEqual((await me(tokOther)).status, 200, 'other device untouched');
    assert.strictEqual((await sys(() => Users.findOne({ id: user.id }).lean())).token_version, 0);

    const ok = await revokeOthers({ password: PASSWORD });
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(ok.body.revoked, 1);
    assert.strictEqual((await me(tokOther)).status, 401, 'other device signed out');
    assert.strictEqual((await me(ok.body.token)).status, 200);
  });

  await t.test('S17. Sign out all other devices never extends the session (token and row keep their end time)', async () => {
    await tenant(1);
    const user = await owner(1);
    const tokMine = await login(user);
    await login(user, { ua: SAFARI_IPHONE });
    // Pretend this session started 5 days ago: 2 days left.
    const ends = new Date(Date.now() + 2 * 86400 * 1000);
    const { iat, exp, ...claims } = jwt.decode(tokMine);
    assert.ok(iat && exp);
    const aged = jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: Math.floor((ends.getTime() - Date.now()) / 1000) });
    await sys(() => UserSessions.updateOne({ session_hash: sessions.hashSessionId(sidOf(tokMine)) }, { $set: { expires_at: ends } }));

    let token = aged;
    for (let i = 0; i < 2; i += 1) { // repeated calls do not add time either
      const res = await request(app).post('/api/account/sessions/revoke-others').set(as(token)).send({ password: PASSWORD });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      token = res.body.token;
      assert.strictEqual(sidOf(token), sidOf(tokMine), 'same session');
      assert.ok(jwt.decode(token).exp <= jwt.decode(aged).exp, 'new token ends no later than the old one');
      const row = await rowOf(token);
      assert.strictEqual(row.expires_at.getTime(), ends.getTime(), 'session row keeps its end time');
      assert.strictEqual((await me(token)).status, 200);
    }
    assert.ok(jwt.decode(token).exp < Math.floor(Date.now() / 1000) + 3 * 86400, 'not a fresh 7-day token');

    // A token from before sessions: the new tracked session ends when that token did.
    const legacy = makeToken(await sys(() => Users.findOne({ id: user.id }).lean())); // 1 day
    const res = await request(app).post('/api/account/sessions/revoke-others').set(as(legacy)).send({ password: PASSWORD });
    assert.strictEqual(res.status, 200);
    assert.ok(jwt.decode(res.body.token).exp <= jwt.decode(legacy).exp);
    assert.ok((await rowOf(res.body.token)).expires_at.getTime() <= jwt.decode(legacy).exp * 1000);
  });

  await t.test('S18. With an authenticator app, a valid code (or a recovery code) is needed besides the password', async () => {
    await tenant(1);
    const mfa = require('../services/mfa');
    const { encrypt } = require('../utils/crypto');
    const secret = mfa.generateSecret();
    const { codes, hashes } = mfa.generateRecoveryCodes();
    const user = await owner(1, { mfa_enabled: true, mfa_secret_enc: encrypt(secret), mfa_recovery_hashes: hashes });
    const tok = makeToken(user, { mfa: true });
    const post = (body) => request(app).post('/api/account/sessions/revoke-others').set(as(tok)).send(body);
    assert.strictEqual((await post({ password: PASSWORD })).body.code, 'MFA_CODE_REQUIRED');
    const bad = await post({ password: PASSWORD, code: mfa.totp(secret) === '123456' ? '654321' : '123456' });
    assert.strictEqual(bad.status, 403);
    assert.strictEqual(bad.body.code, 'INVALID_MFA_CODE');
    const wrongPw = await post({ password: 'nope', code: mfa.totp(secret) });
    assert.strictEqual(wrongPw.body.code, 'PASSWORD_INCORRECT', 'a right code does not replace the password');
    const good = await post({ password: PASSWORD, code: mfa.totp(secret) });
    assert.strictEqual(good.status, 200, JSON.stringify(good.body));
    const again = await request(app).post('/api/account/sessions/revoke-others').set(as(good.body.token)).send({ password: PASSWORD, recovery_code: codes[0] });
    assert.strictEqual(again.status, 200, 'recovery code works');
    const fresh = await sys(() => Users.findOne({ id: user.id }).lean());
    assert.strictEqual(fresh.mfa_recovery_hashes.length, hashes.length - 1, 'recovery code used up');
  });

  await t.test('S14. Helpers: IP masking and user-agent reading', () => {
    assert.strictEqual(sessions.maskIp('203.0.113.42'), '203.0.113.x');
    assert.strictEqual(sessions.maskIp('::ffff:203.0.113.42'), '203.0.113.x');
    assert.strictEqual(sessions.maskIp('2001:db8:85a3:1:2:3:4:5'), '2001:db8:85a3:x:x:x:x:x');
    assert.strictEqual(sessions.maskIp(''), null);
    const android = sessions.parseUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36');
    assert.deepStrictEqual(android, { browser: 'Chrome 130', os: 'Android', device_type: 'mobile' });
    const edge = sessions.parseUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0');
    assert.deepStrictEqual(edge, { browser: 'Edge 131', os: 'macOS', device_type: 'desktop' });
    const ipad = sessions.parseUserAgent('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
    assert.strictEqual(ipad.device_type, 'tablet');
    assert.strictEqual(sessions.parseUserAgent('').device_type, 'unknown');
    assert.strictEqual(sessions.locate('10.0.0.5').private, true);
  });
});
