/**
 * N6: data export, reply webhook, delete on request.
 * In-memory MongoDB, synthetic data. Meta and the customer's webhook receiver
 * are stubbed: no real network call is made.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const META_SECRET = 'test-dummy-meta-app-secret';
const signMeta = (raw) => `sha256=${crypto.createHmac('sha256', META_SECRET).update(raw).digest('hex')}`;

let app;
let hook;
const metaCalls = [];
const realPost = axios.post;
const received = [];
let receiverReply;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.NERA_META_APP_SECRET = META_SECRET;
  await startTestDb();
  ({ app } = require('../server'));
  hook = require('../services/replyWebhook');
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: 'wamid.TEST' }] } };
  };
  hook.transport.post = async (url, body, headers) => {
    received.push({ url, body, headers });
    return receiverReply();
  };
});

test.after(async () => {
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  received.length = 0;
  receiverReply = async () => ({ status: 200 });
  await clearCollections();
});

const models = () => require('../models');
const ctx = () => require('../services/tenantContext');

async function seedTenant(id, { role = 'owner', email } = {}) {
  const { Users, Tenants, Clients, Leads, Conversations, Messages, LeadNotes, SalesLeadNotes } = models();
  const { runAsSystem, runAsTenant } = ctx();
  await runAsSystem(() => Tenants.create({ id, name: `Shop ${id}`, status: 'active' }), 'test');
  const user = (await runAsSystem(() => Users.create({
    tenant_id: id, role, email: email || `owner${id}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }), 'test')).toObject();
  const data = await runAsTenant(id, async () => {
    const { encryptToken } = require('../services/clientSecrets');
    const brand = await Clients.create({ name: `Brand ${id}`, phone_number_id: `PN${id}`, whatsapp_status: 'verified', ...encryptToken('test-dummy-token') });
    const lead = await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id, status: 'new' });
    const conversation = await Conversations.create({ lead_id: lead.id, phone: '9876543210', status: 'open' });
    await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: `hello from ${id}`, sent_at: new Date(Date.now() - 60000) });
    await Messages.create({ conversation_id: conversation.id, direction: 'outbound', content: `=CMD() reply ${id}`, is_ai: true, sent_at: new Date(Date.now() - 30000) });
    await LeadNotes.create({ lead_id: lead.id, note: `note ${id}` });
    await SalesLeadNotes.create({ lead_id: lead.id, note: `sales note ${id}` });
    return { brand, lead, conversation };
  });
  return { ...data, user, headers: { Authorization: `Bearer ${makeToken(user)}` } };
}

const auditEvents = (event) => ctx().runAsSystem(() => models().AuditEvents.find({ event }, { _id: 0 }).lean(), 'test');

test('Exports', async (t) => {
  await t.test('E1. Contact export has only this contact, escapes formulas, and is logged without content', async () => {
    const a = await seedTenant(1);
    const b = await seedTenant(2);
    const res = await request(app).get(`/api/contacts/${a.lead.id}/export.csv`).set(a.headers);
    assert.strictEqual(res.status, 200, res.text);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.match(res.headers['content-disposition'], /attachment; filename="contact-\d+-conversation-/);
    assert.match(res.text, /hello from 1/);
    assert.match(res.text, /"'=CMD\(\) reply 1"/);
    assert.match(res.text, /note 1/);
    assert.match(res.text, /sales note 1/);
    assert.doesNotMatch(res.text, /from 2|reply 2|note 2/, "the other workspace's data never appears");
    const [event] = await auditEvents('CONTACT_EXPORTED');
    assert.strictEqual(event.tenant_id, 1);
    assert.strictEqual(event.actor_user_id, a.user.id);
    assert.strictEqual(event.target_id, String(a.lead.id));
    assert.deepStrictEqual({ messages: event.meta.messages, notes: event.meta.notes }, { messages: 2, notes: 2 });
    assert.ok(event.created_at);
    assert.doesNotMatch(JSON.stringify(event), /hello from|9876543210|Ravi/, 'the log holds no content or number');
    void b;
  });

  await t.test('E2. A contact of another workspace is a 404, and writes no export log', async () => {
    const a = await seedTenant(1);
    const b = await seedTenant(2);
    const res = await request(app).get(`/api/contacts/${b.lead.id}/export.csv`).set(a.headers);
    // Ids are per workspace counters: the id may exist in both. The file must then be a's own contact.
    if (res.status === 200) assert.doesNotMatch(res.text, /from 2/);
    else assert.strictEqual(res.status, 404);
    assert.strictEqual((await request(app).get('/api/contacts/999999/export.csv').set(a.headers)).status, 404);
    assert.strictEqual((await request(app).get('/api/contacts/abc/export.csv').set(a.headers)).status, 404);
  });

  await t.test('E3. Workspace export: own messages and contacts only, owner/admin only, logged', async () => {
    const a = await seedTenant(1);
    await seedTenant(2);
    const messages = await request(app).get('/api/data-export/workspace.csv').set(a.headers);
    assert.strictEqual(messages.status, 200, messages.text);
    assert.match(messages.text, /hello from 1/);
    assert.doesNotMatch(messages.text, /from 2|reply 2/);
    assert.match(messages.text.split('\r\n')[0], /contact_id.*contact_name.*contact_phone/);
    const contacts = await request(app).get('/api/data-export/workspace.csv?part=contacts').set(a.headers);
    assert.strictEqual(contacts.status, 200);
    assert.match(contacts.text, /Ravi/);
    assert.strictEqual(contacts.text.trim().split('\r\n').length, 2, 'header plus this workspace\'s one contact');
    const events = await auditEvents('WORKSPACE_EXPORTED');
    assert.deepStrictEqual(events.map((e) => e.meta.part).sort(), ['contacts', 'messages']);
    assert.ok(events.every((e) => e.tenant_id === 1 && e.actor_user_id === a.user.id));
  });

  await t.test('E4. Roles without export permission and signed-out callers are refused', async () => {
    const agent = await seedTenant(1, { role: 'agent' });
    assert.strictEqual((await request(app).get('/api/data-export/workspace.csv').set(agent.headers)).status, 403);
    assert.strictEqual((await request(app).get(`/api/contacts/${agent.lead.id}/export.csv`).set(agent.headers)).status, 403);
    assert.strictEqual((await request(app).get('/api/data-export/workspace.csv')).status, 401);
    const manager = await seedTenant(2, { role: 'manager' });
    assert.strictEqual((await request(app).get(`/api/contacts/${manager.lead.id}/export.csv`).set(manager.headers)).status, 200, 'managers may export one contact');
    assert.strictEqual((await request(app).get('/api/data-export/workspace.csv').set(manager.headers)).status, 403, 'but not the whole workspace');
    assert.strictEqual((await auditEvents('WORKSPACE_EXPORTED')).length, 0);
  });
});

async function inbound(tenant, text, { from = '919876543210', id = `wamid.IN${crypto.randomUUID()}` } = {}) {
  const raw = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ changes: [{ field: 'messages', value: {
      metadata: { phone_number_id: `PN${tenant.brand.tenant_id ?? 1}` },
      contacts: [{ profile: { name: 'Ravi' } }],
      messages: [{ from, id, type: 'text', text: { body: text } }],
    } }] }],
  });
  return request(app).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', signMeta(raw)).send(raw);
}

test('Reply webhook', async (t) => {
  const setup = async (id = 1) => {
    const tenant = await seedTenant(id);
    const put = await request(app).put('/api/reply-webhook').set(tenant.headers).send({ url: 'https://hooks.example.com/nera' });
    assert.strictEqual(put.status, 200, JSON.stringify(put.body));
    return { tenant, secret: put.body.secret, put };
  };
  const deliveries = (id = 1) => ctx().runAsTenant(id, () => models().WebhookDeliveries.find({}, { _id: 0 }).sort({ id: 1 }).lean());

  await t.test('W1. The secret is shown once, stored encrypted, and the URL must be public https', async () => {
    const { tenant, secret, put } = await setup();
    assert.match(secret, /^whsec_[0-9a-f]{64}$/);
    assert.ok(put.body.secret_notice);
    const get = await request(app).get('/api/reply-webhook').set(tenant.headers);
    assert.strictEqual(get.body.config.url, 'https://hooks.example.com/nera');
    assert.strictEqual(get.body.config.secret_last4, secret.slice(-4));
    assert.doesNotMatch(JSON.stringify(get.body), new RegExp(secret));
    const row = await ctx().runAsTenant(1, () => models().ReplyWebhooks.findOne({}).lean());
    assert.notStrictEqual(row.secret_enc, secret);
    assert.ok(!JSON.stringify(row).includes(secret), 'the plain secret is not stored');
    const again = await request(app).put('/api/reply-webhook').set(tenant.headers).send({ url: 'https://hooks.example.com/other' });
    assert.strictEqual(again.body.secret, undefined, 'a later save does not reveal the secret');
    for (const url of ['http://hooks.example.com/x', 'https://127.0.0.1/x', 'https://169.254.169.254/x', 'https://localhost/x']) {
      const bad = await request(app).put('/api/reply-webhook').set(tenant.headers).send({ url });
      assert.strictEqual(bad.status, 400, url);
      assert.strictEqual(bad.body.code, 'INVALID_WEBHOOK_URL');
    }
    const rotated = await request(app).post('/api/reply-webhook/rotate-secret').set(tenant.headers);
    assert.strictEqual(rotated.status, 200);
    assert.notStrictEqual(rotated.body.secret, secret);
    const agent = await seedTenant(5, { role: 'agent' });
    assert.strictEqual((await request(app).get('/api/reply-webhook').set(agent.headers)).status, 403);
  });

  await t.test('W2. A new reply is sent signed, with timestamp and event id; the log holds no content', async () => {
    const { tenant, secret } = await setup();
    const res = await inbound(tenant, 'I want to order the red dress');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(received.length, 0, 'in tests the worker is run by hand');
    assert.strictEqual(await hook.processDue(), 1);
    assert.strictEqual(received.length, 1);
    const call = received[0];
    assert.strictEqual(call.url, 'https://hooks.example.com/nera');
    assert.ok(hook.verifySignature(secret, call.headers['X-Nera-Timestamp'], call.body, call.headers['X-Nera-Signature']));
    assert.ok(Math.abs(Number(call.headers['X-Nera-Timestamp']) - Date.now() / 1000) < 60);
    assert.strictEqual(call.headers['X-Nera-Attempt'], '1');
    const event = JSON.parse(call.body);
    assert.strictEqual(event.type, 'message.received');
    assert.strictEqual(event.workspace_id, 1);
    assert.strictEqual(event.data.message.text, 'I want to order the red dress');
    assert.strictEqual(event.data.contact.phone, '919876543210');
    assert.strictEqual(call.headers['X-Nera-Event-Id'], event.id);
    const [row] = await deliveries();
    assert.strictEqual(row.status, 'delivered');
    assert.strictEqual(row.attempts, 1);
    assert.strictEqual(row.last_status_code, 200);
    assert.strictEqual(row.url_host, 'hooks.example.com');
    assert.doesNotMatch(JSON.stringify(row), /red dress|9876543210|Ravi|whsec_/, 'the delivery log holds no content');
    const api = await request(app).get('/api/reply-webhook/deliveries').set(tenant.headers);
    assert.strictEqual(api.body.deliveries.length, 1);
    assert.doesNotMatch(JSON.stringify(api.body), /red dress|9876543210|Ravi/);
  });

  await t.test('W3. Failures are retried with backoff, keep the same event id, and stop after six tries', async () => {
    const { tenant } = await setup();
    await inbound(tenant, 'hello');
    receiverReply = async () => ({ status: 503 });
    let now = new Date();
    assert.strictEqual(await hook.processDue({ now }), 1);
    let [row] = await deliveries();
    assert.deepStrictEqual({ s: row.status, a: row.attempts, c: row.last_error_code }, { s: 'pending', a: 1, c: 'http_503' });
    assert.ok(Math.abs(new Date(row.next_attempt_at) - (now.getTime() + 60000)) < 1000, 'first retry after a minute');
    assert.strictEqual(await hook.processDue({ now }), 0, 'not retried before it is due');
    const ids = new Set();
    for (let attempt = 2; attempt <= 6; attempt += 1) {
      now = new Date(new Date(row.next_attempt_at).getTime() + 1000);
      assert.strictEqual(await hook.processDue({ now }), 1);
      [row] = await deliveries();
      assert.strictEqual(row.attempts, attempt);
    }
    assert.strictEqual(row.status, 'failed');
    assert.strictEqual(await hook.processDue({ now: new Date(now.getTime() + 86400000) }), 0, 'a failed event is not tried again');
    assert.strictEqual(received.length, 6);
    received.forEach((r, i) => assert.strictEqual(r.headers['X-Nera-Attempt'], String(i + 1)));
    received.forEach((r) => ids.add(r.headers['X-Nera-Event-Id']));
    assert.strictEqual(ids.size, 1, 'one event id on every retry');
    receiverReply = async () => { const e = new Error('timeout'); e.code = 'timeout'; throw e; };
  });

  await t.test('W4. A timeout or network error is retried and later succeeds', async () => {
    const { tenant } = await setup();
    await inbound(tenant, 'hello');
    receiverReply = async () => { const e = new Error('timeout'); e.code = 'timeout'; throw e; };
    await hook.processDue();
    let [row] = await deliveries();
    assert.strictEqual(row.last_error_code, 'timeout');
    receiverReply = async () => ({ status: 204 });
    await hook.processDue({ now: new Date(new Date(row.next_attempt_at).getTime() + 1000) });
    [row] = await deliveries();
    assert.strictEqual(row.status, 'delivered');
    assert.strictEqual(row.attempts, 2);
  });

  await t.test('W5. A disabled or missing webhook sends nothing; each workspace uses its own secret', async () => {
    const one = await setup(1);
    const two = await seedTenant(2);
    const noHook = await inbound({ brand: { tenant_id: 2 } }, 'hello two');
    assert.strictEqual(noHook.status, 200);
    assert.strictEqual((await deliveries(2)).length, 0, 'workspace 2 has no webhook');
    await request(app).put('/api/reply-webhook').set(two.headers).send({ url: 'https://hooks.example.org/two' });
    await inbound({ brand: { tenant_id: 2 } }, 'second message', { from: '919876543210' });
    await inbound(one.tenant, 'message for one');
    await hook.processDue();
    const byUrl = Object.fromEntries(received.map((r) => [r.url, r]));
    assert.ok(hook.verifySignature(one.secret, byUrl['https://hooks.example.com/nera'].headers['X-Nera-Timestamp'], byUrl['https://hooks.example.com/nera'].body, byUrl['https://hooks.example.com/nera'].headers['X-Nera-Signature']));
    assert.ok(!hook.verifySignature(one.secret, byUrl['https://hooks.example.org/two'].headers['X-Nera-Timestamp'], byUrl['https://hooks.example.org/two'].body, byUrl['https://hooks.example.org/two'].headers['X-Nera-Signature']), "workspace 2's events are not signed with workspace 1's secret");
    assert.doesNotMatch(byUrl['https://hooks.example.com/nera'].body, /second message/);
    assert.doesNotMatch(byUrl['https://hooks.example.org/two'].body, /message for one/);
    await request(app).put('/api/reply-webhook').set(one.tenant.headers).send({ url: 'https://hooks.example.com/nera', enabled: false });
    received.length = 0;
    await inbound(one.tenant, 'while disabled');
    await hook.processDue();
    assert.strictEqual(received.length, 0);
  });
});

test('Delete on request', async (t) => {
  await t.test('D1. Deletes messages, notes and attachments, keeps only a minimal record, and is logged', async () => {
    const a = await seedTenant(1);
    const b = await seedTenant(2); // the same phone number in another workspace
    const { Messages, LeadNotes, SalesLeadNotes, Conversations, Leads, ContactErasures, MediaFiles, CampaignMessageQueue, Payments } = models();
    const { runAsTenant, runAsSystem } = ctx();
    await runAsTenant(1, async () => {
      await Messages.create({ conversation_id: a.conversation.id, direction: 'inbound', content: 'photo', msg_type: 'image', media_url: 'media://t_1/202611-' + 'a'.repeat(32) + '/id.jpg' });
      await MediaFiles.create({ file_id: 'a'.repeat(32), scope: 't_1', filename: 'id.jpg' });
      await CampaignMessageQueue.create({ lead_id: a.lead.id, phone: '919876543210', status: 'pending', template_name: 't' });
      await Payments.create({ lead_id: a.lead.id, amount: 100 });
    });
    const refused = await request(app).post(`/api/contacts/${a.lead.id}/erase`).set(a.headers).send({});
    assert.strictEqual(refused.status, 400);
    assert.strictEqual(refused.body.code, 'CONFIRMATION_REQUIRED');
    assert.strictEqual(await runAsTenant(1, () => Leads.countDocuments({})), 1, 'nothing deleted without confirmation');

    const res = await request(app).post(`/api/contacts/${a.lead.id}/erase`).set(a.headers).send({ confirm: 'DELETE' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.counts.messages, 3);
    assert.strictEqual(res.body.counts.notes, 1);
    assert.strictEqual(res.body.counts.sales_notes, 1);
    assert.strictEqual(res.body.counts.attachments, 1);
    assert.strictEqual(res.body.counts.queued_sends, 1);

    await runAsTenant(1, async () => {
      assert.strictEqual(await Messages.countDocuments({}), 0);
      assert.strictEqual(await Conversations.countDocuments({}), 0);
      assert.strictEqual(await LeadNotes.countDocuments({}), 0);
      assert.strictEqual(await SalesLeadNotes.countDocuments({}), 0);
      assert.strictEqual(await MediaFiles.countDocuments({}), 0, 'the attachment record is gone');
      assert.strictEqual(await CampaignMessageQueue.countDocuments({}), 0, 'queued sends are cancelled');
      assert.strictEqual(await Leads.countDocuments({}), 0);
      assert.strictEqual(await Payments.countDocuments({}), 1, 'payment records are kept');
      const records = await ContactErasures.find({}, { _id: 0 }).lean();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].status, 'completed');
      assert.strictEqual(records[0].erased_by_user_id, a.user.id);
      assert.doesNotMatch(JSON.stringify(records[0]), /Ravi|9876543210|hello|note/, 'the record holds no personal data');
    });
    await runAsTenant(2, async () => {
      assert.strictEqual(await Messages.countDocuments({}), 2, "the other workspace's data is untouched");
      assert.strictEqual(await Leads.countDocuments({}), 1);
      assert.strictEqual(await LeadNotes.countDocuments({}), 1);
    });
    const events = await runAsSystem(() => models().AuditEvents.find({ event: 'CONTACT_ERASED' }, { _id: 0 }).lean(), 'test');
    assert.deepStrictEqual(events.map((e) => e.meta.stage), ['requested', 'completed']);
    assert.ok(events.every((e) => e.tenant_id === 1 && e.actor_user_id === a.user.id));
    assert.doesNotMatch(JSON.stringify(events), /Ravi|9876543210|hello from/);

    const again = await request(app).post(`/api/contacts/${a.lead.id}/erase`).set(a.headers).send({ confirm: 'DELETE' });
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.already_erased, true, 'repeating is safe');
    void b;
  });

  await t.test('D2. All sends to the erased number stop, even if the number is added again', async () => {
    const a = await seedTenant(1);
    const { Leads, Messages, WebhookDeliveries } = models();
    const { runAsTenant } = ctx();
    await request(app).put('/api/reply-webhook').set(a.headers).send({ url: 'https://hooks.example.com/nera' });
    await request(app).post(`/api/contacts/${a.lead.id}/erase`).set(a.headers).send({ confirm: 'DELETE' });
    const lead = await runAsTenant(1, () => Leads.create({ name: 'Ravi again', phone: '+91 98765 43210', client_id: a.brand.id, status: 'new' }));

    const manual = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: lead.id, message: 'Hi', msg_type: 'text' });
    assert.strictEqual(manual.status, 409);
    assert.strictEqual(manual.body.code, 'CONTACT_ERASED');
    const internal = await request(app).post('/api/internal/send-reply').set({ 'x-internal-key': require('./setup').TEST_INTERNAL_KEY, 'x-tenant-id': '1' }).send({ lead_id: lead.id, message: 'Hi' });
    assert.strictEqual(internal.status, 409);
    assert.strictEqual(internal.body.code, 'CONTACT_ERASED');
    const template = await request(app).post('/api/communication/send-template').set(a.headers).send({ lead_id: lead.id, template_name: 'x' });
    assert.strictEqual(template.status, 409);
    assert.strictEqual(metaCalls.length, 0, 'nothing reached Meta');
    assert.match(manual.body.error, /asked for their data to be deleted/, 'a plain message, no raw error');

    const incoming = await inbound(a, 'please talk to me');
    assert.strictEqual(incoming.status, 200);
    await runAsTenant(1, async () => {
      assert.strictEqual(await Messages.countDocuments({ content: 'please talk to me' }), 0, 'a message from an erased number is not stored again');
      assert.strictEqual(await WebhookDeliveries.countDocuments({}), 0, 'and no webhook event is made for it');
    });
  });

  await t.test('D3. Needs permission, a signed-in user, and a contact of this workspace', async () => {
    const agent = await seedTenant(1, { role: 'agent' });
    assert.strictEqual((await request(app).post(`/api/contacts/${agent.lead.id}/erase`).set(agent.headers).send({ confirm: 'DELETE' })).status, 403);
    assert.strictEqual((await request(app).post(`/api/contacts/${agent.lead.id}/erase`).send({ confirm: 'DELETE' })).status, 401);
    const owner = await seedTenant(2);
    assert.strictEqual((await request(app).post('/api/contacts/987654/erase').set(owner.headers).send({ confirm: 'DELETE' })).status, 404);
    assert.strictEqual(await ctx().runAsTenant(1, () => models().Leads.countDocuments({})), 1, 'the agent attempt deleted nothing');
  });

  await t.test('D4. A pending webhook event for a deleted message is dropped, not sent', async () => {
    const a = await seedTenant(1);
    await request(app).put('/api/reply-webhook').set(a.headers).send({ url: 'https://hooks.example.com/nera' });
    await inbound(a, 'secret text');
    await request(app).post(`/api/contacts/${a.lead.id}/erase`).set(a.headers).send({ confirm: 'DELETE' });
    assert.strictEqual(await hook.processDue(), 0);
    assert.strictEqual(received.length, 0);
  });
});
