/**
 * Assigning a platform Meta number to a workspace (admin WhatsApp Numbers page):
 * an explicit, audited admin action that writes the brand's number and WABA
 * (never a token), refuses numbers or brands already in use, and unassigning
 * releases the brand.
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
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

test('Meta number assignment', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn);

  async function seed() {
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const founder = await staff('founder');
    const ops = await staff('ops');
    await sys(() => Tenants.create([{ id: 1, name: 'Acme', status: 'active' }, { id: 2, name: 'Beta', status: 'active' }]));
    const acme = (await runAsTenant(1, () => Clients.create({ name: 'Acme Brand' }))).toObject();
    const beta = (await runAsTenant(2, () => Clients.create({ name: 'Beta Brand' }))).toObject();
    await sys(() => MetaWhatsappAccounts.create({ waba_id: 'W1', name: 'Acme WABA' }));
    await sys(() => MetaWhatsappPhoneNumbers.create([
      { phone_number_id: 'P1', waba_id: 'W1', display_phone_number: '+91 98765 43210', connection_status: 'CONNECTED' },
      { phone_number_id: 'P2', waba_id: 'W1', display_phone_number: '+91 90000 00002', connection_status: 'PENDING' },
    ]));
    return { founder, ops, acme, beta };
  }
  const brand = (id, tenantId) => runAsTenant(tenantId, () => Clients.findOne({ id }).lean());

  await t.test('A1. Ops assigns a number: brand gets number and WABA (no token), inventory linked, audited', async () => {
    const { ops, acme } = await seed();
    const inv = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(ops));
    assert.strictEqual(inv.status, 200);
    assert.deepStrictEqual(inv.body.workspaces.map((w) => w.tenant_name).sort(), ['Acme', 'Beta']);

    const res = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: acme.id });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const b = await brand(acme.id, 1);
    assert.strictEqual(b.phone_number_id, 'P1');
    assert.strictEqual(b.wa_business_id, 'W1');
    assert.strictEqual(b.whatsapp_number, '919876543210');
    assert.strictEqual(b.whatsapp_status, 'verified');
    assert.ok(!b.wa_access_token && !b.wa_access_token_enc, 'no token written');
    assert.strictEqual((await sys(() => MetaWhatsappPhoneNumbers.findOne({ phone_number_id: 'P1' }).lean())).client_id, acme.id);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'META_PHONE_LINKED', tenant_id: 1 })));

    const after = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(ops));
    // The workspace now has its number, so the picker no longer offers it.
    const acmeRow = after.body.workspaces.find((w) => w.tenant_name === 'Acme');
    assert.strictEqual(acmeRow.has_number, true);
    assert.strictEqual(acmeRow.phone_number_id, 'P1');
    assert.strictEqual(after.body.workspaces.find((w) => w.tenant_name === 'Beta').has_number, false);
    const p1 = after.body.phone_numbers.find((p) => p.phone_number_id === 'P1');
    assert.strictEqual(p1.linked_brand.tenant_name, 'Acme');
    assert.strictEqual(p1.linked_brand.identity_matches, true);
  });

  await t.test('A2. A number already assigned, or a brand with another number, is refused; nothing changes', async () => {
    const { ops, acme, beta } = await seed();
    await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: acme.id });

    const taken = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: beta.id });
    assert.strictEqual(taken.status, 409);
    assert.strictEqual((await brand(beta.id, 2)).phone_number_id ?? null, null);

    const second = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P2/assign').set(bearer(ops)).send({ client_id: acme.id });
    assert.strictEqual(second.status, 409);
    assert.strictEqual((await brand(acme.id, 1)).phone_number_id, 'P1');
  });

  await t.test('A3. Unassign releases the brand and the inventory row; the number can then go to another workspace', async () => {
    const { ops, acme, beta } = await seed();
    await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: acme.id });
    const un = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/unassign').set(bearer(ops));
    assert.strictEqual(un.status, 200);
    const b = await brand(acme.id, 1);
    assert.strictEqual(b.phone_number_id, null);
    assert.strictEqual(b.whatsapp_status, 'not_configured');
    assert.strictEqual((await sys(() => MetaWhatsappPhoneNumbers.findOne({ phone_number_id: 'P1' }).lean())).client_id, null);

    const re = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: beta.id });
    assert.strictEqual(re.status, 200);
    assert.strictEqual((await brand(beta.id, 2)).phone_number_id, 'P1');
  });

  await t.test('A5. Workspace detail shows its number, usage counts and who did what', async () => {
    const { ops, acme } = await seed();
    await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(ops)).send({ client_id: acme.id });
    const res = await request(app).get('/api/admin/tenants/1').set(bearer(ops));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.whatsapp.display_phone_number, '+91 98765 43210');
    assert.strictEqual(res.body.whatsapp.connection_status, 'CONNECTED');
    assert.deepStrictEqual(Object.keys(res.body.usage).sort(), ['campaigns', 'conversations', 'leads', 'messages']);
    assert.strictEqual(res.body.usage.leads, 0);
    const linked = res.body.audit.find((e) => e.event === 'META_PHONE_LINKED');
    assert.strictEqual(linked.actor_name, 'ops');
    assert.ok(!JSON.stringify(res.body).includes('wa_access_token'), 'no token in the response');
  });

  await t.test('A6. Inventory sends template counts only; templates of one account load on demand', async () => {
    const { ops } = await seed();
    const { MetaWhatsappTemplates } = require('../models');
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'T1', waba_id: 'W1', name: 'welcome', language: 'en', status: 'APPROVED' },
      { template_id: 'T2', waba_id: 'W1', name: 'offer', language: 'en', status: 'REJECTED' },
    ]));
    const inv = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(ops));
    assert.strictEqual(inv.status, 200);
    assert.strictEqual(inv.body.templates, undefined, 'no template list in the inventory');
    assert.deepStrictEqual(inv.body.template_summary, [{ waba_id: 'W1', total: 2, approved: 1, other: 1 }]);
    const list = await request(app).get('/api/admin/meta/whatsapp/templates').query({ waba_id: 'W1' }).set(bearer(ops));
    assert.strictEqual(list.status, 200);
    assert.deepStrictEqual(list.body.templates.map((x) => x.name), ['offer', 'welcome']);
    assert.strictEqual((await request(app).get('/api/admin/meta/whatsapp/templates').set(bearer(ops))).status, 400);
  });

  await t.test('A4. Customers and anonymous callers cannot assign', async () => {
    const { acme } = await seed();
    const owner = (await runAsTenant(1, () => Users.create({ role: 'owner', email: 'o@acme.test', name: 'O', is_active: true, token_version: 0 }))).toObject();
    assert.strictEqual((await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').set(bearer(owner)).send({ client_id: acme.id })).status, 403);
    assert.strictEqual((await request(app).post('/api/admin/meta/whatsapp/phone-numbers/P1/assign').send({ client_id: acme.id })).status, 401);
    assert.strictEqual((await brand(acme.id, 1)).phone_number_id ?? null, null);
  });
});
