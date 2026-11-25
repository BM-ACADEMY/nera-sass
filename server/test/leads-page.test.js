/**
 * Leads page (customer app): source kinds without "website", the list's
 * filters and total, bulk assign / status, add-lead checks, exports, and
 * that none of it reaches another workspace's leads or team.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const supertest = require('supertest');
// Every request gets a deadline, so a stuck call fails the test instead of
// hanging the run.
const request = (target) => new Proxy(supertest(target), {
  get: (agent, method) => (...args) => {
    return agent[method](...args).timeout({ deadline: 60000 });
  },
});
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app, models, runAsSystem, runAsTenant, leadSources;

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
  leadSources = require('../services/leadSources');
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); });

async function seedWorkspace(tenantId) {
  await runAsSystem(() => models.Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active' }), 'test');
  const makeUser = (role, name) => runAsSystem(() => models.Users.create({
    tenant_id: tenantId, role, email: `${name.toLowerCase()}${tenantId}@shop.test`, name, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test').then((doc) => doc.toObject());
  const owner = await makeUser('owner', 'Owner');
  const agent = await makeUser('agent', 'Priya');
  const brand = await runAsTenant(tenantId, () => models.Clients.create({ name: `Brand ${tenantId}` }).then((doc) => doc.toObject()));
  return { tenantId, owner, agent, brand, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
}

// One lead of every kind, plus old spellings that must land in the right one.
const SAMPLE = [
  { name: 'Wa', source: 'WhatsApp', expect: 'whatsapp' },
  { name: 'Wa lower', source: 'whatsapp', expect: 'whatsapp' },
  { name: 'Ad click', source: 'facebook', ad_id: '120200001', expect: 'whatsapp_ad' },
  { name: 'Ad click 2', source: 'WhatsApp', ad_id: '120200002', expect: 'whatsapp_ad' },
  { name: 'Sheet', source: 'XLS Sheet', expect: 'import' },
  { name: 'Campaign list', source: 'csv_batch_17', expect: 'import' },
  { name: 'Csv', source: 'CSV Import', expect: 'import' },
  { name: 'Hand', source: 'Manual', expect: 'manual' },
  { name: 'Old site', source: 'website', expect: 'manual' },
  { name: 'Old site 2', source: 'Website', expect: 'manual' },
  { name: 'No source', expect: 'manual' },
  { name: 'Walk in', source: 'Walk-in', expect: 'manual' },
  { name: 'Form', source: 'Meta Ads', leadgen_id: 'LG1', expect: 'facebook' },
  { name: 'Old fb', source: 'facebook', campaign_name: 'Diwali', ad_name: 'Ad A', expect: 'facebook' },
  { name: 'Form with ad', source: 'facebook', ad_id: '120200003', meta_lead_id: 'ML1', expect: 'facebook' },
];

async function seedLeads(s, rows = SAMPLE) {
  return runAsTenant(s.tenantId, async () => {
    const out = [];
    let i = 0;
    for (const { expect, ...row } of rows) {
      i += 1;
      const lead = (await models.Leads.create({ phone: `91900${s.tenantId}${String(i).padStart(5, '0')}`, client_id: s.brand.id, status: 'new', ...row })).toObject();
      out.push({ ...lead, expect });
    }
    return out;
  });
}

test('Source kinds', async (t) => {
  await t.test('L1. Every lead has exactly one kind, the same in Mongo and in JS', async () => {
    const s = await seedWorkspace(1);
    const leads = await seedLeads(s);
    for (const lead of leads) assert.strictEqual(leadSources.leadSourceKind(lead), lead.expect, `${lead.name} is ${lead.expect}`);
    const seen = new Map();
    for (const kind of leadSources.SOURCE_KINDS) {
      const ids = await runAsTenant(1, () => models.Leads.distinct('id', leadSources.sourceFilter(kind)));
      for (const id of ids) {
        assert.ok(!seen.has(id), `lead ${id} is in ${seen.get(id)} and ${kind}`);
        seen.set(id, kind);
      }
    }
    for (const lead of leads) assert.strictEqual(seen.get(lead.id), lead.expect, `${lead.name} filtered as ${lead.expect}`);
  });

  await t.test('L2. "website" is not a source any more; old names are read only for saved export jobs', () => {
    assert.ok(!leadSources.SOURCE_KINDS.includes('website'));
    assert.strictEqual(leadSources.normalizeSourceKind('website'), null);
    assert.strictEqual(leadSources.normalizeSourceKind('xls_sheet'), null);
    assert.strictEqual(leadSources.normalizeSourceKind('website', { legacy: true }), 'manual');
    assert.strictEqual(leadSources.normalizeSourceKind('WhatsApp ad'), 'whatsapp_ad');
  });

  await t.test('L3. GET /api/leads filters by source and counts old website leads as Manual', async () => {
    const s = await seedWorkspace(1);
    await seedLeads(s);
    const count = (kind) => SAMPLE.filter((row) => row.expect === kind).length;
    for (const kind of leadSources.SOURCE_KINDS) {
      const res = await request(app).get(`/api/leads?source=${kind}&limit=100`).set(s.headers);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.total, count(kind), kind);
      assert.ok(res.body.leads.every((lead) => lead.source_kind === kind), `${kind} rows carry their kind`);
    }
    const manual = await request(app).get('/api/leads?source=manual&limit=100').set(s.headers);
    assert.ok(manual.body.leads.some((lead) => lead.name === 'Old site'));
    assert.strictEqual((await request(app).get('/api/leads?source=website').set(s.headers)).status, 400);

    const summary = await request(app).get('/api/leads/source-summary').set(s.headers);
    assert.strictEqual(summary.status, 200);
    assert.deepStrictEqual(Object.keys(summary.body.counts).sort(), [...leadSources.SOURCE_KINDS].sort());
    assert.strictEqual(summary.body.counts.facebook, 3);
    assert.strictEqual(summary.body.counts.manual, 5);
  });

  await t.test('L4. Facebook campaign filter only returns lead form leads', async () => {
    const s = await seedWorkspace(1);
    await seedLeads(s);
    const res = await request(app).get('/api/leads?campaign_name=Diwali').set(s.headers);
    assert.deepStrictEqual(res.body.leads.map((lead) => lead.name), ['Old fb']);
    const options = await request(app).get('/api/leads/facebook-filter-options').set(s.headers);
    assert.deepStrictEqual(options.body.options, [{ campaign_name: 'Diwali', ad_name: 'Ad A' }]);
  });
});

test('Lead list', async (t) => {
  await t.test('L5. The total is right on every page, also past the end', async () => {
    const s = await seedWorkspace(1);
    await seedLeads(s);
    const first = await request(app).get('/api/leads?limit=10&offset=0').set(s.headers);
    assert.strictEqual(first.body.total, SAMPLE.length);
    assert.strictEqual(first.body.leads.length, 10);
    const second = await request(app).get('/api/leads?limit=10&offset=10').set(s.headers);
    assert.strictEqual(second.body.leads.length, SAMPLE.length - 10);
    const past = await request(app).get('/api/leads?limit=10&offset=40').set(s.headers);
    assert.strictEqual(past.body.leads.length, 0);
    assert.strictEqual(past.body.total, SAMPLE.length);
  });

  await t.test('L6. Status, assigned-to and search filters reach the query', async () => {
    const s = await seedWorkspace(1);
    const leads = await seedLeads(s);
    await runAsTenant(1, () => models.Leads.updateMany({ id: { $in: [leads[0].id, leads[1].id] } }, { $set: { assigned_to: s.agent.id, status: 'hot' } }));
    const mine = await request(app).get(`/api/leads?assigned_to=${s.agent.id}`).set(s.headers);
    assert.strictEqual(mine.body.total, 2);
    assert.ok(mine.body.leads.every((lead) => lead.assigned_name === 'Priya'));
    const unassigned = await request(app).get('/api/leads?assigned_to=unassigned').set(s.headers);
    assert.strictEqual(unassigned.body.total, SAMPLE.length - 2);
    const hot = await request(app).get('/api/leads?status=hot').set(s.headers);
    assert.strictEqual(hot.body.total, 2);
    const search = await request(app).get('/api/leads?search=Old%20site').set(s.headers);
    assert.ok(search.body.leads.length >= 1 && search.body.leads[0].name.startsWith('Old site'));
    assert.strictEqual((await request(app).get('/api/leads?assigned_to=abc').set(s.headers)).status, 400);
  });
});

test('Assigning and changing status', async (t) => {
  await t.test('L7. Bulk assign and bulk status change this workspace\'s leads', async () => {
    const s = await seedWorkspace(1);
    const leads = await seedLeads(s);
    const ids = leads.slice(0, 3).map((lead) => lead.id);
    const assign = await request(app).post('/api/leads/bulk').set(s.headers).send({ ids, action: 'assign', assigned_to: s.agent.id });
    assert.strictEqual(assign.status, 200);
    assert.strictEqual(assign.body.updated, 3);
    const status = await request(app).post('/api/leads/bulk').set(s.headers).send({ ids, action: 'status', status: 'Converted' });
    assert.strictEqual(status.body.updated, 3);
    const rows = await runAsTenant(1, () => models.Leads.find({ id: { $in: ids } }).lean());
    assert.ok(rows.every((row) => row.assigned_to === s.agent.id && row.status === 'converted'));
    const unassign = await request(app).post('/api/leads/bulk').set(s.headers).send({ ids, action: 'assign', assigned_to: null });
    assert.strictEqual(unassign.status, 200);
    assert.ok((await runAsTenant(1, () => models.Leads.find({ id: { $in: ids } }).lean())).every((row) => row.assigned_to == null));
    assert.strictEqual((await request(app).post('/api/leads/bulk').set(s.headers).send({ ids, action: 'status', status: 'hijacked' })).status, 400);
    assert.strictEqual((await request(app).post('/api/leads/bulk').set(s.headers).send({ ids: [], action: 'status', status: 'hot' })).status, 400);
    assert.strictEqual((await request(app).post('/api/leads/bulk').set(s.headers).send({ ids, action: 'delete' })).status, 400);
  });

  await t.test('L8. Another workspace\'s leads and team members cannot be used', async () => {
    const a = await seedWorkspace(1);
    const b = await seedWorkspace(2);
    const leadsA = await seedLeads(a, SAMPLE.slice(0, 2));
    const leadsB = await seedLeads(b, SAMPLE.slice(0, 2));

    // B's agent is not in A's team.
    const crossAssign = await request(app).post('/api/leads/bulk').set(a.headers).send({ ids: [leadsA[0].id], action: 'assign', assigned_to: b.agent.id });
    assert.strictEqual(crossAssign.status, 400);
    const patch = await request(app).patch(`/api/leads/${leadsA[0].id}`).set(a.headers).send({ assigned_to: b.agent.id });
    assert.strictEqual(patch.status, 400);
    const create = await request(app).post('/api/leads').set(a.headers).send({ name: 'New', phone: '919811100001', assigned_to: b.agent.id });
    assert.strictEqual(create.status, 400);

    // A cannot change B's leads, even by id.
    const crossLeads = await request(app).post('/api/leads/bulk').set(a.headers).send({ ids: leadsB.map((lead) => lead.id), action: 'status', status: 'lost' });
    assert.strictEqual(crossLeads.status, 200);
    assert.strictEqual(crossLeads.body.updated, 0);
    const untouched = await runAsTenant(2, () => models.Leads.find({}).lean());
    assert.ok(untouched.every((row) => row.status === 'new'));
    assert.strictEqual((await request(app).patch(`/api/leads/${leadsB[0].id}`).set(a.headers).send({ status: 'lost' })).status, 404);

    // Lists, counts and filters stay inside the workspace.
    const list = await request(app).get('/api/leads').set(a.headers);
    assert.strictEqual(list.body.total, 2);
    assert.ok(list.body.leads.every((lead) => lead.tenant_id === 1));
    const summary = await request(app).get('/api/leads/source-summary').set(a.headers);
    assert.strictEqual(Object.values(summary.body.counts).reduce((sum, n) => sum + n, 0), 2);
    const byAgent = await request(app).get(`/api/leads?assigned_to=${b.agent.id}`).set(a.headers);
    assert.strictEqual(byAgent.body.total, 0);
  });

  await t.test('L9. Add lead: Manual or WhatsApp only, a team member of this workspace', async () => {
    const s = await seedWorkspace(1);
    const ok = await request(app).post('/api/leads').set(s.headers).send({ name: 'Ravi', phone: '+91 98111 00002', source: 'whatsapp', assigned_to: s.agent.id });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.lead.source, 'WhatsApp');
    assert.strictEqual(ok.body.lead.assigned_to, s.agent.id);
    const plain = await request(app).post('/api/leads').set(s.headers).send({ name: 'Mala', phone: '919811100003' });
    assert.strictEqual(plain.body.lead.source, 'Manual');
    const website = await request(app).post('/api/leads').set(s.headers).send({ name: 'Site', phone: '919811100004', source: 'website' });
    assert.strictEqual(website.status, 400);
  });
});

test('Exports', async (t) => {
  const waitForJob = async (s, id) => {
    for (let i = 0; i < 50; i += 1) {
      const res = await request(app).get(`/api/leads/exports/${id}`).set(s.headers);
      if (['completed', 'failed'].includes(res.body.status)) return res.body;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('export did not finish');
  };

  await t.test('L10. Export by source and of picked leads, with plain source names', async () => {
    const s = await seedWorkspace(1);
    const leads = await seedLeads(s);
    assert.strictEqual((await request(app).post('/api/leads/exports').set(s.headers).send({ mode: 'source', source: 'website' })).status, 400);

    const bySource = await request(app).post('/api/leads/exports').set(s.headers).send({ mode: 'source', source: 'whatsapp_ad' });
    assert.strictEqual(bySource.status, 202);
    assert.strictEqual(bySource.body.total_records, 2);

    const picked = leads.filter((lead) => ['Ad click', 'Old site', 'Sheet'].includes(lead.name));
    const selected = await request(app).post('/api/leads/exports').set(s.headers).send({ mode: 'selected', ids: picked.map((lead) => lead.id) });
    assert.strictEqual(selected.status, 202);
    assert.strictEqual(selected.body.total_records, 3);
    const done = await waitForJob(s, selected.body.id);
    assert.strictEqual(done.status, 'completed', done.error_message);
    assert.strictEqual(done.processed_records, 3);
    const job = await runAsTenant(1, () => models.LeadExportJobs.findOne({ id: selected.body.id }).lean());
    const csv = fs.readFileSync(job.file_path, 'utf8');
    fs.unlinkSync(job.file_path);
    assert.match(csv, /"WhatsApp ad"/);
    assert.match(csv, /"Manual"/);
    assert.match(csv, /"Import"/);
    assert.doesNotMatch(csv, /website/i);
    assert.strictEqual(csv.trim().split('\n').length, 4, 'header + 3 picked leads');
  });

  await t.test('L11. Exporting another workspace\'s lead ids finds nothing', async () => {
    const a = await seedWorkspace(1);
    const b = await seedWorkspace(2);
    const leadsB = await seedLeads(b, SAMPLE.slice(0, 3));
    const res = await request(app).post('/api/leads/exports').set(a.headers).send({ mode: 'selected', ids: leadsB.map((lead) => lead.id) });
    assert.strictEqual(res.status, 400);
  });

  await t.test('L12. Agents cannot export or delete (role permissions)', async () => {
    const s = await seedWorkspace(1);
    const [lead] = await seedLeads(s, SAMPLE.slice(0, 1));
    const agentHeaders = { Authorization: `Bearer ${makeToken(s.agent)}` };
    assert.strictEqual((await request(app).post('/api/leads/exports').set(agentHeaders).send({ mode: 'all' })).status, 403);
    assert.strictEqual((await request(app).delete(`/api/leads/${lead.id}`).set(agentHeaders)).status, 403);
    assert.strictEqual((await request(app).delete(`/api/leads/${lead.id}`).set(s.headers)).status, 200);
  });
});
