/**
 * Task 1B-0: WhatsApp webhook security.
 *  - only requests signed by Meta (X-Hub-Signature-256 over the exact raw body,
 *    keyed with NERA_META_APP_SECRET) are processed
 *  - missing / malformed / wrong signatures, modified payloads and missing
 *    configuration are refused before anything is logged, stored, emitted,
 *    replied to or forwarded
 *  - no fallback to META_APP_SECRET / META_CONTENT_OS_APP_SECRET
 *  - the hard-coded third-party forward and the ?source=n8n bypass are gone
 * In-memory MongoDB, synthetic data, every outbound HTTP call recorded.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const request = require('supertest');
const axiosModule = require('axios');
const { startTestDb, stopTestDb, clearCollections } = require('./setup');

const SECRET = 'test-dummy-webhook-secret';
const sign = (raw, secret = SECRET) => `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;

// Every outbound HTTP request from any axios instance is recorded and refused.
const outbound = [];
const realRequest = axiosModule.Axios.prototype.request;

test.before(async () => {
  process.env.WA_VERIFY_TOKEN = 'test_verify_token';
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.META_PAGE_ACCESS_TOKEN = 'test-dummy-page';
  delete process.env.N8N_WEBHOOK_URL;
  axiosModule.Axios.prototype.request = function recordAndRefuse(config) {
    outbound.push(String((typeof config === 'string' ? config : `${config?.baseURL || ''}${config?.url || ''}`)));
    return Promise.reject(new Error('outbound HTTP blocked in test'));
  };
  await startTestDb();
});

test.after(async () => {
  axiosModule.Axios.prototype.request = realRequest;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  outbound.length = 0;
  process.env.NERA_META_APP_SECRET = SECRET;
  delete process.env.META_APP_SECRET;
  delete process.env.META_CONTENT_OS_APP_SECRET;
});

test('Task 1B-0: WhatsApp webhook security', async (t) => {
  const models = require('../models');
  const { Clients, Leads, Messages, Conversations, Templates, CampaignLogs, FailedWebhooks, Tenants } = models;
  const { runAsTenant, runAsSystem } = require('../services/tenantContext');
  const { isValidMetaSignature } = require('../services/metaWebhookSignature');

  // The route on a test app with the same raw-body capture as server.js and
  // recording stand-ins for disk logging, sockets, AI replies and HTTP.
  const logWrites = [];
  const socketEvents = [];
  const aiReplyQueue = new Map();
  const recordingAxios = { post: async (url) => { outbound.push(url); throw new Error('blocked'); }, get: async (url) => { outbound.push(url); throw new Error('blocked'); } };
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
  require('../routes/leados/webhook-whatsapp')(app, {
    CampaignLogs, Clients, Conversations, Leads, Messages, Templates, FailedWebhooks, models,
    NO_ID: { _id: 0 }, aiReplyQueue, axios: recordingAxios,
    fs: { appendFileSync: (file, text) => logWrites.push({ file, text }) },
    path, io: { emit: (event) => { socketEvents.push(event); return true; } },
    openRouter: { isConfigured: false }, phoneTailRegex: (p) => new RegExp(`${p}$`),
    upsertOne: async (model, query, update, insertDoc) => {
      const doc = await model.findOne(query).lean();
      if (doc) { await model.updateOne(query, update); return doc; }
      return (await model.create(insertDoc)).toObject();
    },
    SERVER_ROOT: __dirname,
  });

  async function seed() {
    await runAsSystem(() => Tenants.create({ id: 101, name: 'Tenant 101', status: 'active' }));
    await runAsTenant(101, () => Clients.create({ name: 'Brand 101', phone_number_id: 'PHONE_101', whatsapp_number: '+919876543210' }));
  }
  const payload = (text = 'Hello from a synthetic customer') => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA_101',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          metadata: { display_phone_number: '919876543210', phone_number_id: 'PHONE_101' },
          contacts: [{ profile: { name: 'Synthetic Customer' }, wa_id: '919111222333' }],
          messages: [{ from: '919111222333', id: `wamid.${crypto.randomUUID()}`, timestamp: '1700000000', text: { body: text }, type: 'text' }],
        },
      }],
    }],
  });
  const post = (raw, headers = {}, query = '') => {
    let req = request(app).post(`/webhook/whatsapp${query}`).set('Content-Type', 'application/json');
    for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
    return req.send(raw);
  };
  const counts = async () => ({
    leads: await runAsSystem(() => Leads.countDocuments({})),
    messages: await runAsSystem(() => Messages.countDocuments({})),
    conversations: await runAsSystem(() => Conversations.countDocuments({})),
  });
  // A refused request leaves no trace at all.
  async function assertInert(label) {
    assert.deepStrictEqual(await counts(), { leads: 0, messages: 0, conversations: 0 }, `${label}: records created`);
    assert.strictEqual(logWrites.length, 0, `${label}: payload written to disk`);
    assert.strictEqual(socketEvents.length, 0, `${label}: socket events emitted`);
    assert.strictEqual(aiReplyQueue.size, 0, `${label}: AI reply scheduled`);
    assert.strictEqual(outbound.length, 0, `${label}: outbound request made`);
  }
  const reset = () => { logWrites.length = 0; socketEvents.length = 0; aiReplyQueue.clear(); outbound.length = 0; };

  await t.test('W1. A correctly signed payload is processed for the right workspace, with nothing forwarded externally', async () => {
    await seed();
    reset();
    const raw = JSON.stringify(payload());
    const res = await post(raw, { 'X-Hub-Signature-256': sign(raw) });
    assert.strictEqual(res.status, 200);
    const lead = await runAsTenant(101, () => Leads.findOne({ phone: '919111222333' }).lean());
    assert.ok(lead, 'lead created in tenant 101');
    assert.strictEqual(await runAsTenant(101, () => Messages.countDocuments({})), 1);
    assert.strictEqual(outbound.length, 0, `no external forward: ${outbound.join(', ')}`);
  });

  await t.test('W2. A missing signature is refused before any processing', async () => {
    await seed();
    reset();
    const res = await post(JSON.stringify(payload()));
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'WEBHOOK_SIGNATURE_INVALID');
    await assertInert('missing signature');
  });

  await t.test('W3. Malformed signature headers are refused', async () => {
    await seed();
    const raw = JSON.stringify(payload());
    const good = sign(raw);
    const malformed = [
      good.replace('sha256=', 'sha1='), good.replace('sha256=', ''), 'sha256=', 'sha256=zz', `${good}00`, good.slice(0, -2),
      `sha256=${'0'.repeat(64)}`, 'garbage',
    ];
    for (const header of malformed) {
      reset();
      const res = await post(raw, { 'X-Hub-Signature-256': header });
      assert.strictEqual(res.status, 401, header);
      await assertInert(`malformed header ${header.slice(0, 20)}`);
    }
  });

  await t.test('W4. A signature made with another secret is refused', async () => {
    await seed();
    reset();
    const raw = JSON.stringify(payload());
    const res = await post(raw, { 'X-Hub-Signature-256': sign(raw, 'some-other-app-secret') });
    assert.strictEqual(res.status, 401);
    await assertInert('wrong secret');
  });

  await t.test('W5. A modified payload is refused (signature covers the exact raw body)', async () => {
    await seed();
    const original = payload('Original text');
    const raw = JSON.stringify(original);
    const signature = sign(raw);
    reset();
    const tampered = JSON.stringify(payload('Tampered text'));
    assert.strictEqual((await post(tampered, { 'X-Hub-Signature-256': signature })).status, 401);
    await assertInert('tampered body');
    reset();
    const reformatted = JSON.stringify(original, null, 2); // same JSON, different bytes
    assert.strictEqual((await post(reformatted, { 'X-Hub-Signature-256': signature })).status, 401);
    await assertInert('re-serialised body');
  });

  await t.test('W6. Missing configuration fails closed, with no fallback to other secrets', async () => {
    await seed();
    delete process.env.NERA_META_APP_SECRET;
    process.env.META_APP_SECRET = 'legacy-shared-secret';
    process.env.META_CONTENT_OS_APP_SECRET = 'legacy-shared-secret';
    reset();
    const raw = JSON.stringify(payload());
    for (const signature of [undefined, sign(raw, 'legacy-shared-secret'), sign(raw, '')]) {
      const res = await post(raw, signature ? { 'X-Hub-Signature-256': signature } : {});
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.code, 'WEBHOOK_SECRET_NOT_CONFIGURED');
    }
    await assertInert('missing configuration');
    process.env.NERA_META_APP_SECRET = '   ';
    assert.strictEqual((await post(raw, { 'X-Hub-Signature-256': sign(raw, '   ') })).status, 503, 'a blank secret counts as missing');
  });

  await t.test('W7. The ?source=n8n bypass is gone', async () => {
    await seed();
    reset();
    const raw = JSON.stringify(payload());
    const unsigned = await post(raw, {}, '?source=n8n');
    assert.strictEqual(unsigned.status, 401, 'source=n8n does not skip verification');
    await assertInert('unsigned ?source=n8n');
    const signed = await post(raw, { 'X-Hub-Signature-256': sign(raw) }, '?source=n8n');
    assert.strictEqual(signed.status, 200);
    assert.strictEqual(await runAsTenant(101, () => Messages.countDocuments({})), 1, 'processed exactly like any signed request');
    assert.strictEqual(outbound.length, 0);
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'leados', 'webhook-whatsapp.js'), 'utf8');
    assert.ok(!source.includes("req.query.source"), 'no query-string switch left in the route');
    assert.ok(!/abmgroups\.org/.test(source), 'no hard-coded third-party destination left in the route');
  });

  await t.test('W8. A non-JSON body is refused (no raw body to verify)', async () => {
    await seed();
    reset();
    const res = await request(app).post('/webhook/whatsapp').set('Content-Type', 'text/plain').set('X-Hub-Signature-256', sign('x')).send('x');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'WEBHOOK_BODY_UNREADABLE');
    await assertInert('non-JSON body');
  });

  await t.test('W9. Signature check unit: constant-time compare, exact bytes only', () => {
    const raw = Buffer.from('{"a":1}');
    assert.strictEqual(isValidMetaSignature(raw, sign(raw), SECRET), true);
    assert.strictEqual(isValidMetaSignature(raw, sign(raw).toUpperCase().replace('SHA256=', 'sha256='), SECRET), true, 'hex case-insensitive');
    assert.strictEqual(isValidMetaSignature(raw, sign(raw), null), false);
    assert.strictEqual(isValidMetaSignature('{"a":1}', sign(raw), SECRET), false, 'requires the raw Buffer');
    assert.strictEqual(isValidMetaSignature(Buffer.from('{"a": 1}'), sign(raw), SECRET), false);
  });

  await t.test('W10. On the real server: raw-body path works end to end; GET verification unchanged', async () => {
    const { app: server } = require('../server');
    await seed();
    const raw = JSON.stringify(payload());
    const unsigned = await request(server).post('/webhook/whatsapp').set('Content-Type', 'application/json').send(raw);
    assert.strictEqual(unsigned.status, 401);
    const wrong = await request(server).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw, 'nope')).send(raw);
    assert.strictEqual(wrong.status, 401);
    delete process.env.NERA_META_APP_SECRET;
    const unconfigured = await request(server).post('/webhook/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(raw)).send(raw);
    assert.strictEqual(unconfigured.status, 503);
    assert.deepStrictEqual(await counts(), { leads: 0, messages: 0, conversations: 0 });
    const challenge = await request(server).get('/webhook/whatsapp').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test_verify_token', 'hub.challenge': 'abc123' });
    assert.strictEqual(challenge.status, 200);
    assert.strictEqual(challenge.text, 'abc123');
    assert.strictEqual(outbound.length, 0);
  });
});
