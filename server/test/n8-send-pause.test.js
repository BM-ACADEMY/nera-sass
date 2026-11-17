/**
 * N8: staff send pause and appeal evidence.
 *  - pause needs a reason, stops all sending, keeps sign-in and reading
 *  - resume restores sending; every change is audited
 *  - a suspended workspace cannot be paused (it already cannot send)
 *  - appeal evidence carries counts and masked numbers, never message text or full numbers
 *
 * Real server.js app, in-memory MongoDB, dummy credentials.
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

test.after(async () => { await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); });

test('N8: send pause and appeal evidence', async (t) => {
  const { Users, Tenants, Clients, WhatsappConsents, CampaignMessageQueue, AuditEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { tenantCanSend } = require('../services/lifecycle');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

  async function seed(tenantId = 31) {
    const founder = (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'founder',
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    await sys(() => Tenants.create({ id: tenantId, name: 'Dress Shop', status: 'active' }));
    const brand = await runAsTenant(tenantId, async () => (await Clients.create({ name: 'Dress Brand', whatsapp_number: '919876543210' })).toObject());
    const owner = (await sys(() => Users.create({
      tenant_id: tenantId, role: 'owner', email: 'owner@dress.test', name: 'owner',
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    return { founder, owner, brand, tenantId };
  }
  const auditEvents = (tenantId) => sys(() => AuditEvents.find({ tenant_id: tenantId }).lean());

  await t.test('P1. Pause needs a reason, stops sending, keeps sign-in, resumes, and is audited', async () => {
    const { founder, owner, tenantId } = await seed();
    assert.strictEqual(await tenantCanSend(tenantId), true);

    const noReason = await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(founder)).send({});
    assert.strictEqual(noReason.status, 400);
    assert.strictEqual(await tenantCanSend(tenantId), true, 'nothing changed without a reason');

    const paused = await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(founder)).send({ reason: 'Meta flagged the number' });
    assert.strictEqual(paused.status, 200, JSON.stringify(paused.body));
    assert.strictEqual(paused.body.tenant.sending_paused, true);
    assert.strictEqual(await tenantCanSend(tenantId), false, 'no sending while paused');

    const again = await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(founder)).send({ reason: 'again' });
    assert.strictEqual(again.status, 409, 'already paused');

    const stillIn = await request(app).get('/api/clients').set(bearer(owner));
    assert.strictEqual(stillIn.status, 200, 'the workspace can still sign in and read');

    const resumed = await request(app).post(`/api/admin/tenants/${tenantId}/resume-sending`).set(bearer(founder)).send({ reason: 'Appeal accepted' });
    assert.strictEqual(resumed.status, 200, JSON.stringify(resumed.body));
    assert.strictEqual(await tenantCanSend(tenantId), true);
    const none = await request(app).post(`/api/admin/tenants/${tenantId}/resume-sending`).set(bearer(founder)).send({});
    assert.strictEqual(none.status, 409, 'not paused any more');

    const events = (await auditEvents(tenantId)).map((e) => e.event);
    assert.ok(events.includes('TENANT_SENDING_PAUSED'));
    assert.ok(events.includes('TENANT_SENDING_RESUMED'));
  });

  await t.test('P2. A suspended workspace cannot be paused, and a customer cannot pause or resume', async () => {
    const { founder, owner, tenantId } = await seed(32);
    const asCustomer = await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(owner)).send({ reason: 'x' });
    assert.ok([401, 403].includes(asCustomer.status), `customer refused, got ${asCustomer.status}`);
    await sys(() => Tenants.updateOne({ id: tenantId }, { $set: { status: 'suspended' } }));
    const res = await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(founder)).send({ reason: 'x' });
    assert.strictEqual(res.status, 409);
  });

  await t.test('E1. Appeal evidence has counts and masked numbers, never message text or full numbers', async () => {
    const { founder, owner, tenantId } = await seed(33);
    await runAsTenant(tenantId, async () => {
      await WhatsappConsents.create({ phone: '919876543210', phone_key: '9876543210', status: 'opted_in', opt_in_source: 'manual', opt_in_at: new Date(), opt_in_text: 'Agreed on the call' });
      await WhatsappConsents.create({ phone: '919000011111', phone_key: '9000011111', status: 'opted_out', opt_in_source: 'import', opt_in_at: new Date(), opt_out_source: 'inbound_keyword', opt_out_at: new Date(), opt_out_text: 'STOP' });
      await CampaignMessageQueue.create({ phone: '919876543210', kind: 'marketing', status: 'sent', processed_at: new Date(), content: 'SECRET MESSAGE TEXT 123', created_at: new Date() });
      await CampaignMessageQueue.create({ phone: '919000011111', kind: 'marketing', status: 'skipped', skip_reason: 'CONTACT_OPTED_OUT', content: 'SECRET MESSAGE TEXT 456', created_at: new Date() });
    });
    await request(app).post(`/api/admin/tenants/${tenantId}/pause-sending`).set(bearer(founder)).send({ reason: 'Quality dropped to RED' });

    const res = await request(app).get(`/api/admin/tenants/${tenantId}/appeal-evidence`).set(bearer(founder));
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const body = res.body;
    assert.strictEqual(body.workspace.sending_paused, true);
    assert.strictEqual(body.workspace.sending_paused_reason, 'Quality dropped to RED');
    assert.strictEqual(body.consent.contacts_by_status.opted_in, 1);
    assert.strictEqual(body.consent.contacts_by_status.opted_out, 1);
    assert.strictEqual(body.consent.opt_outs_by_source.inbound_keyword, 1);
    assert.strictEqual(body.sending.messages_by_kind_and_status.marketing.sent, 1);
    assert.strictEqual(body.sending.skipped_by_reason.CONTACT_OPTED_OUT, 1);
    assert.ok(body.staff_and_system_actions.some((e) => e.event === 'TENANT_SENDING_PAUSED' && e.reason === 'Quality dropped to RED'));

    const text = JSON.stringify(body);
    for (const secret of ['SECRET MESSAGE TEXT', '919876543210', '9876543210', '919000011111', '9000011111']) {
      assert.ok(!text.includes(secret), `evidence must not contain ${secret}`);
    }
    assert.ok(text.includes('•••• 3210'), 'last four digits are shown');

    const asCustomer = await request(app).get(`/api/admin/tenants/${tenantId}/appeal-evidence`).set(bearer(owner));
    assert.ok([401, 403].includes(asCustomer.status), 'customers cannot read it');
    const missing = await request(app).get('/api/admin/tenants/999/appeal-evidence').set(bearer(founder));
    assert.strictEqual(missing.status, 404);
    const events = (await auditEvents(tenantId)).map((e) => e.event);
    assert.ok(events.includes('TENANT_APPEAL_EXPORTED'), 'the export is audited');
  });
});
