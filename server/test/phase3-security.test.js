/**
 * Phase 3 security regression tests, against the real server.js app on an
 * in-memory MongoDB (setup.js refuses remote hosts).
 *
 *  A. No staff workspace bypass, in development or production configurations
 *  B. Workspace provisioning: explicit, audited manual grants; plans only from
 *     the server-side catalogue; client-supplied prices ignored
 *  C. Workflow-log cleanup: one workspace with the service key; all workspaces
 *     only for founder/ops staff (audited); retention period preserved
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
});

const DAY = 86400000;
const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
const service = { 'x-internal-key': TEST_INTERNAL_KEY };

// Runs fn with temporary environment values, restoring them afterwards.
async function withEnv(values, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(values)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
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

async function seedWorkspace(models, { tenantId, name }) {
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  await runAsSystem(() => models.Tenants.create({ id: tenantId, name, status: 'active' }));
  await runAsTenant(tenantId, async () => {
    await models.Clients.create({ name: `${name} Brand` });
    await models.Subscriptions.create({
      plan_code: 'TEST', status: 'active', limits: { max_users: 10 },
      current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * DAY),
    });
  });
}

async function createUser(models, fields) {
  const { runAsSystem } = require('../services/tenantContext');
  return (await runAsSystem(() => models.Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();
}

const staff = (models, role) => createUser(models, {
  tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role,
});

const grantPayload = (overrides = {}) => ({
  business_name: 'Kaveri Motors',
  owner_name: 'Kavya Rao',
  owner_email: 'kavya@kaveri.test',
  plan_code: 'WA-STARTER',
  term_months: 12,
  payment_reference: 'APPROVAL-2026-014',
  grant_reason: 'Pilot client approved by the founder; paid by bank transfer',
  ...overrides,
});

test('Phase 3 security remediation', async (t) => {
  const models = require('../models');
  const { Tenants, Clients, Subscriptions, Invitations, Leads, Plans, WorkflowLogs, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const count = (model, filter = {}) => runAsSystem(() => model.countDocuments(filter));

  // ── A. Staff workspace bypass removed ─────────────────────
  const BYPASS_CONFIGS = [
    { name: 'test', env: { NODE_ENV: 'test', ALLOW_STAFF_WORKSPACE: undefined } },
    { name: 'development', env: { NODE_ENV: 'development', ALLOW_STAFF_WORKSPACE: undefined } },
    { name: 'development + ALLOW_STAFF_WORKSPACE=true', env: { NODE_ENV: 'development', ALLOW_STAFF_WORKSPACE: 'true' } },
    { name: 'production', env: { NODE_ENV: 'production', ALLOW_STAFF_WORKSPACE: undefined } },
    { name: 'production + ALLOW_STAFF_WORKSPACE=true', env: { NODE_ENV: 'production', ALLOW_STAFF_WORKSPACE: 'true' } },
  ];

  await t.test('A1. Staff tokens cannot open a customer workspace in any configuration', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await runAsTenant(1, () => Leads.create({ name: 'Secret Lead', phone: '919999900001' }));
    const founder = await staff(models, 'founder');

    for (const config of BYPASS_CONFIGS) {
      await withEnv(config.env, async () => {
        for (const headers of [{}, { 'x-tenant-id': '1' }, { 'x-tenant-id': '2' }]) {
          const label = `${config.name}, x-tenant-id=${headers['x-tenant-id'] || 'none'}`;
          const read = await request(app).get('/api/leads').set({ ...bearer(founder), ...headers });
          assert.strictEqual(read.status, 403, `GET /api/leads (${label}) returned ${read.status}`);
          assert.strictEqual(read.body.code, 'STAFF_NOT_ALLOWED', label);
          assert.ok(!JSON.stringify(read.body).includes('Secret Lead'), `tenant data leaked (${label})`);
          const write = await request(app).post('/api/leads').set({ ...bearer(founder), ...headers }).send({ name: 'Injected', phone: '919999900002' });
          assert.strictEqual(write.status, 403, `POST /api/leads (${label}) returned ${write.status}`);
          const team = await request(app).get('/api/team/users').set({ ...bearer(founder), ...headers });
          assert.strictEqual(team.status, 403, `GET /api/team/users (${label})`);
        }
      });
    }
    assert.strictEqual(await count(Leads), 1, 'no lead was created through a staff token');
  });

  await t.test('A2. Customers still use their own workspace; x-tenant-id cannot switch it', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    await runAsTenant(1, () => Leads.create({ name: 'Acme Lead', phone: '919999900011' }));
    await runAsTenant(2, () => Leads.create({ name: 'Beta Lead', phone: '919999900012' }));
    const ownerA = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner A' });

    for (const config of BYPASS_CONFIGS) {
      await withEnv(config.env, async () => {
        const res = await request(app).get('/api/leads').set({ ...bearer(ownerA), 'x-tenant-id': '2' });
        assert.strictEqual(res.status, 200, config.name);
        const names = (res.body.leads || []).map((l) => l.name);
        assert.ok(names.includes('Acme Lead'), config.name);
        assert.ok(!names.includes('Beta Lead'), `other workspace visible (${config.name})`);
      });
    }
  });

  await t.test('A3. Platform staff routes keep working', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const founder = await staff(models, 'founder');
    assert.strictEqual((await request(app).get('/api/admin/tenants').set(bearer(founder))).status, 200);
    assert.strictEqual((await request(app).get('/api/admin/tenants/1').set(bearer(founder))).status, 200);
    const me = await request(app).get('/api/auth/me').set(bearer(founder));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.is_platform_staff, true);
  });

  // ── B. Provisioning: manual grants and plan catalogue ─────
  await t.test('B1. Missing or blank grant reference/reason is refused; nothing is created', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const cases = [
      grantPayload({ payment_reference: undefined }),
      grantPayload({ payment_reference: '  ' }),
      grantPayload({ grant_reason: undefined }),
      grantPayload({ grant_reason: 'too short' }),
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(body);
      assert.strictEqual(res.status, 400, JSON.stringify(body));
    }
    assert.strictEqual(await count(Tenants), 0);
    assert.strictEqual(await count(Subscriptions), 0);
    assert.strictEqual(await count(Invitations), 0);
  });

  await t.test('B2. Unknown plan is refused', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload({ plan_code: 'GOLD-UNLIMITED' }));
    assert.strictEqual(res.status, 400);
    assert.match(res.body.error, /not in the plan catalogue/);
    assert.strictEqual(await count(Tenants), 0);
  });

  await t.test('B3. With no plan catalogue, workspace creation is unavailable (503)', async () => {
    const founder = await staff(models, 'founder');
    assert.strictEqual(await count(Plans), 0);
    const plans = await request(app).get('/api/admin/plans').set(bearer(founder));
    assert.strictEqual(plans.status, 200);
    assert.deepStrictEqual(plans.body.plans, []);
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    assert.strictEqual(res.status, 503);
    assert.match(res.body.error, /plan catalogue is not loaded/);
    assert.strictEqual(await count(Tenants), 0);
  });

  await t.test('B4. An authorized manual grant is recorded as a manual grant, with who and why', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const tenantId = res.body.tenant.id;
    const sub = await runAsTenant(tenantId, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(sub.payment_method, 'manual_grant');
    assert.strictEqual(sub.payment_reference, 'APPROVAL-2026-014');
    assert.strictEqual(sub.grant_reason, 'Pilot client approved by the founder; paid by bank transfer');
    assert.strictEqual(sub.granted_by, founder.id);

    const grantEvent = await runAsSystem(() => AuditEvents.findOne({ event: 'MANUAL_GRANT_AUTHORIZED', tenant_id: tenantId }).lean());
    assert.ok(grantEvent, 'manual grant audited');
    assert.strictEqual(grantEvent.actor_user_id, founder.id);
    assert.strictEqual(grantEvent.meta.reason, sub.grant_reason);
    assert.strictEqual(grantEvent.meta.reference, sub.payment_reference);
    assert.strictEqual(await count(AuditEvents, { event: 'PAYMENT_VERIFIED', tenant_id: tenantId }), 0, 'not recorded as a verified payment');
  });

  await t.test('B5. Prices and limits come from the catalogue, never from the request', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload({
      monthly_price: 1, contract_value: 1, discount_pct: 99, limits: { max_users: 999 }, plan: { monthly_price: 1 },
    }));
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const plan = await runAsSystem(() => Plans.findOne({ code: 'WA-STARTER' }).lean());
    const sub = await runAsTenant(res.body.tenant.id, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(sub.monthly_price, plan.monthly_price);
    assert.strictEqual(sub.discount_pct, plan.pricing_rules.term_discount_pct['12']);
    assert.strictEqual(sub.contract_value, Math.round(plan.monthly_price * 12 * (1 - sub.discount_pct / 100)));
    assert.strictEqual(sub.limits.max_users, plan.limits.max_users);
  });

  await t.test('B6. Staff cannot record a Razorpay payment; renewals follow the same rules', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const support = await staff(models, 'support');
    const asRazorpay = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload({ payment_method: 'razorpay', payment_reference: 'pay_fake123' }));
    assert.strictEqual(asRazorpay.status, 400);
    assert.strictEqual((await request(app).post('/api/admin/tenants').set(bearer(support)).send(grantPayload())).status, 403);
    assert.strictEqual(await count(Tenants), 0);

    const provisioning = require('../services/provisioning');
    assert.throws(() => provisioning.validatePayment({ method: 'razorpay', reference: 'pay_fake123' }, founder.id), (err) => err.status === 400);

    const created = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(grantPayload());
    const tenantId = created.body.tenant.id;
    const renew = (body, who = founder) => request(app).post(`/api/admin/tenants/${tenantId}/subscriptions`).set(bearer(who)).send(body);
    assert.strictEqual((await renew({ plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'APPROVAL-2026-015' })).status, 400, 'reason required');
    assert.strictEqual((await renew({ plan_code: 'WA-STARTER', term_months: 1, grant_reason: 'Renewal approved by founder' })).status, 400, 'reference required');
    assert.strictEqual((await renew({ plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'pay_x', grant_reason: 'Renewal approved by founder', payment_method: 'razorpay' })).status, 400);
    assert.strictEqual((await renew({ plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'APPROVAL-2026-015', grant_reason: 'Renewal approved by founder' }, support)).status, 403);
    const ok = await renew({ plan_code: 'WA-STARTER', term_months: 1, payment_reference: 'APPROVAL-2026-015', grant_reason: 'Renewal approved by founder' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(ok.body.subscription.payment_method, 'manual_grant');
    assert.strictEqual(ok.body.subscription.grant_reason, 'Renewal approved by founder');
    assert.strictEqual(await count(AuditEvents, { event: 'MANUAL_GRANT_AUTHORIZED', tenant_id: tenantId }), 2);
  });

  // ── C. Workflow-log cleanup ────────────────────────────────
  async function seedLogs() {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    const old = new Date(Date.now() - 40 * DAY);
    const recent = new Date(Date.now() - 29 * DAY);
    for (const tenantId of [1, 2]) {
      await runAsTenant(tenantId, async () => {
        await WorkflowLogs.create({ workflow: 'WF01', status: 'success', message: 'old', created_at: old });
        await WorkflowLogs.create({ workflow: 'WF01', status: 'success', message: 'recent', created_at: recent });
      });
    }
    await runAsSystem(() => WorkflowLogs.create({ tenant_id: null, workflow: 'WF06', status: 'success', message: 'platform old', created_at: old }));
  }
  const logsOf = (tenantId) => runAsSystem(() => WorkflowLogs.find({ tenant_id: tenantId }).lean()).then((rows) => rows.map((r) => r.message).sort());

  await t.test('C1. Service key with x-tenant-id cleans up only that workspace, within retention', async () => {
    await seedLogs();
    const res = await request(app).post('/api/admin/cleanup').set({ ...service, 'x-tenant-id': '1' }).send({ tenant_id: 2, filter: {} });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scope, 'tenant');
    assert.strictEqual(res.body.deleted_logs, 1);
    assert.deepStrictEqual(await logsOf(1), ['recent'], 'old log removed, 29-day log kept');
    assert.deepStrictEqual(await logsOf(2), ['old', 'recent'], 'other workspace untouched');
    assert.deepStrictEqual(await logsOf(null), ['platform old'], 'platform logs untouched');
  });

  await t.test('C2. Service key without a workspace, a wrong key, customers and support staff are refused', async () => {
    await seedLogs();
    const keyOnly = await request(app).post('/api/admin/cleanup').set(service);
    assert.strictEqual(keyOnly.status, 403);
    assert.strictEqual(keyOnly.body.code, 'CROSS_TENANT_CLEANUP_FORBIDDEN');
    assert.strictEqual((await request(app).post('/api/admin/cleanup').set({ 'x-internal-key': 'wrong-key', 'x-tenant-id': '1' })).status, 401);
    const owner = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner' });
    assert.strictEqual((await request(app).post('/api/admin/cleanup').set(bearer(owner))).status, 403);
    const support = await staff(models, 'support');
    assert.strictEqual((await request(app).post('/api/admin/cleanup').set(bearer(support))).status, 403);
    assert.strictEqual(await count(WorkflowLogs), 5, 'nothing deleted');
  });

  await t.test('C3. Founder/ops staff clean up every workspace; it is audited', async () => {
    await seedLogs();
    const ops = await staff(models, 'ops');
    const res = await request(app).post('/api/admin/cleanup').set(bearer(ops));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.scope, 'all_tenants');
    assert.strictEqual(res.body.deleted_logs, 3);
    assert.deepStrictEqual(await logsOf(1), ['recent']);
    assert.deepStrictEqual(await logsOf(2), ['recent']);
    assert.deepStrictEqual(await logsOf(null), []);
    const event = await runAsSystem(() => AuditEvents.findOne({ event: 'PLATFORM_MAINTENANCE', 'meta.operation': 'cleanup_workflow_logs' }).lean());
    assert.ok(event);
    assert.strictEqual(event.actor_user_id, ops.id);
    assert.strictEqual(event.meta.deleted_logs, 3);
    assert.strictEqual(event.meta.retention_days, 30);
  });
});
