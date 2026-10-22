/**
 * AI replies from n8n: n8n never receives a WhatsApp token. It posts the reply
 * text to /api/internal/send-reply with the service key and tenant id, and the
 * server sends it with the brand's own token. Meta is stubbed; no real call.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, TEST_INTERNAL_KEY } = require('./setup');

let app;
const metaCalls = [];
const realPost = axios.post;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  ({ app } = require('../server'));
  axios.post = async (url, body, config) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body, auth: config?.headers?.Authorization });
    return { data: { messages: [{ id: 'wamid.TEST' }] } };
  };
});

test.after(async () => {
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  await clearCollections();
});

test('n8n AI reply relay', async (t) => {
  const { Tenants, Clients, Leads, Messages } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });

  async function seed() {
    await runAsSystem(() => Tenants.create([{ id: 1, name: 'Acme', status: 'active' }, { id: 2, name: 'Beta', status: 'active' }]), 'test');
    const brand = (await runAsTenant(1, () => Clients.create({ name: 'Acme Brand', phone_number_id: 'PN1', wa_access_token: 'test-dummy-acme-token' }))).toObject();
    const lead = (await runAsTenant(1, () => Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id, status: 'new' }))).toObject();
    return { brand, lead };
  }

  await t.test('R1. The reply is sent with the brand token held by the server and stored as an AI message', async () => {
    const { lead } = await seed();
    const res = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: 'Hello Ravi' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(metaCalls.length, 1);
    assert.match(metaCalls[0].url, /\/PN1\/messages$/);
    assert.strictEqual(metaCalls[0].auth, 'Bearer test-dummy-acme-token');
    assert.strictEqual(metaCalls[0].body.to, '919876543210');
    assert.strictEqual(metaCalls[0].body.text.body, 'Hello Ravi');
    const saved = await runAsTenant(1, () => Messages.findOne({ wa_msg_id: 'wamid.TEST' }).lean());
    assert.strictEqual(saved.direction, 'outbound');
    assert.strictEqual(saved.is_ai, true);
    assert.ok(!JSON.stringify(res.body).includes('test-dummy-acme-token'), 'token is never returned');
  });

  await t.test('R2. Another tenant cannot send to this lead; a wrong key is refused', async () => {
    const { lead } = await seed();
    const other = await request(app).post('/api/internal/send-reply').set(service(2)).send({ lead_id: lead.id, message: 'Hi' });
    assert.strictEqual(other.status, 404);
    const wrongKey = await request(app).post('/api/internal/send-reply').set({ 'x-internal-key': 'wrong-key', 'x-tenant-id': '1' }).send({ lead_id: lead.id, message: 'Hi' });
    assert.strictEqual(wrongKey.status, 401);
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('R3. Empty or oversized messages and suspended workspaces are refused before Meta', async () => {
    const { lead } = await seed();
    assert.strictEqual((await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: '  ' })).status, 400);
    assert.strictEqual((await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: 'x'.repeat(4097) })).status, 400);
    await runAsSystem(() => Tenants.updateOne({ id: 1 }, { $set: { status: 'suspended' } }), 'test');
    const blocked = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: lead.id, message: 'Hi' });
    assert.ok([403].includes(blocked.status), `expected 403, got ${blocked.status}`);
    assert.strictEqual(metaCalls.length, 0);
  });

  await t.test('R4. A template is sent with its body values; bad names are refused before Meta', async () => {
    const { lead } = await seed();
    const bad = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: lead.id, template: 'Bad Name!' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(metaCalls.length, 0);
    const res = await request(app).post('/api/internal/send-template').set(service(1))
      .send({ lead_id: lead.id, template: 'getnera_welcome', language: 'en', body_params: ['Ravi'] });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(metaCalls[0].auth, 'Bearer test-dummy-acme-token');
    assert.deepStrictEqual(metaCalls[0].body.template, {
      name: 'getnera_welcome', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Ravi' }] }],
    });
  });
});
