/**
 * Cross-customer security review (release/customer-panel): Settings > Team,
 * the Leads page bulk actions and exports, sales tasks and the activity log.
 *
 * Two workspaces, A (tenant 1) and B (tenant 2), each with an owner, admin,
 * manager and agent. Signed in as every role of A, every new staff and
 * leads-bulk endpoint is tried against B's ids (users, invitations, leads,
 * assignees, tasks). Every attempt must be refused or change nothing, and B's
 * data must be byte-for-byte unchanged afterwards. Then role escalation inside
 * A, mass assignment, Mongo operator injection, the forced password change,
 * and the seat limit.
 * Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const supertest = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const request = (target) => new Proxy(supertest(target), {
  get: (agent, method) => (...args) => agent[method](...args).timeout({ deadline: 60000 }),
});

const TEMP = 'Temporary-Pass-1';
let app;
let models;
let runAsSystem;
let runAsTenant;
let billing;
let notify;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.BILLING_REQUIRE_PLAN;
  delete process.env.N8N_NEW_LEAD_WEBHOOK_URL;
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  billing = require('../services/billing');
  notify = require('../services/notify');
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });

const sys = (fn) => runAsSystem(fn, 'test');
const bearer = (user, opts) => ({ Authorization: `Bearer ${makeToken(user, opts)}` });
const ROLES = ['owner', 'admin', 'manager', 'agent'];

async function seedWorkspace(tenantId, { plan = 'complete' } = {}) {
  const { Users, Tenants, Leads, Clients, SalesTasks } = models;
  const makeUser = async (role, extra = {}) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@t${tenantId}.test`, name: `${role} ${tenantId}`,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, active: true, token_version: 0, created_at: new Date(Date.now() - 1000 * (10 - ROLES.indexOf(role))), ...extra,
  }))).toObject();
  const users = {};
  for (const role of ROLES) users[role] = await makeUser(role);
  await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: users.owner.id, timezone: 'Asia/Kolkata' }));
  if (plan) await billing.subscriptions.activate({ tenantId, plan: await billing.plans.planByCode(plan) });
  // A disabled member (for reactivate attempts).
  const disabled = await makeUser('agent', { email: `disabled${tenantId}@t${tenantId}.test`, is_active: false, active: false, deactivated_at: new Date() });
  const brand = await runAsTenant(tenantId, () => Clients.create({ name: `Brand ${tenantId}` }).then((d) => d.toObject()));
  const leads = await runAsTenant(tenantId, async () => {
    const out = [];
    for (let i = 1; i <= 3; i += 1) {
      out.push((await Leads.create({ name: `Lead ${tenantId}-${i}`, phone: `9190000${tenantId}000${i}`, client_id: brand.id, status: 'new', assigned_to: users.agent.id, source: 'Manual' })).toObject());
    }
    return out;
  });
  const task = await runAsTenant(tenantId, () => SalesTasks.create({ lead_id: leads[0].id, task_type: 'manual', title: `Task ${tenantId}`, assigned_to: users.agent.id, status: 'pending' }).then((d) => d.toObject()));
  return { tenantId, users, disabled, brand, leads, task };
}

async function inviteIn(tenantId, owner, email, role = 'agent') {
  const invitations = require('../services/invitations');
  const result = await invitations.createInvitation({ tenantId, email, name: 'Invitee', role, invitedBy: { id: owner.id, name: owner.name } });
  return result.invitation;
}

// Everything of a workspace that an attack could change.
async function snapshot(tenantId) {
  const { Users, Invitations, Leads, SalesTasks, Tenants, UserSessions } = models;
  return runAsTenant(tenantId, async () => JSON.stringify({
    users: await Users.find({}, { _id: 0, __v: 0, last_login: 0 }).sort({ id: 1 }).lean(),
    invitations: await Invitations.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }).lean(),
    leads: await Leads.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }).lean(),
    tasks: await SalesTasks.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }).lean(),
    sessions: await UserSessions.find({}, { _id: 0, __v: 0, last_seen_at: 0 }).sort({ id: 1 }).lean(),
    tenant: await sys(() => Tenants.findOne({ id: tenantId }, { _id: 0, __v: 0 }).lean()),
  }));
}

const refused = (res, label, codes = [403, 404]) => {
  assert.ok(codes.includes(res.status), `${label}: expected ${codes.join('/')} but got ${res.status} ${JSON.stringify(res.body)}`);
};

test('Cross-customer security', async (t) => {
  let A;
  let B;
  let bInvite;

  t.beforeEach(async () => {
    await clearCollections();
    notify.clearOutbox();
    await billing.plans.ensureDefaultPlans();
    A = await seedWorkspace(1);
    B = await seedWorkspace(2);
    bInvite = await inviteIn(2, B.users.owner, 'pending@t2.test');
  });

  await t.test('C1. Every role of A against every B id on the staff endpoints: refused, B unchanged', async () => {
    const before = await snapshot(2);
    const bUserIds = [...ROLES.map((r) => B.users[r].id), B.disabled.id];
    for (const role of ROLES) {
      const h = bearer(A.users[role]);
      for (const id of bUserIds) {
        const label = `${role} of A on B user ${id}`;
        refused(await request(app).patch(`/api/team/users/${id}`).set(h).send({ name: 'Hijacked', phone: '+91 90000 99999', role: 'agent' }), `${label} PATCH`);
        refused(await request(app).patch(`/api/team/users/${id}/role`).set(h).send({ role: 'owner' }), `${label} PATCH role`);
        refused(await request(app).post(`/api/team/users/${id}/reset-password`).set(h).send({ password: TEMP }), `${label} reset-password`);
        refused(await request(app).post(`/api/team/users/${id}/deactivate`).set(h), `${label} deactivate`);
        refused(await request(app).post(`/api/team/users/${id}/reactivate`).set(h), `${label} reactivate`);
        refused(await request(app).post(`/api/team/users/${id}/revoke-sessions`).set(h), `${label} revoke-sessions`);
        refused(await request(app).delete(`/api/team/users/${id}`).set(h), `${label} DELETE`);
      }
      refused(await request(app).post(`/api/team/invitations/${bInvite.id}/resend`).set(h), `${role} resend B invitation`);
      refused(await request(app).delete(`/api/team/invitations/${bInvite.id}`).set(h), `${role} revoke B invitation`);

      // The list never shows B's people or invitations.
      const list = await request(app).get('/api/team/users').set(h);
      // Old managers and agents are Staff now: no Team page.
      if (['manager', 'agent'].includes(role)) refused(list, `${role} team list`, [403]);
      else {
        assert.strictEqual(list.status, 200);
        assert.ok(list.body.users.every((u) => u.tenant_id === 1), `${role}: only A users`);
        assert.ok(!list.body.invitations.some((i) => i.id === bInvite.id), `${role}: no B invitation`);
      }
      // The admin panel's new routes are staff only.
      refused(await request(app).post('/api/admin/tenants/2/users').set(h).send({ name: 'X Y', email: 'x@t2.test', role: 'owner', method: 'password', password: TEMP }), `${role} admin add user`, [401, 403]);
      refused(await request(app).post(`/api/admin/users/${B.users.owner.id}/reset-password`).set(h).send({ password: TEMP }), `${role} admin reset-password`, [401, 403]);
      refused(await request(app).get('/api/admin/tenants/2/activity').set(h), `${role} admin activity`, [401, 403]);
    }
    assert.strictEqual(await snapshot(2), before, "B's users, invitations and sessions are unchanged");
  });

  await t.test('C2. Every role of A against B leads, assignees and tasks: refused or no effect, B unchanged', async () => {
    const beforeB = await snapshot(2);
    const bLeadIds = B.leads.map((l) => l.id);
    const aLeadIds = A.leads.map((l) => l.id);
    for (const role of ROLES) {
      const h = bearer(A.users[role]);
      const label = `${role} of A`;
      // Bulk on B's leads: nothing matches in A.
      for (const body of [
        { ids: bLeadIds, action: 'status', status: 'lost' },
        { ids: bLeadIds, action: 'assign', assigned_to: A.users.agent.id },
        { ids: bLeadIds, action: 'assign', assigned_to: null },
      ]) {
        const res = await request(app).post('/api/leads/bulk').set(h).send(body);
        assert.ok(res.status === 404 || (res.status === 200 && res.body.updated === 0), `${label} bulk ${body.action} on B: ${res.status} ${JSON.stringify(res.body)}`);
      }
      // Mixed ids: only A's own leads count.
      const mixed = await request(app).post('/api/leads/bulk').set(h).send({ ids: [...aLeadIds, ...bLeadIds], action: 'status', status: 'warm' });
      assert.strictEqual(mixed.status, 200);
      assert.strictEqual(mixed.body.updated, aLeadIds.length, `${label}: only A leads are counted`);
      // B's people are not assignees in A.
      for (const bUser of [B.users.owner, B.users.agent]) {
        refused(await request(app).post('/api/leads/bulk').set(h).send({ ids: aLeadIds, action: 'assign', assigned_to: bUser.id }), `${label} bulk-assign A leads to B user`, [400, 403, 404]);
        refused(await request(app).patch(`/api/leads/${aLeadIds[0]}`).set(h).send({ assigned_to: bUser.id }), `${label} PATCH A lead to B user`, [400, 403, 404]);
        refused(await request(app).post('/api/leads').set(h).send({ name: 'New', phone: '919811100011', assigned_to: bUser.id }), `${label} add lead for B user`, [400, 403, 404]);
        refused(await request(app).post('/api/sales-tasks').set(h).send({ title: 'x', assigned_to: bUser.id }), `${label} task for B user`, [400, 403, 404]);
      }
      // Single-lead routes with B ids.
      refused(await request(app).patch(`/api/leads/${bLeadIds[0]}`).set(h).send({ status: 'lost', name: 'Hijacked' }), `${label} PATCH B lead`);
      refused(await request(app).delete(`/api/leads/${bLeadIds[0]}`).set(h), `${label} DELETE B lead`);
      refused(await request(app).post(`/api/leads/${bLeadIds[0]}/ai`).set(h).send({ paused: true }), `${label} pause AI on B lead`);
      // Exports of B ids: agents are refused, others match nothing.
      refused(await request(app).post('/api/leads/exports').set(h).send({ mode: 'selected', ids: bLeadIds }), `${label} export B leads`, ['manager', 'agent'].includes(role) ? [403] : [400]);
      // Filtering by a B assignee finds nothing.
      const filtered = await request(app).get(`/api/leads?assigned_to=${B.users.agent.id}`).set(h);
      assert.strictEqual(filtered.status, 200);
      assert.strictEqual(filtered.body.total, 0, `${label}: no lead of B by assignee filter`);
      // Sales tasks of B.
      refused(await request(app).post('/api/sales-tasks').set(h).send({ title: 'x', lead_id: bLeadIds[0] }), `${label} task on B lead`, [400, 403, 404]);
      refused(await request(app).patch(`/api/sales-tasks/${B.task.id}`).set(h).send({ title: 'Hijacked', status: 'completed' }), `${label} PATCH B task`);
      refused(await request(app).put(`/api/sales-tasks/${B.task.id}/status`).set(h).send({ status: 'completed' }), `${label} complete B task`, [400, 403, 404]);
      refused(await request(app).delete(`/api/sales-tasks/${B.task.id}`).set(h), `${label} DELETE B task`);
      const bulkDel = await request(app).post('/api/sales-tasks/bulk-delete').set(h).send({ ids: [B.task.id] });
      assert.ok(bulkDel.status >= 400 || bulkDel.body.deletedCount === 0, `${label} bulk-delete B task: ${JSON.stringify(bulkDel.body)}`);
      const exp = await request(app).post('/api/sales-tasks/export').set(h).send({ ids: [B.task.id] });
      assert.ok(exp.status >= 400 || !String(exp.text).includes('Task 2'), `${label}: export of a B task`);
      // Activity log: only A's events, even when asking for a B person.
      const act = await request(app).get(`/api/activity?user_id=${B.users.owner.id}`).set(h);
      // The activity log is for Owners.
      if (role !== 'owner') refused(act, `${label} activity`, [403]);
      else {
        assert.strictEqual(act.status, 200);
        assert.strictEqual(act.body.events.length, 0, `${label}: no B events`);
      }
    }
    assert.strictEqual(await snapshot(2), beforeB, "B's leads and tasks are unchanged");
  });

  await t.test('C3. Role escalation inside A', async () => {
    const { owner, admin, manager, agent } = A.users;
    const body = { name: 'New Person', email: 'new@t1.test', method: 'password', password: TEMP };
    const before = await snapshot(1);
    // Managers and agents manage nobody.
    for (const actor of [manager, agent]) {
      const h = bearer(actor);
      for (const role of ROLES) refused(await request(app).post('/api/team/users').set(h).send({ ...body, role }), `${actor.role} adds ${role}`, [403]);
      refused(await request(app).post('/api/team/invitations').set(h).send({ email: 'inv@t1.test', role: 'agent' }), `${actor.role} invites`, [403]);
      for (const target of [owner, admin, manager, agent]) {
        if (target.id === actor.id) continue;
        refused(await request(app).patch(`/api/team/users/${target.id}`).set(h).send({ role: 'agent' }), `${actor.role} changes ${target.role}`, [403]);
        refused(await request(app).post(`/api/team/users/${target.id}/reset-password`).set(h).send({ password: TEMP }), `${actor.role} resets ${target.role}`, [403]);
        refused(await request(app).delete(`/api/team/users/${target.id}`).set(h), `${actor.role} removes ${target.role}`, [403]);
        refused(await request(app).post(`/api/team/users/${target.id}/deactivate`).set(h), `${actor.role} disables ${target.role}`, [403]);
      }
      // Nor themselves.
      refused(await request(app).patch(`/api/team/users/${actor.id}/role`).set(h).send({ role: 'owner' }), `${actor.role} self-promotes`, [400, 403]);
    }
    // Admins: never Owner/Admin grants, never an Owner target.
    const ha = bearer(admin);
    for (const role of ['owner', 'admin']) {
      refused(await request(app).post('/api/team/users').set(ha).send({ ...body, role }), `admin adds ${role}`, [403]);
      refused(await request(app).post('/api/team/users').set(ha).send({ ...body, role, method: 'invite', password: undefined }), `admin invites ${role} (team/users)`, [403]);
      refused(await request(app).post('/api/team/invitations').set(ha).send({ email: 'inv@t1.test', role }), `admin invites ${role}`, [403]);
      refused(await request(app).patch(`/api/team/users/${agent.id}`).set(ha).send({ role }), `admin promotes agent to ${role}`, [403]);
      refused(await request(app).patch(`/api/team/users/${manager.id}/role`).set(ha).send({ role }), `admin promotes manager to ${role}`, [403]);
    }
    refused(await request(app).patch(`/api/team/users/${admin.id}/role`).set(ha).send({ role: 'owner' }), 'admin self-promotes', [400, 403]);
    for (const [method, path, payload] of [
      ['patch', `/api/team/users/${owner.id}`, { name: 'Owned' }],
      ['patch', `/api/team/users/${owner.id}/role`, { role: 'agent' }],
      ['post', `/api/team/users/${owner.id}/reset-password`, { password: TEMP }],
      ['post', `/api/team/users/${owner.id}/deactivate`, {}],
      ['post', `/api/team/users/${owner.id}/revoke-sessions`, {}],
      ['delete', `/api/team/users/${owner.id}`, {}],
    ]) refused(await request(app)[method](path).set(ha).send(payload), `admin ${method} ${path}`, [403]);
    // Owner cannot remove, disable or demote themselves (the last Owner).
    const ho = bearer(owner);
    refused(await request(app).delete(`/api/team/users/${owner.id}`).set(ho), 'owner removes self', [400, 403, 409]);
    refused(await request(app).post(`/api/team/users/${owner.id}/deactivate`).set(ho), 'owner disables self', [400, 403, 409]);
    refused(await request(app).patch(`/api/team/users/${owner.id}/role`).set(ho).send({ role: 'agent' }), 'owner demotes self', [400, 403, 409]);
    assert.strictEqual(await snapshot(1), before, 'none of the refused attempts changed A');
  });

  await t.test('C4. Mass assignment and Mongo operators in bodies and queries', async () => {
    const { owner } = A.users;
    const h = bearer(owner);
    const res = await request(app).post('/api/team/users').set(h).send({
      name: 'Mass Assign', email: 'mass@t1.test', role: 'agent', method: 'password', password: TEMP,
      tenant_id: 2, is_platform_staff: true, staff_role: 'founder', must_change_password: false, token_version: 99, is_active: true,
    });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const row = await sys(() => models.Users.findOne({ email: 'mass@t1.test' }).lean());
    assert.strictEqual(row.tenant_id, 1);
    assert.notStrictEqual(row.is_platform_staff, true);
    assert.strictEqual(row.staff_role, null);
    assert.strictEqual(row.must_change_password, true);
    assert.strictEqual(row.token_version, 0);
    const patched = await request(app).patch(`/api/team/users/${row.id}`).set(h).send({ name: 'Renamed', tenant_id: 2, is_platform_staff: true, staff_role: 'founder', email: 'other@t2.test' });
    assert.strictEqual(patched.status, 200);
    const after = await sys(() => models.Users.findOne({ id: row.id }).lean());
    assert.strictEqual(after.tenant_id, 1);
    assert.strictEqual(after.email, 'mass@t1.test');
    assert.notStrictEqual(after.is_platform_staff, true);
    // Operators instead of values.
    refused(await request(app).patch(`/api/team/users/${row.id}`).set(h).send({ role: { $ne: null } }), 'role operator', [400]);
    refused(await request(app).post('/api/team/users').set(h).send({ name: 'Op', email: { $gt: '' }, role: 'agent', method: 'password', password: TEMP }), 'email operator', [400]);
    refused(await request(app).post('/api/leads/bulk').set(h).send({ ids: [{ $gt: 0 }], action: 'status', status: 'lost' }), 'bulk ids operator', [400]);
    refused(await request(app).post('/api/leads/bulk').set(h).send({ ids: [A.leads[0].id], action: 'assign', assigned_to: { $gt: 0 } }), 'bulk assignee operator', [400]);
    refused(await request(app).post('/api/leads/bulk').set(h).send({ ids: [A.leads[0].id], action: 'status', status: { $ne: 'x' } }), 'bulk status operator', [400]);
    // Query strings are parsed flat (no nested objects): either refused or only A's leads.
    const opQuery = await request(app).get('/api/leads?assigned_to[$ne]=0').set(h);
    assert.ok(opQuery.status === 400 || (opQuery.status === 200 && opQuery.body.leads.every((l) => l.tenant_id === 1)), 'assigned_to operator in query');
    refused(await request(app).post('/api/leads/exports').set(h).send({ mode: 'selected', ids: [{ $gt: 0 }] }), 'export ids operator', [400]);
    const opActivity = await request(app).get('/api/activity?user_id[$ne]=0').set(h);
    assert.ok(opActivity.status === 400 || (opActivity.status === 200 && opActivity.body.staff.every((u) => ![...ROLES.map((r) => B.users[r].id), B.disabled.id].includes(u.id))), 'activity user_id operator');
    const bLead = await runAsTenant(2, () => models.Leads.findOne({ id: B.leads[0].id }).lean());
    assert.strictEqual(bLead.status, 'new');
  });

  await t.test('C4b. The activity log says which leads were exported (selected, not "all leads")', async () => {
    const res = await request(app).post('/api/leads/exports').set(bearer(A.users.owner)).send({ mode: 'selected', ids: [A.leads[0].id] });
    assert.strictEqual(res.status, 202, JSON.stringify(res.body));
    const row = await sys(() => models.AuditEvents.findOne({ event: 'LEADS_EXPORTED', tenant_id: 1 }).lean());
    assert.match(row.summary, /Exported selected leads \(1 record\)/);
  });

  await t.test('C5. A temporary password blocks every new endpoint, the socket included', async () => {
    const { owner } = A.users;
    const added = await request(app).post('/api/team/users').set(bearer(owner)).send({ name: 'Temp Admin', email: 'temp@t1.test', role: 'admin', method: 'password', password: TEMP });
    assert.strictEqual(added.status, 201);
    const signIn = await request(app).post('/api/auth/login').send({ email: 'temp@t1.test', password: TEMP });
    assert.strictEqual(signIn.status, 200);
    const h = { Authorization: `Bearer ${signIn.body.token}` };
    for (const [method, path, payload] of [
      ['get', '/api/team/users'],
      ['post', '/api/team/users', { name: 'Sneaky', email: 'sneaky@t1.test', role: 'agent', method: 'password', password: TEMP }],
      ['post', '/api/team/invitations', { email: 'sneaky2@t1.test', role: 'agent' }],
      ['post', `/api/team/users/${A.users.agent.id}/reset-password`, { password: TEMP }],
      ['delete', `/api/team/users/${A.users.agent.id}`],
      ['post', '/api/leads/bulk', { ids: [A.leads[0].id], action: 'status', status: 'lost' }],
      ['post', '/api/leads/exports', { mode: 'all' }],
      ['get', '/api/activity'],
      ['get', '/api/sales-tasks'],
      ['get', '/api/account/sessions'],
      ['post', '/api/auth/mfa/email/setup', {}],
    ]) {
      const res = await request(app)[method](path).set(h).send(payload || {});
      assert.strictEqual(res.status, 403, `${method} ${path}: ${res.status} ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.code, 'PASSWORD_CHANGE_REQUIRED', `${method} ${path}`);
    }
    const { socketAuth } = require('../middleware/authMiddleware');
    const socketError = await new Promise((resolve) => {
      socketAuth({ handshake: { auth: { token: signIn.body.token } }, join() {}, data: {} }, (err) => resolve(err || null));
    });
    assert.ok(socketError, 'the socket refuses a temporary-password session');
    assert.strictEqual(await sys(() => models.Users.countDocuments({ email: /sneaky/ })), 0);
  });

  await t.test('C6. Reset, disable and remove end the target sessions at once', async () => {
    const { owner, agent, manager } = A.users;
    const ho = bearer(owner);
    const tokens = { agent: makeToken(agent), manager: makeToken(manager), disabled: null };
    assert.strictEqual((await request(app).get('/api/tenant').set({ Authorization: `Bearer ${tokens.agent}` })).status, 200);
    assert.strictEqual((await request(app).post(`/api/team/users/${agent.id}/reset-password`).set(ho).send({ password: TEMP })).status, 200);
    assert.strictEqual((await request(app).get('/api/tenant').set({ Authorization: `Bearer ${tokens.agent}` })).status, 401, 'reset ends the old session');
    assert.strictEqual((await request(app).post(`/api/team/users/${manager.id}/deactivate`).set(ho)).status, 200);
    assert.strictEqual((await request(app).get('/api/tenant').set({ Authorization: `Bearer ${tokens.manager}` })).status, 401, 'disable ends the session');
    const admin = A.users.admin;
    const adminToken = makeToken(admin);
    assert.strictEqual((await request(app).delete(`/api/team/users/${admin.id}`).set(ho)).status, 200);
    assert.strictEqual((await request(app).get('/api/tenant').set({ Authorization: `Bearer ${adminToken}` })).status, 401, 'remove ends the session');
    assert.strictEqual((await request(app).post('/api/auth/login').send({ email: admin.email, password: 'Original-Pass-1' })).status, 401, 'a removed person cannot sign in');
    refused(await request(app).post(`/api/team/users/${admin.id}/reactivate`).set(ho), 'a removed person cannot be enabled again', [404]);
  });

  await t.test('C7. Platform staff: ops cannot reset a staff account; staff routes need the right permission', async () => {
    const founder = (await sys(() => models.Users.create({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@getnera.test', name: 'Founder', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0 }))).toObject();
    const ops = (await sys(() => models.Users.create({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', email: 'ops@getnera.test', name: 'Ops', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0 }))).toObject();
    const h = bearer(ops, { mfa: true });
    refused(await request(app).post(`/api/admin/users/${founder.id}/reset-password`).set(h).send({ password: TEMP }), 'ops resets the founder', [400, 403, 404]);
    const row = await sys(() => models.Users.findOne({ id: founder.id }).lean());
    assert.ok(bcrypt.compareSync('Original-Pass-1', row.password_hash));
    assert.notStrictEqual(row.must_change_password, true);
    // A deleted workspace takes no new people.
    await sys(() => models.Tenants.updateOne({ id: 2 }, { $set: { status: 'deleted' } }));
    refused(await request(app).post('/api/admin/tenants/2/users').set(h).send({ name: 'Late Add', email: 'late@t2.test', role: 'owner', method: 'password', password: TEMP }), 'add to a deleted workspace', [404]);
    // Unknown workspace.
    refused(await request(app).post('/api/admin/tenants/999/users').set(h).send({ name: 'Ghost', email: 'ghost@t9.test', role: 'owner', method: 'password', password: TEMP }), 'add to an unknown workspace', [404]);
  });

  await t.test('C8. Seat limit: resending an expired invitation cannot add a person beyond the plan', async () => {
    // Workspace 3 on the whatsapp plan (2 seats): its owner plus one more.
    await sys(() => models.Tenants.create({ id: 3, name: 'Small', status: 'active', timezone: 'Asia/Kolkata' }));
    const owner = (await sys(() => models.Users.create({ tenant_id: 3, role: 'owner', email: 'owner@t3.test', name: 'Owner Three', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0 }))).toObject();
    await billing.subscriptions.activate({ tenantId: 3, plan: await billing.plans.planByCode('whatsapp') });
    assert.strictEqual(await billing.seatLimit(3), 2);
    const h = bearer(owner);
    const invited = await request(app).post('/api/team/invitations').set(h).send({ email: 'late@t3.test', role: 'agent' });
    assert.strictEqual(invited.status, 201, JSON.stringify(invited.body));
    // The link expires: the seat it held is free again and is given to someone else.
    await sys(() => models.Invitations.updateOne({ id: invited.body.invitation.id }, { $set: { expires_at: new Date(Date.now() - 1000) } }));
    const added = await request(app).post('/api/team/users').set(h).send({ name: 'Seat Taker', email: 'taker@t3.test', role: 'agent', method: 'password', password: TEMP });
    assert.strictEqual(added.status, 201, JSON.stringify(added.body));
    // Full now: a new invitation is refused…
    refused(await request(app).post('/api/team/invitations').set(h).send({ email: 'third@t3.test', role: 'agent' }), 'invite past the seats', [409]);
    // …and so is bringing the expired one back to life.
    const resent = await request(app).post(`/api/team/invitations/${invited.body.invitation.id}/resend`).set(h);
    refused(resent, 'resend past the seats', [409]);
    const inv = await sys(() => models.Invitations.findOne({ id: invited.body.invitation.id }).lean());
    assert.ok(new Date(inv.expires_at) <= new Date(), 'the expired invitation stays expired');
    // Staff resend from the admin panel follows the same seat rule.
    const founder = (await sys(() => models.Users.create({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'f@getnera.test', name: 'F', password_hash: 'x', is_active: true, token_version: 0 }))).toObject();
    refused(await request(app).post(`/api/admin/tenants/3/invitations/${invited.body.invitation.id}/resend`).set(bearer(founder, { mfa: true })), 'staff resend past the seats', [409]);
    // A pending (not expired) invitation still resends while it holds its seat.
    await sys(() => models.Users.updateOne({ email: 'taker@t3.test' }, { $set: { is_active: false } }));
    const second = await request(app).post('/api/team/invitations').set(h).send({ email: 'ok@t3.test', role: 'agent' });
    assert.strictEqual(second.status, 201, JSON.stringify(second.body));
    assert.strictEqual((await request(app).post(`/api/team/invitations/${second.body.invitation.id}/resend`).set(h)).status, 200, 'a pending invitation resends');
  });
  await t.test('C9. Only an Owner manages an Admin: an Admin cannot reset, disable, remove, demote or change another Admin', async () => {
    const { owner, admin, manager } = A.users;
    const admin2 = (await sys(() => models.Users.create({
      tenant_id: 1, role: 'admin', email: 'admin2@t1.test', name: 'Second Admin',
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, active: true, token_version: 0,
    }))).toObject();
    const ha = bearer(admin);
    const before = await snapshot(1);
    for (const [method, path, payload] of [
      ['patch', `/api/team/users/${admin2.id}`, { name: 'Renamed By Admin' }],
      ['patch', `/api/team/users/${admin2.id}`, { role: 'agent' }],
      ['patch', `/api/team/users/${admin2.id}/role`, { role: 'manager' }],
      ['post', `/api/team/users/${admin2.id}/reset-password`, { password: TEMP }],
      ['post', `/api/team/users/${admin2.id}/deactivate`, {}],
      ['post', `/api/team/users/${admin2.id}/revoke-sessions`, {}],
      ['delete', `/api/team/users/${admin2.id}`, {}],
    ]) refused(await request(app)[method](path).set(ha).send(payload), `admin ${method} ${path} on another admin`, [403]);
    assert.strictEqual(await snapshot(1), before, 'the other Admin is unchanged');
    // Admins still manage Managers and Agents.
    const renamed = await request(app).patch(`/api/team/users/${manager.id}`).set(ha).send({ name: 'Manager Renamed' });
    assert.strictEqual(renamed.status, 200, JSON.stringify(renamed.body));
    // An Owner manages Admins.
    const ho = bearer(owner);
    assert.strictEqual((await request(app).post(`/api/team/users/${admin2.id}/reset-password`).set(ho).send({ password: TEMP })).status, 200);
    assert.strictEqual((await request(app).patch(`/api/team/users/${admin2.id}`).set(ho).send({ role: 'manager' })).status, 200);
    // Once a Manager, the Admin may manage them.
    assert.strictEqual((await request(app).post(`/api/team/users/${admin2.id}/deactivate`).set(ha)).status, 200);
  });
  await t.test('C10. Accepting an invitation needs a free seat at that moment', async () => {
    // Workspace 3 on the whatsapp plan (2 seats): its owner plus one invitation.
    await sys(() => models.Tenants.create({ id: 3, name: 'Small', status: 'active', timezone: 'Asia/Kolkata' }));
    const owner = (await sys(() => models.Users.create({ tenant_id: 3, role: 'owner', email: 'owner@t3.test', name: 'Owner Three', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0 }))).toObject();
    await billing.subscriptions.activate({ tenantId: 3, plan: await billing.plans.planByCode('whatsapp') });
    const invitations = require('../services/invitations');
    const { token } = await invitations.createInvitation({ tenantId: 3, email: 'late@t3.test', role: 'agent', invitedBy: { id: owner.id, name: owner.name } });
    assert.ok(token);
    // The seat the invitation held is taken before it is accepted (another
    // login created while the link sat in the inbox, e.g. by platform staff).
    await sys(() => models.Users.create({ tenant_id: 3, role: 'agent', email: 'taker@t3.test', name: 'Seat Taker', password_hash: 'x', is_active: true, token_version: 0 }));
    const res = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Late Joiner', password: 'Team-Member-2026' });
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.error || res.body.message, 'This workspace has no free seat. Ask the owner to free one or add a seat.');
    assert.strictEqual(await sys(() => models.Users.countDocuments({ email: 'late@t3.test' })), 0, 'no login was created');
    const inv = await sys(() => models.Invitations.findOne({ email: 'late@t3.test' }).lean());
    assert.strictEqual(inv.accepted_at ?? null, null, 'the invitation stays usable');
    // A seat frees up: the same link now works.
    await sys(() => models.Users.updateOne({ email: 'taker@t3.test' }, { $set: { is_active: false } }));
    const ok = await request(app).post('/api/auth/invitations/accept').send({ token, name: 'Late Joiner', password: 'Team-Member-2026' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    // Cancelling an invitation never needs a seat, even in a full workspace.
    await sys(() => models.Users.updateOne({ email: 'taker@t3.test' }, { $set: { is_active: true } }));
    const extra = await sys(() => models.Invitations.create({ tenant_id: 3, email: 'over@t3.test', role: 'agent', token_hash: 'x'.repeat(64), expires_at: new Date(Date.now() + 3600000), created_at: new Date() }));
    const revoked = await request(app).delete(`/api/team/invitations/${extra.id}`).set(bearer(owner));
    assert.strictEqual(revoked.status, 200, JSON.stringify(revoked.body));
  });
  await t.test('C11. Workspace alerts never go to a disabled or demoted former Owner', async () => {
    const { Users, Tenants } = models;
    const { owner } = A.users;
    const mk = async (email, extra = {}) => (await sys(() => Users.create({
      tenant_id: 1, role: 'owner', email, name: email, password_hash: bcrypt.hashSync('Original-Pass-1', 4),
      is_active: true, active: true, token_version: 0, ...extra,
    }))).toObject();
    const owner2 = await mk('owner2@t1.test', { created_at: new Date(Date.now() - 500) });
    const owner3 = await mk('owner3@t1.test', { created_at: new Date(Date.now() - 100) });
    const recorded = async () => (await sys(() => Tenants.findOne({ id: 1 }).lean())).owner_user_id;
    assert.strictEqual(await recorded(), owner.id);
    // Demoting the recorded owner moves the record to another active Owner.
    const demoted = await request(app).patch(`/api/team/users/${owner.id}/role`).set(bearer(owner2)).send({ role: 'agent' });
    assert.strictEqual(demoted.status, 200, JSON.stringify(demoted.body));
    assert.strictEqual(await recorded(), owner2.id, 'demote moves the recorded owner');
    // So does disabling them (the team route and the older one share it).
    const disabled = await request(app).post(`/api/team/users/${owner2.id}/deactivate`).set(bearer(owner3));
    assert.strictEqual(disabled.status, 200, JSON.stringify(disabled.body));
    assert.strictEqual(await recorded(), owner3.id, 'disable moves the recorded owner');

    // Older data may still point at someone who is no longer an active Owner:
    // the alert senders skip them and use an active Owner instead.
    const alerts = require('../services/alerts');
    const numberHealth = require('../services/numberHealth');
    for (const stale of [owner.id /* demoted, still active */, owner2.id /* disabled */, A.disabled.id /* disabled agent */]) {
      await sys(() => Tenants.updateOne({ id: 1 }, { $set: { owner_user_id: stale } }));
      const viaAlerts = await runAsTenant(1, () => alerts.recipientsFor(1));
      assert.strictEqual(viaAlerts.owner?.id, owner3.id, `alerts skip user ${stale}`);
      const viaHealth = await runAsTenant(1, () => numberHealth.workspaceOwner());
      assert.strictEqual(viaHealth.owner?.id, owner3.id, `number health skips user ${stale}`);
    }
    // No active Owner at all: nobody is emailed rather than a former one.
    await sys(() => Users.updateOne({ id: owner3.id }, { $set: { is_active: false } }));
    await sys(() => Tenants.updateOne({ id: 1 }, { $set: { owner_user_id: owner3.id } }));
    assert.strictEqual((await runAsTenant(1, () => alerts.recipientsFor(1))).owner, null);
    assert.strictEqual((await runAsTenant(1, () => numberHealth.workspaceOwner())).owner, null);
  });

  await t.test('C12. Lead import never assigns leads to disabled or removed people', async () => {
    const { Users, Leads } = models;
    const { owner, agent } = A.users;
    // A.disabled has the same name as the active agent ("agent 1").
    assert.strictEqual(A.disabled.name, agent.name);
    await sys(() => Users.create({
      tenant_id: 1, role: 'agent', email: 'gone@t1.test', name: 'Gone Person', password_hash: 'x',
      is_active: false, active: false, removed_at: new Date(), token_version: 0,
    }));
    const csv = [
      'name,phone,assigned',
      `Import One,919811100001,${agent.name}`,
      `Import Two,919811100002,${A.disabled.email}`,
      'Import Three,919811100003,gone@t1.test',
      'Import Four,919811100004,Gone Person',
      `Import Five,919811100005,${agent.email}`,
    ].join('\n');
    const res = await request(app).post('/api/leads/import').set(bearer(owner)).attach('file', Buffer.from(csv), 'leads.csv');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const byName = Object.fromEntries((await runAsTenant(1, () => Leads.find({ name: /^Import / }).lean())).map((l) => [l.name, l.assigned_to ?? null]));
    assert.strictEqual(byName['Import One'], agent.id, 'a shared name goes to the active person');
    assert.strictEqual(byName['Import Two'], null, 'not to a disabled person');
    assert.strictEqual(byName['Import Three'], null, 'not to a removed person (email)');
    assert.strictEqual(byName['Import Four'], null, 'not to a removed person (name)');
    assert.strictEqual(byName['Import Five'], agent.id);
  });

});
