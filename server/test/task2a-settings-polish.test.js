/**
 * Task 2A: Settings polish (server side).
 *  - a wrong MFA code is INVALID_MFA_CODE; an expired session / sign-in step is a different 401
 *  - website validation applies only to a changed website (legacy values never block a save)
 *  - the pending-sync explanation names a missing WABA ID correctly
 *  - /api/auth/me always reflects the current role and name
 * Real server.js app, in-memory MongoDB, dummy credentials, stubbed Meta HTTP.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const axios = require('axios');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_JWT_SECRET } = require('./setup');

process.env.META_PAGE_ACCESS_TOKEN = 'test-dummy-page';
process.env.META_SYSTEM_USER_ACCESS_TOKEN = 'test-dummy-system';
process.env.META_INVENTORY_ACCESS_TOKEN = '';

const DAY = 86400000;
const PASSWORD = 'Original-Pass-1';
let app;
const metaCalls = [];
const realGet = axios.get;
const realPost = axios.post;
const refuse = (method) => async (url) => { metaCalls.push({ method, url }); throw new Error(`Unexpected outbound call in test: ${method} ${url}`); };

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.get = refuse('GET');
  axios.post = refuse('POST');
});

test.after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  metaCalls.length = 0;
});

test('Task 2A: Settings polish', async (t) => {
  const { Users, Tenants, Clients } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const mfa = require('../services/mfa');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearerToken = (token) => ({ Authorization: `Bearer ${token}` });

  async function workspace(brandFields = {}) {
    await sys(() => Tenants.create({ id: 10, name: 'Workspace 10', status: 'active' }));
    const brand = await runAsTenant(10, async () => {
      return (await Clients.create({ name: 'Brand 10', ...brandFields })).toObject();
    });
    const owner = (await sys(() => Users.create({
      tenant_id: 10, role: 'owner', email: 'owner10@acme.test', name: 'Owner Ten', password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0,
    }))).toObject();
    return { brand, owner };
  }
  const rawBrand = (id) => mongoose.connection.collection('clients').findOne({ id }, { projection: { _id: 0 } });

  // ── MFA errors ───────────────────────────────────────────
  await t.test('E1. Enrolment: a wrong code is INVALID_MFA_CODE; an expired session is a different 401', async () => {
    const { owner } = await workspace();
    const session = makeToken(owner);
    await request(app).post('/api/auth/mfa/setup').set(bearerToken(session)).send({});
    const wrong = await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: '000000' });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.body.code, 'INVALID_MFA_CODE');

    await sys(() => Users.updateOne({ id: owner.id }, { $inc: { token_version: 1 } })); // session revoked elsewhere
    const expired = await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: '000000' });
    assert.strictEqual(expired.status, 401);
    assert.notStrictEqual(expired.body.code, 'INVALID_MFA_CODE', 'an ended session is not reported as a wrong code');
    assert.strictEqual(expired.body.code, 'SESSION_REVOKED');
  });

  await t.test('E2. Login step: a wrong code is INVALID_MFA_CODE; an expired sign-in step is a different 401', async () => {
    const { owner } = await workspace();
    const session = makeToken(owner);
    const start = await request(app).post('/api/auth/mfa/setup').set(bearerToken(session)).send({});
    await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: mfa.totp(start.body.secret) });

    const login = await request(app).post('/api/auth/login').send({ email: owner.email, password: PASSWORD });
    const wrong = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, code: '000000' });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.body.code, 'INVALID_MFA_CODE');
    const badRecovery = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, recovery_code: 'NOT-A-CODE' });
    assert.strictEqual(badRecovery.body.code, 'INVALID_MFA_CODE');

    const expiredStep = jwt.sign({ id: owner.id, tv: 0, typ: 'mfa', exp: Math.floor(Date.now() / 1000) - 60 }, TEST_JWT_SECRET);
    const expired = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: expiredStep, code: mfa.totp(start.body.secret) });
    assert.strictEqual(expired.status, 401);
    assert.notStrictEqual(expired.body.code, 'INVALID_MFA_CODE');
  });

  // ── Website validation ───────────────────────────────────
  await t.test('V1. A legacy website without https:// never blocks saving other fields', async () => {
    const { brand, owner } = await workspace({ wa_website: 'legacy-site.example' });
    const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearerToken(makeToken(owner))).send({ wa_description: 'Updated', wa_website: 'legacy-site.example' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const raw = await rawBrand(brand.id);
    assert.strictEqual(raw.wa_description, 'Updated');
    assert.strictEqual(raw.wa_website, 'legacy-site.example', 'unchanged legacy value left exactly as it was');
  });

  await t.test('V2. A changed website is normalised or refused; empty clears it', async () => {
    const { brand, owner } = await workspace();
    const auth = bearerToken(makeToken(owner));
    const patch = (wa_website) => request(app).patch(`/api/clients/${brand.id}`).set(auth).send({ wa_website });
    assert.strictEqual((await patch('example.org')).status, 200);
    assert.strictEqual((await rawBrand(brand.id)).wa_website, 'https://example.org');
    assert.strictEqual((await patch('http://shop.example.in/path')).status, 200);
    assert.strictEqual((await rawBrand(brand.id)).wa_website, 'http://shop.example.in/path');
    for (const bad of ['javascript:alert(1)', 'ftp://example.org', 'not a url', 'localhost', 'https://user:pass@example.org']) {
      const res = await patch(bad);
      assert.strictEqual(res.status, 400, bad);
      assert.strictEqual(res.body.code, 'INVALID_WEBSITE', bad);
    }
    assert.strictEqual((await rawBrand(brand.id)).wa_website, 'http://shop.example.in/path', 'refused values change nothing');
    assert.strictEqual((await patch('')).status, 200);
    assert.strictEqual((await rawBrand(brand.id)).wa_website, null);
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Pending-sync explanations ────────────────────────────
  await t.test('R1. Each missing piece of the WhatsApp connection gets its own explanation, with no Meta call', async () => {
    const cases = [
      [{}, 'WHATSAPP_NOT_CONNECTED'],
      [{ phone_number_id: 'p-1', wa_business_id: 'waba-1' }, 'WHATSAPP_CREDENTIAL_MISSING'],
      [{ phone_number_id: 'p-1', wa_access_token: 'test-dummy-brand-token' }, 'WHATSAPP_ACCOUNT_ID_MISSING'],
    ];
    for (const [fields, reason] of cases) {
      await clearCollections();
      const { brand, owner } = await workspace(fields);
      const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearerToken(makeToken(owner))).send({ wa_description: `for ${reason}` });
      assert.strictEqual(res.status, 200, JSON.stringify(res.body));
      assert.strictEqual(res.body.meta_profile_pending_reason, reason);
      assert.strictEqual((await rawBrand(brand.id)).wa_description, `for ${reason}`);
    }
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Current identity ─────────────────────────────────────
  await t.test('I1. /api/auth/me reflects a role or name change on the same session', async () => {
    const { owner } = await workspace();
    const admin = (await sys(() => Users.create({
      tenant_id: 10, role: 'admin', email: 'admin10@acme.test', name: 'Admin Ten', password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0,
    }))).toObject();
    const session = bearerToken(makeToken(admin));
    assert.strictEqual((await request(app).get('/api/auth/me').set(session)).body.role, 'admin');
    await sys(() => Users.updateOne({ id: admin.id }, { $set: { role: 'agent', name: 'Agent Ten' } }));
    const me = await request(app).get('/api/auth/me').set(session);
    assert.strictEqual(me.body.role, 'agent');
    assert.strictEqual(me.body.name, 'Agent Ten');
    const tenant = await request(app).get('/api/tenant').set(session);
    assert.strictEqual(tenant.body.permissions.manage_settings, false, 'server permissions follow the new role');
    assert.ok(owner.id);
  });
});
