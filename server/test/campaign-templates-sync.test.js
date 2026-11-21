/**
 * POST /api/templates/sync-all fills the LeadOS `templates` collection that the
 * Campaigns page lists. Each workspace brand keeps its own rows: two workspaces
 * with the same template name (every WhatsApp account has hello_world) never
 * overwrite or block each other. Meta is stubbed (an unexpected call fails).
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

let app;
let routes = {};
const calls = [];
const real = { get: axios.get };
const GRAPH = /^https:\/\/graph\.facebook\.com\/[^/]+\//;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  ({ app } = require('../server'));
  axios.get = async (url, config) => {
    const path = url.replace(GRAPH, '').split('?')[0];
    calls.push({ path, auth: config?.headers?.Authorization });
    if (!routes[path]) throw new Error(`Unstubbed Meta call: GET ${url}`);
    return { data: { data: routes[path] } };
  };
});
test.after(async () => { Object.assign(axios, real); await stopTestDb(); });
test.beforeEach(async () => { await clearCollections(); calls.length = 0; routes = {}; });

const metaTpl = (id, name, body, status = 'APPROVED') => ({
  id, name, language: 'en', status, category: 'MARKETING', components: [{ type: 'BODY', text: body }],
});

test('Campaign templates sync', async (t) => {
  const { Users, Tenants, Clients, Templates } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (u) => ({ Authorization: `Bearer ${makeToken(u)}` });
  const owner = async (tenantId) => (await sys(() => Users.create({
    tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
  }))).toObject();

  async function seed() {
    await sys(() => Tenants.create([{ id: 1, name: 'Shop', status: 'active' }, { id: 2, name: 'Bakery', status: 'active' }]));
    const dress = (await runAsTenant(1, () => Clients.create({ name: 'Dress', phone_number_id: 'P1', wa_business_id: 'W1', ...encryptToken('test-dummy-dress-token') }))).toObject();
    const bakery = (await runAsTenant(2, () => Clients.create({ name: 'Bakery', phone_number_id: 'P3', wa_business_id: 'W3', ...encryptToken('test-dummy-bakery-token') }))).toObject();
    return { dress, bakery, shop: await owner(1), baker: await owner(2) };
  }

  await t.test('T1. Two workspaces can both sync a template with the same name', async () => {
    const { dress, bakery, shop, baker } = await seed();
    routes['W1/message_templates'] = [metaTpl('M1', 'hello_world', 'Hello')];
    routes['W3/message_templates'] = [metaTpl('M3', 'hello_world', 'Hello'), metaTpl('M4', 'bread', 'Fresh bread')];
    const first = await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({ client_id: String(dress.id) });
    assert.strictEqual(first.status, 200, JSON.stringify(first.body));
    assert.strictEqual(calls.at(-1).auth, 'Bearer test-dummy-dress-token', 'the brand credential is used');
    assert.ok(!JSON.stringify(first.body).includes('test-dummy'), 'no token in the response');
    const other = await request(app).post('/api/templates/sync-all').set(bearer(baker)).send({ client_id: bakery.id });
    assert.strictEqual(other.status, 200, JSON.stringify(other.body));
    assert.deepStrictEqual([other.body.imported, other.body.skipped], [2, 0]);
    const shopList = await request(app).get('/api/templates').set(bearer(shop));
    assert.deepStrictEqual(shopList.body.templates.map((x) => [x.meta_template_id, x.client_id, x.status]), [['M1', dress.id, 'approved']], 'the other workspace rows are not visible');
    const bakeryList = await request(app).get('/api/templates').set(bearer(baker));
    assert.deepStrictEqual(bakeryList.body.templates.map((x) => x.meta_template_id).sort(), ['M3', 'M4']);
  });

  await t.test('T2. A re-sync updates the same row and keeps the first approval time', async () => {
    const { dress, shop } = await seed();
    routes['W1/message_templates'] = [metaTpl('M1', 'offer', 'Dress offer')];
    await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({ client_id: dress.id });
    const first = await runAsTenant(1, () => Templates.findOne({ name: 'offer' }).lean());
    routes['W1/message_templates'] = [metaTpl('M1', 'offer', 'Dress offer v2')];
    const again = await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({ client_id: dress.id });
    assert.deepStrictEqual([again.body.imported, again.body.updated], [0, 1]);
    const rows = await runAsTenant(1, () => Templates.find({ name: 'offer' }).lean());
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].body, 'Dress offer v2');
    assert.strictEqual(rows[0].approved_at.getTime(), first.approved_at.getTime());
  });

  await t.test('T3. A legacy row with no brand is claimed instead of duplicated', async () => {
    const { dress, shop } = await seed();
    await runAsTenant(1, () => Templates.create({ name: 'offer', language: 'en', body: 'old', status: 'draft', client_id: null }));
    routes['W1/message_templates'] = [metaTpl('M1', 'offer', 'Dress offer')];
    const res = await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({ client_id: dress.id });
    assert.deepStrictEqual([res.body.imported, res.body.updated], [0, 1]);
    const rows = await runAsTenant(1, () => Templates.find({ name: 'offer' }).lean());
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].client_id, dress.id);
  });

  await t.test('T4. A brand of another workspace, or no brand, is refused without calling Meta', async () => {
    const { bakery, shop } = await seed();
    const other = await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({ client_id: bakery.id });
    assert.strictEqual(other.status, 409);
    assert.strictEqual(other.body.code, 'WHATSAPP_NOT_CONNECTED');
    const none = await request(app).post('/api/templates/sync-all').set(bearer(shop)).send({});
    assert.strictEqual(none.status, 409);
    assert.strictEqual(calls.length, 0);
  });
});
