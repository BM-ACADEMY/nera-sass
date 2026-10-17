/**
 * Task 2.0: customer brand API security.
 *  - responses never carry a decrypted WhatsApp token or its ciphertext
 *  - profile changes need tenant.settings, WhatsApp changes need whatsapp.manage
 *  - one workspace cannot reach another's brand
 *  - customers cannot create or delete brands
 *  - the legacy embedded-signup completion is paused and never calls Meta
 *
 * Real server.js app, in-memory MongoDB, dummy credentials, stubbed Meta HTTP.
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
const BRAND_TOKEN = 'test-dummy-brand-token-7781';
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

test('Task 2.0: customer brand API security', async (t) => {
  const { Users, Tenants, Clients, Subscriptions } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
  const createUser = async (fields) => (await sys(() => Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();

  // A workspace, its brand and one user per customer role.
  async function workspace(tenantId, brandFields = {}) {
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active' }));
    const brand = await runAsTenant(tenantId, async () => {
      await Subscriptions.create({
        plan_code: 'TEST', status: 'active', limits: { max_users: 10 },
        current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * DAY),
      });
      return (await Clients.create({ name: `Brand ${tenantId}`, ...brandFields })).toObject();
    });
    const users = {};
    for (const role of ['owner', 'admin', 'manager', 'agent']) {
      users[role] = await createUser({ tenant_id: tenantId, role, email: `${role}${tenantId}@acme.test`, name: role });
    }
    return { brand, users };
  }
  const connected = { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111', wa_access_token: BRAND_TOKEN };

  const rawBrand = (id) => mongoose.connection.collection('clients').findOne({ id }, { projection: { _id: 0 } });
  const brandCount = () => mongoose.connection.collection('clients').countDocuments({});

  // No decrypted token, no ciphertext, no secret key anywhere in the body.
  async function assertNoSecret(res, brandId, label) {
    const raw = await rawBrand(brandId);
    const body = JSON.stringify(res.body);
    assert.ok(!body.includes(BRAND_TOKEN), `${label}: decrypted token returned`);
    if (raw?.wa_access_token_enc) assert.ok(!body.includes(raw.wa_access_token_enc), `${label}: ciphertext returned`);
    for (const key of ['"wa_access_token"', '"wa_access_token_enc"', '"client_wa_token"']) {
      assert.ok(!body.includes(key), `${label}: ${key} key present`);
    }
  }

  // ── Responses ────────────────────────────────────────────
  await t.test('B1. Brand responses exclude the token and ciphertext and report only configured + last 4', async () => {
    const { brand, users } = await workspace(10, connected);
    const list = await request(app).get('/api/clients').set(bearer(users.agent));
    assert.strictEqual(list.status, 200);
    await assertNoSecret(list, brand.id, 'GET /api/clients');
    assert.strictEqual(list.body.clients[0].wa_token_configured, true);
    assert.strictEqual(list.body.clients[0].wa_token_last4, '7781');

    // Profile change (no Meta call needed: the owner changes only the status).
    const patch = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ status: 'active' });
    assert.strictEqual(patch.status, 200, JSON.stringify(patch.body));
    await assertNoSecret(patch, brand.id, 'PATCH /api/clients/:id');
    assert.strictEqual(patch.body.client.wa_token_configured, true);

    const noop = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({});
    assert.strictEqual(noop.status, 200);
    await assertNoSecret(noop, brand.id, 'PATCH no-op');

    // WhatsApp setup with stubbed Meta (the brand's own dummy token).
    metaRoutes['GET waba-1/phone_numbers'] = { data: [{ id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED' }] };
    metaRoutes['POST p-1/whatsapp_business_profile'] = { success: true };
    metaRoutes['GET p-1/whatsapp_business_profile'] = { data: [{}] };
    const setup = await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(users.admin));
    assert.strictEqual(setup.status, 200, JSON.stringify(setup.body));
    await assertNoSecret(setup, brand.id, 'POST whatsapp-setup');
    for (const call of metaCalls) assert.strictEqual(call.auth, `Bearer ${BRAND_TOKEN}`, 'setup uses the brand\'s own token');
  });

  await t.test('B2. The response guard strips WhatsApp secrets for customers only', async () => {
    const { stripWhatsAppSecrets, customerResponseGuard } = require('../services/responseGuard');
    const payload = { lead: { id: 1, client_wa_token: 'x', nested: [{ wa_access_token: 'y', wa_access_token_enc: 'z', keep: 1 }] }, wa_token_last4: '1234' };
    assert.deepStrictEqual(stripWhatsAppSecrets(payload), { lead: { id: 1, nested: [{ keep: 1 }] }, wa_token_last4: '1234' });

    const run = (identity) => {
      let sent;
      const res = { json: (body) => { sent = body; return body; } };
      customerResponseGuard({ identity }, res, () => {});
      res.json(payload);
      return sent;
    };
    assert.ok(!JSON.stringify(run({ kind: 'tenant', tenantId: 1 })).includes('client_wa_token'), 'customer response stripped');
    assert.strictEqual(run({ kind: 'service', tenantId: 1 }), payload, 'service calls unchanged');
    assert.strictEqual(run({ kind: 'staff' }), payload, 'staff routes unchanged');
  });

  // ── Roles ────────────────────────────────────────────────
  await t.test('B3. Managers and agents cannot change the profile or credentials, run setup or upload a logo', async () => {
    const { brand, users } = await workspace(10, connected);
    const before = await rawBrand(brand.id);
    for (const role of ['manager', 'agent']) {
      const who = bearer(users[role]);
      const profile = await request(app).patch(`/api/clients/${brand.id}`).set(who).send({ wa_description: 'changed' });
      assert.strictEqual(profile.status, 403, `${role} profile`);
      assert.strictEqual(profile.body.permission, 'tenant.settings');
      const creds = await request(app).patch(`/api/clients/${brand.id}`).set(who).send({ wa_access_token: 'new-token', phone_number_id: 'p-9' });
      assert.strictEqual(creds.status, 403, `${role} credentials`);
      const setup = await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(who);
      assert.strictEqual(setup.status, 403, `${role} setup`);
      assert.strictEqual(setup.body.permission, 'whatsapp.manage');
      const logo = await request(app).post(`/api/clients/${brand.id}/meta-profile-logo`).set(who);
      assert.strictEqual(logo.status, 403, `${role} logo`);
      const signup = await request(app).post(`/api/clients/${brand.id}/meta-embedded-signup/complete`).set(who).send({ waba_id: 'w', phone_number_id: 'p' });
      assert.strictEqual(signup.status, 403, `${role} signup`);
      const del = await request(app).delete(`/api/clients/${brand.id}`).set(who);
      assert.strictEqual(del.status, 403, `${role} delete`);
    }
    assert.deepStrictEqual(await rawBrand(brand.id), before, 'brand unchanged');
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('B4. Owners and admins can change the profile and WhatsApp credentials', async () => {
    const { brand, users } = await workspace(10);
    const owner = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.owner)).send({ name: 'Renamed Brand' });
    assert.strictEqual(owner.status, 200, JSON.stringify(owner.body));
    const admin = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(users.admin)).send({ phone_number_id: 'p-new', wa_access_token: BRAND_TOKEN });
    assert.strictEqual(admin.status, 200, JSON.stringify(admin.body));
    await assertNoSecret(admin, brand.id, 'admin credential update');
    const raw = await rawBrand(brand.id);
    assert.strictEqual(raw.name, 'Renamed Brand');
    assert.strictEqual(raw.phone_number_id, 'p-new');
    assert.ok(raw.wa_access_token_enc && raw.wa_access_token_enc !== BRAND_TOKEN, 'stored encrypted');
    assert.strictEqual(raw.wa_access_token, undefined);
  });

  // ── Isolation ────────────────────────────────────────────
  await t.test('B5. One workspace cannot read or change another workspace\'s brand', async () => {
    const { brand: brandA } = await workspace(10, connected);
    const { users: usersB } = await workspace(20);
    const beforeA = await rawBrand(brandA.id);
    const list = await request(app).get('/api/clients').query({ tenant_id: 10 }).set(bearer(usersB.owner));
    assert.strictEqual(list.status, 200);
    assert.ok(list.body.clients.every((c) => c.tenant_id === 20), 'only the caller\'s own brand');
    const patch = await request(app).patch(`/api/clients/${brandA.id}`).set(bearer(usersB.owner)).send({ name: 'Taken over' });
    assert.strictEqual(patch.status, 404);
    const setup = await request(app).post(`/api/clients/${brandA.id}/whatsapp-setup`).set(bearer(usersB.owner));
    assert.strictEqual(setup.status, 404);
    assert.deepStrictEqual(await rawBrand(brandA.id), beforeA);
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Creation and deletion ────────────────────────────────
  await t.test('B6. Customers cannot create or delete brands, even naming another workspace', async () => {
    const { brand, users } = await workspace(10, connected);
    await workspace(20);
    const countBefore = await brandCount();
    const before = await rawBrand(brand.id);
    const create = await request(app).post('/api/clients').set(bearer(users.owner)).send({ name: 'Second Brand' });
    assert.strictEqual(create.status, 403);
    assert.strictEqual(create.body.code, 'BRAND_MANAGED_BY_PLATFORM');
    const injected = await request(app).post('/api/clients').set(bearer(users.owner)).send({ name: 'Injected', tenant_id: 20 });
    assert.strictEqual(injected.status, 403);
    const del = await request(app).delete(`/api/clients/${brand.id}`).set(bearer(users.owner));
    assert.strictEqual(del.status, 403);
    assert.strictEqual(del.body.code, 'BRAND_MANAGED_BY_PLATFORM');
    assert.strictEqual(await brandCount(), countBefore, 'no brand created or deleted');
    assert.deepStrictEqual(await rawBrand(brand.id), before);
    assert.strictEqual(metaCalls.length, 0, 'no Meta deregistration');
  });

  // ── Legacy embedded signup ───────────────────────────────
  await t.test('B7. Legacy embedded signup: config disabled, completion 503 for owners, no Meta call, nothing changed', async () => {
    const { brand, users } = await workspace(10);
    const before = await rawBrand(brand.id);
    const config = await request(app).get('/api/meta/embedded-signup/config').set(bearer(users.owner));
    assert.strictEqual(config.status, 200);
    assert.strictEqual(config.body.enabled, false);
    assert.strictEqual(config.body.reason, 'SECURE_SIGNUP_PENDING');
    assert.strictEqual(config.body.app_id, undefined, 'nothing to start the Meta flow with');
    assert.strictEqual(config.body.config_id, undefined);
    metaRoutes['GET waba-1/phone_numbers'] = { data: [{ id: 'p-new', display_phone_number: '911111111111', status: 'CONNECTED' }] };
    const res = await request(app).post(`/api/clients/${brand.id}/meta-embedded-signup/complete`).set(bearer(users.owner))
      .send({ waba_id: 'waba-1', phone_number_id: 'p-new' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'SECURE_SIGNUP_PENDING');
    assert.deepStrictEqual(await rawBrand(brand.id), before);
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Admin credential path preserved ──────────────────────
  await t.test('B8. The admin credential path still works and stays sanitised', async () => {
    const { brand } = await workspace(10);
    const founder = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'founder' });
    const put = await request(app).put('/api/admin/tenants/10/whatsapp').set(bearer(founder))
      .send({ phone_number_id: 'p-7', wa_business_id: 'waba-7', whatsapp_number: '917777777777', wa_access_token: BRAND_TOKEN });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    await assertNoSecret(put, brand.id, 'admin PUT whatsapp');
    assert.strictEqual(put.body.brand.wa_token_configured, true);
    const list = await request(app).get('/api/admin/clients').set(bearer(founder));
    await assertNoSecret(list, brand.id, 'admin GET clients');
    assert.ok((await rawBrand(brand.id)).wa_access_token_enc);
  });
});
