/**
 * Lead labels (routes/leados/labels.js, services/leadLabels.js): create,
 * rename, recolour, delete; who may do what; labels on leads and the Leads
 * list filter; campaign audiences by label; and that workspace B can never
 * list, count, attach, delete, filter by or target workspace A's labels.
 * Also migration 043 (old shared tags -> per-workspace labels).
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
test.beforeEach(async () => { await clearCollections(); });

const sys = (fn) => runAsSystem(fn, 'test');

async function seedWorkspace(tenantId) {
  await sys(() => models.Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active' }));
  const makeUser = (role) => sys(() => models.Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: `${role} ${tenantId}`,
    password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  })).then((doc) => doc.toObject());
  const users = { owner: await makeUser('owner'), admin: await makeUser('admin'), manager: await makeUser('manager'), agent: await makeUser('agent') };
  const headers = Object.fromEntries(Object.entries(users).map(([role, user]) => [role, { Authorization: `Bearer ${makeToken(user)}` }]));
  // One brand per workspace; the third lead has no brand (for per-brand counts).
  const { brand, leads } = await runAsTenant(tenantId, async () => {
    const b = (await models.Clients.create({ name: `Brand ${tenantId}` })).toObject();
    const out = [];
    for (let i = 1; i <= 3; i += 1) {
      out.push((await models.Leads.create({ name: `Lead ${tenantId}-${i}`, phone: `9198000${tenantId}000${i}`, client_id: i === 3 ? null : b.id, status: 'new', assigned_to: i === 1 ? users.agent.id : null, source: 'Manual' })).toObject());
    }
    return { brand: b, leads: out };
  });
  return { tenantId, users, headers, brand, leads };
}

const createLabel = (s, body, role = 'owner') => request(app).post('/api/labels').set(s.headers[role]).send(body);
const auditEvents = (tenantId, event) => sys(() => models.AuditEvents.find({ tenant_id: tenantId, event }, { _id: 0 }).lean());

test('Labels: create, rename, recolour, delete', async (t) => {
  await t.test('owner and admin manage labels; names are checked and unique per workspace', async () => {
    const a = await seedWorkspace(1);
    const vip = await createLabel(a, { name: '  VIP   customer ', color: 'violet' });
    assert.strictEqual(vip.status, 201, JSON.stringify(vip.body));
    assert.deepStrictEqual(vip.body.label, { id: vip.body.label.id, name: 'VIP customer', color: 'violet', lead_count: 0 });

    const byAdmin = await createLabel(a, { name: 'Follow up' }, 'admin');
    assert.strictEqual(byAdmin.status, 201);
    assert.strictEqual(byAdmin.body.label.color, 'slate', 'default colour');

    for (const bad of [{}, { name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, { name: 'Ok', color: 'pink' }, { name: 'Ok', color: '#ff0000' }, { name: { $gt: '' } }]) {
      const res = await createLabel(a, bad);
      assert.strictEqual(res.status, 400, JSON.stringify(bad));
    }
    assert.strictEqual((await createLabel(a, { name: 'x'.repeat(40) })).status, 201, '40 characters is allowed');

    const dup = await createLabel(a, { name: 'vip CUSTOMER' });
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.code, 'LABEL_EXISTS');

    const renamed = await request(app).patch(`/api/labels/${byAdmin.body.label.id}`).set(a.headers.owner).send({ name: 'Call back', color: 'amber' });
    assert.strictEqual(renamed.status, 200);
    assert.deepStrictEqual(renamed.body.label, { id: byAdmin.body.label.id, name: 'Call back', color: 'amber' });
    const clash = await request(app).patch(`/api/labels/${byAdmin.body.label.id}`).set(a.headers.owner).send({ name: 'Vip Customer' });
    assert.strictEqual(clash.status, 409);
    const sameNameNewCase = await request(app).patch(`/api/labels/${vip.body.label.id}`).set(a.headers.owner).send({ name: 'VIP Customer' });
    assert.strictEqual(sameNameNewCase.status, 200, 'a label may change the case of its own name');
    assert.strictEqual((await request(app).patch(`/api/labels/${vip.body.label.id}`).set(a.headers.owner).send({ color: 'nope' })).status, 400);
    assert.strictEqual((await request(app).patch(`/api/labels/${vip.body.label.id}`).set(a.headers.owner).send({})).status, 400);
    assert.strictEqual((await request(app).patch('/api/labels/999999').set(a.headers.owner).send({ name: 'x' })).status, 404);

    const list = await request(app).get('/api/labels').set(a.headers.agent);
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.labels.map((l) => l.name), ['Call back', 'VIP Customer', 'x'.repeat(40)]);
    assert.strictEqual(list.body.colors.length, 8);

    const del = await request(app).delete(`/api/labels/${byAdmin.body.label.id}`).set(a.headers.admin);
    assert.strictEqual(del.status, 200);
    assert.strictEqual((await request(app).delete(`/api/labels/${byAdmin.body.label.id}`).set(a.headers.admin)).status, 404);

    assert.strictEqual((await auditEvents(1, 'LABEL_CREATED')).length, 3);
    assert.strictEqual((await auditEvents(1, 'LABEL_UPDATED')).length, 2);
    assert.strictEqual((await auditEvents(1, 'LABEL_DELETED')).length, 1);
  });

  await t.test('managers and agents cannot create, change or delete labels', async () => {
    const a = await seedWorkspace(1);
    const label = (await createLabel(a, { name: 'Hot' })).body.label;
    for (const role of ['manager', 'agent']) {
      assert.strictEqual((await createLabel(a, { name: `By ${role}` }, role)).status, 403);
      assert.strictEqual((await request(app).patch(`/api/labels/${label.id}`).set(a.headers[role]).send({ name: 'Cold' })).status, 403);
      assert.strictEqual((await request(app).delete(`/api/labels/${label.id}`).set(a.headers[role])).status, 403);
    }
    assert.strictEqual((await request(app).get('/api/labels').set(a.headers.agent)).body.labels.length, 1);
  });
});

test('Labels on leads', async (t) => {
  await t.test('any member labels a lead of the workspace; rows carry labels; the list filters by label', async () => {
    const a = await seedWorkspace(1);
    const hot = (await createLabel(a, { name: 'Hot', color: 'red' })).body.label;
    const vip = (await createLabel(a, { name: 'VIP', color: 'violet' })).body.label;
    const [l1, l2, l3] = a.leads;

    // An agent labels a lead assigned to them and one that is not: every member
    // sees every lead of the workspace (no per-assignee restriction exists).
    const add1 = await request(app).post(`/api/leads/${l1.id}/labels/${hot.id}`).set(a.headers.agent);
    assert.strictEqual(add1.status, 200, JSON.stringify(add1.body));
    assert.strictEqual(add1.body.added, true);
    assert.strictEqual((await request(app).post(`/api/leads/${l1.id}/labels/${hot.id}`).set(a.headers.agent)).body.added, false, 'adding twice is a no-op');
    assert.strictEqual((await request(app).post(`/api/leads/${l2.id}/labels/${hot.id}`).set(a.headers.agent)).status, 200);
    const put = await request(app).put(`/api/leads/${l3.id}/labels`).set(a.headers.manager).send({ label_ids: [vip.id, hot.id] });
    assert.strictEqual(put.status, 200);
    assert.deepStrictEqual(put.body.labels.map((l) => l.name), ['Hot', 'VIP']);
    assert.strictEqual((await request(app).put(`/api/leads/${l3.id}/labels`).set(a.headers.manager).send({ label_ids: 'x' })).status, 400);
    assert.strictEqual((await request(app).put(`/api/leads/${l3.id}/labels`).set(a.headers.manager).send({ label_ids: [999999] })).status, 404);
    assert.strictEqual((await request(app).post(`/api/leads/${l1.id}/labels/999999`).set(a.headers.agent)).status, 404);
    assert.strictEqual((await request(app).post(`/api/leads/999999/labels/${hot.id}`).set(a.headers.agent)).status, 404);

    const rows = (await request(app).get('/api/leads?limit=50').set(a.headers.owner)).body.leads;
    const byId = new Map(rows.map((r) => [r.id, r]));
    assert.deepStrictEqual(byId.get(l1.id).labels, [{ id: hot.id, name: 'Hot', color: 'red' }]);
    assert.deepStrictEqual(byId.get(l1.id).tags, [{ id: hot.id, name: 'Hot', color: '#ef4444' }], 'older tags shape with a CSS colour');
    assert.deepStrictEqual(byId.get(l3.id).labels.map((l) => l.id), [hot.id, vip.id]);

    const filtered = await request(app).get(`/api/leads?label=${vip.id}`).set(a.headers.agent);
    assert.deepStrictEqual(filtered.body.leads.map((l) => l.id), [l3.id]);
    assert.strictEqual(filtered.body.total, 1);
    assert.strictEqual((await request(app).get(`/api/leads?tag_id=${hot.id}`).set(a.headers.agent)).body.total, 3, 'tag_id is the older name');

    const single = await request(app).get(`/api/leads/${l1.id}?messages=0`).set(a.headers.agent);
    assert.deepStrictEqual(single.body.lead.tags.map((x) => x.id), [hot.id]);
    assert.deepStrictEqual((await request(app).get(`/api/leads/${l3.id}/labels`).set(a.headers.agent)).body.labels.map((l) => l.id), [hot.id, vip.id]);

    // Removing (new and older route).
    assert.strictEqual((await request(app).delete(`/api/leads/${l1.id}/labels/${hot.id}`).set(a.headers.agent)).body.removed, true);
    assert.strictEqual((await request(app).delete(`/api/leads/${l2.id}/tags/${hot.id}`).set(a.headers.agent)).body.removed, true);
    assert.strictEqual((await request(app).post(`/api/leads/${l2.id}/tags`).set(a.headers.agent).send({ tagId: vip.id })).body.added, true);
    const counts = new Map((await request(app).get('/api/labels').set(a.headers.owner)).body.labels.map((l) => [l.name, l.lead_count]));
    assert.deepStrictEqual(Object.fromEntries(counts), { Hot: 1, VIP: 2 });

    assert.strictEqual((await auditEvents(1, 'LEAD_LABEL_ADDED')).length, 5);
    assert.strictEqual((await auditEvents(1, 'LEAD_LABEL_REMOVED')).length, 2);
  });

  await t.test('deleting a label takes it off every lead; deleting a lead removes its links', async () => {
    const a = await seedWorkspace(1);
    const hot = (await createLabel(a, { name: 'Hot' })).body.label;
    const keep = (await createLabel(a, { name: 'Keep' })).body.label;
    for (const lead of a.leads) {
      await request(app).put(`/api/leads/${lead.id}/labels`).set(a.headers.owner).send({ label_ids: [hot.id, keep.id] });
    }
    const del = await request(app).delete(`/api/labels/${hot.id}`).set(a.headers.owner);
    assert.strictEqual(del.body.removed_links, 3);
    const links = await runAsTenant(1, () => models.LeadLabelLinks.find({}, { _id: 0, lead_id: 1, label_id: 1 }).lean());
    assert.ok(links.every((l) => l.label_id === keep.id));
    assert.strictEqual(links.length, 3);
    assert.strictEqual((await request(app).delete(`/api/leads/${a.leads[0].id}`).set(a.headers.owner)).status, 200);
    assert.strictEqual(await runAsTenant(1, () => models.LeadLabelLinks.countDocuments({})), 2);
  });
});

test('Workspace isolation', async (t) => {
  await t.test('B cannot list, count, change, delete, attach, filter by or target A\'s labels or leads', async () => {
    const a = await seedWorkspace(1);
    const b = await seedWorkspace(2);
    const aLabel = (await createLabel(a, { name: 'VIP', color: 'violet' })).body.label;
    await request(app).post(`/api/leads/${a.leads[0].id}/labels/${aLabel.id}`).set(a.headers.owner);
    // The same name is fine in another workspace.
    const bLabel = (await createLabel(b, { name: 'vip' })).body.label;
    assert.ok(bLabel, 'same name allowed in another workspace');

    const bList = (await request(app).get('/api/labels').set(b.headers.owner)).body.labels;
    assert.deepStrictEqual(bList.map((l) => l.id), [bLabel.id]);
    assert.strictEqual(bList[0].lead_count, 0, 'A\'s links are not counted');

    assert.strictEqual((await request(app).patch(`/api/labels/${aLabel.id}`).set(b.headers.owner).send({ name: 'Mine' })).status, 404);
    assert.strictEqual((await request(app).delete(`/api/labels/${aLabel.id}`).set(b.headers.owner)).status, 404);
    // A's label on B's lead, B's label on A's lead, A's label on A's lead.
    assert.strictEqual((await request(app).post(`/api/leads/${b.leads[0].id}/labels/${aLabel.id}`).set(b.headers.agent)).status, 404);
    assert.strictEqual((await request(app).post(`/api/leads/${a.leads[1].id}/labels/${bLabel.id}`).set(b.headers.agent)).status, 404);
    assert.strictEqual((await request(app).post(`/api/leads/${a.leads[1].id}/labels/${aLabel.id}`).set(b.headers.owner)).status, 404);
    assert.strictEqual((await request(app).delete(`/api/leads/${a.leads[0].id}/labels/${aLabel.id}`).set(b.headers.owner)).status, 404);
    assert.strictEqual((await request(app).post(`/api/leads/${b.leads[0].id}/tags`).set(b.headers.owner).send({ tagId: aLabel.id })).status, 404);
    assert.strictEqual((await request(app).put(`/api/leads/${b.leads[0].id}/labels`).set(b.headers.owner).send({ label_ids: [aLabel.id] })).status, 404);
    assert.strictEqual((await request(app).put(`/api/leads/${a.leads[0].id}/labels`).set(b.headers.owner).send({ label_ids: [] })).status, 404);
    assert.strictEqual((await request(app).get(`/api/leads/${a.leads[0].id}/labels`).set(b.headers.owner)).status, 404);

    const filtered = await request(app).get(`/api/leads?label=${aLabel.id}`).set(b.headers.owner);
    assert.strictEqual(filtered.status, 200);
    assert.strictEqual(filtered.body.total, 0);

    // Campaign audience: A's label is not found for B.
    const preview = await request(app).post('/api/campaigns/preview').set(b.headers.owner)
      .send({ name: 'x', client_id: b.brand.id, template_id: 1, target_label_id: aLabel.id });
    assert.strictEqual(preview.status, 404);
    assert.strictEqual(preview.body.code, 'LABEL_NOT_FOUND');
    const legacyName = await request(app).post('/api/campaigns/preview').set(b.headers.owner)
      .send({ name: 'x', client_id: b.brand.id, template_id: 1, target_tag_id: aLabel.id });
    assert.strictEqual(legacyName.status, 404);
    const create = await request(app).post('/api/campaigns').set(b.headers.owner)
      .send({ name: 'x', client_id: b.brand.id, template_id: 1, target_label_id: aLabel.id, preview_confirmed: true });
    assert.strictEqual(create.status, 404);
    assert.strictEqual(await runAsTenant(2, () => models.Campaigns.countDocuments({})), 0);
    const bCounts = (await request(app).get('/api/campaigns/audience-counts').set(b.headers.owner)).body;
    assert.deepStrictEqual(bCounts.labels.map((l) => l.id), [bLabel.id]);
    assert.deepStrictEqual((await request(app).get('/api/campaigns/tags').set(b.headers.owner)).body.tags.map((l) => l.id), [bLabel.id]);

    // A is unchanged.
    const aAfter = await runAsTenant(1, () => models.Labels.findOne({ id: aLabel.id }, { _id: 0, name: 1, color: 1 }).lean());
    assert.deepStrictEqual(aAfter, { name: 'VIP', color: 'violet' });
    assert.strictEqual(await runAsTenant(1, () => models.LeadLabelLinks.countDocuments({})), 1);
    assert.strictEqual(await runAsTenant(2, () => models.LeadLabelLinks.countDocuments({})), 0);
  });

  await t.test('campaign audience by label counts only this workspace\'s leads, per brand', async () => {
    const a = await seedWorkspace(1);
    const b = await seedWorkspace(2);
    const aLabel = (await createLabel(a, { name: 'VIP' })).body.label;
    const bLabel = (await createLabel(b, { name: 'VIP' })).body.label;
    for (const lead of a.leads) await request(app).post(`/api/leads/${lead.id}/labels/${aLabel.id}`).set(a.headers.owner);
    await request(app).post(`/api/leads/${b.leads[0].id}/labels/${bLabel.id}`).set(b.headers.owner);

    const all = (await request(app).get('/api/campaigns/audience-counts').set(a.headers.owner)).body;
    assert.deepStrictEqual(all.labels, [{ id: aLabel.id, name: 'VIP', color: 'slate', lead_count: 3 }]);
    const brand = (await request(app).get(`/api/campaigns/audience-counts?client_id=${a.brand.id}`).set(a.headers.owner)).body;
    assert.strictEqual(brand.labels[0].lead_count, 2, 'leads of the chosen brand only');
    assert.strictEqual(brand.tags[0].lead_count, 2);
    const bCounts = (await request(app).get('/api/campaigns/audience-counts').set(b.headers.owner)).body;
    assert.deepStrictEqual(bCounts.labels.map((l) => [l.id, l.lead_count]), [[bLabel.id, 1]]);

    const audience = require('../services/campaignAudience');
    const aLeads = await runAsTenant(1, () => audience.resolveAudience({ client_id: a.brand.id, target_status: 'all', target_label_id: aLabel.id }));
    assert.deepStrictEqual(aLeads.map((l) => l.id).sort(), [a.leads[0].id, a.leads[1].id].sort());
    const crossed = await runAsTenant(2, () => audience.resolveAudience({ client_id: b.brand.id, target_status: 'all', target_label_id: aLabel.id }));
    assert.strictEqual(crossed.length, 0);
  });
});

test('Migration 043: old tags become per-workspace labels', async (t) => {
  await t.test('dry run writes nothing; apply copies per workspace; running again changes nothing', async () => {
    const a = await seedWorkspace(1);
    const b = await seedWorkspace(2);
    const { migrate } = require('../migrations/043_lead_labels');
    // Old shared tags, used by both workspaces.
    const [vip, cold, unused] = await sys(async () => [
      (await models.AllianceInboxTags.create({ name: 'VIP', color: '#7c3aed' })).toObject(),
      (await models.AllianceInboxTags.create({ name: 'Cold', color: '#00a884' })).toObject(),
      (await models.AllianceInboxTags.create({ name: 'Unused', color: '#000000' })).toObject(),
    ]);
    await runAsTenant(1, async () => {
      await models.LeadTags.create({ lead_id: a.leads[0].id, tag_id: vip.id });
      await models.LeadTags.create({ lead_id: a.leads[1].id, tag_id: vip.id });
      await models.LeadTags.create({ lead_id: a.leads[1].id, tag_id: cold.id });
      await models.LeadTags.create({ lead_id: 987654, tag_id: vip.id }); // lead deleted
      await models.Campaigns.create({ name: 'Old', client_id: a.brand.id, template_id: 1, target_status: 'all', target_tag_id: cold.id, status: 'completed' });
    });
    await runAsTenant(2, async () => {
      await models.LeadTags.create({ lead_id: b.leads[0].id, tag_id: vip.id });
      // B already has a label with that name: it is reused.
      await models.Labels.create({ name: 'vip', name_key: 'vip', color: 'green' });
      await models.Campaigns.create({ name: 'Old B', client_id: b.brand.id, template_id: 1, target_status: 'all', target_tag_id: unused.id, status: 'scheduled' });
    });
    const quiet = () => {};

    const dry = await migrate({ log: quiet });
    assert.deepStrictEqual(dry, { apply: false, labels_created: 3, labels_reused: 1, links_added: 4, links_present: 0, links_orphaned: 1, campaigns_moved: 2, campaigns_unresolved: 0 });
    assert.strictEqual(await sys(() => models.Labels.countDocuments({})), 1, 'dry run writes nothing');
    assert.strictEqual(await sys(() => models.LeadLabelLinks.countDocuments({})), 0);

    const applied = await migrate({ apply: true, log: quiet });
    assert.deepStrictEqual({ ...applied, apply: undefined }, { ...dry, apply: undefined });
    const aLabels = await runAsTenant(1, () => models.Labels.find({}, { _id: 0, id: 1, name: 1, color: 1, migrated_from_tag_id: 1 }).sort({ name: 1 }).lean());
    assert.deepStrictEqual(aLabels.map((l) => [l.name, l.color, l.migrated_from_tag_id]), [['Cold', 'teal', cold.id], ['VIP', 'violet', vip.id]]);
    const bLabels = await runAsTenant(2, () => models.Labels.find({}, { _id: 0, id: 1, name: 1 }).sort({ name: 1 }).lean());
    assert.deepStrictEqual(bLabels.map((l) => l.name), ['Unused', 'vip']);
    const aVip = aLabels.find((l) => l.name === 'VIP');
    const aLinks = await runAsTenant(1, () => models.LeadLabelLinks.find({}, { _id: 0, lead_id: 1, label_id: 1 }).lean());
    assert.strictEqual(aLinks.length, 3);
    assert.ok(aLinks.filter((l) => l.label_id === aVip.id).length === 2);
    const bLinks = await runAsTenant(2, () => models.LeadLabelLinks.find({}, { _id: 0, lead_id: 1, label_id: 1 }).lean());
    assert.deepStrictEqual(bLinks, [{ lead_id: b.leads[0].id, label_id: bLabels.find((l) => l.name === 'vip').id }]);
    const aCampaign = await runAsTenant(1, () => models.Campaigns.findOne({}, { _id: 0 }).lean());
    assert.strictEqual(aCampaign.target_label_id, aLabels.find((l) => l.name === 'Cold').id);
    assert.strictEqual(aCampaign.target_tag_id, null);
    assert.strictEqual(aCampaign.migrated_from_tag_id, cold.id);

    // Through the API, each workspace sees only its own labels and counts.
    const counts = (await request(app).get('/api/labels').set(a.headers.owner)).body.labels.map((l) => [l.name, l.lead_count]);
    assert.deepStrictEqual(counts, [['Cold', 1], ['VIP', 2]]);

    const again = await migrate({ apply: true, log: quiet });
    assert.strictEqual(again.labels_created, 0);
    assert.strictEqual(again.links_added, 0);
    assert.strictEqual(again.links_present, 4);
    assert.strictEqual(again.campaigns_moved, 0);
    const dryAgain = await migrate({ log: quiet });
    assert.strictEqual(dryAgain.labels_created + dryAgain.links_added + dryAgain.campaigns_moved, 0);
    assert.strictEqual(await sys(() => models.Labels.countDocuments({})), 4);
    assert.strictEqual(await sys(() => models.LeadTags.countDocuments({})), 5, 'old links are kept');
  });
});
