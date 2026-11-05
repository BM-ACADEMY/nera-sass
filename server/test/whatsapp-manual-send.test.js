/**
 * Manual send from the customer inbox: POST /api/whatsapp/send. Meta is stubbed;
 * no real call. A Meta refusal must reach the agent in plain words, and the
 * response must never carry a stack trace.
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
let metaReply;
const metaCalls = [];
const realPost = axios.post;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return metaReply();
  };
});

test.after(async () => {
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  metaReply = async () => ({ data: { messages: [{ id: 'wamid.TEST' }] } });
  await clearCollections();
});

test('Manual WhatsApp send', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');

  // A customer who wrote in a minute ago, so the 24-hour window is open.
  async function seed() {
    await runAsSystem(() => Tenants.create({ id: 1, name: 'Dress Shop', status: 'active' }), 'test');
    const owner = (await runAsSystem(() => Users.create({
      tenant_id: 1, role: 'owner', email: 'owner@shop.test', name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }), 'test')).toObject();
    return runAsTenant(1, async () => {
      const brand = await Clients.create({ name: 'Dress Brand', phone_number_id: 'PN1', whatsapp_status: 'verified', ...encryptToken('test-dummy-token') });
      const lead = await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id, status: 'new' });
      const conversation = await Conversations.create({ lead_id: lead.id, phone: '9876543210', status: 'open' });
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: new Date(Date.now() - 60000) });
      return { lead, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
    });
  }

  await t.test('M1. A text reply reaches Meta and is stored on the thread', async () => {
    const { lead, headers } = await seed();
    const res = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Hello', msg_type: 'text' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(metaCalls.length, 1);
    assert.strictEqual(metaCalls[0].body.to, '919876543210');
    assert.deepStrictEqual(metaCalls[0].body.text, { body: 'Hello' });
    assert.strictEqual(res.body.message.wa_msg_id, 'wamid.TEST');
    assert.strictEqual(await runAsTenant(1, () => Messages.countDocuments({ direction: 'outbound', content: 'Hello' })), 1);
  });

  await t.test('M2. A Meta refusal shows Meta\'s reason and leaks nothing', async () => {
    const { lead, headers } = await seed();
    metaReply = async () => {
      const err = new Error('Request failed with status code 400');
      err.response = { status: 400, data: { error: { code: 131047, message: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed.' } } } };
      throw err;
    };
    const res = await request(app).post('/api/whatsapp/send').set(headers).send({ lead_id: lead.id, message: 'Hello', msg_type: 'text' });
    assert.strictEqual(res.status, 502, JSON.stringify(res.body));
    assert.match(res.body.error, /More than 24 hours have passed/);
    assert.strictEqual(res.body.code, 'WHATSAPP_SEND_FAILED');
    assert.strictEqual(res.body.stack, undefined);
    assert.strictEqual(await runAsTenant(1, () => Messages.countDocuments({ direction: 'outbound' })), 0, 'a refused message is not stored');
  });
});
