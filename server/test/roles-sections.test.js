/**
 * Roles Owner / Admin / Staff with sections: old roles read the new way,
 * what an Admin may give, the section guard on API routes (403 without the
 * section, 200 with it), the Team page for Owners and Admins only, Staff
 * reports limited to their own leads, and migration 044.
 * Real server.js app, in-memory MongoDB.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const TEMP = 'Temporary-Pass-1';
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

test('permissions: old roles are read as Owner, Admin or Staff with sections', () => {
  const { describeUser, can, hasSection, SECTIONS, LEGACY_SECTIONS, canAssignRole } = require('../services/permissions');
  const as = (role, extra = {}) => describeUser({ tenant_id: 1, role, ...extra });

  assert.deepStrictEqual(as('owner').sections, SECTIONS);
  assert.strictEqual(as('owner').role, 'owner');
  assert.deepStrictEqual(as('admin').sections, SECTIONS, 'an Admin without a list keeps everything');
  const manager = as('manager');
  assert.strictEqual(manager.role, 'staff');
  assert.deepStrictEqual(manager.sections, ['dashboard', 'leads', 'sales_tasks', 'inbox', 'templates', 'campaigns', 'ai_brain', 'followups', 'reports']);
  for (const old of ['agent', 'user', 'ops']) {
    assert.strictEqual(as(old).role, 'staff');
    assert.deepStrictEqual(as(old).sections, ['leads', 'sales_tasks', 'inbox']);
  }
  assert.deepStrictEqual(LEGACY_SECTIONS.agent.slice().sort(), ['inbox', 'leads', 'sales_tasks']);
  assert.deepStrictEqual(as('staff').sections, ['leads', 'inbox'], 'Staff without a list get the defaults');
  assert.deepStrictEqual(as('staff', { sections: ['campaigns', 'bogus', 'leads'] }).sections, ['leads', 'campaigns'], 'unknown keys dropped, sidebar order');
  assert.deepStrictEqual(as('admin', { sections: ['inbox'] }).sections, ['inbox']);
  assert.strictEqual(as('nonsense').role, 'staff');

  // Owner keeps everything; Admins lose billing, WhatsApp number and settings.
  for (const permission of ['team.manage', 'tenant.settings', 'whatsapp.manage', 'billing.manage', 'workspace.export', 'activity.view', 'integrations.manage', 'calendar.manage', 'campaigns.manage', 'leads.delete']) {
    assert.strictEqual(can(as('owner'), permission), true, `owner ${permission}`);
  }
  for (const permission of ['tenant.settings', 'whatsapp.manage', 'billing.manage', 'workspace.export', 'activity.view', 'integrations.manage', 'calendar.manage']) {
    assert.strictEqual(can(as('admin'), permission), false, `admin ${permission}`);
  }
  assert.strictEqual(can(as('admin'), 'team.manage'), true);
  assert.strictEqual(can(as('admin'), 'billing.view'), true);
  assert.strictEqual(can(as('staff'), 'team.view'), false);
  // Section-bound permissions.
  assert.strictEqual(can(as('staff', { sections: ['campaigns'] }), 'campaigns.manage'), true);
  assert.strictEqual(can(as('staff', { sections: ['leads'] }), 'campaigns.manage'), false);
  assert.strictEqual(can(as('admin', { sections: ['inbox'] }), 'campaigns.manage'), false);
  assert.strictEqual(can(as('staff', { sections: ['leads'] }), 'leads.delete'), false, 'Staff never bulk delete');
  assert.strictEqual(can(as('admin', { sections: ['leads'] }), 'leads.export'), true);
  assert.strictEqual(can(as('admin', { sections: ['inbox'] }), 'leads.export'), false);
  // Platform staff and n8n are not limited by sections.
  assert.strictEqual(hasSection({ kind: 'service', tenantId: 1 }, 'campaigns'), true);
  assert.strictEqual(hasSection(describeUser({ is_platform_staff: true, staff_role: 'ops' }), 'campaigns'), true);
  // Role assignment.
  assert.strictEqual(canAssignRole('admin', 'staff', 'admin'), false);
  assert.strictEqual(canAssignRole('admin', 'admin', 'staff'), false);
  assert.strictEqual(canAssignRole('admin', 'agent', 'staff'), true);
  assert.strictEqual(canAssignRole('owner', 'staff', 'admin'), true);
});

test('Roles and sections over the API', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Leads, Invitations } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const billing = require('../services/billing');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  let seq = 0;

  t.beforeEach(async () => {
    await clearCollections();
    await billing.plans.ensureDefaultPlans();
  });

  const createUser = async (fields) => (await sys(() => Users.create({
    email: `user${++seq}@acme.test`, name: `User ${seq}`, password_hash: bcrypt.hashSync('Existing-Pass-1', 4),
    is_active: true, token_version: 0, ...fields,
  }))).toObject();
  async function workspace(tenantId = 1) {
    const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}` });
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata' }));
    await billing.subscriptions.activate({ tenantId, plan: await billing.plans.planByCode('complete') });
    return owner;
  }
  const addPerson = (actor, body) => request(app).post('/api/team/users').set(bearer(actor)).send({ method: 'password', password: TEMP, ...body });
  const stored = (email) => sys(() => Users.findOne({ email }, { _id: 0 }).lean());

  await t.test('R1. Owner adds Staff (defaults Leads + WhatsApp Chat) and Admin (all sections); the role list is Owner, Admin, Staff', async () => {
    const owner = await workspace();
    const staff = await addPerson(owner, { name: 'Priya', email: 'priya@acme.test', role: 'staff' });
    assert.strictEqual(staff.status, 201, JSON.stringify(staff.body));
    assert.strictEqual(staff.body.user.role, 'staff');
    assert.deepStrictEqual(staff.body.user.sections, ['leads', 'inbox']);
    assert.deepStrictEqual((await stored('priya@acme.test')).sections, ['leads', 'inbox']);

    const admin = await addPerson(owner, { name: 'Ravi', email: 'ravi@acme.test', role: 'admin', sections: ['campaigns', 'leads'] });
    assert.strictEqual(admin.status, 201, JSON.stringify(admin.body));
    assert.deepStrictEqual(admin.body.user.sections, ['leads', 'campaigns']);
    const allAdmin = await addPerson(owner, { name: 'Asha', email: 'asha@acme.test', role: 'admin' });
    assert.strictEqual(allAdmin.body.user.sections.length, 10);
    assert.ok(allAdmin.body.user.sections.includes('followups'), 'a new Admin gets Follow-ups too');

    const bad = await addPerson(owner, { name: 'Bad', email: 'bad@acme.test', role: 'staff', sections: ['billing'] });
    assert.strictEqual(bad.status, 400, 'billing is not a section');
    const manager = await addPerson(owner, { name: 'Old App', email: 'old@acme.test', role: 'manager' });
    assert.strictEqual(manager.status, 201, 'an older app sending "manager" still works');
    assert.strictEqual(manager.body.user.role, 'staff');
    assert.ok(manager.body.user.sections.includes('campaigns'));

    // GET /api/tenant tells the app the sections (Owner: all).
    const tenant = await request(app).get('/api/tenant').set(bearer(owner));
    assert.strictEqual(tenant.body.sections.length, 10);
    assert.strictEqual(tenant.body.permissions.manage_billing, true);
  });

  await t.test('R2. An Admin grants only sections they have, and never adds or edits an Admin or Owner', async () => {
    const owner = await workspace();
    const admin = await createUser({ tenant_id: 1, role: 'admin', sections: ['leads', 'inbox', 'reports'] });
    const otherAdmin = await createUser({ tenant_id: 1, role: 'admin', sections: ['leads'] });
    const h = bearer(admin);

    const refused = await addPerson(admin, { name: 'Sneaky', email: 'sneaky@acme.test', role: 'staff', sections: ['leads', 'campaigns'] });
    assert.strictEqual(refused.status, 403);
    assert.match(refused.body.error, /only give sections that you have/);
    assert.strictEqual(await stored('sneaky@acme.test'), null);
    const invited = await request(app).post('/api/team/invitations').set(h).send({ email: 'inv@acme.test', role: 'staff', sections: ['ai_brain'] });
    assert.strictEqual(invited.status, 403, 'invitations follow the same rule');

    const ok = await addPerson(admin, { name: 'Kumar', email: 'kumar@acme.test', role: 'staff', sections: ['inbox', 'reports'] });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.deepStrictEqual(ok.body.user.sections, ['inbox', 'reports']);

    for (const role of ['admin', 'owner']) {
      const res = await addPerson(admin, { name: 'Promote', email: `${role}x@acme.test`, role });
      assert.strictEqual(res.status, 403, `admin adds ${role}`);
      const inv = await request(app).post('/api/team/invitations').set(h).send({ email: `${role}inv@acme.test`, role });
      assert.strictEqual(inv.status, 403, `admin invites ${role}`);
    }
    for (const target of [owner, otherAdmin]) {
      assert.strictEqual((await request(app).patch(`/api/team/users/${target.id}`).set(h).send({ sections: ['leads'] })).status, 403, `admin edits ${target.role}`);
      assert.strictEqual((await request(app).post(`/api/team/users/${target.id}/deactivate`).set(h)).status, 403);
      assert.strictEqual((await request(app).delete(`/api/team/users/${target.id}`).set(h)).status, 403);
    }
    const kumar = await stored('kumar@acme.test');
    assert.strictEqual((await request(app).patch(`/api/team/users/${kumar.id}`).set(h).send({ role: 'admin' })).status, 403, 'admin promotes staff to admin');

    // Editing Staff: a section the Admin lacks, given by the Owner, stays.
    await sys(() => Users.updateOne({ id: kumar.id }, { $set: { sections: ['inbox', 'campaigns'] } }));
    const edited = await request(app).patch(`/api/team/users/${kumar.id}`).set(h).send({ sections: ['leads'] });
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.body));
    assert.deepStrictEqual(edited.body.user.sections, ['leads', 'campaigns']);
    const grab = await request(app).patch(`/api/team/users/${kumar.id}`).set(h).send({ sections: ['leads', 'ai_brain'] });
    assert.strictEqual(grab.status, 403);

    // The Team list tells the page what this Admin may tick.
    const list = await request(app).get('/api/team/users').set(h);
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.grantable_sections, ['leads', 'inbox', 'reports']);

    // The Owner edits an Admin's sections and role freely.
    const ownerEdit = await request(app).patch(`/api/team/users/${otherAdmin.id}`).set(bearer(owner)).send({ sections: ['campaigns'] });
    assert.strictEqual(ownerEdit.status, 200, JSON.stringify(ownerEdit.body));
    assert.deepStrictEqual(ownerEdit.body.user.sections, ['campaigns']);
    const demoted = await request(app).patch(`/api/team/users/${otherAdmin.id}`).set(bearer(owner)).send({ role: 'staff' });
    assert.strictEqual(demoted.status, 200);
    assert.strictEqual(demoted.body.user.role, 'staff');
    assert.deepStrictEqual(demoted.body.user.sections, ['campaigns'], 'a role change keeps the sections');
    const promoted = await request(app).patch(`/api/team/users/${otherAdmin.id}`).set(bearer(owner)).send({ role: 'owner' });
    assert.strictEqual(promoted.status, 200);
    assert.strictEqual((await stored(otherAdmin.email)).sections, undefined, 'Owners store no sections');
  });

  await t.test('R3. A section not granted is refused by the server; granted, it works; the Owner is unaffected', async () => {
    const owner = await workspace();
    const noCampaigns = await createUser({ tenant_id: 1, role: 'staff', sections: ['leads', 'inbox'] });
    const withCampaigns = await createUser({ tenant_id: 1, role: 'staff', sections: ['campaigns'] });
    const legacyAgent = await createUser({ tenant_id: 1, role: 'agent' });

    const refused = await request(app).get('/api/campaigns').set(bearer(noCampaigns));
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.code, 'SECTION_FORBIDDEN');
    assert.strictEqual((await request(app).get('/api/campaigns').set(bearer(legacyAgent))).status, 403, 'an old agent has no campaigns');
    assert.strictEqual((await request(app).get('/api/campaigns').set(bearer(withCampaigns))).status, 200);
    assert.strictEqual((await request(app).get('/api/campaigns').set(bearer(owner))).status, 200);

    // Other sections.
    assert.strictEqual((await request(app).get('/api/brain/profile').set(bearer(noCampaigns))).status, 403, 'AI Brain');
    assert.strictEqual((await request(app).get('/api/calendar/meetings').set(bearer(noCampaigns))).status, 403, 'Plugins');
    assert.strictEqual((await request(app).get('/api/reports/summary').set(bearer(noCampaigns))).status, 403, 'Dashboard / Reports');
    assert.strictEqual((await request(app).get('/api/sales-tasks').set(bearer(noCampaigns))).status, 403, 'Sales Task');
    assert.strictEqual((await request(app).get('/api/sales-tasks').set(bearer(legacyAgent))).status, 200, 'an old agent keeps Sales Task');
    assert.strictEqual((await request(app).get('/api/inbox').set(bearer(withCampaigns))).status, 403, 'WhatsApp Chat');
    assert.strictEqual((await request(app).get('/api/inbox').set(bearer(noCampaigns))).status, 200);
    assert.strictEqual((await request(app).get('/api/leads').set(bearer(withCampaigns))).status, 403, 'Leads');
    assert.strictEqual((await request(app).get('/api/leads').set(bearer(noCampaigns))).status, 200);
    assert.strictEqual((await request(app).post('/api/templates').set(bearer(noCampaigns)).send({})).status, 403, 'Templates (changes)');
    // The template list is shared (the campaign builder and chat use it).
    assert.strictEqual((await request(app).get('/api/templates').set(bearer(withCampaigns))).status, 200);
    // Staff with Leads cannot bulk export or delete.
    assert.strictEqual((await request(app).post('/api/leads/exports').set(bearer(noCampaigns)).send({ mode: 'all' })).status, 403);
  });

  await t.test('R4. Staff never open the Team endpoints; Admins see the team but not billing changes or settings', async () => {
    await workspace();
    const staff = await createUser({ tenant_id: 1, role: 'staff', sections: ['leads'] });
    const admin = await createUser({ tenant_id: 1, role: 'admin', sections: ['leads'] });
    const h = bearer(staff);
    assert.strictEqual((await request(app).get('/api/team/users').set(h)).status, 403);
    assert.strictEqual((await addPerson(staff, { name: 'X', email: 'x@acme.test', role: 'staff' })).status, 403);
    assert.strictEqual((await request(app).post('/api/team/invitations').set(h).send({ email: 'y@acme.test', role: 'staff' })).status, 403);
    const tenant = await request(app).get('/api/tenant').set(h);
    assert.strictEqual(tenant.status, 200);
    assert.strictEqual(tenant.body.permissions.view_team, false);
    assert.deepStrictEqual(tenant.body.sections, ['leads']);

    assert.strictEqual((await request(app).get('/api/team/users').set(bearer(admin))).status, 200);
    const adminTenant = await request(app).get('/api/tenant').set(bearer(admin));
    assert.strictEqual(adminTenant.body.permissions.view_team, true);
    assert.strictEqual(adminTenant.body.permissions.manage_billing, false);
    assert.strictEqual(adminTenant.body.permissions.manage_whatsapp, false);
    assert.strictEqual(adminTenant.body.permissions.manage_settings, false);
    assert.strictEqual((await request(app).patch('/api/tenant/settings').set(bearer(admin)).send({ language: 'ta' })).status, 403);
    assert.strictEqual((await request(app).get('/api/activity').set(bearer(admin))).status, 403);

    // /api/auth/me carries the sections for the sidebar.
    const me = await request(app).get('/api/auth/me').set(h);
    assert.deepStrictEqual(me.body.user?.sections ?? me.body.sections, ['leads']);
  });

  await t.test('R5. Reports: Staff see only their own leads, Owners and Admins the whole team', async () => {
    const owner = await workspace();
    const staff = await createUser({ tenant_id: 1, role: 'staff', sections: ['reports', 'dashboard'] });
    const admin = await createUser({ tenant_id: 1, role: 'admin', sections: ['reports'] });
    await runAsTenant(1, async () => {
      await Leads.create({ phone: '919000000001', name: 'Mine 1', status: 'hot', assigned_to: staff.id, created_at: new Date() });
      await Leads.create({ phone: '919000000002', name: 'Mine 2', status: 'new', assigned_to: staff.id, created_at: new Date() });
      await Leads.create({ phone: '919000000003', name: 'Theirs', status: 'hot', assigned_to: owner.id, created_at: new Date() });
      await Leads.create({ phone: '919000000004', name: 'Nobody', status: 'hot', created_at: new Date() });
    });
    const summary = (user) => request(app).get('/api/reports/summary').set(bearer(user));
    const mine = await summary(staff);
    assert.strictEqual(mine.status, 200, JSON.stringify(mine.body));
    assert.strictEqual(mine.body.hot_leads, 1);
    assert.strictEqual(mine.body.leads_today, 2);
    for (const user of [owner, admin]) {
      const all = await summary(user);
      assert.strictEqual(all.body.hot_leads, 3);
      assert.strictEqual(all.body.leads_today, 4);
    }
    const custom = await request(app).get('/api/reports/summary').query({ range: 'custom', from: '2020-01-01', to: '2099-12-31' }).set(bearer(staff));
    assert.strictEqual(custom.body.leads_today, 2);

    const rows = await request(app).get('/api/reports/leads').set(bearer(staff));
    assert.deepStrictEqual(rows.body.leads.map((l) => l.name).sort(), ['Mine 1', 'Mine 2']);
    assert.strictEqual((await request(app).get('/api/reports/leads').set(bearer(owner))).body.leads.length, 4);

    const sources = await request(app).get('/api/reports/conversion-rate').set(bearer(staff));
    assert.strictEqual(sources.status, 200);
    assert.strictEqual(sources.body.data.reduce((sum, row) => sum + row.count, 0), 2);
  });

  await t.test('R5b. Follow-ups is its own section: given without AI Brain it works, AI Brain alone does not open it', async () => {
    const owner = await workspace();
    const followupsOnly = await createUser({ tenant_id: 1, role: 'staff', sections: ['followups'] });
    const brainOnly = await createUser({ tenant_id: 1, role: 'staff', sections: ['ai_brain'] });
    const legacyManager = await createUser({ tenant_id: 1, role: 'manager' });
    const legacyAgent = await createUser({ tenant_id: 1, role: 'agent' });
    const due = (user) => request(app).get('/api/followups/due').set(bearer(user));
    assert.strictEqual((await due(followupsOnly)).status, 200);
    assert.strictEqual((await due(owner)).status, 200);
    assert.strictEqual((await due(legacyManager)).status, 200, 'old managers keep follow-ups');
    const refused = await due(brainOnly);
    assert.strictEqual(refused.status, 403);
    assert.strictEqual(refused.body.code, 'SECTION_FORBIDDEN');
    assert.strictEqual((await due(legacyAgent)).status, 403, 'old agents have no follow-ups');
    assert.strictEqual((await request(app).post('/api/followups/rule').set(bearer(brainOnly)).send({ lead_id: 1 })).status, 403);
    assert.strictEqual((await request(app).post('/api/followups/rule').set(bearer(followupsOnly)).send({ lead_id: 1 })).status, 200);
    // And the other way round: Follow-ups alone does not open AI Brain.
    assert.strictEqual((await request(app).get('/api/brain/profile').set(bearer(followupsOnly))).status, 403);
    assert.strictEqual((await request(app).get('/api/brain/profile').set(bearer(brainOnly))).status, 200);
    // An Admin without Follow-ups cannot give it.
    const admin = await createUser({ tenant_id: 1, role: 'admin', sections: ['leads', 'ai_brain'] });
    const give = await addPerson(admin, { name: 'Nope', email: 'nope@acme.test', role: 'staff', sections: ['followups'] });
    assert.strictEqual(give.status, 403);
  });

  await t.test('R6. Migration 044 moves old roles to Staff/Admin with sections, once', async () => {
    const { migrate } = require('../migrations/044_roles_sections');
    await workspace();
    const manager = await createUser({ tenant_id: 1, role: 'manager' });
    const agent = await createUser({ tenant_id: 1, role: 'agent' });
    const admin = await createUser({ tenant_id: 1, role: 'admin' });
    const custom = await createUser({ tenant_id: 1, role: 'staff', sections: ['reports'] });
    const platform = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', role: null });
    await runAsTenant(1, () => Invitations.create({ email: 'pending@acme.test', role: 'agent', token_hash: 'x'.repeat(64), expires_at: new Date(Date.now() + 3600000), created_at: new Date() }));

    const dry = await migrate({ apply: false, log: () => {} });
    assert.strictEqual(dry.users_changed, 3);
    assert.strictEqual((await stored(manager.email)).role, 'manager', 'a dry run writes nothing');

    const applied = await migrate({ apply: true, log: () => {} });
    assert.strictEqual(applied.users_changed, 3);
    assert.strictEqual(applied.invitations_changed, 1);
    const m = await stored(manager.email);
    assert.strictEqual(m.role, 'staff');
    assert.deepStrictEqual(m.sections, ['dashboard', 'leads', 'sales_tasks', 'inbox', 'templates', 'campaigns', 'ai_brain', 'followups', 'reports']);
    assert.strictEqual(m.migrated_from_role, 'manager');
    const a = await stored(agent.email);
    assert.strictEqual(a.role, 'staff');
    assert.deepStrictEqual(a.sections, ['leads', 'sales_tasks', 'inbox']);
    assert.strictEqual((await stored(admin.email)).sections.length, 10);
    assert.ok((await stored(admin.email)).sections.includes('followups'));
    assert.ok(!a.sections.includes('followups'), 'agents get no Follow-ups');
    assert.deepStrictEqual((await stored(custom.email)).sections, ['reports'], 'a chosen list is kept');
    assert.strictEqual((await stored('owner1@acme.test')).sections, undefined, 'the Owner is unchanged');
    assert.strictEqual((await stored(platform.email)).role, null, 'platform staff are not touched');
    const inv = await sys(() => Invitations.findOne({ email: 'pending@acme.test' }).lean());
    assert.strictEqual(inv.role, 'staff');

    const again = await migrate({ apply: true, log: () => {} });
    assert.strictEqual(again.users_changed, 0, 'running it again changes nothing');
  });
});
