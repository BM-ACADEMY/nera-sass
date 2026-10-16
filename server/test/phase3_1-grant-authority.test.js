/**
 * Phase 3.1: only founder staff may authorize manual grants (workspace
 * creation and subscription renewal). Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, seedTestPlans, makeToken, TEST_INTERNAL_KEY } = require('./setup');

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
  await seedTestPlans();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

const grantPayload = (overrides = {}) => ({
  business_name: 'Kaveri Motors',
  owner_name: 'Kavya Rao',
  owner_email: 'kavya@kaveri.test',
  plan_code: 'WA-STARTER',
  term_months: 12,
  payment_reference: 'APPROVAL-2026-021',
  grant_reason: 'Pilot client approved by the founder; paid by bank transfer',
  ...overrides,
});

test('Phase 3.1: founder-only manual grants', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Subscriptions, Invitations, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const provisioning = require('../services/provisioning');
  const count = (model, filter = {}) => runAsSystem(() => model.countDocuments(filter));

  const createStaff = async (role, extra = {}) => (await runAsSystem(() => Users.create({
    name: role, email: `${role}${extra.suffix || ''}@nera.test`, tenant_id: null, is_platform_staff: true, staff_role: role,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: extra.is_active ?? true, token_version: 0,
  }))).toObject();

  // Nothing billing-related may exist after a refused attempt.
  async function assertNothingCreated(label) {
    assert.strictEqual(await count(Tenants), 0, `${label}: tenant`);
    assert.strictEqual(await count(Clients), 0, `${label}: brand`);
    assert.strictEqual(await count(Subscriptions), 0, `${label}: subscription`);
    assert.strictEqual(await count(Invitations), 0, `${label}: invitation`);
    assert.strictEqual(await count(Users, { tenant_id: { $ne: null } }), 0, `${label}: customer user`);
    assert.strictEqual(await count(AuditEvents, { event: 'MANUAL_GRANT_AUTHORIZED' }), 0, `${label}: grant audit`);
  }

  await t.test('G1. A founder authorizes a manual grant; the audit names that founder, reference, reason and time', async () => {
    const founder = await createStaff('founder');
    const before = Date.now();
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    const after = Date.now();
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const tenantId = res.body.tenant.id;

    const sub = await runAsTenant(tenantId, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(sub.payment_method, 'manual_grant');
    assert.strictEqual(sub.granted_by, founder.id);

    const event = await runAsSystem(() => AuditEvents.findOne({ event: 'MANUAL_GRANT_AUTHORIZED', tenant_id: tenantId }).lean());
    assert.ok(event, 'grant audited');
    assert.strictEqual(event.actor_type, 'staff');
    assert.strictEqual(event.actor_user_id, founder.id, 'actor is the authenticated founder');
    assert.strictEqual(event.meta.authorized_by, founder.id);
    assert.strictEqual(event.meta.reference, 'APPROVAL-2026-021');
    assert.strictEqual(event.meta.reason, 'Pilot client approved by the founder; paid by bank transfer');
    const at = new Date(event.created_at).getTime();
    assert.ok(at >= before - 1000 && at <= after + 1000, 'timestamp recorded at the time of the grant');
  });

  await t.test('G2. Ops and support get 403 for creation and renewal; nothing is created', async () => {
    const ops = await createStaff('ops');
    const support = await createStaff('support');
    for (const who of [ops, support]) {
      const res = await request(app).post('/api/admin/tenants').set(bearer(who)).send(grantPayload());
      assert.strictEqual(res.status, 403, `${who.staff_role} create returned ${res.status}`);
      assert.strictEqual(res.body.permission, 'platform.billing.grant');
    }
    await assertNothingCreated('ops/support create');

    // Renewal of an existing workspace (created by a founder).
    const founder = await createStaff('founder');
    const created = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    const tenantId = created.body.tenant.id;
    const renewal = { plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'APPROVAL-2026-022', grant_reason: 'Renewal approved by the founder' };
    for (const who of [ops, support]) {
      const res = await request(app).post(`/api/admin/tenants/${tenantId}/subscriptions`).set(bearer(who)).send(renewal);
      assert.strictEqual(res.status, 403, `${who.staff_role} renew returned ${res.status}`);
    }
    assert.strictEqual(await runAsTenant(tenantId, () => Subscriptions.countDocuments({})), 1, 'no renewal subscription created');
    assert.strictEqual(await count(AuditEvents, { event: 'MANUAL_GRANT_AUTHORIZED', tenant_id: tenantId }), 1);
  });

  await t.test('G3. Missing or invalid authorization creates nothing', async () => {
    // An existing customer workspace and its Owner.
    await runAsSystem(() => Tenants.create({ id: 99, name: 'Existing Customer', status: 'active' }));
    const owner = (await runAsSystem(() => Users.create({ name: 'Owner', email: 'owner@acme.test', tenant_id: 99, role: 'owner', is_active: true }))).toObject();
    const inactiveFounder = await createStaff('founder', { suffix: '.inactive', is_active: false });
    const attempts = [
      ['anonymous', {}, 401],
      ['customer owner', bearer(owner), 403],
      ['deactivated founder', bearer(inactiveFounder), 401],
      ['service key', { 'x-internal-key': TEST_INTERNAL_KEY }, 401],
      ['forged token', { Authorization: 'Bearer not-a-real-token' }, 401],
    ];
    for (const [label, headers, status] of attempts) {
      const res = await request(app).post('/api/admin/tenants').set(headers).send(grantPayload());
      assert.strictEqual(res.status, status, `${label} returned ${res.status}`);
    }
    // Only the workspace and Owner the test created exist.
    assert.strictEqual(await count(Tenants), 1);
    assert.strictEqual(await count(Subscriptions), 0);
    assert.strictEqual(await count(Invitations), 0);
    assert.strictEqual(await count(Users, { tenant_id: { $ne: null } }), 1);
  });

  await t.test('G4. The service layer also refuses non-founder authorization', async () => {
    const ops = await createStaff('ops');
    const inactiveFounder = await createStaff('founder', { suffix: '.inactive', is_active: false });
    const input = {
      business_name: 'Kaveri Motors', owner_email: 'kavya@kaveri.test', plan_code: 'WA-STARTER', term_months: 12,
      payment: { method: 'manual_grant', reference: 'APPROVAL-2026-023', reason: 'Called directly, not through the route' },
    };
    for (const actorUserId of [ops.id, inactiveFounder.id, 987654]) {
      await assert.rejects(() => provisioning.provisionTenant(input, { actorUserId }), (err) => err.status === 403);
    }
    await assertNothingCreated('service layer');
  });

  await t.test('G5. A founder renewal is recorded against that founder', async () => {
    const founder = await createStaff('founder');
    const created = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    const tenantId = created.body.tenant.id;
    const res = await request(app).post(`/api/admin/tenants/${tenantId}/subscriptions`).set(bearer(founder))
      .send({ plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'APPROVAL-2026-024', grant_reason: 'Renewal approved by the founder' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.subscription.granted_by, founder.id);
    const events = await runAsSystem(() => AuditEvents.find({ event: 'MANUAL_GRANT_AUTHORIZED', tenant_id: tenantId }).sort({ id: 1 }).lean());
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[1].actor_user_id, founder.id);
    assert.strictEqual(events[1].meta.reference, 'APPROVAL-2026-024');
  });

  await t.test('G6. Other founder/ops workspace management is unchanged', async () => {
    const founder = await createStaff('founder');
    const ops = await createStaff('ops');
    const created = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    const tenantId = created.body.tenant.id;

    assert.strictEqual((await request(app).patch(`/api/admin/tenants/${tenantId}`).set(bearer(ops)).send({ language: 'ta' })).status, 200);
    assert.strictEqual((await request(app).post(`/api/admin/tenants/${tenantId}/suspend`).set(bearer(ops)).send({ reason: 'Ops check' })).status, 200);
    assert.strictEqual((await request(app).post(`/api/admin/tenants/${tenantId}/reinstate`).set(bearer(ops))).status, 200);
    assert.strictEqual((await request(app).get('/api/admin/tenants').set(bearer(ops))).status, 200);

    const opsMe = await request(app).get('/api/admin/me').set(bearer(ops));
    assert.strictEqual(opsMe.body.permissions['platform.billing.grant'], false);
    assert.strictEqual(opsMe.body.permissions['platform.tenants.manage'], true);
    const founderMe = await request(app).get('/api/admin/me').set(bearer(founder));
    assert.strictEqual(founderMe.body.permissions['platform.billing.grant'], true);
  });
});
