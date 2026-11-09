/**
 * Slice S1: signed webhooks everywhere, no global WhatsApp credentials, no raw
 * payload on disk, Alliance relay fails closed.
 *
 *  - every Meta-facing POST webhook refuses missing / wrong signatures and
 *    fails closed (503) when NERA_META_APP_SECRET is unset
 *  - a brand without credentials gets a clear 409 and nothing is sent, even
 *    when the legacy META_PAGE_ACCESS_TOKEN / WA_PHONE_NUMBER_ID are set
 *  - owner notifications use the named NERA_FOUNDER_NOTIFY_* settings only
 *  - tokens are stored encrypted (AES-256-GCM) and never returned
 *  - verified webhooks write nothing under uploads/
 *  - the Alliance relay refuses everything without INTERNAL_API_KEY
 *  - the Mafiya cron does not start when jobs are off or the module is disabled
 * In-memory MongoDB, synthetic data, every outbound HTTP call recorded; no
 * real Meta call is made.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY, TEST_TOKEN_KEY } = require('./setup');

const SECRET = 'test-dummy-webhook-secret';
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
const SERVER_ROOT = path.join(__dirname, '..');
const UPLOAD_LOGS = ['incoming_payloads.log', 'audio_error.txt', 'media_upload.log'].map((f) => path.join(SERVER_ROOT, 'uploads', f));

// Legacy single-business settings are deliberately SET for the whole file:
// any remaining fallback to them would show up as an outbound call.
const LEGACY = {
  META_PAGE_ACCESS_TOKEN: 'test-dummy-legacy-page-token',
  WA_PHONE_NUMBER_ID: 'ENV_LEGACY_PN',
  META_SYSTEM_USER_ACCESS_TOKEN: 'test-dummy-legacy-system-token',
  WA_BUSINESS_ACCOUNT_ID: 'ENV_LEGACY_WABA',
};
const FOUNDER_ENV = ['NERA_FOUNDER_NOTIFY_PHONE_NUMBER_ID', 'NERA_FOUNDER_NOTIFY_ACCESS_TOKEN', 'NERA_FOUNDER_NOTIFY_TO'];

// Every outbound HTTP request from any axios instance is recorded. Graph calls
// get a synthetic success so send paths can be followed to the end.
const outbound = [];
const realRequest = axiosModule.Axios.prototype.request;
const headerOf = (headers, name) => {
  if (!headers) return undefined;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] ?? headers[name.toLowerCase()];
};

let app;

test.before(async () => {
  process.env.WA_VERIFY_TOKEN = 'test_verify_token';
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  delete process.env.DISABLED_MODULES;
  delete process.env.N8N_WEBHOOK_URL;
  delete process.env.N8N_NEW_LEAD_WEBHOOK_URL;
  delete process.env.ALLIANCE_WA_PHONE_NUMBER_ID;
  Object.assign(process.env, LEGACY);
  for (const name of FOUNDER_ENV) delete process.env[name];
  axiosModule.Axios.prototype.request = async function recordOutbound(config) {
    const url = String(typeof config === 'string' ? config : `${config?.baseURL || ''}${config?.url || ''}`);
    let data = config?.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch (_) { /* keep raw */ } }
    outbound.push({ url, method: String(config?.method || 'get').toLowerCase(), auth: headerOf(config?.headers, 'Authorization'), data });
    if (/^https:\/\/graph\.facebook\.com\//.test(url)) return { status: 200, data: { messages: [{ id: 'wamid.S1' }] }, headers: {}, config };
    throw new Error(`outbound HTTP blocked in test: ${url}`);
  };
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  outbound.length = 0;
  process.env.NERA_META_APP_SECRET = SECRET;
  process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;
  Object.assign(process.env, LEGACY);
  for (const name of FOUNDER_ENV) delete process.env[name];
  for (const file of UPLOAD_LOGS) { try { fs.unlinkSync(file); } catch (_) { /* absent */ } }
});

const graphCalls = () => outbound.filter((o) => /graph\.facebook\.com/.test(o.url));

test('Slice S1: signed webhooks, tenant credentials only, no payload on disk, Alliance fail-closed', async (t) => {
  const models = require('../models');
  const { Tenants, Clients, Leads, Users, Templates, FailedWebhooks, CampaignMessageQueue } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { sanitizeClient, decryptToken, encryptToken } = require('../services/clientSecrets');

  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });
  const postRaw = (url, raw, headers = {}) => {
    let req = request(app).post(url).set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(raw);
  };

  // Tenant 1: brand without WhatsApp. Tenant 2: brand with its own verified number.
  async function seed() {
    await runAsSystem(() => Tenants.create([{ id: 1, name: 'Bare Workspace', status: 'active' }, { id: 2, name: 'Connected Workspace', status: 'active' }]), 'test');
    const bare = (await runAsTenant(1, () => Clients.create({ name: 'Bare Brand' }))).toObject();
    const bareLead = (await runAsTenant(1, () => Leads.create({ name: 'Meena', phone: '919000000001', client_id: bare.id, status: 'new' }))).toObject();
    const connected = (await runAsTenant(2, () => Clients.create({
      name: 'Connected Brand', phone_number_id: 'PN_CONNECTED', wa_business_id: 'WABA_CONNECTED',
      whatsapp_number: '+919876543210', whatsapp_status: 'verified', wa_access_token: 'test-dummy-brand-token',
    }))).toObject();
    const connectedLead = (await runAsTenant(2, () => Leads.create({ name: 'Ravi', phone: '919000000002', client_id: connected.id, status: 'new' }))).toObject();
    const [owner1, owner2] = (await runAsSystem(() => Users.create([
      { tenant_id: 1, role: 'owner', email: 'owner1@s1.test', name: 'Owner One', is_active: true, token_version: 0 },
      { tenant_id: 2, role: 'owner', email: 'owner2@s1.test', name: 'Owner Two', is_active: true, token_version: 0 },
    ]), 'test')).map((u) => u.toObject());
    return { bare, bareLead, connected, connectedLead, owner1, owner2 };
  }

  const whatsappPayload = (phoneNumberId, from = '919111222333') => JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA_X', changes: [{ field: 'messages', value: {
      messaging_product: 'whatsapp',
      metadata: { display_phone_number: '919876543210', phone_number_id: phoneNumberId },
      contacts: [{ profile: { name: 'Synthetic Customer' }, wa_id: from }],
      messages: [{ from, id: `wamid.${crypto.randomUUID()}`, timestamp: '1700000000', text: { body: 'Hello' }, type: 'text' }],
    } }] }],
  });

  // ── Item 1: every Meta-facing POST webhook is signature-checked ──
  for (const [url, raw] of [
    ['/webhook/meta-leads', JSON.stringify({ object: 'page', entry: [] })],
  ]) {
    await t.test(`S1. ${url}: missing, malformed and wrong signatures are refused; a valid one is accepted`, async () => {
      assert.strictEqual((await postRaw(url, raw)).status, 401, 'missing signature');
      assert.strictEqual((await postRaw(url, raw, { 'X-Hub-Signature-256': 'sha256=nothex' })).status, 401, 'malformed');
      assert.strictEqual((await postRaw(url, raw, { 'X-Hub-Signature-256': sign(raw, 'another-secret') })).status, 401, 'wrong secret');
      assert.strictEqual((await postRaw(url, raw, { 'X-Hub-Signature-256': sign(raw) })).status, 200, 'valid');
      assert.strictEqual((await postRaw(url, JSON.stringify({ object: 'page', entry: [], x: 1 }), { 'X-Hub-Signature-256': sign(raw) })).status, 401, 'modified body');
      assert.strictEqual(await runAsSystem(() => FailedWebhooks.countDocuments({})), 0);
      assert.strictEqual(outbound.length, 0);
    });

    await t.test(`S2. ${url}: unset NERA_META_APP_SECRET fails closed with 503, no fallback to other secrets`, async () => {
      delete process.env.NERA_META_APP_SECRET;
      process.env.META_APP_SECRET = 'legacy-secret';
      try {
        const res = await postRaw(url, raw, { 'X-Hub-Signature-256': sign(raw, 'legacy-secret') });
        assert.strictEqual(res.status, 503);
        assert.strictEqual(res.body.code, 'WEBHOOK_SECRET_NOT_CONFIGURED');
      } finally {
        delete process.env.META_APP_SECRET;
      }
    });
  }

  // ── Item 11: a verified WhatsApp webhook writes nothing under uploads/ ──
  await t.test('S3. A verified WhatsApp webhook is processed and no payload or error file is written to disk', async () => {
    const { connected } = await seed();
    const raw = whatsappPayload(connected.phone_number_id);
    const res = await postRaw('/webhook/whatsapp', raw, { 'X-Hub-Signature-256': sign(raw) });
    assert.strictEqual(res.status, 200);
    const lead = await runAsTenant(2, () => Leads.findOne({ phone: '919111222333' }).lean());
    assert.ok(lead, 'lead created in the brand\'s tenant');
    for (const file of UPLOAD_LOGS) assert.ok(!fs.existsSync(file), `${path.basename(file)} must not be written`);
    const webhookSource = fs.readFileSync(path.join(SERVER_ROOT, 'routes', 'leados', 'webhook-whatsapp.js'), 'utf8');
    const sendSource = fs.readFileSync(path.join(SERVER_ROOT, 'routes', 'leados', 'whatsapp.js'), 'utf8');
    assert.ok(!/incoming_payloads\.log|audio_error\.txt/.test(webhookSource), 'no payload or error file in the webhook route');
    assert.ok(!/media_upload\.log/.test(sendSource), 'no media log in the send route');
  });

  // ── Item 2: the environment phone number is not a managed number ──
  await t.test('S4. A webhook for the legacy WA_PHONE_NUMBER_ID is ignored: no brand owns it, so nothing is stored', async () => {
    await seed();
    const raw = whatsappPayload(LEGACY.WA_PHONE_NUMBER_ID, '919111222444');
    const res = await postRaw('/webhook/whatsapp', raw, { 'X-Hub-Signature-256': sign(raw) });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await runAsSystem(() => Leads.countDocuments({ phone: '919111222444' })), 0);
    assert.strictEqual(outbound.length, 0);
  });

  // ── Item 2: AI follow-up text uses the brand's own credentials or refuses ──
  await t.test('S5. /api/ai/followup: a brand without WhatsApp gets 409 and no call; a connected brand sends with its own token', async () => {
    const { bareLead, connectedLead, owner1, owner2 } = await seed();
    const refused = await request(app).post('/api/ai/followup').set(bearer(owner1)).send({ lead_id: bareLead.id, prompt: 'Follow up politely' });
    assert.strictEqual(refused.status, 409, JSON.stringify(refused.body));
    assert.strictEqual(refused.body.code, 'WHATSAPP_NOT_CONNECTED');
    assert.strictEqual(graphCalls().length, 0, 'no call with the legacy token');

    // The follow-up engine only writes after an outbound message that the customer has not answered.
    const conversation = (await runAsTenant(2, () => models.Conversations.create({ lead_id: connectedLead.id, phone: '919000000002', status: 'open', last_message: 'Hello Ravi', last_message_at: new Date() }))).toObject();
    await runAsTenant(2, () => models.Messages.create({ conversation_id: conversation.id, direction: 'outbound', content: 'Hello Ravi', msg_type: 'text', status: 'sent', is_ai: false, sent_at: new Date() }));
    // Follow-up nudges are marketing (send policy): the contact must have opted in and written within 24 hours.
    await runAsTenant(2, () => require('../services/consent').recordOptIn({ leadId: connectedLead.id, source: 'test_fixture' }));
    await runAsTenant(2, () => models.Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'ok', msg_type: 'text', status: 'delivered', sent_at: new Date(Date.now() - 1000) }));
    const sent = await request(app).post('/api/ai/followup').set(bearer(owner2)).send({ lead_id: connectedLead.id, prompt: 'Follow up politely' });
    assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
    const calls = graphCalls();
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/PN_CONNECTED\/messages$/);
    assert.strictEqual(calls[0].auth, 'Bearer test-dummy-brand-token');
    assert.strictEqual(calls[0].data.to, '919000000002');
    assert.ok(!JSON.stringify(sent.body).includes('test-dummy-brand-token'), 'token never returned');
  });

  // ── Item 2: template media upload and status sync never use a shared token ──
  await t.test('S6. Template media upload without a brand token is refused (no legacy token) and the upload is discarded', async () => {
    const { bare, owner1 } = await seed();
    const noClient = await request(app).post('/api/templates/upload-media').set(bearer(owner1)).attach('file', Buffer.from('png-bytes'), { filename: 'a.png', contentType: 'image/png' });
    assert.strictEqual(noClient.status, 409, JSON.stringify(noClient.body));
    const bareClient = await request(app).post('/api/templates/upload-media').set(bearer(owner1)).field('client_id', String(bare.id)).attach('file', Buffer.from('png-bytes'), { filename: 'b.png', contentType: 'image/png' });
    assert.strictEqual(bareClient.status, 409, JSON.stringify(bareClient.body));
    assert.strictEqual(bareClient.body.code, 'WHATSAPP_NOT_CONNECTED');
    assert.strictEqual(outbound.length, 0, 'no Graph call with META_PAGE_ACCESS_TOKEN');
  });

  await t.test('S7. Template status sync for an "alliance"-scoped template no longer uses the shared system token', async () => {
    const { owner1 } = await seed();
    const tpl = (await runAsTenant(1, () => Templates.create({ name: 'shared_tpl', body: 'Hi', language: 'en', status: 'pending', meta_template_id: '123456', template_scope: 'alliance', client_id: null }))).toObject();
    const res = await request(app).get(`/api/templates/${tpl.id}/sync`).set(bearer(owner1));
    assert.strictEqual(res.status, 409, JSON.stringify(res.body));
    assert.strictEqual(res.body.code, 'WHATSAPP_NOT_CONNECTED');
    assert.strictEqual(outbound.length, 0, 'META_SYSTEM_USER_ACCESS_TOKEN was not used');
  });

  // ── Item 2: owner notifications use the named internal configuration only ──
  await t.test('S8. Founder report and staff alert: unconfigured means not sent with a reason; configured sends with NERA_FOUNDER_NOTIFY_* only', async () => {
    await seed();
    const report = await request(app).post('/api/communication/send-founder').set(service(1)).send({ channel: 'whatsapp', type: 'daily', content: 'Synthetic founder report' });
    assert.strictEqual(report.status, 200, JSON.stringify(report.body));
    assert.strictEqual(report.body.delivered, false);
    assert.strictEqual(report.body.reason, 'NOT_CONFIGURED');
    assert.deepStrictEqual(report.body.missing, FOUNDER_ENV);
    const alert = await request(app).post('/api/communication/notify-staff').set(service(1)).send({ phone: '+91 90000 00009', content: 'Synthetic alert', label: 'hot lead' });
    assert.strictEqual(alert.status, 200, JSON.stringify(alert.body));
    assert.strictEqual(alert.body.delivered, false);
    assert.deepStrictEqual(alert.body.missing, FOUNDER_ENV.slice(0, 2), 'an explicit phone only needs the sender settings');
    assert.strictEqual(outbound.length, 0, 'legacy META_PAGE_ACCESS_TOKEN / WA_PHONE_NUMBER_ID are never used');

    process.env.NERA_FOUNDER_NOTIFY_PHONE_NUMBER_ID = 'FOUNDER_PN';
    process.env.NERA_FOUNDER_NOTIFY_ACCESS_TOKEN = 'test-dummy-founder-token';
    process.env.NERA_FOUNDER_NOTIFY_TO = '+91 90000 00000';
    const delivered = await request(app).post('/api/communication/send-founder').set(service(1)).send({ channel: 'whatsapp', type: 'daily', content: 'Synthetic founder report' });
    assert.strictEqual(delivered.status, 200, JSON.stringify(delivered.body));
    assert.strictEqual(delivered.body.delivered, true);
    assert.strictEqual(delivered.body.wa_msg_id, 'wamid.S1');
    const calls = graphCalls();
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /\/FOUNDER_PN\/messages$/);
    assert.strictEqual(calls[0].auth, 'Bearer test-dummy-founder-token');
    assert.strictEqual(calls[0].data.to, '919000000000');
    assert.ok(!JSON.stringify(delivered.body).includes('test-dummy-founder-token'));
  });

  // ── Item 2: credentials encrypted at rest ──
  await t.test('S9. The brand token is stored only as AES-256-GCM ciphertext, decrypted on read, stripped from responses, unreadable with another key', async () => {
    await runAsSystem(() => Tenants.create({ id: 9, name: 'Crypto Workspace', status: 'active' }), 'test');
    const PLAIN = 'test-dummy-plain-token-ABCD';
    const brand = (await runAsTenant(9, () => Clients.create({ name: 'Crypto Brand', phone_number_id: 'PN_9', wa_access_token: PLAIN }))).toObject();

    const raw = await mongoose.connection.collection('clients').findOne({ id: brand.id });
    assert.strictEqual(raw.wa_access_token, undefined, 'no plain-text column');
    assert.match(raw.wa_access_token_enc, /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/, 'iv:authTag:ciphertext');
    assert.ok(!raw.wa_access_token_enc.includes(PLAIN));
    assert.strictEqual(raw.wa_token_last4, 'ABCD');

    const viaModel = await runAsTenant(9, () => Clients.findOne({ id: brand.id }, { wa_access_token: 1 }).lean());
    assert.strictEqual(viaModel.wa_access_token, PLAIN, 'the model decrypts for server code');
    assert.strictEqual(viaModel.wa_access_token_enc, undefined);

    const safe = sanitizeClient(await runAsTenant(9, () => Clients.findOne({ id: brand.id }).lean()));
    assert.strictEqual(safe.wa_access_token, undefined);
    assert.strictEqual(safe.wa_access_token_enc, undefined);
    assert.strictEqual(safe.wa_token_configured, true);
    assert.strictEqual(safe.wa_token_last4, 'ABCD');

    assert.strictEqual(decryptToken(encryptToken(PLAIN).wa_access_token_enc), PLAIN, 'round trip');
    process.env.TOKEN_ENCRYPTION_KEY = 'a-different-key-used-only-in-this-test-0000';
    try {
      assert.strictEqual(decryptToken(raw.wa_access_token_enc), null, 'another key cannot read it');
    } finally {
      process.env.TOKEN_ENCRYPTION_KEY = TEST_TOKEN_KEY;
    }

    await runAsTenant(9, () => Clients.updateOne({ id: brand.id }, { $set: { wa_access_token: 'test-dummy-rotated-WXYZ' } }));
    const rotated = await mongoose.connection.collection('clients').findOne({ id: brand.id });
    assert.strictEqual(rotated.wa_access_token, undefined);
    assert.notStrictEqual(rotated.wa_access_token_enc, raw.wa_access_token_enc);
    assert.strictEqual(rotated.wa_token_last4, 'WXYZ');
    assert.strictEqual(CampaignMessageQueue.schema.path('wa_token'), undefined, 'queue rows can no longer carry a token');
  });

  // ── Item 11: Alliance relay fails closed ──
  await t.test('S10. The Alliance webhook relay refuses every call without a matching INTERNAL_API_KEY, including when the key is unset', async () => {
    const body = { object: 'whatsapp_business_account', entry: [] };
    assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').send(body)).status, 401, 'no header');
    assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').set('x-internal-key', 'wrong').send(body)).status, 401, 'wrong key');
    assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').set('x-internal-key', TEST_INTERNAL_KEY).send(body)).status, 200, 'right key');
    delete process.env.INTERNAL_API_KEY;
    try {
      assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').send(body)).status, 401, 'unset key, no header');
      assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').set('x-internal-key', '').send(body)).status, 401, 'unset key, empty header');
      assert.strictEqual((await request(app).post('/api/alliance-inbox/webhook').set('x-internal-key', TEST_INTERNAL_KEY).send(body)).status, 401, 'unset key, any header');
      assert.strictEqual((await request(app).get('/api/alliance-inbox/webhook').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': '1' })).status, 401);
    } finally {
      process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;
    }
  });

  // ── Test-suite hygiene: the Mafiya cron respects the jobs and module switches ──
  await t.test('S11. routes/mafiya-reviews.js schedules its cron only when jobs are on and the module is enabled', async () => {
    const cronPath = require.resolve('node-cron');
    const routePath = require.resolve('../routes/mafiya-reviews');
    const realCron = require.cache[cronPath];
    const realRoute = require.cache[routePath];
    const scheduled = [];
    const savedJobs = process.env.JOBS_ENABLED;
    const savedModules = process.env.DISABLED_MODULES;
    const load = () => {
      delete require.cache[routePath];
      require.cache[cronPath] = { id: cronPath, filename: cronPath, loaded: true, exports: { schedule: (...args) => { scheduled.push(args[0]); return { stop() {} }; } } };
      require(routePath);
    };
    try {
      process.env.JOBS_ENABLED = 'false';
      delete process.env.DISABLED_MODULES;
      load();
      assert.strictEqual(scheduled.length, 0, 'jobs off: nothing scheduled');
      delete process.env.JOBS_ENABLED;
      process.env.DISABLED_MODULES = 'alliance,mafiya,contentos';
      load();
      assert.strictEqual(scheduled.length, 0, 'module disabled: nothing scheduled');
      delete process.env.DISABLED_MODULES;
      load();
      assert.deepStrictEqual(scheduled, ['*/5 * * * * *'], 'jobs on and module enabled: scheduled once');
    } finally {
      if (realCron) require.cache[cronPath] = realCron; else delete require.cache[cronPath];
      if (realRoute) require.cache[routePath] = realRoute; else delete require.cache[routePath];
      process.env.JOBS_ENABLED = savedJobs;
      if (savedModules === undefined) delete process.env.DISABLED_MODULES; else process.env.DISABLED_MODULES = savedModules;
    }
  });

  // ── Source audit: no global WhatsApp credential left in the send paths ──
  await t.test('S12. No LeadOS send path reads a global WhatsApp token or phone number', () => {
    const files = ['routes/leados/followups.js', 'routes/leados/templates.js', 'routes/leados/whatsapp.js', 'routes/leados/webhook-whatsapp.js', 'routes/leados/messages.js', 'routes/leados/internal.js', 'routes/salesos.js', 'services/tenantSender.js', 'services/founderNotify.js'];
    const forbidden = /(?<![A-Z_])(META_PAGE_ACCESS_TOKEN|WA_PHONE_NUMBER_ID|META_SYSTEM_USER_ACCESS_TOKEN|WA_BUSINESS_ACCOUNT_ID|FOUNDER_WHATSAPP_PHONE)\b/;
    for (const file of files) {
      const source = fs.readFileSync(path.join(SERVER_ROOT, file), 'utf8');
      const hit = source.match(forbidden);
      assert.ok(!hit, `${file} still reads ${hit && hit[1]}`);
    }
  });
});
