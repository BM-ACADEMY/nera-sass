/**
 * Workspace creation without plans: only an active Admin (Owner) can create a
 * workspace; it has full access with no plan, expiry or limits; nothing about
 * plans, terms or payments is stored. Founder Reports show counts only.
 * Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
const payload = (overrides = {}) => ({
  business_name: 'Kaveri Motors',
  owner_name: 'Kavya Rao',
  owner_email: 'kavya@kaveri.test',
  owner_password: 'Owner-Set-2026',
  ...overrides,
});

test('Workspace creation without plans', async (t) => {
  const { Users, Tenants, Clients, AuditEvents } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const provisioning = require('../services/provisioning');
  const sys = (fn) => runAsSystem(fn, 'test');
  const count = (model, filter = {}) => sys(() => model.countDocuments(filter));
  const createStaff = async (role, extra = {}) => (await sys(() => Users.create({
    tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}${extra.suffix || ''}@nera.test`, name: role,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: extra.is_active ?? true, token_version: 0,
  }))).toObject();
  const assertNothingCreated = async (label) => {
    assert.strictEqual(await count(Tenants), 0, `${label}: no tenant`);
    assert.strictEqual(await count(Clients), 0, `${label}: no brand`);
    assert.strictEqual(await count(Users, { tenant_id: { $ne: null } }), 0, `${label}: no owner`);
  };

  await t.test('W1. An Admin (Owner) creates a workspace: full access, no plan or subscription stored, audited', async () => {
    const founder = await createStaff('founder');
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(payload({ plan_code: 'IGNORED', term_months: 12 }));
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.subscription, undefined);
    const tenantId = res.body.tenant.id;

    const list = await request(app).get('/api/admin/tenants').set(bearer(founder));
    const row = list.body.tenants.find((x) => x.id === tenantId);
    assert.strictEqual(row.lifecycle_state, 'active');
    assert.strictEqual(row.access, 'full');
    assert.strictEqual(row.plan, undefined);

    const names = await mongoose.connection.db.listCollections({ name: 'subscriptions' }).toArray();
    if (names.length) assert.strictEqual(await mongoose.connection.db.collection('subscriptions').countDocuments(), 0, 'nothing written to subscriptions');

    const audit = await sys(() => AuditEvents.findOne({ event: 'TENANT_CREATED', tenant_id: tenantId }).lean());
    assert.strictEqual(audit.actor_user_id, founder.id);

    // The owner signs in and has full access.
    const login = await request(app).post('/api/auth/login').send({ email: 'kavya@kaveri.test', password: 'Owner-Set-2026' });
    assert.strictEqual(login.status, 200, JSON.stringify(login.body));
    const summary = await request(app).get('/api/tenant').set({ Authorization: `Bearer ${login.body.token}` });
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.lifecycle.access, 'full');
    assert.strictEqual(summary.body.usage.max_users, -1);
    assert.strictEqual(summary.body.subscription, undefined);
  });

  await t.test('W2. Staff (ops), customers and anonymous callers cannot create a workspace; nothing is created', async () => {
    const ops = await createStaff('ops');
    assert.strictEqual((await request(app).post('/api/admin/tenants').set(bearer(ops)).send(payload())).status, 403);
    assert.strictEqual((await request(app).post('/api/admin/tenants').send(payload())).status, 401);
    await assertNothingCreated('route');
  });

  await t.test('W3. The service layer also refuses anyone but an active founder', async () => {
    const ops = await createStaff('ops');
    const inactive = await createStaff('founder', { suffix: '.inactive', is_active: false });
    for (const actorUserId of [ops.id, inactive.id, 987654, null]) {
      await assert.rejects(() => provisioning.provisionTenant(payload(), { actorUserId }), (err) => err.status === 403);
    }
    await assertNothingCreated('service layer');
  });

  await t.test('W4. The old plan and renewal routes are gone', async () => {
    const founder = await createStaff('founder');
    assert.strictEqual((await request(app).get('/api/admin/plans').set(bearer(founder))).status, 404);
    assert.strictEqual((await request(app).post('/api/admin/tenants/1/subscriptions').set(bearer(founder)).send({})).status, 404);
  });

  await t.test('W5. Founder Reports show counts only and stay staff-only', async () => {
    const founder = await createStaff('founder');
    await request(app).post('/api/admin/tenants').set(bearer(founder)).send(payload());
    const res = await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(founder));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(Object.keys(res.body.snapshot).sort(), ['totalLeads', 'totalUsers', 'totalWorkspaces']);
    assert.strictEqual(res.body.snapshot.totalWorkspaces, 1);

    const ops = await createStaff('ops');
    assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(ops))).status, 200);
    const retired = await createStaff('support');
    assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(retired))).status, 403);
    const owner = await sys(() => Users.findOne({ email: 'kavya@kaveri.test' }).lean());
    assert.strictEqual((await request(app).get('/api/admin/reports/founder-dashboard').set(bearer(owner))).status, 403);
  });
});

test('Live admin updates', async (t) => {
  const realtime = require('../services/realtime');
  const { Users } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');

  await t.test('L1. Creating a workspace tells open admin sessions, with ids only', async () => {
    await clearCollections();
    const sent = [];
    realtime.setStaffSender((event, payload) => sent.push({ event, payload }));
    const founder = (await runAsSystem(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'live@nera.test', name: 'Live',
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(payload({ owner_email: 'live-owner@kaveri.test' }));
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const created = sent.find((s) => s.event === 'admin:changed' && s.payload.event === 'TENANT_CREATED');
    assert.ok(created, `notified: ${JSON.stringify(sent.map((s) => s.payload.event))}`);
    assert.strictEqual(created.payload.tenant_id, res.body.tenant.id);
    assert.deepStrictEqual(Object.keys(created.payload).sort(), ['at', 'event', 'target_type', 'tenant_id']);
    realtime.setStaffSender(null);
  });
});
