/**
 * Leads page: notes on a lead, "Updated by" (last_changed_by / _at) and the
 * one-lead activity timeline.
 *
 * Two workspaces, A (tenant 1) and B (tenant 2), each with an owner, admin,
 * manager and two agents. Notes: add, list newest first, length rules,
 * authors delete their own, Owner/Admin delete anyone's, nobody reaches B's
 * leads or notes (404, B unchanged). Every team member sees every lead of
 * their workspace (as GET /api/leads does), so an agent can read and add notes
 * on a lead assigned to someone else, but not delete another person's note.
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

let app;
let models;
let runAsSystem;
let runAsTenant;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.N8N_NEW_LEAD_WEBHOOK_URL;
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });

const sys = (fn) => runAsSystem(fn, 'test');
const auth = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });

async function seedWorkspace(tenantId) {
  await sys(() => models.Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active' }));
  const makeUser = (role, name) => sys(() => models.Users.create({
    tenant_id: tenantId, role, name, email: `${name.toLowerCase()}${tenantId}@shop.test`,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, active: true, token_version: 0,
  })).then((doc) => doc.toObject());
  const users = {
    owner: await makeUser('owner', 'Owner'),
    admin: await makeUser('admin', 'Admin'),
    manager: await makeUser('manager', 'Manager'),
    agent: await makeUser('agent', 'Aakash'),
    agent2: await makeUser('agent', 'Priya'),
  };
  const brand = await runAsTenant(tenantId, () => models.Clients.create({ name: `Brand ${tenantId}` }).then((d) => d.toObject()));
  const leads = await runAsTenant(tenantId, async () => {
    const out = [];
    for (let i = 1; i <= 3; i += 1) {
      out.push((await models.Leads.create({
        name: `Lead ${tenantId}-${i}`, phone: `9190000${tenantId}000${i}`, client_id: brand.id, status: 'new', source: 'Manual',
        // Lead 1 is the agent's, lead 2 is Priya's, lead 3 has nobody.
        assigned_to: i === 1 ? users.agent.id : i === 2 ? users.agent2.id : null,
      })).toObject());
    }
    return out;
  });
  return { tenantId, users, brand, leads };
}

const notesOf = (tenantId) => runAsTenant(tenantId, () => models.LeadNotes.find({}, { _id: 0, __v: 0 }).sort({ id: 1 }).lean());
const leadOf = (tenantId, id) => runAsTenant(tenantId, () => models.Leads.findOne({ id }, { _id: 0 }).lean());

test('Lead notes, updated by and activity timeline', async (t) => {
  let A;
  let B;

  t.beforeEach(async () => {
    await clearCollections();
    A = await seedWorkspace(1);
    B = await seedWorkspace(2);
  });

  await t.test('N1. Add and list notes: newest first, author name, no note text in the activity log', async () => {
    const lead = A.leads[0];
    const first = await request(app).post(`/api/leads/${lead.id}/notes`).set(auth(A.users.agent)).send({ note: '  Called, wants a demo on Friday  ' });
    assert.strictEqual(first.status, 201, JSON.stringify(first.body));
    assert.strictEqual(first.body.note.note, 'Called, wants a demo on Friday');
    assert.strictEqual(first.body.note.author_name, 'Aakash');
    assert.strictEqual(first.body.note.can_delete, true);
    const second = await request(app).post(`/api/leads/${lead.id}/notes`).set(auth(A.users.owner)).send({ note: 'Sent the price list' });
    assert.strictEqual(second.status, 201);

    const list = await request(app).get(`/api/leads/${lead.id}/notes`).set(auth(A.users.agent));
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.notes.map((n) => n.note), ['Sent the price list', 'Called, wants a demo on Friday']);
    assert.deepStrictEqual(list.body.notes.map((n) => n.author_name), ['Owner', 'Aakash']);
    // The agent may delete only their own note.
    assert.deepStrictEqual(list.body.notes.map((n) => n.can_delete), [false, true]);

    const stored = await notesOf(1);
    assert.strictEqual(stored.length, 2);
    assert.strictEqual(stored[0].user_id, A.users.agent.id);

    const logged = await sys(() => models.AuditEvents.find({ event: 'LEAD_NOTE_ADDED' }, { _id: 0 }).lean());
    assert.strictEqual(logged.length, 2);
    for (const row of logged) {
      assert.strictEqual(row.tenant_id, 1);
      assert.strictEqual(row.target_id, String(lead.id));
      assert.ok(!JSON.stringify(row).includes('demo on Friday') && !JSON.stringify(row).includes('price list'), 'note text stays out of the log');
    }

    // The Leads list shows the note count.
    const rows = await request(app).get('/api/leads?limit=50').set(auth(A.users.owner));
    const counts = Object.fromEntries(rows.body.leads.map((l) => [l.id, l.note_count]));
    assert.strictEqual(counts[lead.id], 2);
    assert.strictEqual(counts[A.leads[1].id], 0);
  });

  await t.test('N2. Empty, missing, non-text and over-long notes are refused', async () => {
    const url = `/api/leads/${A.leads[0].id}/notes`;
    for (const body of [{}, { note: '' }, { note: '   ' }, { note: { $gt: '' } }, { note: 123 }, { note: 'x'.repeat(1001) }]) {
      const res = await request(app).post(url).set(auth(A.users.owner)).send(body);
      assert.strictEqual(res.status, 400, `${JSON.stringify(body).slice(0, 40)} -> ${res.status}`);
    }
    const ok = await request(app).post(url).set(auth(A.users.owner)).send({ note: 'x'.repeat(1000) });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual((await notesOf(1)).length, 1);
  });

  await t.test('N3. Delete: authors delete their own; Owner and Admin delete anyone\'s; manager and other agents cannot', async () => {
    const lead = A.leads[0];
    const add = async (user, note) => (await request(app).post(`/api/leads/${lead.id}/notes`).set(auth(user)).send({ note })).body.note;
    const byAgent = await add(A.users.agent, 'agent note');
    const byOwner = await add(A.users.owner, 'owner note');
    const byAgent2 = await add(A.users.agent2, 'priya note');
    const del = (user, note) => request(app).delete(`/api/leads/${lead.id}/notes/${note.id}`).set(auth(user));

    assert.strictEqual((await del(A.users.agent, byOwner)).status, 403, 'agent cannot delete the owner\'s note');
    assert.strictEqual((await del(A.users.agent2, byAgent)).status, 403, 'agent cannot delete another agent\'s note');
    assert.strictEqual((await del(A.users.manager, byAgent)).status, 403, 'manager cannot delete someone else\'s note');
    assert.strictEqual((await notesOf(1)).length, 3);

    assert.strictEqual((await del(A.users.agent, byAgent)).status, 200, 'author deletes own note');
    assert.strictEqual((await del(A.users.admin, byAgent2)).status, 200, 'admin deletes anyone\'s note');
    assert.strictEqual((await del(A.users.owner, byOwner)).status, 200, 'owner deletes own note');
    assert.strictEqual((await notesOf(1)).length, 0);
    assert.strictEqual((await del(A.users.owner, byOwner)).status, 404, 'a deleted note is gone');

    // A note can only be deleted through its own lead.
    const other = await add(A.users.owner, 'on lead 1');
    const wrongLead = await request(app).delete(`/api/leads/${A.leads[1].id}/notes/${other.id}`).set(auth(A.users.owner));
    assert.strictEqual(wrongLead.status, 404);
    assert.strictEqual((await notesOf(1)).length, 1);
    const logged = await sys(() => models.AuditEvents.countDocuments({ event: 'LEAD_NOTE_DELETED', tenant_id: 1 }));
    assert.strictEqual(logged, 3);
  });

  await t.test('N4. Another workspace: every role of A gets 404 on B\'s leads and notes; B is unchanged', async () => {
    const bLead = B.leads[0];
    const bNote = (await request(app).post(`/api/leads/${bLead.id}/notes`).set(auth(B.users.owner)).send({ note: 'B secret remark' })).body.note;
    assert.ok(bNote?.id);
    const before = JSON.stringify(await notesOf(2));
    for (const role of ['owner', 'admin', 'manager', 'agent']) {
      const h = auth(A.users[role]);
      const list = await request(app).get(`/api/leads/${bLead.id}/notes`).set(h);
      assert.strictEqual(list.status, 404, `${role} list`);
      assert.ok(!JSON.stringify(list.body).includes('B secret'));
      assert.strictEqual((await request(app).post(`/api/leads/${bLead.id}/notes`).set(h).send({ note: 'from A' })).status, 404, `${role} add`);
      assert.strictEqual((await request(app).delete(`/api/leads/${bLead.id}/notes/${bNote.id}`).set(h)).status, 404, `${role} delete`);
      // B's note id through one of A's own leads.
      assert.strictEqual((await request(app).delete(`/api/leads/${A.leads[0].id}/notes/${bNote.id}`).set(h)).status, 404, `${role} delete via own lead`);
      const timeline = await request(app).get(`/api/leads/${bLead.id}/activity`).set(h);
      assert.strictEqual(timeline.status, 404, `${role} activity`);
    }
    assert.strictEqual(JSON.stringify(await notesOf(2)), before);
    assert.strictEqual((await notesOf(1)).length, 0);
  });

  await t.test('N5. Every team member sees every lead of the workspace, so an agent works on notes of a lead assigned to someone else', async () => {
    // Lead 2 is Priya's, lead 3 is unassigned. There is no "own leads only"
    // rule on the server (GET /api/leads shows every lead to every member);
    // notes follow the same rule through visibleLead() in leads-crud.js.
    for (const lead of [A.leads[1], A.leads[2]]) {
      assert.strictEqual((await request(app).get(`/api/leads/${lead.id}`).set(auth(A.users.agent))).status, 200);
      assert.strictEqual((await request(app).post(`/api/leads/${lead.id}/notes`).set(auth(A.users.agent)).send({ note: 'seen' })).status, 201);
      assert.strictEqual((await request(app).get(`/api/leads/${lead.id}/notes`).set(auth(A.users.agent))).body.notes.length, 1);
    }
    // ...but cannot delete a note Priya wrote on her own lead.
    const priya = (await request(app).post(`/api/leads/${A.leads[1].id}/notes`).set(auth(A.users.agent2)).send({ note: 'mine' })).body.note;
    assert.strictEqual((await request(app).delete(`/api/leads/${A.leads[1].id}/notes/${priya.id}`).set(auth(A.users.agent))).status, 403);
    // Bad ids.
    assert.strictEqual((await request(app).get('/api/leads/abc/notes').set(auth(A.users.agent))).status, 404);
    assert.strictEqual((await request(app).delete(`/api/leads/${A.leads[1].id}/notes/abc`).set(auth(A.users.agent))).status, 404);
  });

  await t.test('U1. last_changed_by / last_changed_at: set by status, assignment, edit and bulk changes, not by the request body', async () => {
    const [l1, l2, l3] = A.leads;
    const list = async () => Object.fromEntries((await request(app).get('/api/leads?limit=50').set(auth(A.users.owner))).body.leads.map((l) => [l.id, l]));
    let rows = await list();
    assert.strictEqual(rows[l1.id].last_changed_by, null);
    assert.strictEqual(rows[l1.id].last_changed_at, null);

    const status = await request(app).patch(`/api/leads/${l1.id}`).set(auth(A.users.agent)).send({ status: 'hot' });
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.lead.updated_by_name, 'Aakash');
    rows = await list();
    assert.strictEqual(rows[l1.id].last_changed_by, 'Aakash');
    assert.ok(new Date(rows[l1.id].last_changed_at).getTime() > Date.now() - 60000);
    assert.strictEqual(rows[l2.id].last_changed_by, null);

    const assign = await request(app).patch(`/api/leads/${l1.id}`).set(auth(A.users.agent2)).send({ assigned_to: A.users.agent2.id });
    assert.strictEqual(assign.status, 200);
    assert.strictEqual((await leadOf(1, l1.id)).updated_by_name, 'Priya');
    assert.strictEqual((await leadOf(1, l1.id)).updated_by_user_id, A.users.agent2.id);

    // Fields the client sends for "who" are ignored.
    await request(app).patch(`/api/leads/${l1.id}`).set(auth(A.users.manager)).send({ interest: 'Course', updated_by_name: 'Someone else', last_changed_by: 'x' });
    assert.strictEqual((await leadOf(1, l1.id)).updated_by_name, 'Manager');

    const bulkStatus = await request(app).post('/api/leads/bulk').set(auth(A.users.admin)).send({ ids: [l2.id, l3.id], action: 'status', status: 'warm' });
    assert.strictEqual(bulkStatus.status, 200);
    rows = await list();
    assert.strictEqual(rows[l2.id].last_changed_by, 'Admin');
    assert.strictEqual(rows[l3.id].last_changed_by, 'Admin');
    assert.strictEqual(rows[l1.id].last_changed_by, 'Manager');

    const bulkAssign = await request(app).post('/api/leads/bulk').set(auth(A.users.owner)).send({ ids: [l3.id], action: 'assign', assigned_to: A.users.agent.id });
    assert.strictEqual(bulkAssign.status, 200);
    assert.strictEqual((await leadOf(1, l3.id)).updated_by_name, 'Owner');

    // A bulk change naming B's lead changes nothing of B.
    await request(app).post('/api/leads/bulk').set(auth(A.users.owner)).send({ ids: [B.leads[0].id], action: 'status', status: 'lost' });
    const bLead = await leadOf(2, B.leads[0].id);
    assert.strictEqual(bLead.updated_by_name, undefined);
    assert.strictEqual(bLead.status, 'new');

    // A lead added by hand starts with its creator.
    const added = await request(app).post('/api/leads').set(auth(A.users.agent)).send({ name: 'Walk in', phone: '919812345678', source: 'manual' });
    assert.strictEqual(added.status, 201, JSON.stringify(added.body));
    assert.strictEqual(added.body.lead.updated_by_name, 'Aakash');
  });

  await t.test('T1. Activity timeline: this lead\'s events and bulk changes including it, newest first, own workspace only', async () => {
    const [l1, l2] = A.leads;
    await request(app).patch(`/api/leads/${l1.id}`).set(auth(A.users.agent)).send({ status: 'hot' });
    await request(app).post(`/api/leads/${l1.id}/notes`).set(auth(A.users.owner)).send({ note: 'private remark' });
    await request(app).post('/api/leads/bulk').set(auth(A.users.admin)).send({ ids: [l1.id, l2.id], action: 'assign', assigned_to: A.users.agent2.id });
    await request(app).patch(`/api/leads/${l2.id}`).set(auth(A.users.agent)).send({ status: 'lost' });
    // B does things to its own lead with the same id range.
    await request(app).patch(`/api/leads/${B.leads[0].id}`).set(auth(B.users.owner)).send({ status: 'cold' });

    const res = await request(app).get(`/api/leads/${l1.id}/activity`).set(auth(A.users.agent2));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const events = res.body.events;
    assert.deepStrictEqual(events.map((e) => e.event), ['LEADS_BULK_ASSIGNED', 'LEAD_NOTE_ADDED', 'LEAD_STATUS_CHANGED']);
    assert.deepStrictEqual(events.map((e) => e.actor.name), ['Admin', 'Owner', 'Aakash']);
    assert.strictEqual(events[1].action, 'Added a note');
    for (const e of events) {
      assert.ok(e.at && e.details, 'time and summary');
      assert.strictEqual(e.meta, undefined, 'meta (ids of other leads) is not sent');
    }
    assert.ok(!JSON.stringify(events).includes('private remark'));

    const two = (await request(app).get(`/api/leads/${l2.id}/activity`).set(auth(A.users.agent))).body.events;
    assert.deepStrictEqual(two.map((e) => e.event), ['LEAD_STATUS_CHANGED', 'LEADS_BULK_ASSIGNED']);

    // B's owner reading B's lead sees only B's event, even where ids overlap.
    const b = (await request(app).get(`/api/leads/${B.leads[0].id}/activity`).set(auth(B.users.owner))).body.events;
    assert.deepStrictEqual(b.map((e) => e.event), ['LEAD_STATUS_CHANGED']);
    assert.strictEqual(b[0].actor.name, 'Owner');

    // Cross-workspace: 404 for A on B's lead (N4 covers every role).
    assert.strictEqual((await request(app).get(`/api/leads/${B.leads[0].id}/activity`).set(auth(A.users.owner))).status, 404);
    assert.strictEqual((await request(app).get('/api/leads/999999/activity').set(auth(A.users.owner))).status, 404);
  });
});
