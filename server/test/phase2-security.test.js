/**
 * Phase 2 security regression tests, against the real server.js app on an
 * in-memory MongoDB (setup.js refuses remote hosts).
 *
 *  P. Owner provisioning: staff set the owner's password (no email); the
 *     invitation path remains for callers without one; one login per workspace;
 *     no passwords or tokens in responses
 *  T. /api/tenant and /api/team/* require a customer login and stay in-tenant
 *  R. /api/admin/retry: one workspace with the service key + x-tenant-id;
 *     all workspaces only for founder/ops staff (audited)
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
  process.env.EMAIL_DELIVERY = 'memory';
  await clearCollections();
  require('../services/notify').clearOutbox();
});

const STRONG_PASSWORD = 'Owner-Chosen-77';
const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
const SECRET_PATTERN = /password|credentials|"token"|token_hash/i;

async function seedWorkspace(models, { tenantId, name, maxUsers = 10 }) {
  const { Tenants, Clients, Subscriptions } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  await runAsSystem(() => Tenants.create({ id: tenantId, name, status: 'active' }));
  await runAsTenant(tenantId, async () => {
    await Clients.create({ name: `${name} Brand` });
    await Subscriptions.create({
      plan_code: 'TEST', status: 'active', limits: { max_users: maxUsers },
      current_period_start: new Date(), current_period_end: new Date(Date.now() + 30 * 86400000),
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

const tenantPayload = (overrides = {}) => ({
  business_name: 'Kaveri Motors',
  owner_name: 'Kavya Rao',
  owner_email: 'Kavya@Kaveri.test',
  owner_password: STRONG_PASSWORD,
  plan_code: 'WA-STARTER',
  term_months: 12,
  payment_reference: 'MANUAL-PILOT-001',
  grant_reason: 'Pilot client approved by the founder',
  ...overrides,
});

test('Phase 2 security remediation', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Invitations, Messages, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const notify = require('../services/notify');
  const count = (model, filter = {}) => runAsSystem(() => model.countDocuments(filter));

  // ── Owner provisioning ─────────────────────────────────────
  await t.test('P1. Provisioning creates the Owner login with the staff-set password; nothing is emailed', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const res = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(tenantPayload());
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.ok(!SECRET_PATTERN.test(JSON.stringify(res.body)), `secret-looking field in response: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.invitation, null);
    assert.strictEqual(res.body.owner.email, 'kavya@kaveri.test');

    const tenantId = res.body.tenant.id;
    const owner = await runAsSystem(() => Users.findOne({ email: 'kavya@kaveri.test' }).lean());
    assert.strictEqual(owner.tenant_id, tenantId);
    assert.strictEqual(owner.role, 'owner');
    assert.strictEqual(owner.id, res.body.owner.id);
    assert.ok(await bcrypt.compare(STRONG_PASSWORD, owner.password_hash));
    const tenant = await runAsSystem(() => Tenants.findOne({ id: tenantId }).lean());
    assert.strictEqual(tenant.owner_user_id, owner.id);
    assert.strictEqual(await count(Invitations), 0, 'no invitation created');
    assert.strictEqual(notify.outbox().length, 0, 'nothing emailed');
  });

  await t.test('P2. A missing or weak owner password is refused and nothing is created', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const missing = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(tenantPayload({ owner_password: undefined }));
    assert.strictEqual(missing.status, 400);
    const weak = await request(app).post('/api/admin/tenants').set(bearer(founder)).send(tenantPayload({ owner_password: 'short1' }));
    assert.strictEqual(weak.status, 400);
    assert.strictEqual(await count(Tenants), 0);
    assert.strictEqual(await count(Clients), 0);
    assert.strictEqual(await count(Invitations), 0);
    assert.strictEqual(await count(Users, { tenant_id: { $ne: null } }), 0);

    // The service layer applies the same password rules, whatever the caller.
    const provisioning = require('../services/provisioning');
    await assert.rejects(
      () => provisioning.provisionTenant({ ...tenantPayload(), owner_password: 'no-digits-here', payment: { method: 'manual_grant', reference: 'X-1', reason: 'Service layer check' } }, { actorUserId: founder.id }),
      (err) => err.status === 400,
    );
    assert.strictEqual(await count(Tenants), 0);
  });

  await t.test('P3. Without a staff-set password the Owner is invited; a failed email keeps the invitation for resend', async () => {
    await seedTestPlans();
    const founder = await staff(models, 'founder');
    const provisioning = require('../services/provisioning');
    process.env.EMAIL_DELIVERY = 'off';
    const result = await provisioning.provisionTenant(
      { ...tenantPayload({ owner_password: undefined }), payment: { method: 'manual_grant', reference: 'MANUAL-PILOT-001', reason: 'Pilot client approved by the founder' } },
      { actorUserId: founder.id },
    );
    assert.strictEqual(result.delivery.delivered, false);
    assert.strictEqual(result.owner, null);
    const tenantId = result.tenant.id;
    assert.strictEqual(await count(Tenants, { id: tenantId }), 1, 'workspace kept');
    assert.strictEqual(await count(Invitations, { tenant_id: tenantId, accepted_at: null, revoked_at: null }), 1, 'invitation kept');
    assert.strictEqual(await count(Users, { tenant_id: tenantId }), 0, 'no owner account before the invitation is accepted');

    process.env.EMAIL_DELIVERY = 'memory';
    const resend = await request(app).post(`/api/admin/tenants/${tenantId}/invitations/${result.invitation.id}/resend`).set(bearer(founder));
    assert.strictEqual(resend.status, 200, JSON.stringify(resend.body));
    assert.strictEqual(resend.body.delivery.delivered, true);
    assert.ok(!SECRET_PATTERN.test(JSON.stringify(resend.body)));
    assert.ok(notify.outbox().some((m) => m.to === 'kavya@kaveri.test'), 'fresh link emailed');
  });

  await t.test('P4. Invitation routes never return the raw token; a workspace takes only one login', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    await seedWorkspace(models, { tenantId: 3, name: 'Gamma' });
    const founder = await staff(models, 'founder');
    const ownerC = await createUser(models, { tenant_id: 3, role: 'owner', email: 'owner@gamma.test', name: 'Owner C' });

    const viaAdmin = await request(app).post('/api/admin/users').set(bearer(founder)).send({ tenant_id: 1, email: 'one@acme.test', role: 'owner' });
    assert.strictEqual(viaAdmin.status, 201, JSON.stringify(viaAdmin.body));
    assert.deepStrictEqual(Object.keys(viaAdmin.body).sort(), ['delivery', 'invitation']);
    const viaAdminTenant = await request(app).post('/api/admin/tenants/2/invitations').set(bearer(founder)).send({ email: 'two@beta.test', role: 'owner' });
    assert.strictEqual(viaAdminTenant.status, 201, JSON.stringify(viaAdminTenant.body));
    assert.deepStrictEqual(Object.keys(viaAdminTenant.body).sort(), ['delivery', 'invitation']);
    const viaStaff = await request(app).post('/api/admin/staff/invitations').set(bearer(founder)).send({ email: 'new.ops@nera.test', staff_role: 'ops' });
    assert.strictEqual(viaStaff.status, 201);
    assert.deepStrictEqual(Object.keys(viaStaff.body).sort(), ['delivery', 'invitation']);

    // One login per workspace: a second person is refused, wherever the request comes from.
    const second = await request(app).post('/api/admin/users').set(bearer(founder)).send({ tenant_id: 1, email: 'another@acme.test', role: 'owner' });
    assert.strictEqual(second.status, 409);
    const viaTeam = await request(app).post('/api/team/invitations').set(bearer(ownerC)).send({ email: 'three@gamma.test', role: 'agent' });
    assert.strictEqual(viaTeam.status, 409, JSON.stringify(viaTeam.body));
    assert.ok(!SECRET_PATTERN.test(JSON.stringify(viaTeam.body)));
    const legacy = await request(app).post('/api/users').set(bearer(ownerC)).send({ name: 'X', email: 'x@gamma.test', password: 'Some-Pass-123' });
    assert.strictEqual(legacy.status, 409);
    assert.strictEqual(await count(Invitations, { tenant_id: 3 }), 0);
    assert.strictEqual(await count(Users, { tenant_id: 3 }), 1);
  });

  // ── Team routes ────────────────────────────────────────────
  await t.test('T1. Anonymous requests to /api/tenant and /api/team/* are refused', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const checks = [
      ['get', '/api/tenant'], ['patch', '/api/tenant/settings'], ['get', '/api/team/users'],
      ['post', '/api/team/invitations'], ['patch', '/api/team/users/1/role'], ['post', '/api/team/users/1/deactivate'],
    ];
    for (const [method, path] of checks) {
      const res = await request(app)[method](path).send({});
      assert.strictEqual(res.status, 401, `${method.toUpperCase()} ${path} returned ${res.status}`);
    }
    // Other public /api routes are untouched by the team router's middleware.
    assert.strictEqual((await request(app).post('/api/auth/login').send({ email: 'nobody@x.test', password: 'Wrong-Pass-1' })).status, 401);
    assert.strictEqual((await request(app).get('/health')).status, 200);
  });

  await t.test('T2. Members see only their own workspace; permissions apply', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    const ownerA = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner A' });
    const agentA = await createUser(models, { tenant_id: 1, role: 'agent', email: 'agent@acme.test', name: 'Agent A' });
    await createUser(models, { tenant_id: 2, role: 'owner', email: 'owner@beta.test', name: 'Owner B' });

    const summary = await request(app).get('/api/tenant').set(bearer(ownerA));
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.tenant.id, 1);
    assert.strictEqual(summary.body.tenant.name, 'Acme');

    const team = await request(app).get('/api/team/users').set(bearer(ownerA));
    assert.strictEqual(team.status, 200);
    const emails = team.body.users.map((u) => u.email).sort();
    assert.deepStrictEqual(emails, ['agent@acme.test', 'owner@acme.test'], 'no other workspace\'s users');

    // Agents can read the summary but not manage the team.
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(agentA))).status, 200);
    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(agentA))).status, 403);
    assert.strictEqual((await request(app).post('/api/team/invitations').set(bearer(agentA)).send({ email: 'x@acme.test', role: 'agent' })).status, 403);

    // A workspace that already has its login takes no invitation, even when
    // another workspace is named.
    const invite = await request(app).post('/api/team/invitations').set(bearer(ownerA)).send({ email: 'new@acme.test', role: 'agent', tenant_id: 2 });
    assert.strictEqual(invite.status, 409);
    assert.strictEqual(await runAsSystem(() => Invitations.countDocuments({ email: 'new@acme.test' })), 0);
  });

  await t.test('T3. A workspace cannot manage another workspace\'s users', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    const ownerA = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner A' });
    await createUser(models, { tenant_id: 2, role: 'owner', email: 'owner@beta.test', name: 'Owner B' });
    const agentB = await createUser(models, { tenant_id: 2, role: 'agent', email: 'agent@beta.test', name: 'Agent B' });

    assert.strictEqual((await request(app).patch(`/api/team/users/${agentB.id}/role`).set(bearer(ownerA)).send({ role: 'admin' })).status, 404);
    assert.strictEqual((await request(app).post(`/api/team/users/${agentB.id}/deactivate`).set(bearer(ownerA))).status, 404);
    assert.strictEqual((await request(app).post(`/api/team/users/${agentB.id}/revoke-sessions`).set(bearer(ownerA))).status, 404);
    const after = await runAsSystem(() => Users.findOne({ id: agentB.id }).lean());
    assert.strictEqual(after.role, 'agent');
    assert.strictEqual(after.is_active, true);
    assert.strictEqual(after.token_version, 0);
  });

  await t.test('T4. Platform staff use the admin panel, not customer team routes', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner A' });
    const founder = await staff(models, 'founder');
    // Checked under production settings; phase3-security.test.js covers the
    // other configurations (the earlier non-production staff bypass is removed).
    const savedEnv = { NODE_ENV: process.env.NODE_ENV, ALLOW_STAFF_WORKSPACE: process.env.ALLOW_STAFF_WORKSPACE };
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_STAFF_WORKSPACE;
    let res;
    try {
      res = await request(app).get('/api/team/users').set(bearer(founder));
    } finally {
      process.env.NODE_ENV = savedEnv.NODE_ENV;
      if (savedEnv.ALLOW_STAFF_WORKSPACE !== undefined) process.env.ALLOW_STAFF_WORKSPACE = savedEnv.ALLOW_STAFF_WORKSPACE;
    }
    assert.strictEqual(res.status, 403);
    assert.strictEqual(res.body.code, 'STAFF_NOT_ALLOWED');
    // Same outcome under the test configuration.
    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(founder))).status, 403);
    const detail = await request(app).get('/api/admin/tenants/1').set(bearer(founder));
    assert.strictEqual(detail.status, 200);
    assert.deepStrictEqual(detail.body.users.map((u) => u.email), ['owner@acme.test']);
  });

  // ── Retry authorization ────────────────────────────────────
  await t.test('R1. Retry: one workspace with the service key, all workspaces only for founder/ops staff', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    for (const tenantId of [1, 2]) {
      await runAsTenant(tenantId, () => Messages.create({ conversation_id: 1, direction: 'outbound', content: 'x', status: 'failed', sent_at: new Date() }));
    }
    const failedIn = (tenantId) => runAsTenant(tenantId, () => Messages.countDocuments({ status: 'failed' }));
    const service = { 'x-internal-key': TEST_INTERNAL_KEY };
    const owner = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner A' });
    const support = await staff(models, 'support');
    const ops = await staff(models, 'ops');

    // Refused: customer token, service key without a workspace, support staff.
    assert.strictEqual((await request(app).post('/api/admin/retry').set(bearer(owner))).status, 403);
    const keyOnly = await request(app).post('/api/admin/retry').set(service);
    assert.strictEqual(keyOnly.status, 403);
    assert.strictEqual(keyOnly.body.code, 'CROSS_TENANT_RETRY_FORBIDDEN');
    assert.strictEqual((await request(app).post('/api/admin/retry').set(bearer(support))).status, 403);
    assert.strictEqual(await failedIn(1), 1);
    assert.strictEqual(await failedIn(2), 1);

    // Service key naming workspace 1 resets only workspace 1.
    const one = await request(app).post('/api/admin/retry').set({ ...service, 'x-tenant-id': '1' });
    assert.strictEqual(one.status, 200);
    assert.strictEqual(one.body.scope, 'tenant');
    assert.strictEqual(one.body.retried_count, 1);
    assert.strictEqual(await failedIn(1), 0);
    assert.strictEqual(await failedIn(2), 1, 'workspace 2 untouched');

    // Ops staff may retry across workspaces; it is audited.
    const all = await request(app).post('/api/admin/retry').set(bearer(ops));
    assert.strictEqual(all.status, 200);
    assert.strictEqual(all.body.scope, 'all_tenants');
    assert.strictEqual(await failedIn(2), 0);
    const audited = await runAsSystem(() => AuditEvents.findOne({ event: 'PLATFORM_MAINTENANCE' }).lean());
    assert.ok(audited, 'cross-tenant retry recorded');
    assert.strictEqual(audited.actor_type, 'staff');
    assert.strictEqual(audited.actor_user_id, ops.id);
  });
});
