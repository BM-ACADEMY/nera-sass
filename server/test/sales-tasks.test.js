/**
 * Customer Sales Tasks page (/api/sales-tasks/*).
 * - add, edit, complete, reopen and delete a task
 * - a task can only be given to an active member of the same workspace and
 *   linked to a lead of the same workspace
 * - due date + time are read on the workspace clock (Asia/Kolkata by default)
 * - removed automatic tasks are not created again on the next page load
 * - nothing of one workspace can be read or changed from another
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

test('Sales Tasks page', async (t) => {
  const { Users, Tenants, Leads, SalesTasks } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');

  async function workspace(tenantId) {
    await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active' }), 'test');
    const makeUser = async (role, name, extra = {}) => (await runAsSystem(() => Users.create({
      tenant_id: tenantId, role, name, email: `${name.toLowerCase()}${tenantId}@shop.test`,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0, ...extra,
    }), 'test')).toObject();
    const owner = await makeUser('owner', 'Owner');
    const agent = await makeUser('agent', 'Agent');
    const gone = await makeUser('agent', 'Gone', { is_active: false });
    const lead = await runAsTenant(tenantId, () => Leads.create({ name: `Ravi ${tenantId}`, phone: `9198765432${tenantId}`, status: 'new' }));
    return {
      owner, agent, gone, lead,
      headers: { Authorization: `Bearer ${makeToken(owner)}` },
      agentHeaders: { Authorization: `Bearer ${makeToken(agent)}` },
    };
  }

  await t.test('T1. add, edit, complete, reopen and delete a task', async () => {
    const a = await workspace(11);
    const created = await request(app).post('/api/sales-tasks').set(a.headers).send({
      title: 'Send the price list', description: 'Ask about batch size', lead_id: a.lead.id,
      assigned_to: a.agent.id, due_date: '2026-12-01', due_time: '10:30',
    });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const task = created.body.task;
    assert.strictEqual(task.title, 'Send the price list');
    assert.strictEqual(task.task_type, 'manual');
    assert.strictEqual(task.status, 'pending');
    assert.strictEqual(task.name, 'Ravi 11');
    assert.strictEqual(task.assigned_to, a.agent.id);
    assert.strictEqual(task.assigned_name, 'Agent');
    // 10:30 in Asia/Kolkata (UTC+5:30) is 05:00 UTC.
    assert.strictEqual(new Date(task.due_at).toISOString(), '2026-12-01T05:00:00.000Z');

    const list = await request(app).get('/api/sales-tasks').set(a.agentHeaders);
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.time_zone, 'Asia/Kolkata');
    assert.deepStrictEqual(list.body.tasks.map((x) => x.id), [task.id], 'an agent sees the task too');

    const edited = await request(app).patch(`/api/sales-tasks/${task.id}`).set(a.headers).send({ title: 'Send the new price list', assigned_to: null, due_date: '2026-12-02' });
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.body));
    assert.strictEqual(edited.body.task.title, 'Send the new price list');
    assert.strictEqual(edited.body.task.assigned_to, null);
    assert.strictEqual(new Date(edited.body.task.due_at).toISOString(), '2026-12-02T18:29:00.000Z', 'a date alone means the end of that day');

    const done = await request(app).patch(`/api/sales-tasks/${task.id}`).set(a.headers).send({ status: 'completed' });
    assert.strictEqual(done.body.task.status, 'completed');
    assert.ok(done.body.task.completed_at);
    const reopened = await request(app).put(`/api/sales-tasks/${task.id}/status`).set(a.headers).send({ status: 'pending' });
    assert.strictEqual(reopened.status, 200);
    assert.strictEqual(reopened.body.task.status, 'pending');
    assert.strictEqual(reopened.body.task.completed_at, null);

    const removed = await request(app).delete(`/api/sales-tasks/${task.id}`).set(a.headers);
    assert.strictEqual(removed.status, 200);
    assert.strictEqual(await runAsTenant(11, () => SalesTasks.countDocuments({})), 0);
    assert.strictEqual((await request(app).delete(`/api/sales-tasks/${task.id}`).set(a.headers)).status, 404);
    assert.strictEqual((await request(app).patch('/api/sales-tasks/abc').set(a.headers).send({ title: 'x' })).status, 404);
  });

  await t.test('T2. checks the input', async () => {
    const a = await workspace(12);
    const noTitle = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: '  ' });
    assert.strictEqual(noTitle.status, 400);
    const badDate = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', due_date: '2026-13-45' });
    assert.strictEqual(badDate.status, 400);
    const badTime = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', due_date: '2026-12-01', due_time: '25:00' });
    assert.strictEqual(badTime.status, 400);
    const badStatus = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', status: 'done' });
    assert.strictEqual(badStatus.status, 400);
    const noLead = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'Call back' });
    assert.strictEqual(noLead.status, 201, 'a task does not need a lead');
    assert.strictEqual(noLead.body.task.lead_id, null);
    assert.strictEqual(noLead.body.task.due_at, null);
  });

  await t.test('T3. a task is only given to an active member of the same workspace', async () => {
    const a = await workspace(13);
    const b = await workspace(14);
    const people = await request(app).get('/api/sales-tasks/assignees').set(a.agentHeaders);
    assert.strictEqual(people.status, 200);
    assert.deepStrictEqual(people.body.users.map((u) => u.id).sort(), [a.owner.id, a.agent.id].sort(), 'only active members of this workspace');
    assert.ok(!('password_hash' in people.body.users[0]));

    const otherWorkspace = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', assigned_to: b.agent.id });
    assert.strictEqual(otherWorkspace.status, 400);
    const inactive = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', assigned_to: a.gone.id });
    assert.strictEqual(inactive.status, 400);
    const otherLead = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', lead_id: b.lead.id });
    assert.strictEqual(otherLead.status, 400);

    const ok = await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'x', assigned_to: a.agent.id });
    const moveAway = await request(app).patch(`/api/sales-tasks/${ok.body.task.id}`).set(a.headers).send({ assigned_to: b.owner.id });
    assert.strictEqual(moveAway.status, 400);
    assert.strictEqual(await runAsTenant(13, async () => (await SalesTasks.findOne({ id: ok.body.task.id }).lean()).assigned_to), a.agent.id);
  });

  await t.test('T4. one workspace cannot see or change the tasks of another', async () => {
    const a = await workspace(15);
    const b = await workspace(16);
    const taskA = (await request(app).post('/api/sales-tasks').set(a.headers).send({ title: 'Only for A', lead_id: a.lead.id })).body.task;

    const listB = await request(app).get('/api/sales-tasks').set(b.headers);
    assert.strictEqual(listB.status, 200);
    assert.ok(!listB.body.tasks.some((x) => x.title === 'Only for A'));

    assert.strictEqual((await request(app).patch(`/api/sales-tasks/${taskA.id}`).set(b.headers).send({ title: 'hacked' })).status, 404);
    assert.strictEqual((await request(app).put(`/api/sales-tasks/${taskA.id}/status`).set(b.headers).send({ status: 'completed' })).status, 404);
    assert.strictEqual((await request(app).delete(`/api/sales-tasks/${taskA.id}`).set(b.headers)).status, 404);
    const bulk = await request(app).post('/api/sales-tasks/bulk-delete').set(b.headers).send({ ids: [taskA.id] });
    assert.strictEqual(bulk.body.deletedCount, 0);
    assert.strictEqual((await request(app).post(`/api/sales-tasks/lead/${a.lead.id}/notes`).set(b.headers).send({ note: 'hello' })).status, 404);

    const still = await runAsTenant(15, () => SalesTasks.findOne({ id: taskA.id }).lean());
    assert.strictEqual(still.title, 'Only for A');
    assert.strictEqual(still.status, 'pending');
  });

  await t.test('T5. a removed automatic task does not come back on the next load', async () => {
    const a = await workspace(17);
    await runAsTenant(17, () => Leads.updateOne({ id: a.lead.id }, { $set: { status: 'hot' } }));
    const first = await request(app).get('/api/sales-tasks').set(a.headers);
    const hot = first.body.tasks.find((x) => x.task_type === 'hot_lead');
    assert.ok(hot, 'a hot lead gets a task');
    assert.strictEqual((await request(app).delete(`/api/sales-tasks/${hot.id}`).set(a.headers)).status, 200);
    const second = await request(app).get('/api/sales-tasks').set(a.headers);
    assert.ok(!second.body.tasks.some((x) => x.task_type === 'hot_lead'), 'it stays removed');
    const unread = await request(app).get('/api/sales-tasks/unread-count').set(a.headers);
    assert.strictEqual(unread.body.count, 0);
  });

  await t.test('T6. delete by date uses the workspace day, not the UTC day', async () => {
    const a = await workspace(18);
    // 1 Dec 00:30 in India is still 30 Nov in UTC.
    const early = await runAsTenant(18, () => SalesTasks.create({ task_type: 'manual', title: 'early', created_at: new Date('2026-11-30T19:00:00Z') }));
    const before = await runAsTenant(18, () => SalesTasks.create({ task_type: 'manual', title: 'before', created_at: new Date('2026-11-30T18:00:00Z') }));
    const res = await request(app).post('/api/sales-tasks/bulk-delete').set(a.headers).send({ from: '2026-12-01', to: '2026-12-01' });
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.deletedIds, [early.id]);
    assert.ok(await runAsTenant(18, () => SalesTasks.exists({ id: before.id })));
  });
});
