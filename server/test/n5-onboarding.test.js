/**
 * N5: guided customer onboarding. Real server.js app, in-memory MongoDB. Meta
 * and the LLM are stubbed, so nothing leaves the test.
 *
 *   A. checklist statuses (Done / In review / To do / Locked) for all six steps
 *   B. staff-assisted WhatsApp connect: staff only, encrypted, never shown again
 *   C. Meta Embedded Signup stays off behind its feature flag
 *   D. services with prices, timings and AI answers
 *   E. template approval status per template
 *   F. the test message goes through the N1 send policy
 *   G. go live: locked until steps 1 to 5, then AI replies and campaigns
 *   H. the Notices box, using the existing N3 plan and trial state
 *   I. tenant isolation and no billing writes
 */
const test = require('node:test');
const assert = require('node:assert');
const axios = require('axios');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const SECRET_TOKEN = `EAAG${'AbCd1234'.repeat(5)}Wx7Q`;
const OTHER_TOKEN = `EAAG${'ZyXw9876'.repeat(5)}Kp2M`;
const PROFILE = {
  business_name: 'Sunrise Dental', business_description: 'Family dental clinic', service_area: 'Anna Nagar',
  business_hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }, timezone: 'Asia/Kolkata',
  products_and_services: ['Cleaning'], qualifying_questions: ['Treatment needed?', 'Preferred day?'], conversation_goal: 'book_appointment',
  tone: 'Warm', languages: ['English'], pricing_policy: 'share_listed', after_hours_message: 'Closed', handoff_contacts: 'Front desk',
};

let app;
let models;
let runAsSystem;
let runAsTenant;
let billing;
const sends = [];
let graphPhone = { id: '1000000001', display: '+91 98765 43210' };
const realPost = axios.post;
const realGet = axios.get;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.WA_SEND_PER_MINUTE = '100000';
  await startTestDb();
  models = require('../models');
  ({ runAsSystem, runAsTenant } = require('../services/tenantContext'));
  billing = require('../services/billing');
  ({ app } = require('../server'));
  axios.post = async (url, body, options) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    if (/\/messages$/.test(url)) {
      sends.push({ url, body, auth: options?.headers?.Authorization });
      if (sends.refuse) { const error = new Error('refused'); error.response = { data: { error: { code: 131026, message: 'SECRET META DETAIL' } } }; throw error; }
      return { data: { messages: [{ id: `wamid.${sends.length}` }] } };
    }
    return { data: { success: true } };
  };
  axios.get = async (url) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    if (/\/phone_numbers/.test(url)) return { data: { data: [{ id: graphPhone.id, display_phone_number: graphPhone.display, status: 'CONNECTED' }] } };
    if (/whatsapp_business_profile/.test(url)) return { data: { data: [{}] } };
    return { data: {} };
  };
});

test.after(async () => {
  axios.post = realPost;
  axios.get = realGet;
  await stopTestDb();
});

test.beforeEach(async () => {
  sends.length = 0;
  sends.refuse = false;
  graphPhone = { id: '1000000001', display: '+91 98765 43210' };
  for (const name of ['WA_EMBEDDED_SIGNUP_ENABLED', 'META_APP_ID', 'META_EMBEDDED_SIGNUP_CONFIG_ID', 'NERA_META_APP_SECRET', 'N8N_BRAIN_WEBHOOK_URL', 'BILLING_REQUIRE_PLAN', 'ONBOARDING_TEST_MAX_PER_DAY']) delete process.env[name];
  await clearCollections();
  await billing.plans.ensureDefaultPlans();
});

// ── helpers ─────────────────────────────────────────────────
const sys = (fn) => runAsSystem(fn, 'test');
const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
const createUser = async (fields) => (await sys(() => models.Users.create({ is_active: true, token_version: 0, password_hash: 'x', ...fields }))).toObject();
const staff = (role = 'ops') => createUser({ tenant_id: null, is_platform_staff: true, staff_role: role, email: `${role}@nera.test`, name: role });

// A workspace the way provisioning leaves it: in onboarding, no plan.
async function workspace(tenantId, { live = false, phone = null } = {}) {
  const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}`, phone });
  const agent = await createUser({ tenant_id: tenantId, role: 'agent', email: `agent${tenantId}@acme.test`, name: 'Agent' });
  await sys(() => models.Tenants.create({
    id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata',
    ...(live ? {} : { campaigns_enabled: false, ai_enabled: false }),
  }));
  const brand = await runAsTenant(tenantId, async () => (await models.Clients.create({ name: `Brand ${tenantId}`, whatsapp_status: 'not_configured' })).toObject());
  return { tenantId, owner, agent, brand };
}

const overview = async (ws) => {
  const res = await request(app).get('/api/onboarding').set(bearer(ws.owner));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const stepOf = (body, key) => body.steps.find((step) => step.key === key);
const statuses = (body) => Object.fromEntries(body.steps.map((step) => [step.key, step.status]));

const fillBusiness = (ws) => request(app).patch(`/api/clients/${ws.brand.id}`).set(bearer(ws.owner))
  .send({ name: 'Sunrise Dental', wa_website: 'https://sunrise.example.com', wa_address: '12 Main Road, Anna Nagar, Chennai' });

async function staffConnect(tenantId, { token = SECRET_TOKEN, number = '+91 98765 43210', phoneId = '1000000001', waba = '2000000001' } = {}) {
  const ops = await sys(() => models.Users.findOne({ is_platform_staff: true, staff_role: 'ops' }).lean()) || await staff('ops');
  graphPhone = { id: phoneId, display: number };
  return request(app).put(`/api/admin/tenants/${tenantId}/onboarding/whatsapp`).set(bearer(ops))
    .send({ whatsapp_number: number, phone_number_id: phoneId, wa_business_id: waba, wa_access_token: token });
}

const addTemplate = (waba, fields = {}) => sys(() => models.MetaWhatsappTemplates.create({
  template_id: `t${Math.random().toString(36).slice(2, 10)}`, waba_id: waba, name: 'hello_test', language: 'en', category: 'UTILITY',
  status: 'APPROVED', components: [{ type: 'BODY', text: 'Hello from the clinic' }], ...fields,
}));

const addService = (ws, fields = {}) => request(app).post('/api/onboarding/services').set(bearer(ws.owner))
  .send({ name: 'Teeth cleaning', price_inr: 500, duration_minutes: 30, answers: [{ question: 'Is it painful?', answer: 'No, it is gentle.' }], ...fields });

// Takes a workspace through steps 1 to 4 so the test message and go live are reachable.
async function readyForTest(ws, { template = {} } = {}) {
  assert.strictEqual((await fillBusiness(ws)).status, 200);
  const connected = await staffConnect(ws.tenantId);
  assert.strictEqual(connected.status, 200, JSON.stringify(connected.body));
  assert.strictEqual(connected.body.verified, true, JSON.stringify(connected.body));
  assert.strictEqual((await addService(ws)).status, 201);
  await addTemplate('2000000001', template);
}
const sendTest = (ws, body = { phone: '+91 98123 45678' }) => request(app).post('/api/onboarding/test-message').set(bearer(ws.owner)).send(body);

// ── A. checklist statuses ───────────────────────────────────
test('A: a new workspace starts with Locked steps and walks to Done', async () => {
  const ws = await workspace(1);
  let body = await overview(ws);
  assert.deepStrictEqual(statuses(body), { business: 'todo', whatsapp: 'todo', services: 'todo', templates: 'locked', test: 'locked', go_live: 'locked' });
  assert.strictEqual(body.live.is_live, false);
  assert.strictEqual(body.ready_to_go_live, false);

  // 1. business details through the existing brand route
  assert.strictEqual((await fillBusiness(ws)).status, 200);
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'business').status, 'done');

  // 2. the customer asks, our team is working on it: In review
  const asked = await request(app).post('/api/onboarding/whatsapp/request').set(bearer(ws.owner));
  assert.strictEqual(asked.status, 200);
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'whatsapp').status, 'in_review');
  assert.strictEqual(stepOf(body, 'templates').status, 'locked', 'templates wait for a connected number');

  // staff connect it
  const connected = await staffConnect(1);
  assert.strictEqual(connected.status, 200, JSON.stringify(connected.body));
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'whatsapp').status, 'done');
  assert.strictEqual(stepOf(body, 'templates').status, 'todo');
  assert.strictEqual(stepOf(body, 'test').status, 'locked', 'no approved template yet');

  // 3. services
  assert.strictEqual((await addService(ws)).status, 201);
  assert.strictEqual(stepOf(await overview(ws), 'services').status, 'done');

  // 4. templates: In review, then Done
  const template = await addTemplate('2000000001', { status: 'PENDING' });
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'templates').status, 'in_review');
  await sys(() => models.MetaWhatsappTemplates.updateOne({ template_id: template.template_id }, { $set: { status: 'APPROVED' } }));
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'templates').status, 'done');
  assert.strictEqual(stepOf(body, 'test').status, 'todo');
  assert.strictEqual(stepOf(body, 'go_live').status, 'locked');
  assert.ok(stepOf(body, 'go_live').blocked_by.includes('test'));

  // 5. the test message, then 6. go live is offered
  assert.strictEqual((await sendTest(ws)).status, 200);
  body = await overview(ws);
  assert.strictEqual(stepOf(body, 'test').status, 'done');
  assert.strictEqual(stepOf(body, 'go_live').status, 'todo');
  assert.strictEqual(body.ready_to_go_live, true);
});

test('A: business details stay To do until name, website and address are all saved', async () => {
  const ws = await workspace(1);
  await request(app).patch(`/api/clients/${ws.brand.id}`).set(bearer(ws.owner)).send({ wa_website: 'https://sunrise.example.com' });
  const step = stepOf(await overview(ws), 'business');
  assert.strictEqual(step.status, 'todo');
  assert.deepStrictEqual(step.missing, ['address']);
});

test('A: workspaces that predate onboarding are live and keep campaigns working', async () => {
  const ws = await workspace(1, { live: true });
  const body = await overview(ws);
  assert.strictEqual(body.live.is_live, true);
  assert.strictEqual(stepOf(body, 'go_live').status, 'done');
});

// ── B. staff-assisted connect ───────────────────────────────
test('B: only platform staff can enter WhatsApp details, and the token is never shown again', async () => {
  const ws = await workspace(1);
  const body = { whatsapp_number: '+91 98765 43210', phone_number_id: '1000000001', wa_business_id: '2000000001', wa_access_token: SECRET_TOKEN };

  // customers (owner included) cannot reach the staff screen
  for (const user of [ws.owner, ws.agent]) {
    const res = await request(app).put('/api/admin/tenants/1/onboarding/whatsapp').set(bearer(user)).send(body);
    assert.strictEqual(res.status, 403);
  }
  assert.strictEqual((await request(app).get('/api/admin/onboarding/whatsapp-queue').set(bearer(ws.owner))).status, 403);
  assert.strictEqual((await request(app).put('/api/admin/tenants/1/onboarding/whatsapp').send(body)).status, 401);

  const ops = await staff('ops');
  const saved = await request(app).put('/api/admin/tenants/1/onboarding/whatsapp').set(bearer(ops)).send(body);
  assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
  assert.strictEqual(saved.body.configured, true);
  assert.strictEqual(saved.body.verified, true);
  assert.strictEqual(saved.body.token_saved, true);

  // nothing that comes back carries the token or any part of it
  const again = await request(app).get('/api/admin/tenants/1/onboarding/whatsapp').set(bearer(ops));
  const queue = await request(app).get('/api/admin/onboarding/whatsapp-queue').set(bearer(ops));
  const customerView = await request(app).get('/api/onboarding').set(bearer(ws.owner));
  const clients = await request(app).get('/api/clients').set(bearer(ws.owner));
  for (const res of [saved, again, queue, customerView]) {
    const text = JSON.stringify(res.body);
    assert.ok(!text.includes(SECRET_TOKEN), 'token must not be returned');
    assert.ok(!text.includes(SECRET_TOKEN.slice(-4)), 'not even its last characters');
    assert.ok(!/wa_access_token|wa_token_last4/.test(text));
  }
  assert.ok(!JSON.stringify(clients.body).includes(SECRET_TOKEN));

  // stored encrypted, and the tenant sender (the existing code) can still read it
  const raw = await sys(() => models.Clients.collection.findOne({ tenant_id: 1 }));
  assert.ok(raw.wa_access_token_enc && raw.wa_access_token_enc.split(':').length === 3, 'ciphertext iv:tag:data');
  assert.ok(!raw.wa_access_token, 'no plain-text column');
  assert.ok(!JSON.stringify(raw).includes(SECRET_TOKEN));
  const { brandSenderForClientId } = require('../services/tenantSender');
  const sender = await runAsTenant(1, () => brandSenderForClientId(ws.brand.id));
  assert.strictEqual(sender.token, SECRET_TOKEN);
  assert.strictEqual(sender.phoneNumberId, '1000000001');

  // the audit trail records that a token was saved, never the token
  const audit = await sys(() => models.AuditEvents.find({ tenant_id: 1 }).lean());
  assert.ok(audit.some((row) => row.event === 'ONBOARDING_WHATSAPP_CONNECTED'));
  assert.ok(!JSON.stringify(audit).includes(SECRET_TOKEN));
});

test('B: the details are checked and a number cannot be shared between workspaces', async () => {
  const one = await workspace(1);
  await workspace(2);
  const ops = await staff('ops');
  const put = (tenantId, body) => request(app).put(`/api/admin/tenants/${tenantId}/onboarding/whatsapp`).set(bearer(ops))
    .send({ whatsapp_number: '+91 98765 43210', phone_number_id: '1000000001', wa_business_id: '2000000001', wa_access_token: SECRET_TOKEN, ...body });
  assert.strictEqual((await put(1, { whatsapp_number: '12' })).status, 400);
  assert.strictEqual((await put(1, { phone_number_id: 'abc' })).status, 400);
  assert.strictEqual((await put(1, { wa_business_id: '' })).status, 400);
  assert.strictEqual((await put(1, { wa_access_token: 'short' })).status, 400);
  assert.strictEqual((await put(99, {})).status, 404);
  assert.strictEqual((await put(1, {})).status, 200);
  const clash = await put(2, { wa_access_token: OTHER_TOKEN });
  assert.strictEqual(clash.status, 409);
  assert.strictEqual(clash.body.code, 'PHONE_NUMBER_IN_USE');
  assert.ok(!JSON.stringify(one).includes('undefined'));
});

test('B: a failed Meta check is reported to staff, and the customer sees no raw error', async () => {
  const ws = await workspace(1);
  const ops = await staff('ops');
  graphPhone = { id: '999', display: '+91 90000 00000' }; // Meta shows a different number
  const res = await request(app).put('/api/admin/tenants/1/onboarding/whatsapp').set(bearer(ops))
    .send({ whatsapp_number: '+91 98765 43210', phone_number_id: '1000000001', wa_business_id: '2000000001', wa_access_token: SECRET_TOKEN });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.verified, false);
  assert.ok(res.body.verify_error, 'staff are told why');
  const brand = await runAsTenant(1, () => models.Clients.findOne({}, { _id: 0, whatsapp_verification_error: 1 }).lean());
  assert.ok(brand.whatsapp_verification_error, 'the technical reason is kept for staff');
  const body = await overview(ws);
  const text = JSON.stringify(body);
  assert.ok(!text.includes(brand.whatsapp_verification_error), 'customer never sees the raw reason');
  assert.ok(body.notices.some((notice) => notice.id === 'whatsapp-failed' && notice.severity === 'critical'));
});

test('B: the staff queue lists customers who asked, first, and hides connected ones', async () => {
  const one = await workspace(1);
  const two = await workspace(2);
  await workspace(3);
  const ops = await staff('ops');
  await request(app).post('/api/onboarding/whatsapp/request').set(bearer(two.owner));
  await staffConnect(3, { phoneId: '1000000003', waba: '2000000003', number: '+91 98765 00003' });
  const queue = await request(app).get('/api/admin/onboarding/whatsapp-queue').set(bearer(ops));
  assert.strictEqual(queue.status, 200);
  assert.deepStrictEqual(queue.body.queue.map((row) => row.tenant_id), [2, 1]);
  assert.ok(queue.body.queue[0].requested_at);
  // asking twice does not move the original request time
  const again = await request(app).post('/api/onboarding/whatsapp/request').set(bearer(two.owner));
  assert.strictEqual(again.body.already, true);
  assert.ok(one);
});

test('B: only an owner or admin can ask for the connection', async () => {
  const ws = await workspace(1);
  assert.strictEqual((await request(app).post('/api/onboarding/whatsapp/request').set(bearer(ws.agent))).status, 403);
});

// ── C. Mode A behind a feature flag ─────────────────────────
test('C: Embedded Signup is off by default and refuses without calling Meta', async () => {
  const ws = await workspace(1);
  const body = await overview(ws);
  assert.strictEqual(body.embedded_signup.enabled, false);
  assert.strictEqual(stepOf(body, 'whatsapp').embedded_signup, false);
  const res = await request(app).post('/api/onboarding/whatsapp/embedded-signup').set(bearer(ws.owner))
    .send({ code: 'abc', phone_number_id: '1000000001', waba_id: '2000000001' });
  assert.strictEqual(res.status, 404);
  assert.strictEqual(res.body.code, 'FEATURE_OFF');
  const brand = await runAsTenant(1, () => models.Clients.findOne({}, { _id: 0, phone_number_id: 1 }).lean());
  assert.ok(!brand.phone_number_id, 'nothing was saved');
});

test('C: with the flag on but Meta settings missing it says it is not set up', async () => {
  process.env.WA_EMBEDDED_SIGNUP_ENABLED = 'true';
  const ws = await workspace(1);
  assert.strictEqual((await overview(ws)).embedded_signup.enabled, false);
  const res = await request(app).post('/api/onboarding/whatsapp/embedded-signup').set(bearer(ws.owner))
    .send({ code: 'abc', phone_number_id: '1000000001', waba_id: '2000000001' });
  assert.strictEqual(res.status, 503);
  assert.strictEqual(res.body.code, 'NOT_CONFIGURED');
});

test('C: with the flag on the customer\'s own code is exchanged and the token is stored encrypted', async () => {
  process.env.WA_EMBEDDED_SIGNUP_ENABLED = 'true';
  process.env.META_APP_ID = '123456789';
  process.env.META_EMBEDDED_SIGNUP_CONFIG_ID = '987654321';
  process.env.NERA_META_APP_SECRET = 'test-dummy-app-secret';
  const { gateway } = require('../services/onboarding/whatsapp');
  const realExchange = gateway.exchangeCode;
  const realPhone = gateway.phoneNumber;
  const seen = [];
  gateway.exchangeCode = async (code) => { seen.push(code); return OTHER_TOKEN; };
  gateway.phoneNumber = async () => '+91 98765 43210';
  try {
    const ws = await workspace(1);
    const config = (await overview(ws)).embedded_signup;
    assert.deepStrictEqual(config, { enabled: true, app_id: '123456789', config_id: '987654321' });
    assert.ok(!JSON.stringify(config).includes('test-dummy-app-secret'), 'the app secret never goes to the browser');
    assert.strictEqual((await request(app).post('/api/onboarding/whatsapp/embedded-signup').set(bearer(ws.agent)).send({})).status, 403);
    const bad = await request(app).post('/api/onboarding/whatsapp/embedded-signup').set(bearer(ws.owner)).send({ code: 'x' });
    assert.strictEqual(bad.status, 400);
    const res = await request(app).post('/api/onboarding/whatsapp/embedded-signup').set(bearer(ws.owner))
      .send({ code: 'one-time-code', phone_number_id: '1000000001', waba_id: '2000000001' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.verified, true);
    assert.deepStrictEqual(seen, ['one-time-code']);
    assert.ok(!JSON.stringify(res.body).includes(OTHER_TOKEN));
    const raw = await sys(() => models.Clients.collection.findOne({ tenant_id: 1 }));
    assert.ok(raw.wa_access_token_enc && !raw.wa_access_token);
    assert.strictEqual(stepOf(await overview(ws), 'whatsapp').status, 'done');
  } finally {
    gateway.exchangeCode = realExchange;
    gateway.phoneNumber = realPhone;
  }
});

// ── D. services ─────────────────────────────────────────────
test('D: a service needs a name, a price and a timing, and feeds the AI Brain', async () => {
  const ws = await workspace(1);
  const post = (body) => request(app).post('/api/onboarding/services').set(bearer(ws.owner)).send(body);
  assert.strictEqual((await post({ price_inr: 500, duration_minutes: 30 })).status, 400);
  assert.strictEqual((await post({ name: 'Cleaning', duration_minutes: 30 })).status, 400);
  assert.strictEqual((await post({ name: 'Cleaning', price_inr: -5, duration_minutes: 30 })).status, 400);
  assert.strictEqual((await post({ name: 'Cleaning', price_inr: 500 })).status, 400);
  assert.strictEqual((await post({ name: 'Cleaning', price_inr: 500, duration_minutes: 2 })).status, 400);
  assert.strictEqual((await post({ name: 'Cleaning', price_inr: 500, duration_minutes: 30, answers: [{ question: 'Painful?' }] })).status, 400);
  assert.strictEqual((await overview(ws)).steps[2].status, 'todo');

  const created = await addService(ws, { availability: 'Mon to Sat, 9 to 6' });
  assert.strictEqual(created.status, 201);
  const id = created.body.service.id;
  // the AI Brain reads it as a product document with the price in rupees
  const doc = await runAsTenant(1, () => models.BrainDocs.findOne({ id }).lean());
  assert.match(doc.doc_type, /^product:/);
  assert.match(doc.content, /Price: ₹500/);
  assert.match(doc.content, /Duration: 30 minutes/);
  assert.match(doc.content, /Q: Is it painful\?/);
  assert.match(doc.content, /A: No, it is gentle\./);
  assert.match(doc.content, /Availability: Mon to Sat/);

  const edited = await request(app).put(`/api/onboarding/services/${id}`).set(bearer(ws.owner))
    .send({ name: 'Teeth cleaning', price_inr: 650, duration_minutes: 45 });
  assert.strictEqual(edited.status, 200);
  assert.match((await runAsTenant(1, () => models.BrainDocs.findOne({ id }).lean())).content, /Price: ₹650/);
  const listed = await request(app).get('/api/onboarding/services').set(bearer(ws.owner));
  assert.strictEqual(listed.body.services.length, 1);

  // switching it off removes it from the count, deleting it removes it for good
  await request(app).patch(`/api/onboarding/services/${id}`).set(bearer(ws.owner)).send({ is_active: false });
  assert.strictEqual(stepOf(await overview(ws), 'services').status, 'todo');
  assert.strictEqual((await request(app).delete(`/api/onboarding/services/${id}`).set(bearer(ws.owner))).status, 200);
  assert.strictEqual((await request(app).delete(`/api/onboarding/services/${id}`).set(bearer(ws.owner))).status, 404);
});

test('D: an agent can read services but not change them', async () => {
  const ws = await workspace(1);
  assert.strictEqual((await request(app).get('/api/onboarding/services').set(bearer(ws.agent))).status, 200);
  assert.strictEqual((await addService({ ...ws, owner: ws.agent })).status, 403);
});

// ── E. templates ────────────────────────────────────────────
test('E: each template shows Meta\'s approval status', async () => {
  const ws = await workspace(1);
  await staffConnect(1);
  await addTemplate('2000000001', { name: 'welcome', status: 'APPROVED' });
  await addTemplate('2000000001', { name: 'offer', status: 'PENDING', category: 'MARKETING' });
  await addTemplate('2000000001', { name: 'promo', status: 'REJECTED', category: 'MARKETING' });
  await addTemplate('2000000001', { name: 'reminder', status: 'PAUSED' });
  const step = stepOf(await overview(ws), 'templates');
  const byName = Object.fromEntries(step.templates.map((template) => [template.name, template]));
  assert.deepStrictEqual(Object.fromEntries(Object.entries(byName).map(([name, t]) => [name, [t.status, t.status_label]])), {
    welcome: ['approved', 'Approved'], offer: ['in_review', 'In review'], promo: ['rejected', 'Rejected'], reminder: ['paused', 'Paused by Meta'],
  });
  assert.strictEqual(step.status, 'done');
  assert.deepStrictEqual(step.counts, { approved: 1, in_review: 1, rejected: 1, paused: 1, unknown: 0 });
});

test('E: Rejected templates alone leave the step To do with a notice', async () => {
  const ws = await workspace(1);
  await staffConnect(1);
  await addTemplate('2000000001', { name: 'promo', status: 'REJECTED' });
  const body = await overview(ws);
  assert.strictEqual(stepOf(body, 'templates').status, 'todo');
  assert.ok(body.notices.some((notice) => notice.id === 'templates-rejected'));
});

// ── F. test message through the N1 policy ───────────────────
test('F: the test message is a template from the customer\'s own number to their own phone', async () => {
  const ws = await workspace(1);
  await workspace(2);
  await readyForTest(ws);
  const res = await sendTest(ws, { phone: '098123 45678' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.sent, true);
  assert.strictEqual(res.body.to_last4, '5678');
  assert.strictEqual(sends.length, 1);
  assert.strictEqual(sends[0].url, 'https://graph.facebook.com/v21.0/1000000001/messages');
  assert.strictEqual(sends[0].auth, `Bearer ${SECRET_TOKEN}`, 'sent with this tenant\'s own token');
  assert.strictEqual(sends[0].body.to, '919812345678');
  assert.strictEqual(sends[0].body.type, 'template');
  assert.strictEqual(sends[0].body.template.name, 'hello_test');
  // the number they gave becomes their own profile number; next time it is not asked again
  assert.strictEqual((await runAsTenant(1, () => models.Users.findOne({ id: ws.owner.id }).lean())).phone, '+919812345678');
  assert.strictEqual((await overview(ws)).test_phone, '••••5678');
  // the send used a slot on the number, like every other business-initiated message
  const state = await runAsTenant(1, () => models.WhatsappNumberState.findOne({ phone_number_id: '1000000001' }).lean());
  assert.strictEqual(state.templates_today, 1);
});

test('F: it is refused before WhatsApp is connected and with no usable template', async () => {
  const ws = await workspace(1);
  assert.strictEqual((await sendTest(ws)).status, 409);
  await staffConnect(1);
  const none = await sendTest(ws);
  assert.strictEqual(none.status, 409);
  assert.strictEqual(none.body.code, 'NO_TEST_TEMPLATE');
  // a template with variables cannot be sent as it is
  await addTemplate('2000000001', { components: [{ type: 'BODY', text: 'Hello {{1}}' }] });
  assert.strictEqual((await sendTest(ws)).body.code, 'NO_TEST_TEMPLATE');
  assert.strictEqual(stepOf(await overview(ws), 'test').status, 'todo');
  assert.strictEqual(sends.length, 0);
});

test('F: a phone must be valid, and only an owner or admin can send', async () => {
  const ws = await workspace(1);
  await readyForTest(ws);
  assert.strictEqual((await sendTest(ws, {})).body.code, 'PHONE_REQUIRED');
  assert.strictEqual((await sendTest(ws, { phone: '12345' })).body.code, 'PHONE_REQUIRED');
  assert.strictEqual((await request(app).post('/api/onboarding/test-message').set(bearer(ws.agent)).send({ phone: '+919812345678' })).status, 403);
  assert.strictEqual(sends.length, 0);
});

test('F: attempts are limited per day', async () => {
  process.env.ONBOARDING_TEST_MAX_PER_DAY = '2';
  const ws = await workspace(1);
  await readyForTest(ws);
  assert.strictEqual((await sendTest(ws)).status, 200);
  assert.strictEqual((await sendTest(ws)).status, 200);
  const third = await sendTest(ws);
  assert.strictEqual(third.status, 429);
  assert.strictEqual(third.body.code, 'TEST_LIMIT');
  assert.strictEqual(sends.length, 2);
});

test('F: a marketing template needs the owner to confirm the number is their own; STOP is respected', async () => {
  const ws = await workspace(1);
  await readyForTest(ws, { template: { category: 'MARKETING' } });
  const refused = await sendTest(ws);
  assert.strictEqual(refused.status, 400);
  assert.strictEqual(refused.body.code, 'CONFIRMATION_REQUIRED');
  assert.strictEqual(sends.length, 0);
  const ok = await sendTest(ws, { phone: '+91 98123 45678', confirm_own_phone: true });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
  const consent = await runAsTenant(1, () => models.WhatsappConsents.findOne({ phone_key: '9812345678' }).lean());
  assert.strictEqual(consent.status, 'opted_in');
  assert.strictEqual(consent.opt_in_source, 'onboarding_test');

  // a number that said STOP is not messaged, even for a test
  await runAsTenant(1, () => require('../services/consent').recordOptOut({ phone: '9812345678', source: 'inbound_keyword', text: 'STOP' }));
  const stopped = await sendTest(ws, { confirm_own_phone: true });
  assert.strictEqual(stopped.status, 403);
  assert.strictEqual(stopped.body.code, 'CONTACT_OPTED_OUT');
  assert.strictEqual(sends.length, 1);
});

test('F: the N1 policy still applies: a paused number blocks a marketing test, a refused send says nothing raw', async () => {
  const ws = await workspace(1);
  await readyForTest(ws, { template: { category: 'MARKETING' } });
  await runAsTenant(1, () => require('../services/numberHealth').pauseMarketing('1000000001', { by: null, reason: 'quality drop' }));
  const paused = await sendTest(ws, { phone: '+91 98123 45678', confirm_own_phone: true });
  assert.strictEqual(paused.status, 423);
  assert.strictEqual(paused.body.code, 'NUMBER_PAUSED');
  assert.strictEqual(sends.length, 0);

  const second = await workspace(2);
  graphPhone = { id: '1000000002', display: '+91 98765 00002' };
  await readyForTestOn(second);
  sends.refuse = true;
  const failed = await sendTest(second);
  assert.strictEqual(failed.status, 502);
  assert.ok(!JSON.stringify(failed.body).includes('SECRET META DETAIL'), 'Meta\'s own message is not shown');
  assert.strictEqual(failed.body.code, 'TEST_SEND_FAILED');
  assert.strictEqual(stepOf(await overview(second), 'test').status, 'todo', 'a failed send is not Done');
});

async function readyForTestOn(ws) {
  await fillBusiness(ws);
  const res = await staffConnect(ws.tenantId, { phoneId: `100000000${ws.tenantId}`, waba: `200000000${ws.tenantId}`, number: `+91 98765 0000${ws.tenantId}`, token: OTHER_TOKEN });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  await addService(ws);
  await addTemplate(`200000000${ws.tenantId}`);
}

test('F: until go live only the onboarding test may send marketing; nobody else', async () => {
  const sendPolicy = require('../services/sendPolicy');
  const ws = await workspace(1);
  await readyForTest(ws, { template: { category: 'MARKETING' } });
  const lead = { id: 1, phone: '919812345678' };
  await runAsTenant(1, () => require('../services/consent').recordOptIn({ phone: lead.phone, source: 'manual', text: 'Agreed on a call' }));
  const blocked = await runAsTenant(1, () => sendPolicy.checkSend({ lead, kind: 'marketing', messageType: 'template' }));
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.code, 'NOT_LIVE');
  // utility and replies are not marketing and are not held back
  const utility = await runAsTenant(1, () => sendPolicy.checkSend({ lead, kind: 'utility', messageType: 'template' }));
  assert.strictEqual(utility.ok, true);
  // the same call from a live workspace passes
  const live = await workspace(2, { live: true });
  await runAsTenant(2, () => require('../services/consent').recordOptIn({ phone: lead.phone, source: 'manual', text: 'Agreed on a call' }));
  assert.strictEqual((await runAsTenant(2, () => sendPolicy.checkSend({ lead, kind: 'marketing', messageType: 'template' }))).ok, true);
  assert.ok(live);
});

// ── G. go live ──────────────────────────────────────────────
test('G: go live is refused until steps 1 to 5 are Done, naming what is left', async () => {
  const ws = await workspace(1);
  const early = await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner));
  assert.strictEqual(early.status, 409);
  assert.strictEqual(early.body.code, 'NOT_READY');
  assert.deepStrictEqual(early.body.blocked_by, ['business', 'whatsapp', 'services', 'templates', 'test']);
  const tenant = await sys(() => models.Tenants.findOne({ id: 1 }).lean());
  assert.strictEqual(tenant.campaigns_enabled, false);
  assert.strictEqual((await request(app).post('/api/onboarding/go-live').set(bearer(ws.agent))).status, 403);

  // one step short is still refused
  await readyForTest(ws);
  const almost = await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner));
  assert.strictEqual(almost.status, 409);
  assert.deepStrictEqual(almost.body.blocked_by, ['test']);
});

test('G: going live turns on campaigns and, when the AI Brain is ready, AI replies', async () => {
  process.env.N8N_BRAIN_WEBHOOK_URL = 'https://n8n.example.test/webhook/brain';
  const ws = await workspace(1);
  await runAsTenant(1, () => models.BrainProfiles.create({ profile: PROFILE, ai_enabled: false, brain_version: 1, version_type: 'client' }));
  await readyForTest(ws);
  assert.strictEqual((await sendTest(ws)).status, 200);

  // campaigns are held back until now
  const campaignBody = { name: 'Diwali', client_id: ws.brand.id, template_id: 1, target_status: 'new' };
  const before = await request(app).post('/api/campaigns').set(bearer(ws.owner)).send(campaignBody);
  assert.strictEqual(before.status, 403);
  assert.strictEqual(before.body.code, 'NOT_LIVE');

  const res = await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.campaigns, true);
  assert.strictEqual(res.body.ai_replies, true);
  const tenant = await sys(() => models.Tenants.findOne({ id: 1 }).lean());
  assert.strictEqual(tenant.campaigns_enabled, true);
  assert.strictEqual(tenant.ai_enabled, true);
  assert.ok(tenant.went_live_at);
  assert.strictEqual((await runAsTenant(1, () => models.BrainProfiles.findOne({}).lean())).ai_enabled, true);

  const after = await request(app).post('/api/campaigns').set(bearer(ws.owner)).send(campaignBody);
  assert.notStrictEqual(after.body?.code, 'NOT_LIVE', 'the live gate no longer applies');
  const body = await overview(ws);
  assert.strictEqual(stepOf(body, 'go_live').status, 'done');
  assert.strictEqual(body.live.is_live, true);
  assert.strictEqual(body.live.ai_enabled, true);

  // idempotent
  const again = await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner));
  assert.strictEqual(again.status, 200);
  assert.strictEqual(again.body.already_live, true);
  const audit = await sys(() => models.AuditEvents.find({ tenant_id: 1, event: 'ONBOARDING_WENT_LIVE' }).lean());
  assert.strictEqual(audit.length, 1);
});

test('G: with the AI Brain unfinished the workspace still goes live, and a notice says what is missing', async () => {
  const ws = await workspace(1);
  await readyForTest(ws);
  assert.strictEqual((await sendTest(ws)).status, 200);
  const res = await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner));
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.campaigns, true);
  assert.strictEqual(res.body.ai_replies, false);
  assert.strictEqual(res.body.ai_pending_reason, 'AI_PROFILE_INCOMPLETE');
  const tenant = await sys(() => models.Tenants.findOne({ id: 1 }).lean());
  assert.strictEqual(tenant.ai_enabled, false, 'AI stays off until the Brain is complete');
  const notice = (await overview(ws)).notices.find((item) => item.id === 'ai-profile');
  assert.ok(notice && notice.action.path === '/brain');
});

// ── H. notices, with the N3 plan and trial state ────────────
test('H: Notices show the plan state from billing and never change it', async () => {
  const ws = await workspace(1);
  let notices = (await overview(ws)).notices;
  assert.ok(notices.some((notice) => notice.id === 'plan-none' && notice.severity === 'info'));

  // BILLING_REQUIRE_PLAN makes the missing plan urgent and pauses AI
  process.env.BILLING_REQUIRE_PLAN = 'true';
  notices = (await overview(ws)).notices;
  assert.strictEqual(notices.find((notice) => notice.id === 'plan-none').severity, 'warning');
  assert.ok(notices.some((notice) => notice.id === 'ai-blocked' && notice.severity === 'critical'));
  delete process.env.BILLING_REQUIRE_PLAN;

  // a plan granted by staff is the trial: shown as one while it runs out
  const plan = await billing.plans.planByCode('whatsapp');
  await runAsTenant(1, () => billing.subscriptions.activate({ plan, source: 'staff:7' }));
  assert.ok(!(await overview(ws)).notices.some((notice) => notice.id.startsWith('plan-')), 'a fresh month needs no notice');
  await sys(() => models.Subscriptions.updateOne({ tenant_id: 1 }, { $set: { current_period_end: new Date(Date.now() + 3 * 24 * 3600 * 1000) } }));
  notices = (await overview(ws)).notices;
  const ending = notices.find((notice) => notice.id === 'plan-ending');
  assert.match(ending.title, /trial ends in 3 days/);
  // a paid plan says plan, not trial
  await sys(() => models.Subscriptions.updateOne({ tenant_id: 1 }, { $set: { 'meta.last_activation_source': 'payment' } }));
  assert.match((await overview(ws)).notices.find((notice) => notice.id === 'plan-ending').title, /plan ends in 3 days/);
  await sys(() => models.Subscriptions.updateOne({ tenant_id: 1 }, { $set: { current_period_end: new Date(Date.now() - 1000) } }));
  assert.strictEqual((await overview(ws)).notices.find((notice) => notice.id === 'plan-ended').severity, 'critical');
});

test('H: Notices flag a paused number and rejected templates, most urgent first', async () => {
  const ws = await workspace(1);
  await staffConnect(1);
  await addTemplate('2000000001', { name: 'promo', status: 'REJECTED' });
  await runAsTenant(1, () => require('../services/numberHealth').pauseMarketing('1000000001', { by: null, reason: 'quality drop' }));
  const { notices } = await overview(ws);
  const ids = notices.map((notice) => notice.id);
  assert.ok(ids.includes('number-paused') && ids.includes('templates-rejected'));
  assert.ok(ids.indexOf('number-paused') < ids.indexOf('templates-rejected'), 'critical before warning');
  for (const notice of notices) assert.ok(notice.title && notice.message);
});

// ── I. isolation and billing ────────────────────────────────
test('I: a workspace never sees or changes another workspace\'s setup', async () => {
  const one = await workspace(1);
  const two = await workspace(2);
  await readyForTest(one);
  const service = (await runAsTenant(1, () => models.BrainDocs.findOne({ doc_type: /^product:/ }).lean()));

  const seen = await request(app).get('/api/onboarding/services').set(bearer(two.owner));
  assert.deepStrictEqual(seen.body.services, []);
  assert.strictEqual((await request(app).put(`/api/onboarding/services/${service.id}`).set(bearer(two.owner)).send({ name: 'Hijack', price_inr: 1, duration_minutes: 10 })).status, 404);
  assert.strictEqual((await request(app).patch(`/api/onboarding/services/${service.id}`).set(bearer(two.owner)).send({ is_active: false })).status, 404);
  assert.strictEqual((await request(app).delete(`/api/onboarding/services/${service.id}`).set(bearer(two.owner))).status, 404);
  assert.match((await runAsTenant(1, () => models.BrainDocs.findOne({ id: service.id }).lean())).content, /Teeth cleaning/);

  // workspace 2 has not connected anything, so it sees none of workspace 1's templates, number or tokens
  const body = await overview(two);
  assert.deepStrictEqual(statuses(body), { business: 'todo', whatsapp: 'todo', services: 'todo', templates: 'locked', test: 'locked', go_live: 'locked' });
  assert.deepStrictEqual(stepOf(body, 'templates').templates, []);
  const text = JSON.stringify(body);
  assert.ok(!text.includes('hello_test') && !text.includes('Sunrise'));

  // a test message in workspace 2 can never use workspace 1's number or token
  assert.strictEqual((await sendTest(two)).status, 409);
  assert.strictEqual(sends.length, 0);
  // requests and state are per workspace
  await request(app).post('/api/onboarding/whatsapp/request').set(bearer(two.owner));
  assert.strictEqual(await runAsTenant(1, () => models.OnboardingStates.countDocuments({ wa_connect_requested_at: { $ne: null } })), 0);
  // no login, no setup
  assert.strictEqual((await request(app).get('/api/onboarding')).status, 401);
});

test('I: staff cannot open the customer onboarding screen, and onboarding never writes billing data', async () => {
  const ws = await workspace(1);
  const ops = await staff('ops');
  assert.strictEqual((await request(app).get('/api/onboarding').set(bearer(ops))).status, 403);
  process.env.N8N_BRAIN_WEBHOOK_URL = 'https://n8n.example.test/webhook/brain';
  await runAsTenant(1, () => models.BrainProfiles.create({ profile: PROFILE, ai_enabled: false, brain_version: 1, version_type: 'client' }));
  await readyForTest(ws);
  await sendTest(ws);
  assert.strictEqual((await request(app).post('/api/onboarding/go-live').set(bearer(ws.owner))).status, 200);
  for (const name of ['Subscriptions', 'WalletLedger', 'BillingOrders', 'BillingAlerts']) {
    assert.strictEqual(await sys(() => models[name].countDocuments({})), 0, `${name} untouched`);
  }
});

test('I: unexpected errors become a generic message, never a stack or Meta text', async () => {
  const ws = await workspace(1);
  const onboarding = require('../services/onboarding');
  const real = onboarding.overview;
  onboarding.overview = async () => { throw new Error('mongodb://secret-host:27017 exploded at /srv/app/index.js:1'); };
  try {
    const res = await request(app).get('/api/onboarding').set(bearer(ws.owner));
    assert.strictEqual(res.status, 500);
    assert.ok(!/mongodb|secret-host|\/srv\/app/.test(JSON.stringify(res.body)));
  } finally {
    onboarding.overview = real;
  }
});
