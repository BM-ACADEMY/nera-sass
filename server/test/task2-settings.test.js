/**
 * Task 2: the APIs behind customer Settings (Workspace, Brand Profile,
 * WhatsApp, Account, Billing). Real server.js app, in-memory MongoDB, dummy
 * credentials, stubbed Meta HTTP (an unexpected Meta call fails the test).
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axios = require('axios');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

process.env.META_PAGE_ACCESS_TOKEN = 'test-dummy-page';
process.env.META_SYSTEM_USER_ACCESS_TOKEN = 'test-dummy-system';
process.env.META_INVENTORY_ACCESS_TOKEN = '';
process.env.META_APP_ID = 'test-dummy-app';
process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = 'test-dummy-config';

const DAY = 86400000;
const PASSWORD = 'Original-Pass-1';
const BRAND_TOKEN = 'test-dummy-brand-token-4421';
const GRAPH = /^https:\/\/graph\.facebook\.com\/[^/]+\//;
let app;

const metaCalls = [];
let metaRoutes = {};
const realGet = axios.get;
const realPost = axios.post;
const stubbed = (method) => async (url, ...rest) => {
  const config = method === 'GET' ? rest[0] : rest[1];
  metaCalls.push({ method, url, auth: config?.headers?.Authorization || null });
  if (!GRAPH.test(url)) throw new Error(`Unexpected non-Meta URL in test: ${url}`);
  const handler = metaRoutes[`${method} ${url.replace(GRAPH, '')}`];
  if (!handler) throw new Error(`Unstubbed Meta call: ${method} ${url}`);
  return { data: handler };
};

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.get = stubbed('GET');
  axios.post = stubbed('POST');
});

test.after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  metaCalls.length = 0;
  metaRoutes = {};
});

test('Task 2: customer Settings APIs', async (t) => {
  const { Users, Tenants, Clients, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const mfa = require('../services/mfa');
  const sys = (fn) => runAsSystem(fn, 'test');
  const tokenFor = (user, mfaPassed = false) => makeToken(user, { mfa: mfaPassed });
  const bearerToken = (token) => ({ Authorization: `Bearer ${token}` });
  const bearer = (user) => bearerToken(tokenFor(user));
  const createUser = async (fields) => (await sys(() => Users.create({
    password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const freshUser = (id) => sys(() => Users.findOne({ id }).lean());

  async function workspace(tenantId, brandFields = {}) {
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', language: 'en', timezone: 'Asia/Kolkata' }));
    const brand = await runAsTenant(tenantId, async () => {
      return (await Clients.create({ name: `Brand ${tenantId}`, ...brandFields })).toObject();
    });
    const users = {};
    for (const role of ['owner', 'admin', 'manager', 'agent']) {
      users[role] = await createUser({ tenant_id: tenantId, role, email: `${role}${tenantId}@acme.test`, name: `${role} ${tenantId}` });
    }
    return { brand, users };
  }
  const rawBrand = (id) => mongoose.connection.collection('clients').findOne({ id }, { projection: { _id: 0 } });
  const rawTenant = (id) => mongoose.connection.collection('tenants').findOne({ id }, { projection: { _id: 0 } });

  async function assertNoCredential(res, brandId, label) {
    const raw = await rawBrand(brandId);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(BRAND_TOKEN), `${label}: decrypted token returned`);
    if (raw?.wa_access_token_enc) assert.ok(!body.includes(raw.wa_access_token_enc), `${label}: ciphertext returned`);
    for (const key of ['"wa_access_token"', '"wa_access_token_enc"', '"client_wa_token"', '"mfa_secret_enc"', '"password_hash"']) {
      assert.ok(!body.includes(key), `${label}: ${key} present`);
    }
  }

  // ── Permissions and isolation ────────────────────────────
  await t.test('W1. /api/tenant reports each role\'s permission flags; full access and no plan for everyone', async () => {
    const { users } = await workspace(10);
    const expected = {
      owner: { manage_team: true, manage_settings: true, manage_whatsapp: true },
      admin: { manage_team: true, manage_settings: true, manage_whatsapp: true },
      manager: { manage_team: false, manage_settings: false, manage_whatsapp: false },
      agent: { manage_team: false, manage_settings: false, manage_whatsapp: false },
    };
    for (const [role, flags] of Object.entries(expected)) {
      const res = await request(app).get('/api/tenant').set(bearer(users[role]));
      assert.strictEqual(res.status, 200, role);
      assert.deepStrictEqual(res.body.permissions, flags, role);
      assert.strictEqual(res.body.tenant.id, 10);
      assert.strictEqual(res.body.subscription, undefined, `${role}: no plan`);
      assert.strictEqual(res.body.lifecycle.access, 'full', role);
      assert.strictEqual(res.body.usage.max_users, -1, role);
    }
  });

  await t.test('W2. Workspace settings: owner/admin can edit (audited); manager/agent 403; a browser tenant_id is ignored', async () => {
    const { users } = await workspace(10);
    await workspace(20);
    const owner = await request(app).patch('/api/tenant/settings').set(bearer(users.owner)).send({ timezone: 'Asia/Dubai', tenant_id: 20 });
    assert.strictEqual(owner.status, 200, JSON.stringify(owner.body));
    assert.strictEqual((await rawTenant(10)).timezone, 'Asia/Dubai');
    assert.strictEqual((await rawTenant(20)).timezone, 'Asia/Kolkata', 'other workspace unchanged');
    assert.strictEqual((await request(app).patch('/api/tenant/settings').set(bearer(users.admin)).send({ language: 'ta' })).status, 200);
    for (const role of ['manager', 'agent']) {
      const res = await request(app).patch('/api/tenant/settings').set(bearer(users[role])).send({ language: 'hi' });
      assert.strictEqual(res.status, 403, role);
    }
    assert.strictEqual((await rawTenant(10)).language, 'ta');
    assert.strictEqual((await request(app).patch('/api/tenant/settings').set(bearer(users.owner)).send({ language: '' })).status, 400);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'TENANT_UPDATED', tenant_id: 10 })));
  });

  await t.test('W3. The browser cannot select another workspace\'s data', async () => {
    const { brand: brandA } = await workspace(10, { wa_description: 'A' });
    const { users: usersB } = await workspace(20);
    const tenant = await request(app).get('/api/tenant').query({ tenant_id: 10 }).set(bearer(usersB.owner)).set('x-tenant-id', '10');
    assert.strictEqual(tenant.body.tenant.id, 20);
    const brands = await request(app).get('/api/clients').query({ tenant_id: 10 }).set(bearer(usersB.owner)).set('x-tenant-id', '10');
    assert.ok(brands.body.clients.length === 1 && brands.body.clients[0].tenant_id === 20);
    const edit = await request(app).patch(`/api/clients/${brandA.id}`).set(bearer(usersB.owner)).send({ wa_description: 'B' });
    assert.strictEqual(edit.status, 404);
    assert.strictEqual((await rawBrand(brandA.id)).wa_description, 'A');
  });

  // ── Brand profile ────────────────────────────────────────
  await t.test('P1. Profile edit with WhatsApp not connected: saved, no Meta call, sync pending, audited', async () => {
    const { brand, users } = await workspace(10);
    const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ name: 'New Name', wa_description: 'About us' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.meta_profile_pending, true);
    assert.strictEqual(res.body.meta_profile_pending_reason, 'WHATSAPP_NOT_CONNECTED');
    const raw = await rawBrand(brand.id);
    assert.strictEqual(raw.name, 'New Name');
    assert.strictEqual(raw.wa_description, 'About us');
    assert.strictEqual(metaCalls.length, 0);
    const event = await sys(() => AuditEvents.findOne({ event: 'BRAND_UPDATED', tenant_id: 10 }).lean());
    assert.deepStrictEqual(event.meta.fields.sort(), ['name', 'wa_description']);
  });

  await t.test('P2. Profile edit with a number but no own token: saved, no Meta call, credential reported missing', async () => {
    const { brand, users } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111' });
    const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.admin)).send({ wa_website: 'https://example.test' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.meta_profile_pending_reason, 'WHATSAPP_CREDENTIAL_MISSING');
    assert.strictEqual((await rawBrand(brand.id)).wa_website, 'https://example.test');
    assert.strictEqual(metaCalls.length, 0, 'never falls back to the platform token');
  });

  await t.test('P3. Profile edit when connected syncs to Meta with the brand\'s own token; a Meta failure saves nothing', async () => {
    const { brand, users } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111', wa_access_token: BRAND_TOKEN });
    metaRoutes['GET waba-1/phone_numbers'] = { data: [{ id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED' }] };
    metaRoutes['POST p-1/whatsapp_business_profile'] = { success: true };
    metaRoutes['GET p-1/whatsapp_business_profile'] = { data: [{ description: 'Synced' }] };
    const ok = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ wa_description: 'Synced' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.meta_profile_synced, true);
    assert.strictEqual(ok.body.meta_profile_pending, false);
    await assertNoCredential(ok, brand.id, 'connected profile edit');
    for (const call of metaCalls) assert.strictEqual(call.auth, `Bearer ${BRAND_TOKEN}`);

    delete metaRoutes['POST p-1/whatsapp_business_profile'];
    const failed = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ wa_description: 'Not saved' });
    assert.strictEqual(failed.status, 400);
    assert.strictEqual((await rawBrand(brand.id)).wa_description, 'Synced');

    // A non-Meta field never calls Meta, even when connected.
    metaCalls.length = 0;
    const nameOnly = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ name: 'Renamed' });
    assert.strictEqual(nameOnly.status, 200);
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('P4. Managers and agents cannot edit the brand profile', async () => {
    const { brand, users } = await workspace(10);
    for (const role of ['manager', 'agent']) {
      const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users[role])).send({ wa_description: 'x' });
      assert.strictEqual(res.status, 403, role);
    }
    assert.strictEqual((await rawBrand(brand.id)).wa_description ?? null, null);
  });

  // ── WhatsApp entry point ─────────────────────────────────
  await t.test('A1. Connect WhatsApp stays unavailable while secure signup is pending', async () => {
    const { brand, users } = await workspace(10);
    const config = await request(app).get('/api/meta/embedded-signup/config').set(bearer(users.owner));
    assert.strictEqual(config.body.enabled, false);
    assert.strictEqual(config.body.reason, 'SECURE_SIGNUP_PENDING');
    const complete = await request(app).post(`/api/clients/${brand.id}/meta-embedded-signup/complete`).set(bearer(users.owner)).send({ waba_id: 'w', phone_number_id: 'p' });
    assert.strictEqual(complete.status, 503);
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Account ──────────────────────────────────────────────
  await t.test('C1. Password change: wrong current keeps the session; success returns a fresh token and revokes the old one', async () => {
    const { users } = await workspace(10);
    const oldToken = tokenFor(users.agent);
    const wrong = await request(app).post('/api/auth/change-password').set(bearerToken(oldToken)).send({ current: 'nope', newPassword: 'Brand-New-Pass-2' });
    assert.strictEqual(wrong.status, 400);
    assert.strictEqual((await request(app).get('/api/auth/me').set(bearerToken(oldToken))).status, 200, 'session still valid');

    const ok = await request(app).post('/api/auth/change-password').set(bearerToken(oldToken)).send({ current: PASSWORD, newPassword: 'Brand-New-Pass-2' });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token);
    assert.strictEqual((await request(app).get('/api/auth/me').set(bearerToken(oldToken))).status, 401, 'old session revoked');
    const me = await request(app).get('/api/auth/me').set(bearerToken(ok.body.token));
    assert.strictEqual(me.status, 200, 'fresh token works');
    assert.strictEqual(me.body.role, 'agent');
    await assertNoCredential(me, 0, '/api/auth/me');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'PASSWORD_CHANGED', target_id: String(users.agent.id) })));
  });

  await t.test('C2. MFA enrolment from Settings: a wrong code changes nothing; a correct code enables MFA and returns a session', async () => {
    const { users } = await workspace(10);
    const session = tokenFor(users.manager);
    const start = await request(app).post('/api/auth/mfa/setup').set(bearerToken(session)).send({});
    assert.strictEqual(start.status, 200, JSON.stringify(start.body));
    assert.ok(start.body.secret && start.body.otpauth_url.startsWith('otpauth://'));

    const wrong = await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: '000000' });
    assert.strictEqual(wrong.status, 401);
    assert.strictEqual(wrong.body.code, 'INVALID_MFA_CODE', 'a wrong code, not a dead session: the app keeps the session');
    assert.strictEqual((await freshUser(users.manager.id)).mfa_enabled ?? false, false);
    assert.strictEqual((await request(app).get('/api/auth/me').set(bearerToken(session))).status, 200, 'session still valid');

    const confirm = await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: mfa.totp(start.body.secret) });
    assert.strictEqual(confirm.status, 200, JSON.stringify(confirm.body));
    assert.ok(confirm.body.token);
    assert.strictEqual(confirm.body.recovery_codes.length, 10);
    assert.ok(!JSON.stringify(confirm.body).includes(start.body.secret), 'secret not echoed after enrolment');
    assert.strictEqual((await freshUser(users.manager.id)).mfa_enabled, true);
    const me = await request(app).get('/api/auth/me').set(bearerToken(confirm.body.token));
    assert.strictEqual(me.body.mfa_enabled, true);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'MFA_ENROLLED', target_id: String(users.manager.id) })));

    const again = await request(app).post('/api/auth/mfa/setup').set(bearerToken(confirm.body.token)).send({});
    assert.strictEqual(again.status, 400, 'already enabled');
  });

  await t.test('C3. After enrolment, login asks for the code; a TOTP or recovery code completes it', async () => {
    const { users } = await workspace(10);
    const session = tokenFor(users.agent);
    const start = await request(app).post('/api/auth/mfa/setup').set(bearerToken(session)).send({});
    const confirm = await request(app).post('/api/auth/mfa/setup/confirm').set(bearerToken(session)).send({ code: mfa.totp(start.body.secret) });

    const login = await request(app).post('/api/auth/login').send({ email: users.agent.email, password: PASSWORD });
    assert.strictEqual(login.status, 200);
    assert.strictEqual(login.body.mfa_required, true);
    assert.ok(login.body.mfa_token);
    assert.strictEqual(login.body.token, undefined, 'no session before the code');

    const bad = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, code: '000000' });
    assert.strictEqual(bad.status, 401);
    const good = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: login.body.mfa_token, code: mfa.totp(start.body.secret) });
    assert.strictEqual(good.status, 200, JSON.stringify(good.body));
    assert.strictEqual(good.body.user.role, 'agent');
    assert.strictEqual((await request(app).get('/api/auth/me').set(bearerToken(good.body.token))).status, 200);

    const again = await request(app).post('/api/auth/login').send({ email: users.agent.email, password: PASSWORD });
    const recovery = await request(app).post('/api/auth/mfa/verify').send({ mfa_token: again.body.mfa_token, recovery_code: confirm.body.recovery_codes[0] });
    assert.strictEqual(recovery.status, 200);
    const reuse = await request(app).post('/api/auth/login').send({ email: users.agent.email, password: PASSWORD });
    assert.strictEqual((await request(app).post('/api/auth/mfa/verify').send({ mfa_token: reuse.body.mfa_token, recovery_code: confirm.body.recovery_codes[0] })).status, 401, 'recovery code is single-use');
  });

  await t.test('C4. Sign out of all devices revokes every session, including the current one', async () => {
    const { users } = await workspace(10);
    const current = tokenFor(users.owner);
    const other = tokenFor(users.owner);
    const res = await request(app).post('/api/auth/logout-all').set(bearerToken(current));
    assert.strictEqual(res.status, 200);
    for (const token of [current, other]) {
      const me = await request(app).get('/api/auth/me').set(bearerToken(token));
      assert.strictEqual(me.status, 401);
      assert.strictEqual(me.body.code, 'SESSION_REVOKED');
    }
    assert.ok(await sys(() => AuditEvents.exists({ event: 'SESSIONS_REVOKED', target_id: String(users.owner.id) })));
    const login = await request(app).post('/api/auth/login').send({ email: users.owner.email, password: PASSWORD });
    assert.ok(login.body.token, 'can sign in again');
  });

  // ── No credentials anywhere ──────────────────────────────
  await t.test('N1. No Settings API response carries a token or ciphertext', async () => {
    const { brand, users } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111', wa_access_token: BRAND_TOKEN });
    for (const [label, path] of [['tenant', '/api/tenant'], ['me', '/api/auth/me'], ['clients', '/api/clients'], ['signup config', '/api/meta/embedded-signup/config']]) {
      for (const role of ['owner', 'agent']) {
        const res = await request(app).get(path).set(bearer(users[role]));
        assert.strictEqual(res.status, 200, `${label} ${role}`);
        await assertNoCredential(res, brand.id, `${label} (${role})`);
      }
    }
    const list = await request(app).get('/api/clients').set(bearer(users.agent));
    assert.strictEqual(list.body.clients[0].wa_token_configured, true);
    assert.strictEqual(list.body.clients[0].wa_token_last4, '4421');
  });
});
