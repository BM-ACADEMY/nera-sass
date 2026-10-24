/**
 * Admin WhatsApp setup from the Meta inventory and admin Template Management:
 * picking the admin number in WhatsApp Numbers (no .env needed), the template
 * rules checked before Meta, creating / editing / deleting the platform WABA's
 * templates with the inventory credential, and the read-only client view.
 * In-memory MongoDB; every Meta call is stubbed (an unexpected one fails).
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
  const body = method === 'POST' ? rest[0] : undefined;
  calls.push({ method, path: url.replace(GRAPH, ''), body, params: config?.params, auth: config?.headers?.Authorization });
  if (!GRAPH.test(url)) throw new Error(`Unexpected URL ${url}`);
  const handler = routes[`${method} ${url.replace(GRAPH, '')}`];
  if (!handler) throw new Error(`Unstubbed Meta call: ${method} ${url}`);
  if (handler instanceof Error) throw handler;
  return { data: typeof handler === 'function' ? handler(body, config) : handler };
};

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.META_INVENTORY_ACCESS_TOKEN = 'test-dummy-inventory-token';
  process.env.META_APP_ID = 'test-app';
  await startTestDb();
  ({ app } = require('../server'));
  // server.js loads .env; these tests set the admin number from the inventory only.
  delete process.env.PLATFORM_WA_PHONE_NUMBER_ID;
  delete process.env.PLATFORM_WA_ACCESS_TOKEN;
  delete process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID;
  process.env.META_INVENTORY_ACCESS_TOKEN = 'test-dummy-inventory-token';
  process.env.META_APP_ID = 'test-app';
  axios.get = stub('GET');
  axios.post = stub('POST');
  axios.delete = stub('DELETE');
});

test.after(async () => {
  Object.assign(axios, real);
  await stopTestDb();
});

test.beforeEach(async () => {
  await clearCollections();
  const { runAsSystem } = require('../services/tenantContext');
  await runAsSystem(() => require('../services/platformInbox').refreshPlatformNumber(), 'test');
  calls.length = 0;
  routes = {};
});

const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user, { mfa: true })}` });

test('Admin WhatsApp and templates', async (t) => {
  const { Users, Tenants, Clients, MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const inbox = require('../services/platformInbox');
  const { buildTemplate } = require('../services/templateBuilder');
  const sys = (fn) => runAsSystem(fn, 'test');

  async function seed() {
    const staff = async (role) => (await sys(() => Users.create({
      tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role,
      password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }))).toObject();
    const founder = await staff('founder');
    const ops = await staff('ops');
    await sys(() => Tenants.create({ id: 1, name: 'Dress Shop', status: 'active' }));
    const brand = (await runAsTenant(1, () => Clients.create({ name: 'Dress Brand' }))).toObject();
    await sys(() => MetaWhatsappAccounts.create([{ waba_id: 'WP', name: 'Getnera' }, { waba_id: 'WC', name: 'Client WABA' }]));
    await sys(() => MetaWhatsappPhoneNumbers.create([
      { phone_number_id: 'PP', waba_id: 'WP', display_phone_number: '+91 82707 43971', verified_name: 'Getnera' },
      { phone_number_id: 'PC', waba_id: 'WC', display_phone_number: '+1 555 0100', client_id: brand.id },
    ]));
    return { founder, ops, brand };
  }
  const linkPlatform = async (user) => {
    routes['POST WP/subscribed_apps'] = { success: true };
    return request(app).post('/api/admin/meta/whatsapp/phone-numbers/PP/platform').set(bearer(user));
  };

  await t.test('T1. The founder picks the admin number in WhatsApp Numbers: no .env, WABA subscribed, assign refused, unlink works', async () => {
    const { founder, ops, brand } = await seed();
    assert.strictEqual(inbox.platformPhoneId(), null, 'nothing configured yet');
    assert.strictEqual((await linkPlatform(ops)).status, 403, 'staff cannot change the admin number');
    const res = await linkPlatform(founder);
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.webhook_subscribed, true);
    assert.strictEqual(inbox.platformPhoneId(), 'PP');
    assert.strictEqual(inbox.platformToken(), 'test-dummy-inventory-token');
    assert.strictEqual(await inbox.platformWabaId(), 'WP');
    const status = await request(app).get('/api/admin/inbox/status').set(bearer(founder));
    assert.strictEqual(status.body.configured, true);
    assert.strictEqual(status.body.source, 'inventory');
    const inv = await request(app).get('/api/admin/meta/whatsapp/inventory').set(bearer(founder));
    assert.strictEqual(inv.body.platform_phone_number_id, 'PP');
    const assign = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/PP/assign').set(bearer(founder)).send({ client_id: brand.id });
    assert.strictEqual(assign.status, 409, 'the admin number cannot go to a workspace');
    const assigned = await request(app).post('/api/admin/meta/whatsapp/phone-numbers/PC/platform').set(bearer(founder));
    assert.strictEqual(assigned.status, 409, 'a workspace number cannot become the admin number');
    const unlink = await request(app).delete('/api/admin/meta/whatsapp/phone-numbers/PP/platform').set(bearer(founder));
    assert.strictEqual(unlink.status, 200);
    assert.strictEqual(inbox.platformPhoneId(), null);
  });

  await t.test('T2. Template rules are explained before Meta is called', () => {
    const base = { name: 'welcome_offer', language: 'en', category: 'MARKETING', body: 'Hi {{1}}, welcome to Getnera!', samples: { 1: 'Ravi' } };
    const ok = buildTemplate({ ...base, header_format: 'TEXT', header_text: 'Welcome', footer: 'Getnera by Afra Ventures', buttons: [{ type: 'URL', text: 'Visit Getnera', url: 'https://getnera.in' }, { type: 'QUICK_REPLY', text: 'Book demo' }] });
    assert.deepStrictEqual(ok.components.map((c) => c.type), ['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
    assert.deepStrictEqual(ok.components[1].example, { body_text: [['Ravi']] });
    assert.strictEqual(ok.components[3].buttons[0].type, 'QUICK_REPLY', 'quick replies grouped first');
    const bad = (input, pattern) => assert.throws(() => buildTemplate({ ...base, ...input }), pattern);
    bad({ name: 'Welcome Offer' }, /lowercase/);
    bad({ body: 'Hi {{2}} there' }, /start at \{\{1\}\}/);
    bad({ samples: {} }, /sample value/);
    bad({ body: '{{1}} welcome', samples: { 1: 'x' } }, /very start or end/);
    bad({ footer: 'Bye {{1}}' }, /footer cannot have variables/);
    bad({ header_format: 'IMAGE' }, /Upload a sample image/);
    bad({ buttons: [{ type: 'PHONE_NUMBER', text: 'Call', phone_number: '+911' }, { type: 'PHONE_NUMBER', text: 'Call 2', phone_number: '+919876543210' }] }, /phone number|At most 1/);
    const named = buildTemplate({ ...base, variable_type: 'name', body: 'Hi {{customer_name}}, thanks!', samples: { customer_name: 'Ravi' } });
    assert.strictEqual(named.parameter_format, 'NAMED');
    assert.deepStrictEqual(named.components[0].example, { body_text_named_params: [{ param_name: 'customer_name', example: 'Ravi' }] });
    const otp = buildTemplate({ name: 'login_code', language: 'en', category: 'AUTHENTICATION', add_security_recommendation: true, code_expiration_minutes: 10 });
    assert.deepStrictEqual(otp.components.map((c) => c.type), ['BODY', 'FOOTER', 'BUTTONS']);
  });

  await t.test('T3. Create, edit and delete a Getnera template on the admin WABA with the inventory credential', async () => {
    const { founder } = await seed();
    await linkPlatform(founder);
    calls.length = 0;
    const form = { name: 'welcome_getnera', language: 'en', category: 'MARKETING', header_format: 'TEXT', header_text: 'Welcome to Getnera', body: 'Hi {{1}}, thanks for your interest in Getnera!', samples: { 1: 'Aakash' }, footer: 'Getnera by Afra Ventures', buttons: [{ type: 'URL', text: 'Visit Getnera', url: 'https://getnera.in' }] };
    routes['POST WP/message_templates'] = { id: 'T100', status: 'PENDING', category: 'MARKETING' };
    const created = await request(app).post('/api/admin/templates/platform').set(bearer(founder)).send(form);
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    assert.strictEqual(calls[0].auth, 'Bearer test-dummy-inventory-token');
    assert.strictEqual(calls[0].body.name, 'welcome_getnera');
    assert.strictEqual(created.body.template.status, 'PENDING');
    assert.ok(!JSON.stringify(created.body).includes('test-dummy-inventory-token'));

    const dup = await request(app).post('/api/admin/templates/platform').set(bearer(founder)).send(form);
    assert.strictEqual(dup.status, 409, 'same name and language refused before Meta');

    routes['POST T100'] = { success: true };
    const edited = await request(app).put('/api/admin/templates/platform/T100').set(bearer(founder)).send({ ...form, name: 'renamed_ignored', body: 'Hello {{1}}, welcome!' });
    assert.strictEqual(edited.status, 200, JSON.stringify(edited.body));
    assert.strictEqual(edited.body.template.name, 'welcome_getnera', 'name cannot change on edit');
    assert.strictEqual(calls.at(-1).path, 'T100');

    routes['DELETE WP/message_templates'] = { success: true };
    const removed = await request(app).delete('/api/admin/templates/platform/T100').set(bearer(founder));
    assert.strictEqual(removed.status, 200);
    assert.deepStrictEqual(calls.at(-1).params, { name: 'welcome_getnera', hsm_id: 'T100' });
    assert.strictEqual(await sys(() => MetaWhatsappTemplates.countDocuments({ template_id: 'T100' })), 0);
  });

  await t.test('T4. Meta errors are shown in plain words; no admin number gives a setup hint', async () => {
    const { founder } = await seed();
    const none = await request(app).post('/api/admin/templates/platform').set(bearer(founder)).send({ name: 'a_b', language: 'en', category: 'UTILITY', body: 'Your order is ready.' });
    assert.strictEqual(none.status, 409);
    assert.strictEqual(none.body.code, 'PLATFORM_NUMBER_NOT_SET');
    await linkPlatform(founder);
    const metaError = new Error('Request failed');
    metaError.response = { data: { error: { message: 'Invalid parameter', error_user_title: 'Content not allowed', error_user_msg: 'The body contains a URL shortener.' } } };
    routes['POST WP/message_templates'] = metaError;
    const res = await request(app).post('/api/admin/templates/platform').set(bearer(founder)).send({ name: 'a_b', language: 'en', category: 'UTILITY', body: 'Your order is ready.' });
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.body.error, 'The body contains a URL shortener.');
  });

  await t.test('T5. Refresh pulls the admin WABA from Meta; the client view lists other WABAs with their workspace', async () => {
    const { founder, ops } = await seed();
    await linkPlatform(founder);
    await sys(() => MetaWhatsappTemplates.create([
      { template_id: 'OLD', waba_id: 'WP', name: 'gone', language: 'en', status: 'APPROVED' },
      { template_id: 'C1', waba_id: 'WC', name: 'order_update', language: 'en', status: 'APPROVED', category: 'UTILITY', components: [{ type: 'BODY', text: 'Your order shipped' }] },
    ]));
    routes['GET WP/message_templates'] = { data: [{ id: 'N1', name: 'welcome', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi' }] }] };
    const list = await request(app).get('/api/admin/templates/platform?refresh=1').set(bearer(ops));
    assert.strictEqual(list.status, 200, JSON.stringify(list.body));
    assert.deepStrictEqual(list.body.templates.map((x) => x.name), ['welcome'], 'stale row removed, new row added');
    await sys(() => MetaWhatsappTemplates.updateOne({ template_id: 'N1' }, { $set: { status: 'PENDING' } }));
    routes['GET N1'] = { id: 'N1', name: 'welcome', language: 'en', status: 'APPROVED', category: 'MARKETING', components: [{ type: 'BODY', text: 'Hi' }] };
    const checked = await request(app).post('/api/admin/templates/platform/check-pending').set(bearer(ops));
    assert.strictEqual(checked.status, 200, JSON.stringify(checked.body));
    assert.strictEqual(checked.body.changed, 1);
    assert.strictEqual(checked.body.templates[0].status, 'APPROVED', 'pending template picked up its new status from Meta');
    const clients = await request(app).get('/api/admin/templates/clients').set(bearer(ops));
    assert.strictEqual(clients.status, 200);
    assert.deepStrictEqual(clients.body.templates.map((x) => x.name), ['order_update'], 'admin WABA not mixed in');
    assert.strictEqual(clients.body.templates[0].workspaces[0].name, 'Dress Shop');
    assert.strictEqual(clients.body.templates[0].components, undefined, 'the list carries no message content');
    const one = await request(app).get('/api/admin/templates/item/C1').set(bearer(ops));
    assert.deepStrictEqual(one.body.template.components, [{ type: 'BODY', text: 'Your order shipped' }]);
  });
});
