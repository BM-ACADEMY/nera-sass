/**
 * N7: onboarding a customer's own WhatsApp Business Account.
 *  - verification subscribes our app to the customer's WABA, with the brand's own token
 *  - a failed subscription does not undo the verification, but it is recorded and shown
 *  - changing the credentials clears the old subscription state
 *  - responses never carry the token
 *
 * Real server.js app, in-memory MongoDB, dummy credentials, stubbed Meta HTTP.
 */
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const axios = require('axios');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const BRAND_TOKEN = 'test-dummy-brand-token-4242';
const GRAPH = /^https:\/\/graph\.facebook\.com\/[^/]+\//;
let app;

const metaCalls = [];
let metaRoutes = {};
const realGet = axios.get;
const realPost = axios.post;
const stubbed = (method) => async (url, ...rest) => {
  const config = method === 'GET' ? rest[0] : rest[1];
  metaCalls.push({ method, url: url.replace(GRAPH, ''), auth: config?.headers?.Authorization || null });
  if (!GRAPH.test(url)) throw new Error(`Unexpected non-Meta URL in test: ${url}`);
  const handler = metaRoutes[`${method} ${url.replace(GRAPH, '')}`];
  if (!handler) throw new Error(`Unstubbed Meta call: ${method} ${url}`);
  if (handler instanceof Error) throw handler;
  return { data: handler };
};

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  await startTestDb();
  ({ app } = require('../server'));
  axios.get = stubbed('GET');
  axios.post = stubbed('POST');
});

test.after(async () => {
  axios.get = realGet;
  axios.post = realPost;
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  metaCalls.length = 0;
  metaRoutes = {};
});

test('N7: customer WhatsApp onboarding subscribes our app to the WABA', async (t) => {
  const { Users, Tenants, Clients } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

  async function workspace(tenantId) {
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active' }));
    const brand = await runAsTenant(tenantId, async () => (await Clients.create({
      name: `Brand ${tenantId}`, phone_number_id: 'p-1', wa_business_id: 'waba-1',
      whatsapp_number: '911111111111', wa_access_token: BRAND_TOKEN,
    })).toObject());
    const owner = (await sys(() => Users.create({
      tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: 'owner',
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    return { brand, owner };
  }
  const stubVerifyCalls = () => {
    metaRoutes['GET waba-1/phone_numbers'] = { data: [{ id: 'p-1', display_phone_number: '911111111111', status: 'CONNECTED' }] };
    metaRoutes['POST p-1/whatsapp_business_profile'] = { success: true };
    metaRoutes['GET p-1/whatsapp_business_profile'] = { data: [{}] };
  };

  await t.test('S1. Verification subscribes the WABA with the brand\'s own token and the overview says so', async () => {
    const { brand, owner } = await workspace(21);
    stubVerifyCalls();
    metaRoutes['POST waba-1/subscribed_apps'] = { success: true };

    const setup = await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(owner));
    assert.strictEqual(setup.status, 200, JSON.stringify(setup.body));
    const subscribe = metaCalls.filter((c) => c.method === 'POST' && c.url === 'waba-1/subscribed_apps');
    assert.strictEqual(subscribe.length, 1, 'exactly one subscription call');
    assert.strictEqual(subscribe[0].auth, `Bearer ${BRAND_TOKEN}`, 'uses the brand\'s own token, never a platform token');

    const overview = await request(app).get('/api/whatsapp/overview').set(bearer(owner));
    assert.strictEqual(overview.status, 200, JSON.stringify(overview.body));
    assert.strictEqual(overview.body.status, 'verified');
    assert.strictEqual(overview.body.webhook_subscribed, true);
    assert.strictEqual(overview.body.webhook_error, null);
    assert.ok(!JSON.stringify([setup.body, overview.body]).includes(BRAND_TOKEN), 'no token in any response');
  });

  await t.test('S2. A failed subscription keeps the number verified but is recorded and shown', async () => {
    const { brand, owner } = await workspace(22);
    stubVerifyCalls();
    const refusal = new Error('Request failed with status code 400');
    refusal.response = { data: { error: { message: '(#200) Requires whatsapp_business_management permission' } } };
    metaRoutes['POST waba-1/subscribed_apps'] = refusal;

    const setup = await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(owner));
    assert.strictEqual(setup.status, 200, 'verification itself still succeeds');

    const overview = await request(app).get('/api/whatsapp/overview').set(bearer(owner));
    assert.strictEqual(overview.body.status, 'verified');
    assert.strictEqual(overview.body.webhook_subscribed, false, 'the overview must not claim inbound messages work');
    assert.match(overview.body.webhook_error, /whatsapp_business_management/);
  });

  await t.test('S3. A repeat verification subscribes again and clears an earlier failure', async () => {
    const { brand, owner } = await workspace(23);
    stubVerifyCalls();
    const refusal = new Error('denied');
    refusal.response = { data: { error: { message: 'denied' } } };
    metaRoutes['POST waba-1/subscribed_apps'] = refusal;
    await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(owner));

    metaRoutes['POST waba-1/subscribed_apps'] = { success: true };
    const again = await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(owner));
    assert.strictEqual(again.status, 200);
    const overview = await request(app).get('/api/whatsapp/overview').set(bearer(owner));
    assert.strictEqual(overview.body.webhook_subscribed, true);
    assert.strictEqual(overview.body.webhook_error, null);
  });

  await t.test('S4. Changing the WhatsApp credentials clears the old subscription state', async () => {
    const { brand, owner } = await workspace(24);
    stubVerifyCalls();
    metaRoutes['POST waba-1/subscribed_apps'] = { success: true };
    await request(app).post(`/api/clients/${brand.id}/whatsapp-setup`).set(bearer(owner));

    const patch = await request(app).patch(`/api/clients/${brand.id}`).set(bearer(owner)).send({ phone_number_id: 'p-2' });
    assert.strictEqual(patch.status, 200, JSON.stringify(patch.body));
    const raw = await runAsTenant(24, () => Clients.findOne({ id: brand.id }).lean());
    assert.notStrictEqual(raw.whatsapp_webhook_subscribed, true, 'a new number is not subscribed yet');
    assert.strictEqual(raw.whatsapp_status, 'verification_pending');
  });
});
