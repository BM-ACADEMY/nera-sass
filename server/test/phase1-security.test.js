/**
 * Phase 1 security regression tests, run against the real server.js app on an
 * in-memory MongoDB (see setup.js; remote hosts are refused).
 *
 *  A. Unauthorized user creation (POST /api/auth/users removed; /api/admin/users staff-only)
 *  B. Invitation-only provisioning through POST /api/admin/users
 *  C. Legacy SalesOS platform endpoints: tenant tokens refused, service key allowed
 *  D. Administrator password change: strength rules, old tokens invalid, audit
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  // Loaded after the in-memory database is up, so the app uses it.
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  require('../services/notify').clearOutbox();
});

const STRONG_PASSWORD = 'Correct-Horse-42';

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
  const { Users } = models;
  const { runAsSystem } = require('../services/tenantContext');
  return (await runAsSystem(() => Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4),
    is_active: true,
    token_version: 0,
    ...fields,
  }))).toObject();
}

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

test('Phase 1 security remediation', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Invitations, WorkflowLogs, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const notify = require('../services/notify');
  const count = (model, filter = {}) => runAsSystem(() => model.countDocuments(filter));

  await t.test('A1. POST /api/auth/users no longer exists, for any signed-in user', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const agent = await createUser(models, { tenant_id: 1, role: 'agent', email: 'agent@acme.test', name: 'Agent' });
    const owner = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner' });
    const usersBefore = await count(Users);
    const tenantsBefore = await count(Tenants);

    for (const actor of [agent, owner]) {
      const res = await request(app).post('/api/auth/users').set(bearer(actor))
        .send({ name: 'Evil', email: 'evil@x.test', password: 'Whatever-123', role: 'owner', tenant_id: 2 });
      assert.strictEqual(res.status, 404, `expected 404 for ${actor.role}, got ${res.status}`);
    }
    const anonymous = await request(app).post('/api/auth/users').send({ name: 'Evil', email: 'evil2@x.test', password: 'Whatever-123' });
    assert.strictEqual(anonymous.status, 404);

    assert.strictEqual(await count(Users), usersBefore, 'no user was created');
    assert.strictEqual(await count(Tenants), tenantsBefore, 'no workspace was created');
    assert.strictEqual(await count(Tenants, { name: 'Default Workspace' }), 0);
  });

  await t.test('A2. POST /api/admin/users refuses customer tokens and staff without permission', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const tenantAdmin = await createUser(models, { tenant_id: 1, role: 'admin', email: 'admin@acme.test', name: 'Admin' });
    const support = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'support', email: 'support@nera.test', name: 'Support' });

    const asCustomer = await request(app).post('/api/admin/users').set(bearer(tenantAdmin)).send({ tenant_id: 1, email: 'x@acme.test', role: 'agent' });
    assert.strictEqual(asCustomer.status, 403);
    const asSupport = await request(app).post('/api/admin/users').set(bearer(support)).send({ tenant_id: 1, email: 'x@acme.test', role: 'agent' });
    assert.strictEqual(asSupport.status, 403);
    const anonymous = await request(app).post('/api/admin/users').send({ tenant_id: 1, email: 'x@acme.test', role: 'agent' });
    assert.strictEqual(anonymous.status, 401);
    assert.strictEqual(await count(Invitations), 0);
  });

  await t.test('B1. Staff add a user by invitation only: no account, no password, link emailed', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const founder = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });
    const usersBefore = await count(Users);

    const res = await request(app).post('/api/admin/users').set(bearer(founder))
      .send({ tenant_id: 1, email: 'New.Person@Acme.test', name: 'New Person', role: 'manager' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.invitation.status, 'pending');
    assert.strictEqual(res.body.invitation.email, 'new.person@acme.test', 'email normalised');
    assert.strictEqual(res.body.invitation.role, 'manager');
    assert.ok(!/password/i.test(JSON.stringify(res.body)), 'no password in the response');
    // services/invitations.js returns the raw invite token only when NODE_ENV=test
    // (or a caller passes returnToken); the admin route never asks for it.
    assert.strictEqual(process.env.NODE_ENV, 'test');
    assert.strictEqual(await count(Users), usersBefore, 'no user account until the invitation is accepted');

    const invitation = await runAsTenant(1, () => Invitations.findOne({}).lean());
    assert.strictEqual(invitation.tenant_id, 1);
    const mail = notify.outbox().find((m) => m.to === 'new.person@acme.test');
    assert.ok(mail, 'invitation email sent');
    const token = mail.text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];

    // The invited person sets their own password; the link works once.
    const accept = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'New Person', password: STRONG_PASSWORD });
    assert.strictEqual(accept.status, 201, JSON.stringify(accept.body));
    const joined = await runAsSystem(() => Users.findOne({ email: 'new.person@acme.test' }).lean());
    assert.strictEqual(joined.tenant_id, 1);
    assert.strictEqual(joined.role, 'manager');
    assert.ok(await bcrypt.compare(STRONG_PASSWORD, joined.password_hash));
    const reuse = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Again', password: STRONG_PASSWORD });
    assert.strictEqual(reuse.status, 410);
  });

  await t.test('B2. No default workspace: tenant_id required, unknown workspace refused, passwords rejected', async () => {
    const founder = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });

    const noTenant = await request(app).post('/api/admin/users').set(bearer(founder)).send({ email: 'a@b.test', name: 'A', role: 'agent' });
    assert.strictEqual(noTenant.status, 400);
    assert.match(noTenant.body.error, /tenant_id is required/);

    const unknown = await request(app).post('/api/admin/users').set(bearer(founder)).send({ tenant_id: 999, email: 'a@b.test', role: 'agent' });
    assert.strictEqual(unknown.status, 404);

    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const withPassword = await request(app).post('/api/admin/users').set(bearer(founder)).send({ tenant_id: 1, email: 'a@b.test', role: 'agent', password: 'Chosen-By-Staff-1' });
    assert.strictEqual(withPassword.status, 400);

    assert.strictEqual(await count(Tenants, { name: 'Default Workspace' }), 0, 'no Default Workspace created');
    assert.strictEqual(await count(Clients, { name: 'Default Brand' }), 0, 'no Default Brand created');
    assert.strictEqual(await count(Tenants), 1, 'only the seeded workspace exists');
    assert.strictEqual(await count(Invitations), 0);
  });

  await t.test('B3. A workspace that already has its login refuses another one', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner' });
    const founder = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });
    const res = await request(app).post('/api/admin/users').set(bearer(founder)).send({ tenant_id: 1, email: 'extra@acme.test', role: 'agent' });
    assert.strictEqual(res.status, 409);
    assert.match(res.body.error, /one login/);
    assert.strictEqual(await count(Invitations), 0);
  });

  const PLATFORM_ROUTES = [
    ['get', '/api/workflows/logs'],
    ['get', '/api/workflows/telemetry'],
    ['get', '/api/reports/founder-dashboard'],
    ['delete', '/api/workflows/logs/1'],
    ['post', '/api/admin/cleanup'],
    ['post', '/api/admin/retry'],
    ['post', '/api/admin/refresh-embeddings'],
  ];

  await t.test('C1. Customer tokens cannot reach legacy platform endpoints', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const owner = await createUser(models, { tenant_id: 1, role: 'owner', email: 'owner@acme.test', name: 'Owner' });
    await runAsTenant(1, () => WorkflowLogs.create({ id: 1, workflow: 'WF01', status: 'success', message: 'kept', created_at: new Date(Date.now() - 60 * 86400000) }));

    for (const [method, path] of PLATFORM_ROUTES) {
      const res = await request(app)[method](path).set(bearer(owner));
      assert.strictEqual(res.status, 403, `${method.toUpperCase()} ${path} returned ${res.status}`);
    }
    // A wrong service key is not a pass either.
    const wrongKey = await request(app).get('/api/workflows/logs').set('x-internal-key', 'wrong-key');
    assert.strictEqual(wrongKey.status, 401);
    assert.strictEqual(await count(WorkflowLogs), 1, 'nothing was deleted');
  });

  await t.test('C2. The internal service key and founder/ops staff keep access', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    await seedWorkspace(models, { tenantId: 2, name: 'Beta' });
    await runAsTenant(1, () => WorkflowLogs.create({ workflow: 'WF01', status: 'success', message: 'a', created_at: new Date() }));
    await runAsTenant(2, () => WorkflowLogs.create({ workflow: 'WF02', status: 'success', message: 'b', created_at: new Date(Date.now() - 60 * 86400000) }));
    const service = { 'x-internal-key': TEST_INTERNAL_KEY };

    const logs = await request(app).get('/api/workflows/logs').set(service);
    assert.strictEqual(logs.status, 200);
    assert.strictEqual(logs.body.logs.length, 2, 'platform view spans tenants');
    assert.strictEqual((await request(app).get('/api/workflows/telemetry').set(service)).status, 200);
    assert.strictEqual((await request(app).get('/api/reports/founder-dashboard').set(service)).status, 200);
    // Phase 3: the service key cleans up one named workspace (tenant 2 holds the old log).
    assert.strictEqual((await request(app).post('/api/admin/cleanup').set(service)).status, 403);
    const cleanup = await request(app).post('/api/admin/cleanup').set({ ...service, 'x-tenant-id': '2' });
    assert.strictEqual(cleanup.status, 200);
    assert.strictEqual(cleanup.body.deleted_logs, 1, 'only the log older than 30 days is removed');
    // Phase 2: the service key alone may not retry across tenants; it names one workspace.
    assert.strictEqual((await request(app).post('/api/admin/retry').set(service)).status, 403);
    assert.strictEqual((await request(app).post('/api/admin/retry').set({ ...service, 'x-tenant-id': '1' })).status, 200);
    assert.strictEqual((await request(app).post('/api/admin/refresh-embeddings').set(service)).status, 200);

    const ops = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'ops', email: 'ops@nera.test', name: 'Ops' });
    const support = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'support', email: 'support@nera.test', name: 'Support' });
    assert.strictEqual((await request(app).get('/api/workflows/logs').set(bearer(ops))).status, 200);
    assert.strictEqual((await request(app).get('/api/workflows/logs').set(bearer(support))).status, 403);

    // Tenant-scoped service calls are unchanged: they still name their tenant.
    assert.strictEqual((await request(app).get('/api/sales-tasks/unread-count').set(service)).status, 400);
    assert.strictEqual((await request(app).get('/api/sales-tasks/unread-count').set({ ...service, 'x-tenant-id': '1' })).status, 200);
  });

  await t.test('D1. Staff password change: rules enforced, other sessions revoked, audited', async () => {
    const support = await createUser(models, { tenant_id: null, is_platform_staff: true, staff_role: 'support', email: 'support@nera.test', name: 'Support' });
    const oldToken = makeToken(support, { mfa: true });
    const auth = { Authorization: `Bearer ${oldToken}` };

    const weak = await request(app).post('/api/admin/settings/password').set(auth).send({ currentPassword: 'Original-Pass-1', newPassword: 'short' });
    assert.strictEqual(weak.status, 400);
    const wrongCurrent = await request(app).post('/api/admin/settings/password').set(auth).send({ currentPassword: 'not-it', newPassword: STRONG_PASSWORD });
    assert.strictEqual(wrongCurrent.status, 400);
    assert.strictEqual((await runAsSystem(() => Users.findOne({ id: support.id }).lean())).token_version, 0, 'failed attempts change nothing');

    // Any staff member may change their own password (previously founder-only).
    const ok = await request(app).post('/api/admin/settings/password').set(auth).send({ currentPassword: 'Original-Pass-1', newPassword: STRONG_PASSWORD });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.ok(ok.body.token, 'a fresh token is returned for this session');

    const stored = await runAsSystem(() => Users.findOne({ id: support.id }).lean());
    assert.strictEqual(stored.token_version, 1);
    assert.ok(await bcrypt.compare(STRONG_PASSWORD, stored.password_hash));

    const withOld = await request(app).get('/api/admin/me').set(auth);
    assert.strictEqual(withOld.status, 401, 'the old token is revoked');
    assert.strictEqual(withOld.body.code, 'SESSION_REVOKED');
    const withNew = await request(app).get('/api/admin/me').set('Authorization', `Bearer ${ok.body.token}`);
    assert.strictEqual(withNew.status, 200);

    const audited = await runAsSystem(() => AuditEvents.countDocuments({ event: 'PASSWORD_CHANGED', target_id: String(support.id) }));
    assert.strictEqual(audited, 1);
  });

  await t.test('D2. Customer password change also revokes the old token', async () => {
    await seedWorkspace(models, { tenantId: 1, name: 'Acme' });
    const agent = await createUser(models, { tenant_id: 1, role: 'agent', email: 'agent@acme.test', name: 'Agent' });
    const oldToken = makeToken(agent);
    const res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${oldToken}`)
      .send({ current: 'Original-Pass-1', newPassword: STRONG_PASSWORD });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`)).status, 401);
    assert.strictEqual((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`)).status, 200);
  });
});
