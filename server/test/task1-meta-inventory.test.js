/**
 * Task 1A: platform Meta WhatsApp inventory moved to staff-only admin routes,
 * customer-owned WhatsApp numbers, and cross-tenant number uniqueness.
 *
 * Real server.js app, in-memory MongoDB. Every Meta credential is a dummy
 * value set before the server loads (so nothing from .env is used), and every
 * Meta HTTP call goes to a recording stub; an unexpected URL fails the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axios = require('axios');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

// Dummy credentials, set before server.js loads .env (which never overrides
// values already present in a test run).
process.env.META_PAGE_ACCESS_TOKEN = 'test-dummy-page';
process.env.META_SYSTEM_USER_ACCESS_TOKEN = 'test-dummy-system';
process.env.META_INVENTORY_ACCESS_TOKEN = '';
process.env.META_PHONE_REGISTRATION_ENABLED = '';
process.env.META_INVENTORY_SYNC = 'on';
process.env.WA_BUSINESS_ACCOUNT_ID = 'waba-1';
process.env.META_BUSINESS_ID = '';
process.env.WA_META_BUSINESS_ID = '';

const DAY = 86400000;
const GRAPH = /^https:\/\/graph\.facebook\.com\/[^/]+\//;
let app;
let scheduledMetaInventorySync;

// ── Meta HTTP stub ─────────────────────────────────────────
const metaCalls = [];
// Every non-dummy credential seen during the whole file (never reset).
const credentialViolations = [];
let metaRoutes = {};
const realGet = axios.get;
const realPost = axios.post;

function stubbed(method) {
  return async (url, ...rest) => {
    const config = method === 'GET' ? rest[0] : rest[1];
    const authHeader = config?.headers?.Authorization || null;
    metaCalls.push({ method, url, auth: authHeader });
    if (!/^Bearer test-dummy-/.test(String(authHeader))) credentialViolations.push(url);
    if (!GRAPH.test(url)) throw new Error(`Unexpected non-Meta URL in test: ${url}`);
    const path = url.replace(GRAPH, '');
    const handler = metaRoutes[`${method} ${path}`];
    if (!handler) throw new Error(`Unstubbed Meta call: ${method} ${path}`);
    return { data: typeof handler === 'function' ? handler() : handler };
  };
}

function assertDummyCredentialsOnly() {
  for (const call of metaCalls) {
    assert.match(String(call.auth), /^Bearer test-dummy-/, `call to ${call.url} used a non-dummy credential`);
  }
}

// Records which collections Mongoose touches while fn runs.
async function collectionsTouched(fn) {
  const touched = new Set();
  mongoose.set('debug', (collection) => touched.add(collection));
  try {
    await fn();
  } finally {
    mongoose.set('debug', false);
  }
  return touched;
}

async function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const WITH_TOKEN = { META_INVENTORY_ACCESS_TOKEN: 'test-dummy-inventory' };

// Stubbed Meta responses for a single-WABA sync of waba-1.
function stubInventorySync(phones) {
  metaRoutes['GET waba-1'] = { id: 'waba-1', name: 'Platform WABA' };
  metaRoutes['GET waba-1/phone_numbers'] = { data: phones };
  metaRoutes['GET waba-1/message_templates'] = { data: [] };
  for (const phone of phones) metaRoutes[`GET ${phone.id}/whatsapp_business_profile`] = { data: [{}] };
}

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  ({ app, scheduledMetaInventorySync } = require('../server'));
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

test('Task 1A: Meta inventory, customer-owned numbers, cross-tenant uniqueness', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Subscriptions, AuditEvents, MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates, MetaWhatsappSyncRuns } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

  const createUser = async (fields) => (await sys(() => Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();
  const staff = (role) => createUser({ tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role });

  // A workspace with an active subscription, its brand and its Owner.
  async function workspace(tenantId, brandFields = {}) {
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active' }));
    const brand = await runAsTenant(tenantId, async () => {
      await Subscriptions.create({
        plan_code: 'TEST', status: 'active', limits: { max_users: 10 },
        current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * DAY),
      });
      return (await Clients.create({ name: `Brand ${tenantId}`, ...brandFields })).toObject();
    });
    const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: 'Owner' });
    return { brand, owner };
  }

  // Platform inventory rows (tenant_id null), as the system sync writes them.
  async function seedInventory(phones) {
    await sys(() => MetaWhatsappAccounts.create({ waba_id: 'waba-1', name: 'Platform WABA' }));
    for (const phone of phones) await sys(() => MetaWhatsappPhoneNumbers.create({ waba_id: 'waba-1', ...phone }));
  }

  const brandDoc = (id) => sys(() => Clients.findOne({ id }, { _id: 0, wa_access_token_enc: 0, updated_at: 0 }).lean());
  const inventoryPhone = (phoneId) => sys(() => MetaWhatsappPhoneNumbers.findOne({ phone_number_id: phoneId }).lean());

  // ── Access ───────────────────────────────────────────────
  await t.test('M1. Founder and ops can view the inventory; support, customers and anonymous cannot', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const { owner } = await workspace(10);
    for (const role of ['founder', 'ops']) {
      const res = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(await staff(role)));
      assert.strictEqual(res.status, 200, `${role}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.phone_numbers.length, 1);
      assert.strictEqual(res.body.registration_enabled, false);
      assert.strictEqual(res.body.credential_configured, false);
      assert.strictEqual(res.body.can_administer, role === 'founder');
    }
    const support = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(await staff('support')));
    assert.strictEqual(support.status, 403);
    assert.strictEqual(support.body.permission, 'platform.meta');
    const customer = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(owner));
    assert.strictEqual(customer.status, 403);
    assert.strictEqual(customer.body.code, 'STAFF_ONLY');
    assert.strictEqual((await request(app).get('/api/admin/meta/whatsapp/inventory')).status, 401);

    const opsMe = await request(app).get('/api/admin/me').set(bearer(await sys(() => Users.findOne({ staff_role: 'ops' }).lean())));
    assert.strictEqual(opsMe.body.permissions['platform.meta'], true);
    assert.strictEqual(opsMe.body.permissions['platform.meta.admin'], false);
  });

  await t.test('M2. The old customer inventory routes are gone and change nothing', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const { owner, brand } = await workspace(10);
    const before = await brandDoc(brand.id);
    const attempts = [
      ['get', '/api/meta/whatsapp/inventory'],
      ['post', '/api/meta/whatsapp/sync'],
      ['delete', '/api/meta/whatsapp/cache/wabas/waba-1'],
      ['post', '/api/meta/whatsapp/phone-numbers/p-1/register'],
      ['patch', '/api/meta/whatsapp/phone-numbers/p-1/map'],
    ];
    for (const [method, url] of attempts) {
      const res = await request(app)[method](url).set(bearer(owner)).send({ client_id: brand.id, pin: '123456' });
      assert.strictEqual(res.status, 404, `${method.toUpperCase()} ${url} returned ${res.status}`);
    }
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    assert.strictEqual((await inventoryPhone('p-1')).client_id ?? null, null);
    assert.strictEqual(await sys(() => MetaWhatsappAccounts.countDocuments({})), 1);
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('M3. Ops cannot register or clear the cache; refused before any inventory read or Meta call', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const ops = await staff('ops');
    await withEnv({ ...WITH_TOKEN, META_PHONE_REGISTRATION_ENABLED: 'true' }, async () => {
      let register;
      let clear;
      const touched = await collectionsTouched(async () => {
        register = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/register').set(bearer(ops)).send({ pin: '123456' });
        clear = await request(app).delete('/api/admin/meta/whatsapp/cache/wabas/waba-1').set(bearer(ops));
      });
      assert.strictEqual(register.status, 403);
      assert.strictEqual(register.body.permission, 'platform.meta.admin');
      assert.strictEqual(clear.status, 403);
      assert.ok(touched.has('users'), 'the spy records queries (the staff account was read)');
      for (const collection of touched) assert.ok(!collection.startsWith('meta_whatsapp'), `touched ${collection} before authorization`);
    });
    assert.strictEqual(metaCalls.length, 0);
    assert.strictEqual(await sys(() => MetaWhatsappAccounts.countDocuments({})), 1);
    assert.strictEqual(await sys(() => MetaWhatsappPhoneNumbers.countDocuments({})), 1);
    assert.strictEqual(await sys(() => AuditEvents.countDocuments({ event: /^META_/ })), 0);
  });

  // ── Credentials ──────────────────────────────────────────
  await t.test('M4. Sync without META_INVENTORY_ACCESS_TOKEN: 503, no Meta call, no sync run, old tokens ignored', async () => {
    const founder = await staff('founder');
    stubInventorySync([]);
    const res = await request(app).post('/api/admin/meta/whatsapp/sync').set(bearer(founder));
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'META_CREDENTIAL_NOT_CONFIGURED');
    assert.strictEqual(metaCalls.length, 0, 'the old page/system tokens must not be used as a fallback');
    assert.strictEqual(await sys(() => MetaWhatsappSyncRuns.countDocuments({})), 0);
  });

  await t.test('M5. Registration is off by default, and needs the inventory credential when on', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const founder = await staff('founder');
    const off = await withEnv(WITH_TOKEN, () => request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/register').set(bearer(founder)).send({ pin: '123456' }));
    assert.strictEqual(off.status, 403);
    assert.strictEqual(off.body.code, 'REGISTRATION_DISABLED');
    const noToken = await withEnv({ META_PHONE_REGISTRATION_ENABLED: 'true' }, () =>
      request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/register').set(bearer(founder)).send({ pin: '123456' }));
    assert.strictEqual(noToken.status, 503);
    assert.strictEqual(noToken.body.code, 'META_CREDENTIAL_NOT_CONFIGURED');
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('M6. Founder registration with the flag and a dummy inventory token calls only stubbed Meta, audited', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const founder = await staff('founder');
    stubInventorySync([{ id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED' }]);
    metaRoutes['POST p-1/register'] = { success: true };
    metaRoutes['POST waba-1/subscribed_apps'] = { success: true };
    const res = await withEnv({ ...WITH_TOKEN, META_PHONE_REGISTRATION_ENABLED: 'true' }, () =>
      request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/register').set(bearer(founder)).send({ pin: '123456' }));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(metaCalls.some((c) => c.method === 'POST' && c.url.endsWith('/p-1/register')));
    for (const call of metaCalls) assert.strictEqual(call.auth, 'Bearer test-dummy-inventory');
    const event = await sys(() => AuditEvents.findOne({ event: 'META_PHONE_REGISTERED' }).lean());
    assert.strictEqual(event.actor_user_id, founder.id);
    assert.strictEqual(event.meta.outcome, 'registered');
    assert.ok(!JSON.stringify(event.meta).includes('123456'), 'PIN is not stored');
  });

  await t.test('M7. Sync with a dummy inventory token fills the inventory from stubbed Meta', async () => {
    const ops = await staff('ops');
    stubInventorySync([{ id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED', quality_rating: 'GREEN' }]);
    const res = await withEnv(WITH_TOKEN, () => request(app).post('/api/admin/meta/whatsapp/sync').set(bearer(ops)));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.phone_numbers, 1);
    assert.strictEqual((await inventoryPhone('p-1')).quality_rating, 'GREEN');
    for (const call of metaCalls) assert.strictEqual(call.auth, 'Bearer test-dummy-inventory');
    assert.strictEqual(await sys(() => AuditEvents.countDocuments({ event: 'META_INVENTORY_SYNCED' })), 1);
  });

  await t.test('M8. The scheduled sync is skipped without the inventory credential', async () => {
    stubInventorySync([]);
    const result = await scheduledMetaInventorySync();
    assert.deepStrictEqual(result, { skipped: true });
    assert.strictEqual(metaCalls.length, 0);
    assert.strictEqual(await sys(() => MetaWhatsappSyncRuns.countDocuments({})), 0);
  });

  // ── Customer ownership ───────────────────────────────────
  await t.test('M9. Link is refused unless the brand already uses this number; the brand is unchanged', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const { brand } = await workspace(10, { phone_number_id: 'own-1', wa_business_id: 'own-waba', whatsapp_number: '919999999999' });
    const before = await brandDoc(brand.id);
    const ops = await staff('ops');
    const res = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/link').set(bearer(ops)).send({ client_id: brand.id });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'IDENTITY_MISMATCH');
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    assert.strictEqual((await inventoryPhone('p-1')).client_id ?? null, null);
  });

  await t.test('M10. Link succeeds when the brand already uses the number, and changes only the inventory row', async () => {
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111' }]);
    const { brand } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111' });
    const before = await brandDoc(brand.id);
    const res = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/link').set(bearer(await staff('founder'))).send({ client_id: brand.id });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual((await inventoryPhone('p-1')).client_id, brand.id);
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    const event = await sys(() => AuditEvents.findOne({ event: 'META_PHONE_LINKED' }).lean());
    assert.strictEqual(event.tenant_id, 10);
  });

  await t.test('M11. Unlink clears only the inventory link; the brand keeps its number and token', async () => {
    const { brand } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111', wa_access_token: 'customer-own-token' });
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111', client_id: brand.id }]);
    const before = await brandDoc(brand.id);
    const rawBefore = await mongoose.connection.collection('clients').findOne({ id: brand.id });
    const res = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/unlink').set(bearer(await staff('ops')));
    assert.strictEqual(res.status, 200);
    assert.strictEqual((await inventoryPhone('p-1')).client_id, null);
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    const rawAfter = await mongoose.connection.collection('clients').findOne({ id: brand.id });
    assert.strictEqual(rawAfter.wa_access_token_enc, rawBefore.wa_access_token_enc);
  });

  await t.test('M12. Sync never rewrites a brand\'s number, WABA or display number', async () => {
    // Brand 10 moved to its own new number after being linked; brand 20 still uses its linked number.
    const { brand: moved } = await workspace(10, { phone_number_id: 'own-9', wa_business_id: 'own-waba', whatsapp_number: '919999999999' });
    const { brand: same } = await workspace(20, { phone_number_id: 'p-2', wa_business_id: 'waba-1', whatsapp_number: '912222222222', whatsapp_status: 'verification_pending' });
    await seedInventory([
      { phone_number_id: 'p-1', display_phone_number: '911111111111', client_id: moved.id },
      { phone_number_id: 'p-2', display_phone_number: '912222222222', client_id: same.id },
    ]);
    stubInventorySync([
      { id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED' },
      { id: 'p-2', display_phone_number: '+91 22222 22222', status: 'CONNECTED' },
    ]);
    const movedBefore = await brandDoc(moved.id);
    const founder = await staff('founder');
    const res = await withEnv(WITH_TOKEN, () => request(app).post('/api/admin/meta/whatsapp/sync').set(bearer(founder)));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(await brandDoc(moved.id), movedBefore, 'a brand that changed its number is left alone');
    const sameAfter = await brandDoc(same.id);
    assert.strictEqual(sameAfter.phone_number_id, 'p-2');
    assert.strictEqual(sameAfter.wa_business_id, 'waba-1');
    assert.strictEqual(sameAfter.whatsapp_number, '912222222222', 'display number not copied from the inventory');
    assert.strictEqual(sameAfter.whatsapp_status, 'verified', 'status is still refreshed');
  });

  await t.test('M13. Clearing a WABA cache removes only inventory rows; brands untouched; linked WABAs refused', async () => {
    const { brand } = await workspace(10, { phone_number_id: 'p-1', wa_business_id: 'waba-1', whatsapp_number: '911111111111' });
    await seedInventory([{ phone_number_id: 'p-1', display_phone_number: '911111111111', client_id: brand.id }]);
    await sys(() => MetaWhatsappTemplates.create({ template_id: 't-1', waba_id: 'waba-1', name: 'hello' }));
    const founder = await staff('founder');
    const before = await brandDoc(brand.id);
    const refused = await request(app).delete('/api/admin/meta/whatsapp/cache/wabas/waba-1').set(bearer(founder));
    assert.strictEqual(refused.status, 409);
    assert.strictEqual(refused.body.code, 'WABA_HAS_LINKED_PHONE');
    await request(app).post('/api/admin/meta/whatsapp/phone-numbers/p-1/unlink').set(bearer(founder));
    const res = await request(app).delete('/api/admin/meta/whatsapp/cache/wabas/waba-1').set(bearer(founder));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await sys(() => MetaWhatsappAccounts.countDocuments({})), 0);
    assert.strictEqual(await sys(() => MetaWhatsappPhoneNumbers.countDocuments({})), 0);
    assert.strictEqual(await sys(() => MetaWhatsappTemplates.countDocuments({})), 0);
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    assert.strictEqual(metaCalls.length, 0);
  });

  // ── Cross-tenant number reuse ────────────────────────────
  await t.test('M14. A customer cannot take another workspace\'s number; the error does not name it', async () => {
    await workspace(10, { phone_number_id: 'p-A', wa_business_id: 'waba-A', whatsapp_number: '911111111111' });
    const { owner, brand } = await workspace(20);
    const before = await brandDoc(brand.id);
    const res = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(owner)).send({ phone_number_id: 'p-A' });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'PHONE_NUMBER_IN_USE');
    assert.ok(!JSON.stringify(res.body).includes('Brand 10'), 'other brand not named');
    assert.ok(!JSON.stringify(res.body).includes('Workspace 10'), 'other workspace not named');
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    assert.strictEqual(metaCalls.length, 0);
  });

  // Embedded signup itself is paused until Task 1B (M18, task2_0-brand-security.test.js).
  await t.test('M15. WhatsApp setup refuses another workspace\'s number before any Meta call', async () => {
    await workspace(10, { phone_number_id: 'p-A', wa_business_id: 'waba-1', whatsapp_number: '911111111111' });

    // A brand already holding a duplicate number (legacy data) cannot be verified.
    const { owner: owner3, brand: brand3 } = await workspace(30, {
      phone_number_id: 'p-A', wa_business_id: 'waba-1', whatsapp_number: '911111111111', wa_access_token: 'customer-30-token', whatsapp_status: 'not_configured',
    });
    const setup = await request(app).post(`/api/clients/${brand3.id}/whatsapp-setup`).set(bearer(owner3));
    assert.strictEqual(setup.status, 409, JSON.stringify(setup.body));
    assert.strictEqual((await brandDoc(brand3.id)).whatsapp_status, 'not_configured', 'status not changed');
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('M16. Admin number updates refuse a number used by another brand', async () => {
    await workspace(10, { phone_number_id: 'p-A' });
    const { brand } = await workspace(20);
    const founder = await staff('founder');
    const patch = await request(app).patch(`/api/admin/clients/${brand.id}`).set(bearer(founder)).send({ phone_number_id: 'p-A' });
    assert.strictEqual(patch.status, 409);
    assert.strictEqual(patch.body.code, 'PHONE_NUMBER_IN_USE');
    const put = await request(app).put('/api/admin/tenants/20/whatsapp').set(bearer(founder)).send({ phone_number_id: 'p-A' });
    assert.strictEqual(put.status, 409);
    assert.strictEqual(put.body.code, 'PHONE_NUMBER_IN_USE');
    assert.strictEqual((await brandDoc(brand.id)).phone_number_id ?? null, null);
  });

  await t.test('M17. Re-saving a brand\'s own number still works', async () => {
    const { owner, brand } = await workspace(10, { phone_number_id: 'p-A', wa_business_id: 'waba-A', whatsapp_number: '911111111111' });
    const own = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(owner)).send({ phone_number_id: 'p-A' });
    assert.strictEqual(own.status, 200, JSON.stringify(own.body));
    const founder = await staff('founder');
    assert.strictEqual((await request(app).put('/api/admin/tenants/10/whatsapp').set(bearer(founder)).send({ phone_number_id: 'p-A' })).status, 200);
    assert.strictEqual((await request(app).patch(`/api/admin/clients/${brand.id}`).set(bearer(founder)).send({ phone_number_id: 'p-A' })).status, 200);
  });

  // ── Preserved behaviour ──────────────────────────────────
  await t.test('M18. Legacy embedded signup is paused: config disabled, completion 503, no Meta call, brand unchanged', async () => {
    const { owner, brand } = await workspace(20);
    const before = await brandDoc(brand.id);
    metaRoutes['GET waba-1/phone_numbers'] = { data: [{ id: 'p-new', display_phone_number: '+91 33333 33333', status: 'CONNECTED' }] };
    const res = await request(app).post(`/api/clients/${brand.id}/meta-embedded-signup/complete`).set(bearer(owner))
      .send({ waba_id: 'waba-1', phone_number_id: 'p-new', expected_whatsapp_number: '+91 33333 33333' });
    assert.strictEqual(res.status, 503);
    assert.strictEqual(res.body.code, 'SECURE_SIGNUP_PENDING');
    assert.deepStrictEqual(await brandDoc(brand.id), before);
    const config = await request(app).get('/api/meta/embedded-signup/config').set(bearer(owner));
    assert.strictEqual(config.status, 200);
    assert.strictEqual(config.body.enabled, false);
    assert.strictEqual(metaCalls.length, 0);
    assertDummyCredentialsOnly();
  });

  await t.test('M19. No Meta call in this file used anything but a dummy credential', async () => {
    assert.deepStrictEqual(credentialViolations, []);
  });
});
