/**
 * Customer panel Template Management: only the templates of the number linked
 * to the workspace, managed with the brand's own credential; another
 * workspace's templates are never listed, previewed, edited or deleted.
 * Meta is stubbed (an unexpected call fails).
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
const calls = [];
let routes = {};
const real = { get: axios.get, post: axios.post, delete: axios.delete };
const GRAPH = /^https:\/\/graph\.facebook\.com\/[^/]+\//;
const stub = (method) => async (url, ...rest) => {
  const config = method === 'POST' ? rest[1] : rest[0];
  calls.push({ method, path: url.replace(GRAPH, ''), body: method === 'POST' ? rest[0] : undefined, params: config?.params, auth: config?.headers?.Authorization });
  const handler = routes[`${method} ${url.replace(GRAPH, '')}`];
  if (!handler) throw new Error(`Unstubbed Meta call: ${method} ${url}`);
  return { data: handler };
};

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.get = stub('GET');
  axios.post = stub('POST');
  axios.delete = stub('DELETE');
});
test.after(async () => { Object.assign(axios, real); await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); calls.length = 0; routes = {}; });

test('Customer templates', async (t) => {
  const { Users, Tenants, Clients, MetaWhatsappTemplates } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const sys = (fn) => runAsSystem(fn, 'test');
  const user = async (tenantId, role) => (await sys(() => Users.create({
    tenant_id: tenantId, role, email: `${role}${tenantId}@shop.test`, name: role, password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();
  const bearer = (u) => ({ Authorization: `Bearer ${makeToken(u)}` });

  async function seed() {
    await sys(() => Tenants.create([{ id: 1, name: 'Dress Shop', status: 'active' }, { id: 2, name: 'Bakery', status: 'active' }]));
    await runAsTenant(1, () => Clients.create({ name: 'Dress', phone_number_id: 'P1', wa_business_id: 'W1', whatsapp_number: '15550001', ...encryptToken('test-dummy-dress-token') }));
    await runAsTenant(2, () => Clients.create({ name: 'Bakery', phone_number_id: 'P2', wa_business_id: 'W2', ...encryptToken('test-dummy-bakery-token') }));
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'D1', waba_id: 'W1', name: 'order_ready', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your order is ready.' }] },
      { template_id: 'B1', waba_id: 'W2', name: 'bakery_offer', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Fresh bread' }] },
    ]));
    return { owner: await user(1, 'owner'), agent: await user(1, 'agent'), bakery: await user(2, 'owner') };
  }

  await t.test('C1. A workspace lists, previews and manages only its own number templates with its own token', async () => {
    const { owner } = await seed();
    const list = await request(app).get('/api/wa-templates').set(bearer(owner));
    assert.strictEqual(list.status, 200, JSON.stringify(list.body));
    assert.deepStrictEqual(list.body.templates.map((x) => x.name), ['order_ready']);
    assert.strictEqual(list.body.can_manage, true);
    assert.ok(!JSON.stringify(list.body).includes('test-dummy'), 'no token in the response');
    assert.strictEqual((await request(app).get('/api/wa-templates/B1').set(bearer(owner))).status, 404, 'another workspace template is not visible');

    routes['POST W1/message_templates'] = { id: 'D2', status: 'PENDING', category: 'UTILITY' };
    const created = await request(app).post('/api/wa-templates').set(bearer(owner)).send({ name: 'pickup_reminder', language: 'en', category: 'UTILITY', body: 'Hi {{1}}, your order is ready for pickup.', samples: { 1: 'Ravi' } });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(calls.at(-1).auth, 'Bearer test-dummy-dress-token', 'the brand credential is used');

    const editOther = await request(app).put('/api/wa-templates/B1').set(bearer(owner)).send({ category: 'UTILITY', body: 'x' });
    assert.strictEqual(editOther.status, 404);
    const deleteOther = await request(app).delete('/api/wa-templates/B1').set(bearer(owner));
    assert.strictEqual(deleteOther.status, 404);
    assert.ok(!calls.some((c) => c.path.startsWith('W2') || c.path === 'B1'), 'no Meta call touched the other WABA');
  });

  await t.test('C2. Agents can view but not change templates; a workspace without a number gets a clear state', async () => {
    const { agent } = await seed();
    const list = await request(app).get('/api/wa-templates').set(bearer(agent));
    assert.strictEqual(list.body.can_manage, false);
    const create = await request(app).post('/api/wa-templates').set(bearer(agent)).send({ name: 'x_y', language: 'en', category: 'UTILITY', body: 'Hello there.' });
    assert.strictEqual(create.status, 403);
    await sys(() => Tenants.create({ id: 3, name: 'Empty', status: 'active' }));
    await runAsTenant(3, () => Clients.create({ name: 'No number' }));
    const empty = await request(app).get('/api/wa-templates').set(bearer(await user(3, 'owner')));
    assert.deepStrictEqual(empty.body, { configured: false, templates: [] });
  });
});
