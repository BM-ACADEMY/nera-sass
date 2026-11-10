/**
 * Inbound watch: the last message / status receipt Meta sent for each
 * WhatsApp number, shown to the workspace, and a staff-only "Needs your
 * attention" notice when a live number has received nothing for 24 hours.
 *
 *   I1. the webhook stamps the last customer message and the last receipt
 *   I2. a live number silent for 24 hours raises one staff-only notice:
 *       no email, not in the customer's Notices box, in "Needs your attention"
 *   I3. the next inbound event closes it at once
 *   I4. a freshly verified number has a grace period; an unverified number is never flagged
 *   I5. the WhatsApp overview and the health endpoint show the last inbound event
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app, models, runAsSystem, runAsTenant, encryptToken, numberHealth, alerts, notify;
const HOUR = 3600000;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.NERA_META_APP_SECRET = 'test-dummy-webhook-secret';
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  ({ encryptToken } = require('../services/clientSecrets'));
  numberHealth = require('../services/numberHealth');
  alerts = require('../services/alerts');
  notify = require('../services/notify');
  ({ app } = require('../server'));
});
test.after(async () => { await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); notify.outbox().length = 0; });

const signedWebhook = (payload) => {
  const body = JSON.stringify(payload);
  const signature = 'sha256=' + crypto.createHmac('sha256', process.env.NERA_META_APP_SECRET).update(body).digest('hex');
  return request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature).send(body);
};
const statusHook = (phoneNumberId) => signedWebhook({
  object: 'whatsapp_business_account',
  entry: [{ id: 'WABA1', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, statuses: [{ id: 'wamid.unknown', status: 'delivered' }] } }] }],
});

async function seed({ tenantId = 1, phoneNumberId = `PN${tenantId}`, verifiedHoursAgo = 72, status = 'verified' } = {}) {
  await runAsSystem(() => models.Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active', created_at: new Date(Date.now() - 30 * 24 * HOUR) }), 'test');
  const owner = (await runAsSystem(() => models.Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  await runAsSystem(() => models.Tenants.updateOne({ id: tenantId }, { $set: { owner_user_id: owner.id } }), 'test');
  const brand = await runAsTenant(tenantId, async () => (await models.Clients.create({
    name: `Brand ${tenantId}`, phone_number_id: phoneNumberId, wa_business_id: `WABA${tenantId}`, whatsapp_number: '+91 90000 00001', whatsapp_status: status,
    whatsapp_verified_at: status === 'verified' ? new Date(Date.now() - verifiedHoursAgo * HOUR) : null, ...encryptToken(`test-dummy-token-${tenantId}`),
  })).toObject());
  return { tenantId, brand, owner, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
}
const staffHeaders = async () => {
  const staff = (await runAsSystem(() => models.Users.create({
    tenant_id: null, is_platform_staff: true, staff_role: 'founder', role: 'founder', email: 'founder@nera.test', name: 'Founder', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  return { Authorization: `Bearer ${makeToken(staff, { mfa: true })}` };
};
const stateOf = (tenantId, id) => runAsTenant(tenantId, () => models.WhatsappNumberState.findOne({ phone_number_id: id }, { _id: 0 }).lean());
const silentNotices = (tenantId) => runAsTenant(tenantId, () => models.CustomerAlerts.find({ type: 'number_silent' }, { _id: 0 }).lean());

test('Inbound watch', async (t) => {
  await t.test('I1. The webhook stamps the last receipt and the last customer message, at most once a minute', async () => {
    const { tenantId } = await seed();
    assert.strictEqual((await statusHook('PN1')).status, 200);
    const first = await stateOf(tenantId, 'PN1');
    assert.ok(first.last_status_received_at, 'status receipt stamped');
    assert.ok(!first.last_message_received_at);

    await runAsTenant(tenantId, () => numberHealth.recordInboundEvent('PN1', { kind: 'message' }));
    const second = await stateOf(tenantId, 'PN1');
    assert.ok(second.last_message_received_at, 'customer message stamped');
    const activity = numberHealth.inboundActivity(second);
    assert.strictEqual(activity.last_inbound_event_kind, 'message');
    assert.strictEqual(activity.silent, false);

    // A second receipt within the minute is not written again.
    const wrote = await runAsTenant(tenantId, () => numberHealth.recordInboundEvent('PN1', { kind: 'status' }));
    assert.strictEqual(wrote, false);
  });

  await t.test('I2. A live number quiet for 24 hours: one staff-only notice, no email, not in the Notices box', async () => {
    const { tenantId, headers } = await seed();
    await runAsTenant(tenantId, () => numberHealth.recordInboundEvent('PN1', { kind: 'message', at: new Date(Date.now() - 30 * HOUR) }));
    await alerts.evaluateTenant(tenantId);
    await alerts.evaluateTenant(tenantId);
    const notices = await silentNotices(tenantId);
    assert.strictEqual(notices.length, 1, 'raised once, the second sweep changes nothing');
    assert.strictEqual(notices[0].status, 'open');
    assert.strictEqual(notices[0].severity, 'critical');
    assert.strictEqual(notices[0].email_status, 'staff_only');
    assert.strictEqual(notify.outbox().filter((m) => m.to === 'owner1@shop.test').length, 0, 'the customer is not emailed');
    assert.ok(!JSON.stringify(notices[0]).includes('PN1'), 'the full phone number id is not stored in the notice');

    const box = await request(app).get('/api/notices').set(headers);
    assert.strictEqual(box.status, 200);
    assert.ok(!box.body.notices.some((n) => n.type === 'number_silent'), 'not in the customer Notices box');

    const attention = await request(app).get('/api/admin/attention').set(await staffHeaders());
    assert.strictEqual(attention.status, 200);
    const item = attention.body.items.find((i) => i.type === 'number_silent');
    assert.ok(item, 'in Needs your attention');
    assert.strictEqual(item.staff_only, true);
    assert.strictEqual(item.workspace, 'Shop 1');
    assert.strictEqual(item.email_problem, false);
    assert.match(item.title, /No WhatsApp events/);
  });

  await t.test('I3. The next inbound event closes the notice at once', async () => {
    const { tenantId } = await seed();
    await runAsTenant(tenantId, () => numberHealth.recordInboundEvent('PN1', { kind: 'status', at: new Date(Date.now() - 26 * HOUR) }));
    await alerts.evaluateTenant(tenantId);
    assert.strictEqual((await silentNotices(tenantId))[0].status, 'open');
    await statusHook('PN1');
    assert.strictEqual((await silentNotices(tenantId))[0].status, 'resolved');
  });

  await t.test('I4. A number verified an hour ago and an unverified number are not flagged; a live number with no event ever is', async () => {
    const fresh = await seed({ tenantId: 1, verifiedHoursAgo: 1 });
    const pending = await seed({ tenantId: 2, status: 'verification_pending' });
    const never = await seed({ tenantId: 3, verifiedHoursAgo: 25 });
    for (const s of [fresh, pending, never]) await alerts.evaluateTenant(s.tenantId);
    assert.strictEqual((await silentNotices(1)).length, 0, 'grace period for a fresh number');
    assert.strictEqual((await silentNotices(2)).length, 0, 'not live yet');
    const neverNotices = await silentNotices(3);
    assert.strictEqual(neverNotices.length, 1);
    assert.match(neverNotices[0].message, /since it was connected/);
  });

  await t.test('I5. The overview and the health endpoint show the last inbound event', async () => {
    const { tenantId, headers } = await seed();
    const at = new Date(Date.now() - 2 * HOUR);
    await runAsTenant(tenantId, () => numberHealth.recordInboundEvent('PN1', { kind: 'message', at }));
    const overview = await request(app).get('/api/whatsapp/overview').set(headers);
    assert.strictEqual(overview.status, 200, JSON.stringify(overview.body));
    assert.strictEqual(new Date(overview.body.inbound.last_inbound_event_at).toISOString(), at.toISOString());
    assert.strictEqual(overview.body.inbound.last_inbound_event_kind, 'message');
    assert.strictEqual(overview.body.inbound.silent, false);
    assert.strictEqual(overview.body.inbound.silent_after_hours, 24);

    const health = await request(app).get('/api/whatsapp/health').set(headers);
    assert.strictEqual(health.status, 200, JSON.stringify(health.body));
    assert.strictEqual(new Date(health.body.health.last_message_received_at).toISOString(), at.toISOString());
    assert.strictEqual(health.body.health.silent, false);
  });
});
