/**
 * Reports > Team (GET /api/reports/team): per-member numbers from audit
 * events, messages and sales tasks, an AI row, role gating and tenant
 * isolation. Real server.js app, in-memory MongoDB, no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const MIN = 60000;
const DAY = 86400000;
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

test('first reply waits: pure walk', () => {
  const { firstReplyWaits } = require('../services/teamReport');
  const from = new Date('2026-11-20T00:00:00Z');
  const to = new Date('2026-11-27T00:00:00Z');
  const at = (iso) => new Date(iso);
  const { member, ai } = firstReplyWaits([
    { m: [
      { d: 'inbound', t: at('2026-11-21T10:00:00Z') },
      { d: 'inbound', t: at('2026-11-21T10:01:00Z') },
      { d: 'outbound', t: at('2026-11-21T10:05:00Z'), by: 7, ai: false },
      // A second outbound in a row is not a first reply.
      { d: 'outbound', t: at('2026-11-21T10:06:00Z'), by: 7, ai: false },
      { d: 'inbound', t: at('2026-11-21T11:00:00Z') },
      { d: 'outbound', t: at('2026-11-21T11:00:30Z'), ai: true },
      { d: 'inbound', t: at('2026-11-21T12:00:00Z') },
      { d: 'outbound', t: at('2026-11-21T12:01:00Z'), by: 7, f: true },
      { d: 'outbound', t: at('2026-11-21T12:20:00Z'), by: 8, ai: false },
    ] },
    // Wait started before the range, reply inside it: counted.
    { m: [{ d: 'inbound', t: at('2026-11-19T23:00:00Z') }, { d: 'outbound', t: at('2026-11-20T01:00:00Z'), by: 7 }] },
    // Reply before the range: not counted. Wait over 7 days: not counted.
    { m: [{ d: 'inbound', t: at('2026-11-18T10:00:00Z') }, { d: 'outbound', t: at('2026-11-18T10:10:00Z'), by: 7 }] },
    { m: [{ d: 'inbound', t: at('2026-11-12T10:00:00Z') }, { d: 'outbound', t: at('2026-11-21T10:00:00Z'), by: 7 }] },
  ], from, to);
  assert.deepStrictEqual(member.get(7), [5 * MIN, 120 * MIN]);
  assert.deepStrictEqual(member.get(8), [20 * MIN], 'a failed send does not end the wait');
  assert.deepStrictEqual(ai, [30000]);
});

test('Reports > Team', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages, SalesTasks, AuditEvents, AiReplyLogs } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  const createUser = async (fields) => (await sys(() => Users.create({
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...fields,
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
  const audit = (tenantId, actor, event, meta = {}, at = new Date(Date.now() - DAY)) => sys(() => AuditEvents.create({
    tenant_id: tenantId, event, actor_type: 'user', actor_user_id: actor.id, actor_name: actor.name, actor_role: actor.role,
    target_type: 'lead', target_id: '1', summary: event, meta, created_at: at,
  }));

  // Seeds one workspace: an agent with leads, replies, waits, status changes,
  // notes and tasks; the AI with two replies' worth of data. `scale` makes the
  // second workspace's numbers different so a leak would show.
  async function seed(tenantId, scale = 1) {
    const { brand, users } = await workspace(tenantId);
    const { agent, owner } = users;
    await runAsTenant(tenantId, async () => {
      for (const [i, status] of ['new', 'hot', 'converted', 'lost'].entries()) {
        await Leads.create({ name: `L ${status}`, phone: `98765${tenantId}${i}0`, status, client_id: brand.id, assigned_to: agent.id });
      }
      for (let i = 0; i < scale - 1; i += 1) await Leads.create({ name: `Extra ${i}`, phone: `9000${tenantId}${i}`, status: 'warm', client_id: brand.id, assigned_to: agent.id });
    });
    for (let i = 0; i < 3 * scale; i += 1) await audit(tenantId, agent, 'MESSAGE_SENT');
    await audit(tenantId, agent, 'TEMPLATE_SENT');
    await audit(tenantId, agent, 'LEAD_STATUS_CHANGED', { fields: ['status'], before: { status: 'hot' }, after: { status: 'converted' } });
    await audit(tenantId, agent, 'LEAD_STATUS_CHANGED', { fields: ['status'], before: { status: 'new' }, after: { status: 'warm' } });
    await audit(tenantId, agent, 'LEADS_BULK_STATUS_CHANGED', { count: 3, ids: [1, 2, 3], fields: ['status'], after: { status: 'lost' } });
    await audit(tenantId, agent, 'LEAD_NOTE_ADDED');
    await audit(tenantId, agent, 'LEAD_NOTE_ADDED');
    // Before the range: not counted, but it is not the latest event either.
    await audit(tenantId, agent, 'MESSAGE_SENT', {}, new Date(Date.now() - 40 * DAY));
    // The owner assigned the agent two leads (one plus a bulk of one).
    await audit(tenantId, owner, 'LEAD_ASSIGNED', { fields: ['assigned_to'], before: { assigned_to: null }, after: { assigned_to: agent.id } });
    await audit(tenantId, owner, 'LEADS_BULK_ASSIGNED', { count: 1, ids: [9], fields: ['assigned_to'], after: { assigned_to: agent.id } });

    const base = Date.now() - 2 * DAY;
    await runAsTenant(tenantId, async () => {
      const chat = async () => (await Conversations.create({ phone: `9${tenantId}${Math.random().toString().slice(2, 9)}`, status: 'open' })).id;
      const msg = (conversation_id, direction, at, extra = {}) => Messages.create({ conversation_id, direction, content: 'x', msg_type: 'text', sent_at: new Date(at), is_ai: false, status: 'sent', ...extra });
      // 5 minute wait answered by the agent.
      const c1 = await chat();
      await msg(c1, 'inbound', base);
      await msg(c1, 'inbound', base + MIN);
      await msg(c1, 'outbound', base + 5 * MIN, { sent_by: agent.id });
      // AI answers in 30 s, then the agent answers the next question in 15 m.
      const c2 = await chat();
      await msg(c2, 'inbound', base + 60 * MIN);
      await msg(c2, 'outbound', base + 60 * MIN + 30000, { is_ai: true });
      await msg(c2, 'inbound', base + 120 * MIN);
      await msg(c2, 'outbound', base + 135 * MIN, { sent_by: agent.id });
      // A failed send does not end the wait: 20 m.
      const c3 = await chat();
      await msg(c3, 'inbound', base + 200 * MIN);
      await msg(c3, 'outbound', base + 201 * MIN, { sent_by: agent.id, status: 'failed' });
      await msg(c3, 'outbound', base + 220 * MIN, { sent_by: agent.id });
      // A thread picked up after 8 days is not a reply time.
      const c4 = await chat();
      await msg(c4, 'inbound', base - 8 * DAY);
      await msg(c4, 'outbound', base, { sent_by: agent.id });
      // Another workspace's scale: an extra quick reply.
      if (scale > 1) {
        const c5 = await chat();
        await msg(c5, 'inbound', base);
        await msg(c5, 'outbound', base + MIN, { sent_by: agent.id });
      }

      await AiReplyLogs.create({ message_id: 1000 + tenantId, conversation_id: c2, handoff: true, created_at: new Date(base) });
      await AiReplyLogs.create({ message_id: 2000 + tenantId, conversation_id: c2, handoff: true, created_at: new Date(base) });
      await AiReplyLogs.create({ message_id: 3000 + tenantId, conversation_id: c2, handoff: false, created_at: new Date(base) });
      await AiReplyLogs.create({ message_id: 4000 + tenantId, conversation_id: c2, handoff: true, created_at: new Date(Date.now() - 60 * DAY) });

      const task = (fields) => SalesTasks.create({ task_type: 'manual', title: 'T', assigned_to: agent.id, status: 'pending', ...fields });
      await task({ status: 'completed', completed_at: new Date(base) });
      await task({ status: 'completed', completed_at: new Date(base + MIN) });
      await task({ status: 'completed', completed_at: new Date(Date.now() - 100 * DAY) });
      await task({ due_at: new Date(Date.now() - DAY) });
      await task({ due_at: new Date(Date.now() + DAY) });
      await task({ due_at: new Date(Date.now() - DAY), deleted_at: new Date() });
      for (let i = 0; i < scale - 1; i += 1) await task({ due_at: new Date(Date.now() - 2 * DAY) });
    });
    return users;
  }

  await t.test('numbers for a seeded workspace, AI row and totals', async () => {
    const users = await seed(30);
    // A removed person is not listed.
    await createUser({ tenant_id: 30, role: 'agent', email: 'gone30@acme.test', name: 'Gone', removed_at: new Date(), is_active: false });

    const res = await request(app).get('/api/reports/team?range=7d').set(bearer(users.owner));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.members.length, 4);
    assert.ok(!res.body.members.some((m) => m.name === 'Gone'));
    const agent = res.body.members.find((m) => m.user_id === users.agent.id);
    assert.strictEqual(agent.role, 'agent');
    assert.strictEqual(agent.leads_open, 2, 'new + hot; converted and lost are closed');
    assert.strictEqual(agent.leads_assigned, 2);
    assert.strictEqual(agent.replies, 4, '3 messages + 1 template in range');
    assert.strictEqual(agent.status_changes, 5, '2 single changes + a bulk of 3');
    assert.strictEqual(agent.converted, 1);
    assert.strictEqual(agent.lost, 3);
    assert.strictEqual(agent.notes, 2);
    assert.strictEqual(agent.first_replies, 3);
    assert.strictEqual(agent.avg_first_reply_seconds, 800, '(5 + 15 + 20) / 3 minutes');
    assert.strictEqual(agent.tasks_done, 2);
    assert.strictEqual(agent.tasks_overdue, 1);
    assert.ok(Math.abs(new Date(agent.last_active_at).getTime() - (Date.now() - DAY)) < 10 * MIN);

    const owner = res.body.members.find((m) => m.user_id === users.owner.id);
    assert.strictEqual(owner.replies, 0);
    assert.strictEqual(owner.avg_first_reply_seconds, null);
    assert.ok(owner.last_active_at, 'the assignments are the owner\'s activity');

    assert.strictEqual(res.body.totals.replies, 4);
    assert.strictEqual(res.body.totals.converted, 1);
    assert.strictEqual(res.body.totals.avg_first_reply_seconds, 800);
    assert.deepStrictEqual(res.body.ai, { replies: 1, handovers: 2, first_replies: 1, avg_first_reply_seconds: 30 });

    // A custom range before any of it: zeros, current-state numbers stay.
    const old = await request(app).get('/api/reports/team?range=custom&from=2020-01-01&to=2020-01-31').set(bearer(users.owner));
    assert.strictEqual(old.status, 200);
    const oldAgent = old.body.members.find((m) => m.user_id === users.agent.id);
    assert.strictEqual(oldAgent.replies, 0);
    assert.strictEqual(oldAgent.tasks_done, 0);
    assert.strictEqual(oldAgent.leads_open, 2);
    assert.strictEqual(oldAgent.tasks_overdue, 1);
    assert.strictEqual(old.body.ai.replies, 0);

    const bad = await request(app).get('/api/reports/team?range=custom&from=2020-02-01&to=2020-01-01').set(bearer(users.owner));
    assert.strictEqual(bad.status, 400);
  });

  await t.test('a real status change to Converted on the Leads page is counted', async () => {
    const { brand, users } = await workspace(31);
    const lead = await runAsTenant(31, async () => (await Leads.create({ name: 'Ravi', phone: '9876543210', status: 'hot', client_id: brand.id, assigned_to: users.agent.id })).toObject());
    const patch = await request(app).patch(`/api/leads/${lead.id}`).set(bearer(users.agent)).send({ status: 'converted' });
    assert.strictEqual(patch.status, 200);
    const res = await request(app).get('/api/reports/team?range=30d').set(bearer(users.admin));
    assert.strictEqual(res.status, 200);
    const agent = res.body.members.find((m) => m.user_id === users.agent.id);
    assert.strictEqual(agent.converted, 1);
    assert.strictEqual(agent.leads_open, 0);
  });

  await t.test('owner and admin only (old managers are Staff now)', async () => {
    const { users } = await workspace(32);
    assert.strictEqual((await request(app).get('/api/reports/team').set(bearer(users.manager))).status, 403, 'manager is staff');
    for (const role of ['owner', 'admin']) {
      const res = await request(app).get('/api/reports/team').set(bearer(users[role]));
      assert.strictEqual(res.status, 200, role);
    }
    const agent = await request(app).get('/api/reports/team').set(bearer(users.agent));
    assert.strictEqual(agent.status, 403);
    const legacy = await createUser({ tenant_id: 32, role: 'user', email: 'staff32@acme.test', name: 'Staff 32' });
    assert.strictEqual((await request(app).get('/api/reports/team').set(bearer(legacy))).status, 403, 'legacy staff role maps to agent');
    assert.strictEqual((await request(app).get(`/api/reports/team/${users.owner.id}/activity`).set(bearer(users.agent))).status, 403);
    assert.strictEqual((await request(app).get('/api/reports/team')).status, 401);
  });

  await t.test('another workspace\'s data is never counted', async () => {
    const a = await seed(40);
    const b = await seed(41, 3);
    const resA = await request(app).get('/api/reports/team?range=7d').set(bearer(a.owner));
    const resB = await request(app).get('/api/reports/team?range=7d').set(bearer(b.owner));
    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    assert.deepStrictEqual(resA.body.members.map((m) => m.user_id).sort(), Object.values(a).map((u) => u.id).sort());
    assert.deepStrictEqual(resB.body.members.map((m) => m.user_id).sort(), Object.values(b).map((u) => u.id).sort());

    const agentA = resA.body.members.find((m) => m.user_id === a.agent.id);
    assert.strictEqual(agentA.replies, 4);
    assert.strictEqual(agentA.leads_open, 2);
    assert.strictEqual(agentA.first_replies, 3);
    assert.strictEqual(agentA.avg_first_reply_seconds, 800);
    assert.strictEqual(agentA.tasks_overdue, 1);
    assert.deepStrictEqual(resA.body.ai, { replies: 1, handovers: 2, first_replies: 1, avg_first_reply_seconds: 30 });

    const agentB = resB.body.members.find((m) => m.user_id === b.agent.id);
    assert.strictEqual(agentB.replies, 10);
    assert.strictEqual(agentB.leads_open, 4);
    assert.strictEqual(agentB.first_replies, 4);
    assert.strictEqual(agentB.avg_first_reply_seconds, 615, '(5 + 15 + 20 + 1) / 4 minutes');
    assert.strictEqual(agentB.tasks_overdue, 3);

    // The detail panel only shows this workspace's events.
    const mine = await request(app).get(`/api/reports/team/${a.agent.id}/activity?range=7d`).set(bearer(a.owner));
    assert.strictEqual(mine.status, 200);
    assert.ok(mine.body.events.length > 0);
    assert.ok(mine.body.events.every((e) => e.actor.id === a.agent.id));
    const theirs = await request(app).get(`/api/reports/team/${b.agent.id}/activity?range=7d`).set(bearer(a.owner));
    assert.strictEqual(theirs.status, 200);
    assert.deepStrictEqual(theirs.body.events, []);
    assert.strictEqual(theirs.body.total, 0);
  });
});
