/**
 * Settings > Team: add people with a temporary password (forced change at
 * first sign-in) or an invitation, seats, roles, reset password, disable,
 * remove, last Owner protection, tenant isolation, audit, and the admin
 * panel's add-user / reset-password. Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const TEMP = 'Temporary-Pass-1';
const OWN = 'My-Own-Pass-22';
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.BILLING_REQUIRE_PLAN;
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test('Team members', async (t) => {
  const { Users, Tenants, Invitations, AuditEvents, UserSessions } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const billing = require('../services/billing');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  let seq = 0;

  t.beforeEach(async () => {
    await clearCollections();
    notify.clearOutbox();
    await billing.plans.ensureDefaultPlans();
  });

  const createUser = async (fields) => (await sys(() => Users.create({
    email: `user${++seq}@acme.test`, name: `User ${seq}`, password_hash: bcrypt.hashSync('Existing-Pass-1', 4),
    is_active: true, token_version: 0, ...fields,
  }))).toObject();
  // A workspace with an owner; `plan` gives it seats (desk 1, whatsapp 2, complete 5).
  async function workspace(tenantId, { plan = 'complete' } = {}) {
    const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}` });
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata' }));
    if (plan) await billing.subscriptions.activate({ tenantId, plan: await billing.plans.planByCode(plan) });
    return owner;
  }
  const addStaff = (actor, body) => request(app).post('/api/team/users').set(bearer(actor)).send(body);
  const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
  const events = async (event) => sys(() => AuditEvents.find({ event }).lean());

  await t.test('T1. Add with a temporary password: hashed, never returned, and a password change is forced before anything else', async () => {
    const owner = await workspace(1);
    const res = await addStaff(owner, { name: 'Priya Agent', email: 'Priya@Acme.test', phone: '+91 98765 43210', role: 'agent', method: 'password', password: TEMP });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.ok(!JSON.stringify(res.body).includes(TEMP), 'the password is never returned');
    assert.strictEqual(res.body.user.email, 'priya@acme.test');
    assert.strictEqual(res.body.user.role, 'staff', 'the retired agent role is added as Staff');
    assert.strictEqual(res.body.user.must_change_password, true);
    const row = await sys(() => Users.findOne({ email: 'priya@acme.test' }).lean());
    assert.strictEqual(row.tenant_id, 1);
    assert.strictEqual(row.phone, '+91 98765 43210');
    assert.notStrictEqual(row.password_hash, TEMP);
    assert.ok(await bcrypt.compare(TEMP, row.password_hash), 'bcrypt hash of the temporary password');
    const added = await events('TEAM_MEMBER_ADDED');
    assert.strictEqual(added.length, 1);
    assert.ok(!JSON.stringify(added).includes(TEMP), 'the password is not in the audit log');

    // Weak passwords follow the normal password rules.
    const weak = await addStaff(owner, { name: 'Weak', email: 'weak@acme.test', role: 'agent', method: 'password', password: 'short1' });
    assert.strictEqual(weak.status, 400);
    assert.match(weak.body.error, /at least 10 characters/);

    // Sign in with the temporary password: the session says a change is needed…
    const signIn = await login('priya@acme.test', TEMP);
    assert.strictEqual(signIn.status, 200, JSON.stringify(signIn.body));
    assert.strictEqual(signIn.body.user.must_change_password, true);
    const token = signIn.body.token;
    // …and nothing else works until it is changed (403, not 401: the app keeps the session).
    const blocked = await request(app).get('/api/leads').set(auth(token));
    assert.strictEqual(blocked.status, 403);
    assert.strictEqual(blocked.body.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.strictEqual((await request(app).get('/api/tenant').set(auth(token))).body.code, 'PASSWORD_CHANGE_REQUIRED');
    assert.strictEqual((await request(app).get('/api/account/sessions').set(auth(token))).body.code, 'PASSWORD_CHANGE_REQUIRED');
    const me = await request(app).get('/api/auth/me').set(auth(token));
    assert.strictEqual(me.status, 200);
    assert.strictEqual(me.body.must_change_password, true);

    // The same password again is refused; a new one clears the flag.
    const same = await request(app).post('/api/auth/change-password').set(auth(token)).send({ current: TEMP, newPassword: TEMP });
    assert.strictEqual(same.status, 400);
    const changed = await request(app).post('/api/auth/change-password').set(auth(token)).send({ current: TEMP, newPassword: OWN });
    assert.strictEqual(changed.status, 200, JSON.stringify(changed.body));
    const fresh = changed.body.token;
    assert.strictEqual((await request(app).get('/api/tenant').set(auth(fresh))).status, 200);
    assert.strictEqual((await request(app).get('/api/auth/me').set(auth(fresh))).body.must_change_password, false);
    assert.strictEqual((await login('priya@acme.test', OWN)).status, 200);
  });

  await t.test('T2. Invite path: an email is sent, the phone is kept, and accepting creates the login', async () => {
    const owner = await workspace(1);
    const res = await addStaff(owner, { name: 'Ravi Manager', email: 'ravi@acme.test', phone: '+91 90000 00001', role: 'manager', method: 'invite' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.invitation.email, 'ravi@acme.test');
    assert.strictEqual(res.body.invitation.role, 'staff');
    assert.strictEqual(res.body.token, undefined, 'never the invitation token');
    const mail = notify.outbox().find((m) => m.to === 'ravi@acme.test');
    assert.ok(mail, 'invitation email sent');
    const link = /\/invite\/([A-Za-z0-9_-]+)/.exec(mail.text || mail.html)[1];
    const accepted = await request(app).post('/api/auth/invitations/accept').send({ token: link, name: 'Ravi', password: OWN });
    assert.strictEqual(accepted.status, 201, JSON.stringify(accepted.body));
    const row = await sys(() => Users.findOne({ email: 'ravi@acme.test' }).lean());
    assert.strictEqual(row.role, 'staff');
    assert.strictEqual(row.phone, '+91 90000 00001');
    assert.ok(!row.must_change_password, 'they chose their own password');
    // Invite with a password is refused (they choose their own).
    const mixed = await addStaff(owner, { name: 'Mixed', email: 'mixed@acme.test', role: 'agent', method: 'invite', password: TEMP });
    assert.strictEqual(mixed.status, 400);
  });

  await t.test('T3. Seat limit blocks both paths; the list shows seats used and the limit', async () => {
    const owner = await workspace(1, { plan: 'whatsapp' }); // 2 seats
    const first = await addStaff(owner, { name: 'First Agent', email: 'a1@acme.test', role: 'agent', method: 'password', password: TEMP });
    assert.strictEqual(first.status, 201);
    const byPassword = await addStaff(owner, { name: 'Second Agent', email: 'a2@acme.test', role: 'agent', method: 'password', password: TEMP });
    assert.strictEqual(byPassword.status, 409);
    assert.match(byPassword.body.error, /all 2 of its seats/);
    const byInvite = await addStaff(owner, { name: 'Third Agent', email: 'a3@acme.test', role: 'agent', method: 'invite' });
    assert.strictEqual(byInvite.status, 409);
    assert.strictEqual(await sys(() => Users.countDocuments({ tenant_id: 1 })), 2);

    const list = await request(app).get('/api/team/users').set(bearer(owner));
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual({ used: list.body.seats.used, limit: list.body.seats.limit }, { used: 2, limit: 2 });
    const agent = list.body.users.find((u) => u.email === 'a1@acme.test');
    assert.strictEqual(agent.status, 'active');
    assert.strictEqual(agent.must_change_password, true);
    assert.strictEqual(agent.mfa_enabled, false);
    assert.ok('last_login' in agent && 'phone' in agent);

    // Disabling frees the seat; enabling again needs one.
    assert.strictEqual((await request(app).post(`/api/team/users/${agent.id}/deactivate`).set(bearer(owner))).status, 200);
    assert.strictEqual((await addStaff(owner, { name: 'Replacement', email: 'a4@acme.test', role: 'agent', method: 'password', password: TEMP })).status, 201);
    const enable = await request(app).post(`/api/team/users/${agent.id}/reactivate`).set(bearer(owner));
    assert.strictEqual(enable.status, 409);
    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(owner))).body.users.find((u) => u.id === agent.id).status, 'disabled');

    // Without a plan a workspace keeps its single login.
    const solo = await workspace(2, { plan: null });
    const none = await addStaff(solo, { name: 'Nope', email: 'nope@acme.test', role: 'agent', method: 'password', password: TEMP });
    assert.strictEqual(none.status, 409);
  });

  await t.test('T4. Agents and Managers cannot manage the team; Admins cannot add or promote Owners and Admins', async () => {
    const owner = await workspace(1);
    const admin = await createUser({ tenant_id: 1, role: 'admin' });
    const manager = await createUser({ tenant_id: 1, role: 'manager' });
    const agent = await createUser({ tenant_id: 1, role: 'agent' });
    await billing.subscriptions.addExtras({ tenantId: 1, kind: 'seat', quantity: 3 }); // room for the people added below
    const body = { name: 'New Person', email: 'new@acme.test', role: 'agent', method: 'password', password: TEMP };
    assert.strictEqual((await addStaff(agent, body)).status, 403);
    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(agent))).status, 403, 'agents do not see the team');
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(agent))).body.permissions.view_team, false);
    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(manager))).status, 403, 'old managers are Staff: no Team page');
    assert.strictEqual((await addStaff(manager, body)).status, 403);
    assert.strictEqual((await request(app).patch(`/api/team/users/${agent.id}`).set(bearer(manager)).send({ name: 'Changed' })).status, 403);
    assert.strictEqual((await request(app).post(`/api/team/users/${agent.id}/reset-password`).set(bearer(agent)).send({ password: TEMP })).status, 403);
    assert.strictEqual((await request(app).delete(`/api/team/users/${manager.id}`).set(bearer(agent))).status, 403);

    assert.strictEqual((await addStaff(admin, { ...body, role: 'admin' })).status, 403);
    assert.strictEqual((await addStaff(admin, { ...body, role: 'owner' })).status, 403);
    assert.strictEqual((await request(app).patch(`/api/team/users/${agent.id}`).set(bearer(admin)).send({ role: 'admin' })).status, 403);
    assert.strictEqual((await request(app).post(`/api/team/users/${owner.id}/reset-password`).set(bearer(admin)).send({ password: TEMP })).status, 403, 'admins never touch an owner');
    assert.strictEqual((await request(app).delete(`/api/team/users/${owner.id}`).set(bearer(admin))).status, 403);
    assert.strictEqual((await addStaff(admin, body)).status, 201, 'admins add agents');
    assert.strictEqual((await addStaff(owner, { ...body, email: 'admin2@acme.test', role: 'admin' })).status, 201, 'owners add admins');
  });

  await t.test('T5. Edit, reset password (forced change + signed out), disable/enable, remove; all audited', async () => {
    const owner = await workspace(1);
    const agent = await createUser({ tenant_id: 1, role: 'agent', email: 'agent@acme.test' });
    const oldSession = (await login('agent@acme.test', 'Existing-Pass-1')).body.token;
    assert.strictEqual((await request(app).get('/api/tenant').set(auth(oldSession))).status, 200);

    const edit = await request(app).patch(`/api/team/users/${agent.id}`).set(bearer(owner)).send({ name: 'Agent Renamed', phone: '+91 91234 56789', role: 'admin' });
    assert.strictEqual(edit.status, 200, JSON.stringify(edit.body));
    assert.strictEqual(edit.body.user.name, 'Agent Renamed');
    assert.strictEqual(edit.body.user.role, 'admin');
    assert.strictEqual((await request(app).patch(`/api/team/users/${agent.id}`).set(bearer(owner)).send({ phone: 'call me' })).status, 400);

    const reset = await request(app).post(`/api/team/users/${agent.id}/reset-password`).set(bearer(owner)).send({ password: TEMP });
    assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
    assert.ok(!JSON.stringify(reset.body).includes(TEMP));
    assert.strictEqual(reset.body.user.must_change_password, true);
    assert.strictEqual((await request(app).get('/api/tenant').set(auth(oldSession))).status, 401, 'old sessions end');
    assert.strictEqual(await sys(() => UserSessions.countDocuments({ user_id: agent.id, revoked_at: null })), 0);
    const again = await login('agent@acme.test', TEMP);
    assert.strictEqual(again.body.user.must_change_password, true);
    assert.strictEqual((await request(app).get('/api/tenant').set(auth(again.body.token))).body.code, 'PASSWORD_CHANGE_REQUIRED');

    assert.strictEqual((await request(app).post(`/api/team/users/${agent.id}/deactivate`).set(bearer(owner))).status, 200);
    assert.strictEqual((await login('agent@acme.test', TEMP)).status, 401, 'disabled people cannot sign in');
    assert.strictEqual((await request(app).post(`/api/team/users/${agent.id}/reactivate`).set(bearer(owner))).status, 200);

    const removed = await request(app).delete(`/api/team/users/${agent.id}`).set(bearer(owner));
    assert.strictEqual(removed.status, 200, JSON.stringify(removed.body));
    const row = await sys(() => Users.findOne({ id: agent.id }).lean());
    assert.ok(row.removed_at, 'kept, marked removed');
    assert.strictEqual(row.is_active, false);
    assert.strictEqual((await login('agent@acme.test', TEMP)).status, 401);
    const list = await request(app).get('/api/team/users').set(bearer(owner));
    assert.ok(!list.body.users.some((u) => u.id === agent.id), 'removed people leave the list');
    assert.strictEqual((await request(app).patch(`/api/team/users/${agent.id}`).set(bearer(owner)).send({ name: 'Ghost' })).status, 404);

    for (const event of ['TEAM_MEMBER_UPDATED', 'TEAM_MEMBER_ROLE_CHANGED', 'TEAM_MEMBER_PASSWORD_RESET', 'TEAM_MEMBER_DISABLED', 'TEAM_MEMBER_ENABLED', 'TEAM_MEMBER_REMOVED']) {
      const rows = await events(event);
      assert.strictEqual(rows.length, 1, event);
      assert.strictEqual(rows[0].tenant_id, 1);
      assert.strictEqual(rows[0].actor_user_id, owner.id);
    }
    assert.ok(!JSON.stringify(await sys(() => AuditEvents.find({}).lean())).includes(TEMP));
  });

  await t.test('T6. The last Owner cannot be removed, disabled or demoted; another Owner can be', async () => {
    const owner = await workspace(1);
    const admin = await createUser({ tenant_id: 1, role: 'admin' });
    assert.strictEqual((await request(app).delete(`/api/team/users/${owner.id}`).set(bearer(owner))).status, 400, 'not yourself');
    // Platform staff are not stopped by the "yourself" rule, only by the last-owner rule.
    const founder = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder' });
    const teamMembers = require('../services/teamMembers');
    await assert.rejects(teamMembers.removeMember({ tenantId: 1, userId: owner.id, actor: { id: founder.id, kind: 'staff', role: 'founder' } }), (err) => err.status === 409);
    await assert.rejects(teamMembers.updateMember({ tenantId: 1, userId: owner.id, actor: { id: founder.id, kind: 'staff', role: 'founder' }, changes: { role: 'agent' } }), (err) => err.status === 409);
    const second = await createUser({ tenant_id: 1, role: 'owner', email: 'owner2@acme.test' });
    assert.strictEqual((await request(app).delete(`/api/team/users/${owner.id}`).set(bearer(second))).status, 200);
    assert.strictEqual((await sys(() => Tenants.findOne({ id: 1 }).lean())).owner_user_id, second.id, 'recorded owner moves');
    assert.strictEqual((await request(app).patch(`/api/team/users/${second.id}`).set(bearer(admin)).send({ role: 'agent' })).status, 403);
  });

  await t.test('T7. Tenant isolation: nobody manages another workspace\'s people', async () => {
    const ownerA = await workspace(1);
    const ownerB = await workspace(2);
    const agentB = await createUser({ tenant_id: 2, role: 'agent', email: 'agentb@beta.test' });
    // tenant_id in the body is ignored: the person lands in the caller's workspace.
    const added = await addStaff(ownerA, { name: 'Sneaky', email: 'sneaky@acme.test', role: 'agent', method: 'password', password: TEMP, tenant_id: 2 });
    assert.strictEqual(added.status, 201);
    assert.strictEqual((await sys(() => Users.findOne({ email: 'sneaky@acme.test' }).lean())).tenant_id, 1);
    for (const [method, path, body] of [
      ['patch', `/api/team/users/${agentB.id}`, { name: 'Hacked' }],
      ['post', `/api/team/users/${agentB.id}/reset-password`, { password: TEMP }],
      ['post', `/api/team/users/${agentB.id}/deactivate`, {}],
      ['delete', `/api/team/users/${agentB.id}`, {}],
    ]) {
      const res = await request(app)[method](path).set(bearer(ownerA)).send(body);
      assert.strictEqual(res.status, 404, `${method} ${path}`);
    }
    const row = await sys(() => Users.findOne({ id: agentB.id }).lean());
    assert.strictEqual(row.name.startsWith('User'), true);
    assert.strictEqual(row.is_active, true);
    assert.ok(!row.must_change_password);
    const listA = await request(app).get('/api/team/users').set(bearer(ownerA));
    assert.ok(!listA.body.users.some((u) => u.tenant_id !== 1));
    assert.ok((await request(app).get('/api/team/users').set(bearer(ownerB))).body.users.every((u) => u.tenant_id === 2));
    // Invitations of another workspace cannot be resent or cancelled.
    const inv = await request(app).post('/api/team/users').set(bearer(ownerB)).send({ name: 'Invitee', email: 'inv@beta.test', role: 'agent', method: 'invite' });
    assert.strictEqual(inv.status, 201);
    assert.strictEqual((await request(app).delete(`/api/team/invitations/${inv.body.invitation.id}`).set(bearer(ownerA))).status, 404);
    assert.strictEqual(await sys(() => Invitations.countDocuments({ id: inv.body.invitation.id, revoked_at: null })), 1);
  });

  await t.test('T8. Admin panel: add a user with a temporary password and reset a password', async () => {
    await workspace(1);
    const founder = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder' });
    const staffToken = makeToken(founder, { mfa: true });
    const res = await request(app).post('/api/admin/tenants/1/users').set(auth(staffToken))
      .send({ name: 'Admin Added', email: 'added@acme.test', role: 'admin', method: 'password', password: TEMP });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.ok(!JSON.stringify(res.body).includes(TEMP));
    assert.strictEqual(res.body.user.must_change_password, true);
    const changed = await request(app).post('/api/auth/change-password')
      .set(auth((await login('added@acme.test', TEMP)).body.token)).send({ current: TEMP, newPassword: OWN });
    assert.strictEqual(changed.status, 200);
    const reset = await request(app).post(`/api/admin/users/${res.body.user.id}/reset-password`).set(auth(staffToken)).send({ password: 'Another-Temp-9' });
    assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
    assert.strictEqual((await sys(() => Users.findOne({ id: res.body.user.id }).lean())).must_change_password, true);
    const detail = await request(app).get('/api/admin/tenants/1').set(auth(staffToken));
    assert.strictEqual(detail.status, 200);
    assert.strictEqual(detail.body.seats.limit, 5);
    // A customer token cannot use the admin route.
    const owner = await sys(() => Users.findOne({ email: 'owner1@acme.test' }).lean());
    assert.strictEqual((await request(app).post('/api/admin/tenants/1/users').set(bearer(owner)).send({})).status, 403);
  });
});
