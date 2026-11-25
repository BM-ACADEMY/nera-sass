/**
 * Staff activity log: staff actions in the customer app are recorded with the
 * actor's name and role, and owners/admins (and the Getnera admin panel) can
 * read them with filters. Real server.js app, in-memory MongoDB, no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const PASSWORD = 'Original-Pass-1';
let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.N8N_NEW_LEAD_WEBHOOK_URL = '';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Staff activity log', async (t) => {
  const { Users, Tenants, Clients, Leads, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user, mfa = false) => ({ Authorization: `Bearer ${makeToken(user, { mfa })}` });
  const createUser = async (fields) => (await sys(() => Users.create({
    password_hash: bcrypt.hashSync(PASSWORD, 4), is_active: true, token_version: 0, ...fields,
  }))).toObject();

  async function workspace(tenantId) {
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', language: 'en', timezone: 'Asia/Kolkata' }));
    const brand = await runAsTenant(tenantId, async () => (await Clients.create({ name: `Brand ${tenantId}` })).toObject());
    const users = {};
    for (const role of ['owner', 'admin', 'manager', 'agent']) {
      users[role] = await createUser({ tenant_id: tenantId, role, email: `${role}${tenantId}@acme.test`, name: `${role} ${tenantId}` });
    }
    return { brand, users };
  }
  const lead = (tenantId, fields) => runAsTenant(tenantId, async () => (await Leads.create({ name: 'Ravi', phone: '9876543210', status: 'new', score: 0, source: 'Manual', created_at: new Date(), ...fields })).toObject());
  const events = (tenantId, event) => sys(() => AuditEvents.find({ tenant_id: tenantId, ...(event ? { event } : {}) }, { _id: 0 }).sort({ id: 1 }).lean());

  await t.test('A1. lead status change, assignment and other edits are recorded with actor, fields and before/after', async () => {
    const { brand, users } = await workspace(10);
    const l = await lead(10, { client_id: brand.id });
    const res = await request(app).patch(`/api/leads/${l.id}`).set(bearer(users.agent))
      .send({ status: 'contacted', assigned_to: users.manager.id, email: 'ravi@example.test', notes: 'private note text' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.lead.status, 'contacted', 'behaviour unchanged');

    const [status] = await events(10, 'LEAD_STATUS_CHANGED');
    assert.ok(status, 'status change recorded');
    assert.strictEqual(status.actor_user_id, users.agent.id);
    assert.strictEqual(status.actor_name, 'agent 10');
    assert.strictEqual(status.actor_role, 'agent');
    assert.strictEqual(status.target_type, 'lead');
    assert.strictEqual(status.target_id, String(l.id));
    assert.deepStrictEqual(status.meta.before, { status: 'new' });
    assert.deepStrictEqual(status.meta.after, { status: 'contacted' });
    assert.match(status.summary, /Ravi.*new.*contacted/);

    const [assigned] = await events(10, 'LEAD_ASSIGNED');
    assert.match(assigned.summary, /manager 10/);
    const [edited] = await events(10, 'LEAD_UPDATED');
    assert.deepStrictEqual(edited.meta.fields.sort(), ['email', 'notes']);
    const stored = JSON.stringify(await events(10));
    assert.ok(!stored.includes('private note text'), 'note text is never logged');
    assert.ok(!stored.includes('ravi@example.test'), 'edited values of other fields are not logged');

    // Saving the same status again is not a change.
    await request(app).patch(`/api/leads/${l.id}`).set(bearer(users.agent)).send({ status: 'contacted' });
    assert.strictEqual((await events(10, 'LEAD_STATUS_CHANGED')).length, 1);
  });

  await t.test('A2. lead delete is recorded with the lead name', async () => {
    const { brand, users } = await workspace(11);
    const l = await lead(11, { client_id: brand.id, name: 'Meena' });
    const res = await request(app).delete(`/api/leads/${l.id}`).set(bearer(users.manager));
    assert.strictEqual(res.status, 200);
    const [deleted] = await events(11, 'LEAD_DELETED');
    assert.ok(deleted);
    assert.strictEqual(deleted.actor_user_id, users.manager.id);
    assert.match(deleted.summary, /Meena/);
    // A missing lead records nothing.
    await request(app).delete('/api/leads/99999').set(bearer(users.manager));
    assert.strictEqual((await events(11, 'LEAD_DELETED')).length, 1);
  });

  await t.test('A3. lead export is recorded with its scope and count', async () => {
    const { brand, users } = await workspace(12);
    await lead(12, { client_id: brand.id });
    await lead(12, { client_id: brand.id, phone: '9876500000' });
    const res = await request(app).post('/api/leads/exports').set(bearer(users.owner)).send({ mode: 'all' });
    assert.strictEqual(res.status, 202);
    // Let the background export finish before the next test clears the data.
    for (let i = 0; i < 50; i += 1) {
      const job = await request(app).get(`/api/leads/exports/${res.body.id}`).set(bearer(users.owner));
      if (['completed', 'failed'].includes(job.body.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [exported] = await events(12, 'LEADS_EXPORTED');
    assert.ok(exported);
    assert.strictEqual(exported.actor_user_id, users.owner.id);
    assert.strictEqual(exported.meta.total_records, 2);
    assert.match(exported.summary, /all leads \(2 records\)/);
  });

  await t.test('A4. workspace settings change is recorded with a plain summary', async () => {
    const { users } = await workspace(13);
    const res = await request(app).patch('/api/tenant/settings').set(bearer(users.admin)).send({ language: 'ta' });
    assert.strictEqual(res.status, 200);
    const [changed] = await events(13, 'TENANT_UPDATED');
    assert.ok(changed);
    assert.strictEqual(changed.actor_name, 'admin 13');
    assert.strictEqual(changed.actor_role, 'admin');
    assert.match(changed.summary, /language to "ta"/);
  });

  await t.test('A5. sign-in success and failure are recorded for the workspace, without the password', async () => {
    await workspace(14);
    const bad = await request(app).post('/api/auth/login').send({ email: 'agent14@acme.test', password: 'Wrong-Pass-9' });
    assert.strictEqual(bad.status, 401);
    const good = await request(app).post('/api/auth/login').send({ email: 'agent14@acme.test', password: PASSWORD });
    assert.strictEqual(good.status, 200);
    assert.ok(good.body.token);
    const failed = await events(14, 'LOGIN_FAILED');
    const ok = await events(14, 'LOGIN_SUCCEEDED');
    assert.strictEqual(failed.length, 1);
    assert.strictEqual(ok.length, 1);
    assert.strictEqual(ok[0].actor_name, 'agent 14');
    const stored = JSON.stringify(await events(14));
    assert.ok(!stored.includes('Wrong-Pass-9') && !stored.includes(PASSWORD), 'passwords never logged');
  });

  // ── Reading the log ──────────────────────────────────────
  async function seed() {
    const a = await workspace(20);
    const b = await workspace(21);
    const audit = require('../services/audit');
    const write = (tenantId, user, event, at, summary) => sys(() => AuditEvents.create({
      tenant_id: tenantId, event, actor_type: 'user', actor_user_id: user.id, actor_name: user.name, actor_role: user.role,
      summary, meta: {}, created_at: new Date(at),
    }));
    await write(20, a.users.agent, 'LEAD_STATUS_CHANGED', '2026-11-10T06:00:00Z', 'A agent changed status');
    await write(20, a.users.agent, 'MESSAGE_SENT', '2026-11-11T06:00:00Z', 'A agent sent a message');
    await write(20, a.users.manager, 'CAMPAIGN_SENT', '2026-11-12T06:00:00Z', 'A manager sent a campaign');
    await write(20, a.users.owner, 'AI_TURNED_OFF', '2026-11-13T06:00:00Z', 'A owner turned AI off');
    await write(20, a.users.owner, 'USER_ROLE_CHANGED', '2026-11-14T06:00:00Z', 'A owner changed a role');
    await write(20, a.users.owner, 'LOGIN_FAILED', '2026-11-15T06:00:00Z', 'Wrong password');
    // Platform-internal and platform staff events.
    await sys(() => AuditEvents.create({ tenant_id: 20, event: 'CROSS_TENANT_ACCESS_DENIED', actor_type: 'user', actor_user_id: a.users.agent.id, meta: {}, created_at: new Date('2026-11-16T06:00:00Z') }));
    await audit.record('TENANT_SENDING_PAUSED', { tenantId: 20, actor: { actor_type: 'staff', actor_user_id: 999, actor_name: 'Priya (Getnera)', actor_role: 'ops' }, summary: 'Paused sending' });
    await write(21, b.users.owner, 'LEAD_DELETED', '2026-11-12T06:00:00Z', 'B owner deleted a lead');
    return { a, b };
  }

  await t.test('R1. owner and admin read their own workspace log, newest first, with staff list', async () => {
    const { a } = await seed();
    for (const role of ['owner', 'admin']) {
      const res = await request(app).get('/api/activity').set(bearer(a.users[role]));
      assert.strictEqual(res.status, 200, role);
      const summaries = res.body.events.map((e) => e.details);
      assert.ok(!summaries.includes('B owner deleted a lead'), `${role}: other workspace hidden`);
      assert.ok(!res.body.events.some((e) => e.event === 'CROSS_TENANT_ACCESS_DENIED'), 'internal events hidden from customers');
      const times = res.body.events.map((e) => new Date(e.at).getTime());
      assert.deepStrictEqual(times, [...times].sort((x, y) => y - x), 'newest first');
      assert.strictEqual(res.body.events[0].event, 'TENANT_SENDING_PAUSED');
      assert.strictEqual(res.body.events[0].actor.name, 'Getnera team', 'platform staff names are not shown to customers');
      assert.ok(res.body.staff.some((s) => s.id === a.users.agent.id && s.name === 'agent 20'));
      assert.ok(!res.body.staff.some((s) => s.name === 'owner 21'), 'staff list is this workspace only');
      const status = res.body.events.find((e) => e.event === 'LEAD_STATUS_CHANGED');
      assert.strictEqual(status.action, 'Changed lead status');
      assert.strictEqual(status.group, 'leads');
      assert.deepStrictEqual(status.actor, { id: a.users.agent.id, name: 'agent 20', role: 'agent', type: 'user' });
      assert.strictEqual(status.meta, undefined, 'raw meta stays out of the customer view');
    }
  });

  await t.test('R2. manager and agent get 403', async () => {
    const { a } = await seed();
    for (const role of ['manager', 'agent']) {
      const res = await request(app).get('/api/activity').set(bearer(a.users[role]));
      assert.strictEqual(res.status, 403, role);
    }
    assert.strictEqual((await request(app).get('/api/activity')).status, 401);
  });

  await t.test('R3. a query cannot reach another workspace', async () => {
    const { a, b } = await seed();
    const res = await request(app).get('/api/activity').query({ tenant_id: 21, user_id: b.users.owner.id }).set(bearer(a.users.owner));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.events.length, 0);
    assert.strictEqual(res.body.total, 0);
    const own = await request(app).get('/api/activity').set(bearer(b.users.owner));
    assert.deepStrictEqual(own.body.events.map((e) => e.details), ['B owner deleted a lead']);
  });

  await t.test('R4. filters: staff user, group, date range, paging', async () => {
    const { a } = await seed();
    const get = (query) => request(app).get('/api/activity').query(query).set(bearer(a.users.owner));

    const byAgent = await get({ user_id: a.users.agent.id });
    assert.deepStrictEqual(byAgent.body.events.map((e) => e.event), ['MESSAGE_SENT', 'LEAD_STATUS_CHANGED']);

    const groups = {
      leads: ['LEAD_STATUS_CHANGED'], chat: ['MESSAGE_SENT'], campaigns: ['CAMPAIGN_SENT'],
      settings: ['AI_TURNED_OFF'], team: ['USER_ROLE_CHANGED'], security: ['LOGIN_FAILED'],
    };
    for (const [group, expected] of Object.entries(groups)) {
      const res = await get({ group });
      assert.strictEqual(res.status, 200, group);
      assert.deepStrictEqual(res.body.events.map((e) => e.event), expected, group);
    }
    assert.strictEqual((await get({ group: 'nope' })).status, 400);

    // Whole days in India time, both ends included.
    const range = await get({ from: '2026-11-11', to: '2026-11-13' });
    assert.deepStrictEqual(range.body.events.map((e) => e.event), ['AI_TURNED_OFF', 'CAMPAIGN_SENT', 'MESSAGE_SENT']);
    assert.strictEqual((await get({ from: 'garbage' })).status, 400);
    assert.strictEqual((await get({ from: '2026-11-13', to: '2026-11-10' })).status, 400);

    const page1 = await get({ limit: 2, page: 1 });
    const page2 = await get({ limit: 2, page: 2 });
    assert.strictEqual(page1.body.total, 7);
    assert.strictEqual(page1.body.pages, 4);
    assert.strictEqual(page1.body.events.length, 2);
    assert.strictEqual(page2.body.events.length, 2);
    assert.notDeepStrictEqual(page1.body.events.map((e) => e.id), page2.body.events.map((e) => e.id));
  });

  await t.test('R5. admin panel reads one workspace with the same filters; customers cannot use it', async () => {
    const { a } = await seed();
    const staff = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', email: 'ops@getnera.test', name: 'Ops Person' });
    const res = await request(app).get('/api/admin/tenants/20/activity').query({ user_id: a.users.manager.id }).set(bearer(staff, true));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.deepStrictEqual(res.body.events.map((e) => e.event), ['CAMPAIGN_SENT']);
    const all = await request(app).get('/api/admin/tenants/20/activity').set(bearer(staff, true));
    assert.ok(all.body.events.some((e) => e.event === 'CROSS_TENANT_ACCESS_DENIED'), 'admins see every event');
    assert.strictEqual(all.body.events.find((e) => e.event === 'TENANT_SENDING_PAUSED').actor.name, 'Priya (Getnera)');
    assert.ok(!all.body.events.some((e) => e.details === 'B owner deleted a lead'));
    assert.strictEqual((await request(app).get('/api/admin/tenants/9999/activity').set(bearer(staff, true))).status, 404);
    assert.strictEqual((await request(app).get('/api/admin/tenants/20/activity').set(bearer(a.users.owner))).status, 403);
  });
});
