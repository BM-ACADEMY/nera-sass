/**
 * Admin WhatsApp Chat: the platform's own number. Real server.js app on an
 * in-memory MongoDB; Meta is stubbed and no request leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const SECRET = 'test-webhook-secret';
const PLATFORM_PHONE = 'PLATFORM_PHONE_1';
let app;
const metaCalls = [];
const realRequest = axiosModule.Axios.prototype.request;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.NERA_META_APP_SECRET = SECRET;
  process.env.PLATFORM_WA_PHONE_NUMBER_ID = PLATFORM_PHONE;
  process.env.PLATFORM_WA_ACCESS_TOKEN = 'dummy-platform-token';
  process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID = 'WABA_P'; // ignore the real one in server/.env
  axiosModule.Axios.prototype.request = async function stub(config) {
    const url = String(config.url || '');
    metaCalls.push({ url, data: typeof config.data === 'string' ? JSON.parse(config.data) : config.data, auth: config.headers?.Authorization });
    if (url.startsWith('https://graph.facebook.com/') && url.endsWith('/messages')) {
      return { data: { messages: [{ id: `wamid.out.${metaCalls.length}` }] }, status: 200 };
    }
    throw new Error(`blocked outbound call ${url}`);
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });
const sign = (raw) => `sha256=${crypto.createHmac('sha256', SECRET).update(raw).digest('hex')}`;

test('Platform WhatsApp inbox', async (t) => {
  const models = require('../models');
  const { Users, Tenants, Clients, Leads, Messages, PlatformWaContacts, PlatformWaMessages, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');

  async function seed() {
    await clearCollections();
    metaCalls.length = 0;
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role === 'ops' ? 'Priya' : role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const ops = await staff('ops');
    const support = await staff('support');
    await sys(() => Tenants.create({ id: 5, name: 'Kaveri Motors', status: 'active' }));
    await runAsTenant(5, () => Clients.create({ name: 'Kaveri', whatsapp_number: '91 98765 43210' }));
    const owner = (await runAsTenant(5, () => Users.create({ role: 'owner', email: 'o@kaveri.test', name: 'Owner', is_active: true, token_version: 0 }))).toObject();
    await sys(() => MetaWhatsappPhoneNumbers.create({ phone_number_id: PLATFORM_PHONE, waba_id: 'WABA_P', display_phone_number: '+91 90000 00001', verified_name: 'Getnera' }));
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'T1', waba_id: 'WABA_P', name: 'hello_support', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi, this is Getnera support.' }] },
      { template_id: 'T2', waba_id: 'WABA_P', name: 'needs_value', language: 'en', status: 'APPROVED', components: [{ type: 'BODY', text: 'Hi {{1}}' }] },
      { template_id: 'T3', waba_id: 'WABA_P', name: 'pending_one', language: 'en', status: 'PENDING', components: [{ type: 'BODY', text: 'x' }] },
    ]));
    return { ops, support, owner };
  }

  const inbound = (text, from = '919876543210', minutesAgo = 0) => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_P', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { phone_number_id: PLATFORM_PHONE },
      contacts: [{ wa_id: from, profile: { name: 'Ravi' } }],
      messages: [{ from, id: `wamid.in.${crypto.randomUUID()}`, timestamp: String(Math.floor((Date.now() - minutesAgo * 60000) / 1000)), type: 'text', text: { body: text } }],
    } }] }],
  });
  const postWebhook = (raw) => request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);

  await t.test('I1. A message to the platform number lands in the admin inbox only', async () => {
    const { ops } = await seed();
    const res = await postWebhook(inbound('Hello, I want a demo'));
    assert.strictEqual(res.status, 200);
    const contact = await PlatformWaContacts.findOne({ wa_id: '919876543210' }).lean();
    assert.strictEqual(contact.profile_name, 'Ravi');
    assert.strictEqual(contact.unread_count, 1);
    assert.strictEqual(await PlatformWaMessages.countDocuments({ contact_id: contact.id, direction: 'inbound' }), 1);
    assert.strictEqual(await sys(() => Leads.countDocuments({})), 0, 'no workspace lead');
    assert.strictEqual(await sys(() => Messages.countDocuments({})), 0, 'no workspace message');

    const list = await request(app).get('/api/admin/inbox/conversations').set(bearer(ops));
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.conversations[0].name, 'Ravi');
    assert.strictEqual(list.body.conversations[0].window_open, true);
    const detail = await request(app).get(`/api/admin/inbox/conversations/${contact.id}`).set(bearer(ops));
    assert.strictEqual(detail.body.workspaces[0].name, 'Kaveri Motors', 'matched to the workspace by number');
    const status = await request(app).get('/api/admin/inbox/status').set(bearer(ops));
    assert.strictEqual(status.body.configured, true);
    assert.strictEqual(status.body.unread_messages, 1);
  });

  await t.test('I2. Staff reply inside the 24-hour window; the token stays on the server', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('Need help'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const res = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'Sure, how can I help?' });
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    assert.strictEqual(res.body.message.status, 'sent');
    assert.strictEqual(res.body.message.sent_by_name, 'Priya');
    assert.ok(!JSON.stringify(res.body).includes('dummy-platform-token'));
    const call = metaCalls.at(-1);
    assert.ok(call.url.endsWith(`/${PLATFORM_PHONE}/messages`));
    assert.strictEqual(call.auth, 'Bearer dummy-platform-token');
    assert.strictEqual(call.data.to, '919876543210');
    assert.strictEqual(call.data.text.body, 'Sure, how can I help?');

    // Delivery receipts move the status forward.
    const sent = await PlatformWaMessages.findOne({ id: res.body.message.id }).lean();
    const receipt = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: PLATFORM_PHONE }, statuses: [{ id: sent.wa_message_id, status: 'read' }],
    } }] }] });
    await postWebhook(receipt);
    assert.strictEqual((await PlatformWaMessages.findOne({ id: sent.id }).lean()).status, 'read');
  });

  await t.test('I3. Outside the window only an approved template can be sent', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('Old message', '919876543210', 25 * 60));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const text = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'Hello again' });
    assert.strictEqual(text.status, 409);
    assert.strictEqual(text.body.code, 'WINDOW_CLOSED');
    assert.strictEqual(metaCalls.length, 0, 'nothing sent to Meta');

    const templates = await request(app).get('/api/admin/inbox/templates').set(bearer(ops));
    assert.deepStrictEqual(templates.body.templates.map((x) => x.name), ['hello_support'], 'approved, no variables');
    const bad = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({ name: 'needs_value' });
    assert.strictEqual(bad.status, 400);
    const ok = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/template`).set(bearer(ops)).send({ name: 'hello_support', language: 'en' });
    assert.strictEqual(ok.status, 201, JSON.stringify(ok.body));
    assert.strictEqual(metaCalls.at(-1).data.template.name, 'hello_support');
  });

  await t.test('I4. A new chat starts with a template; customers, the retired support role and anonymous callers are refused', async () => {
    const { ops, support, owner } = await seed();
    const start = await request(app).post('/api/admin/inbox/conversations').set(bearer(ops)).send({ phone: '+91 91234 56789', name: 'Lead from expo', template_name: 'hello_support', language: 'en' });
    assert.strictEqual(start.status, 201, JSON.stringify(start.body));
    const contact = await PlatformWaContacts.findOne({ id: start.body.contact_id }).lean();
    assert.strictEqual(contact.wa_id, '919123456789');
    assert.strictEqual(contact.name, 'Lead from expo');

    for (const who of [owner, support]) {
      assert.strictEqual((await request(app).get('/api/admin/inbox/conversations').set(bearer(who))).status, 403);
    }
    assert.strictEqual((await request(app).get('/api/admin/inbox/conversations')).status, 401);
  });

  await t.test('I5. The platform number cannot be assigned to a workspace', async () => {
    const { ops } = await seed();
    const brand = await runAsTenant(5, () => Clients.findOne({}).lean());
    const res = await request(app).post(`/api/admin/meta/whatsapp/phone-numbers/${PLATFORM_PHONE}/assign`).set(bearer(ops)).send({ client_id: brand.id });
    assert.strictEqual(res.status, 409);
    assert.strictEqual(res.body.code, 'PLATFORM_NUMBER');
  });

  await t.test('I6. Without the platform token, sending is refused and status says what is missing', async () => {
    const { ops } = await seed();
    await postWebhook(inbound('hi'));
    const contact = await PlatformWaContacts.findOne({}).lean();
    const saved = process.env.PLATFORM_WA_ACCESS_TOKEN;
    delete process.env.PLATFORM_WA_ACCESS_TOKEN;
    try {
      const status = await request(app).get('/api/admin/inbox/status').set(bearer(ops));
      assert.deepStrictEqual(status.body.missing, ['PLATFORM_WA_ACCESS_TOKEN']);
      const send = await request(app).post(`/api/admin/inbox/conversations/${contact.id}/messages`).set(bearer(ops)).send({ text: 'x' });
      assert.strictEqual(send.status, 503);
      assert.strictEqual(metaCalls.length, 0);
    } finally {
      process.env.PLATFORM_WA_ACCESS_TOKEN = saved;
    }
  });
});
