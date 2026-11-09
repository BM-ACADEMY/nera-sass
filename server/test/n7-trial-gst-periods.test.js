/**
 * N7: prepaid 1 / 3 / 6 month plans, the 7-day free trial and GST, on top of
 * the N3 billing flow. Real server.js app, in-memory MongoDB, dummy Razorpay
 * keys; Razorpay, WhatsApp and the LLM are stubbed, so nothing leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

const KEY_ID = 'rzp_test_dummy_key_id';
const KEY_SECRET = 'test-dummy-razorpay-key-secret';
const WEBHOOK_SECRET = 'test-dummy-razorpay-webhook-secret';
const DAY = 24 * 3600 * 1000;
const PROFILE = {
  business_name: 'Sunrise Dental', business_description: 'Family dental clinic', service_area: 'Anna Nagar',
  business_hours: { days: [0, 1, 2, 3, 4, 5, 6], open: '00:00', close: '23:59' }, timezone: 'Asia/Kolkata',
  products_and_services: ['Cleaning'], qualifying_questions: ['Treatment needed?'], conversation_goal: 'book_appointment',
  tone: 'Warm', languages: ['English'], pricing_policy: 'share_listed', after_hours_message: 'Closed', handoff_contacts: 'Front desk',
};

let app;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.RAZORPAY_KEY_ID = KEY_ID;
  process.env.RAZORPAY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
  delete process.env.BILLING_REQUIRE_PLAN;
  delete process.env.BILLING_GST_PERCENT;
  process.env.WA_SEND_PER_MINUTE = '100000';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test('N7: periods, trial and GST', async (t) => {
  const axios = require('axios');
  const openRouter = require('../services/openrouter');
  const models = require('../models');
  const { Users, Tenants, Clients, Subscriptions, BillingOrders, BillingAlerts, BillingTrials, BillingTrialAttempts, BillingInvoices, BrainProfiles, Leads, Conversations, Messages, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const billing = require('../services/billing');
  const sendPolicy = require('../services/sendPolicy');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });

  const realCreateOrder = billing.razorpay.gateway.createOrder;
  let gatewayCalls;
  billing.razorpay.gateway.createOrder = async (input) => {
    gatewayCalls.push(input);
    return { id: `order_test_${gatewayCalls.length}`, amount: input.amountPaise, currency: input.currency, status: 'created', receipt: input.receipt };
  };
  const realPost = axios.post;
  const realGenerate = openRouter.models.generateContent;
  let sends;

  t.beforeEach(async () => {
    await clearCollections();
    notify.clearOutbox();
    gatewayCalls = [];
    sends = [];
    delete process.env.BILLING_REQUIRE_PLAN;
    await billing.plans.ensureDefaultPlans();
    axios.post = async (url, body) => { sends.push({ url, body }); return { data: { messages: [{ id: `wamid.${sends.length}` }] } }; };
    openRouter.models.generateContent = async () => ({ text: JSON.stringify({ reply: 'Sure, we can help.', handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, answered_from: 'business_info' }), usage: {} });
  });
  t.after(() => {
    billing.razorpay.gateway.createOrder = realCreateOrder;
    axios.post = realPost;
    openRouter.models.generateContent = realGenerate;
  });

  const createUser = async (fields) => (await sys(() => Users.create({ is_active: true, token_version: 0, password_hash: 'x', ...fields }))).toObject();
  async function workspace(tenantId, { phone = `98000000${String(tenantId).padStart(2, '0')}`, whatsapp = `+91 90000 000${String(tenantId).padStart(2, '0')}` } = {}) {
    const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}` });
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata' }));
    const agent = await createUser({ tenant_id: tenantId, role: 'agent', email: `agent${tenantId}@acme.test`, name: 'Agent' });
    const brand = await runAsTenant(tenantId, async () => (await Clients.create({ name: `Brand ${tenantId}`, phone_number_id: `PN${tenantId}`, wa_access_token: 'test-dummy-token', whatsapp_status: 'verified', phone, whatsapp_number: whatsapp })).toObject());
    return { owner, agent, brand };
  }
  const founder = () => createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });
  const checkoutSignature = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const webhookBody = (orderId, paymentId, amount) => JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured' } } },
  });
  const signedWebhook = (body) => request(app).post('/webhook/razorpay/billing')
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex'))
    .send(body);

  async function order(owner, planCode, months) {
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: planCode, period_months: months });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    return created.body;
  }
  async function subscribe(owner, planCode, months = 1) {
    const created = await order(owner, planCode, months);
    const orderId = created.checkout.order_id;
    const paymentId = `pay_${planCode}_${months}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const verified = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(orderId, paymentId) });
    assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
    return { orderId, paymentId, body: verified.body, created };
  }
  async function aiWorkspace(tenantId, options) {
    const ws = await workspace(tenantId, options);
    const { lead, conversation } = await runAsTenant(tenantId, async () => {
      await BrainProfiles.create({ profile: PROFILE, ai_enabled: true, brain_version: 1, version_type: 'client' });
      const lead = (await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: ws.brand.id, status: 'new', last_inbound_at: new Date() })).toObject();
      const conversation = (await Conversations.create({ lead_id: lead.id, phone: '9876543210', status: 'open' })).toObject();
      return { lead, conversation };
    });
    return { ...ws, lead, conversation };
  }
  const inbound = (tenantId, conversation, content) => runAsTenant(tenantId, async () => (await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content, msg_type: 'text', sent_at: new Date() })).toObject());
  const aiReply = async (tenantId, ws, text) => {
    const msg = await inbound(tenantId, ws.conversation, text);
    return request(app).post('/api/internal/ai/reply').set(service(tenantId)).send({ lead_id: ws.lead.id, message_id: msg.id });
  };
  const startTrial = (owner, body = { business_name: 'Sunrise Dental', website: 'https://www.sunrisedental.in/' }) => request(app).post('/api/billing/trial/start').set(bearer(owner)).send(body);
  const summary = (owner) => request(app).get('/api/billing/summary').set(bearer(owner));

  // ── Billing periods ─────────────────────────────────────
  await t.test('P1. Plans carry 1, 3 and 6 month table prices with 18 percent GST worked out on top', async () => {
    const { agent } = await workspace(1);
    const res = await request(app).get('/api/billing/plans').set(bearer(agent));
    assert.strictEqual(res.status, 200);
    const prices = Object.fromEntries(res.body.plans.map((p) => [p.code, p.periods.map((x) => [x.months, x.price_inr])]));
    assert.deepStrictEqual(prices, {
      desk: [[1, 799], [3, 2149], [6, 3799]],
      whatsapp: [[1, 1999], [3, 5399], [6, 9599]],
      complete: [[1, 3999], [3, 10799], [6, 19199]],
    });
    const desk3 = res.body.plans[0].periods[1];
    assert.strictEqual(desk3.price_paise, 214900);
    assert.strictEqual(desk3.gst_rate_percent, 18);
    assert.strictEqual(desk3.gst_paise, 38682);
    assert.strictEqual(desk3.total_paise, 253582);
    assert.strictEqual(res.body.plans[0].price_inr, 799, 'the monthly price is unchanged');
    // Plans seeded before N7 (no period table) get the launch table once, never overwriting an edit.
    await sys(() => models.Plans.updateOne({ code: 'desk' }, { $unset: { period_prices_inr: '' } }));
    await billing.plans.ensureDefaultPlans();
    assert.strictEqual((await billing.plans.planByCode('desk')).periods.length, 3);
    await sys(() => models.Plans.updateOne({ code: 'whatsapp' }, { $unset: { period_prices_inr: '' }, $set: { price_inr: 2499 } }));
    await billing.plans.ensureDefaultPlans();
    assert.deepStrictEqual((await billing.plans.planByCode('whatsapp')).periods.map((p) => [p.months, p.price_inr]), [[1, 2499]], 'an edited monthly price is sold monthly only until staff fill the table');
  });

  await t.test('P2. A 3 month order charges the table price plus GST, stores the three amounts apart, activates 3 months and issues an invoice once', async () => {
    const { owner } = await workspace(1);
    const before = Date.now();
    const { body, created, paymentId, orderId } = await subscribe(owner, 'desk', 3);
    assert.strictEqual(created.checkout.amount, 253582, 'Razorpay is asked for the total');
    assert.strictEqual(gatewayCalls[0].amountPaise, 253582);
    assert.strictEqual(created.order.price_paise, 214900);
    assert.strictEqual(created.order.gst_paise, 38682);
    assert.strictEqual(created.order.total_paise, 253582);
    assert.strictEqual(created.order.period_months, 3);
    const stored = await runAsTenant(1, () => BillingOrders.findOne({ razorpay_order_id: orderId }).lean());
    assert.deepStrictEqual([stored.price_paise, stored.gst_rate_percent, stored.gst_paise, stored.total_paise, stored.amount_paise], [214900, 18, 38682, 253582, 253582]);

    assert.strictEqual(body.subscription.period_months, 3);
    assert.strictEqual(body.subscription.price_inr, 2149);
    const end = new Date(body.subscription.current_period_end).getTime();
    assert.ok(end > before + 88 * DAY && end < before + 93 * DAY, 'about three months');
    assert.ok(new Date(body.subscription.allowance_resets_at).getTime() < before + 32 * DAY, 'the allowance resets after the first month');

    // The invoice: numbered, with the customer's business name, plan, price, GST and total.
    assert.ok(body.invoice, 'the verify answer carries the invoice');
    assert.match(body.invoice.invoice_number, /^GN-\d{4}-000001$/);
    const invoice = await runAsTenant(1, () => BillingInvoices.findOne({}).lean());
    assert.strictEqual(invoice.customer_business_name, 'Workspace 1');
    assert.strictEqual(invoice.plan_code, 'desk');
    assert.strictEqual(invoice.period_months, 3);
    assert.deepStrictEqual([invoice.price_paise, invoice.gst_paise, invoice.total_paise], [214900, 38682, 253582]);
    assert.strictEqual(invoice.razorpay_payment_id, paymentId);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'INVOICE_ISSUED', tenant_id: 1 })));
    // The webhook for the same payment adds nothing; a webhook for the price without GST is ignored.
    await signedWebhook(webhookBody(orderId, paymentId, 253582));
    await signedWebhook(webhookBody(orderId, paymentId, 214900));
    assert.strictEqual(await runAsTenant(1, () => BillingInvoices.countDocuments({})), 1, 'one invoice per payment id');
    assert.strictEqual(await runAsTenant(1, () => Subscriptions.countDocuments({})), 1);
    assert.strictEqual(new Date((await runAsTenant(1, () => Subscriptions.findOne({}).lean())).current_period_end).getTime(), end, 'activated once');

    // A renewal of the same plan for 6 months adds six months; a wrong period is refused.
    const renewed = await subscribe(owner, 'desk', 6);
    const end2 = new Date(renewed.body.subscription.current_period_end).getTime();
    assert.ok(end2 > end + 180 * DAY && end2 < end + 186 * DAY, 'six more months on the paid period');
    assert.match(renewed.body.invoice.invoice_number, /000002$/);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'desk', period_months: 2 })).status, 400);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'desk', period_months: 'x' })).status, 400);

    // Staff change the 6 month price in the table; the next order uses it, with GST on top.
    const staff = await founder();
    const desk = await billing.plans.planByCode('desk');
    const patched = await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ period_prices_inr: { 1: 799, 3: 2149, 6: 3599 } });
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.body));
    const cheaper = await order(owner, 'desk', 6);
    assert.strictEqual(cheaper.checkout.amount, Math.round(359900 * 1.18));
    assert.strictEqual((await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ period_prices_inr: { 2: 100 } })).status, 400);
  });

  await t.test('P3. On a 3 month plan the AI allowance resets every month inside the paid period', async () => {
    const ws = await aiWorkspace(1);
    const staff = await founder();
    const desk = await billing.plans.planByCode('desk');
    await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ ai_replies_month: 2 });
    await subscribe(ws.owner, 'desk', 3);
    assert.strictEqual((await aiReply(1, ws, 'one')).body.sent, true);
    assert.strictEqual((await aiReply(1, ws, 'two')).body.sent, true);
    assert.strictEqual((await aiReply(1, ws, 'three')).body.sent, false, 'the month\'s allowance is used');
    let s = await summary(ws.owner);
    assert.strictEqual(s.body.ai.used, 2);

    // A month passes: the period started 35 days ago and the earlier replies belong to the first month.
    const now = Date.now();
    const start = new Date(now - 35 * DAY);
    await runAsTenant(1, async () => {
      await Subscriptions.updateOne({}, { $set: { current_period_start: start, current_period_end: billing.subscriptions.addMonths(start, 3) } });
      await Messages.updateMany({ direction: 'outbound', is_ai: true }, { $set: { sent_at: new Date(now - 40 * DAY) } });
    });
    s = await summary(ws.owner);
    assert.strictEqual(s.body.ai.used, 0, 'a new monthly cycle');
    assert.strictEqual(s.body.ai.allowed, true);
    assert.ok(new Date(s.body.ai.period_start).getTime() > now - 7 * DAY && new Date(s.body.ai.period_start).getTime() <= now - 3 * DAY, 'the cycle began on the monthly anniversary');
    assert.ok(new Date(s.body.ai.period_end).getTime() > now + 20 * DAY, 'and resets next month');
    assert.strictEqual((await aiReply(1, ws, 'four')).body.sent, true);
    assert.strictEqual((await aiReply(1, ws, 'five')).body.sent, true);
    assert.strictEqual((await aiReply(1, ws, 'six')).body.sent, false);
    const warnings = await runAsTenant(1, () => BillingAlerts.find({ kind: 'ai_allowance_low' }).lean());
    assert.strictEqual(warnings.length, 2, 'the 20 percent warning goes once per monthly cycle');
  });

  // ── Invoices ────────────────────────────────────────────
  await t.test('V1. Invoices are listed and downloaded as PDF by the workspace that paid, and by nobody else', async () => {
    const a = await workspace(1);
    const b = await workspace(2);
    const { body } = await subscribe(a.owner, 'whatsapp', 1);
    const list = await request(app).get('/api/billing/invoices').set(bearer(a.agent));
    assert.strictEqual(list.status, 403, 'agents do not see billing');
    const mine = await request(app).get('/api/billing/invoices').set(bearer(a.owner));
    assert.strictEqual(mine.status, 200);
    assert.strictEqual(mine.body.invoices.length, 1);
    assert.strictEqual(mine.body.invoices[0].total_paise, Math.round(199900 * 1.18));
    assert.ok(!JSON.stringify(mine.body).includes('tenant_id'));

    const pdf = await request(app).get(`/api/billing/invoices/${body.invoice.id}/pdf`).set(bearer(a.owner)).buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });
    assert.strictEqual(pdf.status, 200, pdf.text);
    assert.match(pdf.headers['content-type'], /application\/pdf/);
    assert.match(pdf.headers['content-disposition'], new RegExp(body.invoice.invoice_number));
    assert.strictEqual(pdf.body.slice(0, 5).toString('latin1'), '%PDF-');
    const text = pdf.body.toString('latin1');
    assert.ok(text.includes(body.invoice.invoice_number), 'the invoice number is printed');
    assert.ok(text.includes('Workspace 1'), 'the customer business name is printed');
    assert.ok(text.includes('GST @ 18%'));
    assert.ok(text.includes('2,358.82'), 'the total 1999 + 18 percent');
    assert.ok(text.includes('%%EOF'));

    assert.strictEqual((await request(app).get(`/api/billing/invoices/${body.invoice.id}/pdf`).set(bearer(b.owner))).status, 404, 'another workspace cannot download it');
    assert.deepStrictEqual((await request(app).get('/api/billing/invoices').set(bearer(b.owner))).body.invoices, []);
    assert.strictEqual((await request(app).get(`/api/billing/invoices/${body.invoice.id}/pdf`)).status, 401);
  });

  // ── Free trial ──────────────────────────────────────────
  await t.test('T1. The trial starts without a card, needs business name and website, and shows days left and the upgrade', async () => {
    const { owner, agent } = await workspace(1);
    assert.strictEqual((await startTrial(agent)).status, 403);
    assert.strictEqual((await startTrial(owner, { website: 'sunrisedental.in' })).status, 400, 'business name required');
    assert.strictEqual((await startTrial(owner, { business_name: 'Sunrise Dental' })).status, 400, 'website required');
    assert.strictEqual((await startTrial(owner, { business_name: 'Sunrise Dental', website: 'not a site' })).status, 400);
    assert.strictEqual(gatewayCalls.length, 0, 'no card, no Razorpay');

    const before = Date.now();
    const started = await startTrial(owner);
    assert.strictEqual(started.status, 201, JSON.stringify(started.body));
    assert.strictEqual(started.body.trial.status, 'active');
    assert.strictEqual(started.body.trial.days_left, 7);
    assert.strictEqual(started.body.subscription.is_trial, true);
    assert.strictEqual(started.body.subscription.plan_code, 'trial');
    const end = new Date(started.body.subscription.current_period_end).getTime();
    assert.ok(end > before + 7 * DAY - 5000 && end <= before + 7 * DAY + 5000);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'TRIAL_STARTED', tenant_id: 1 })));

    const s = await summary(owner);
    assert.strictEqual(s.body.trial.active, true);
    assert.strictEqual(s.body.trial.days_left, 7);
    assert.deepStrictEqual(s.body.trial.upgrade, { plan_code: 'whatsapp', period_months: 1 });
    assert.strictEqual(s.body.plan.is_trial, true);
    assert.strictEqual(s.body.ai.allowance, 50);
    assert.strictEqual(s.body.seats.limit, 1);
    assert.strictEqual(s.body.numbers.limit, 1);
    assert.strictEqual(s.body.subscription.days_left, 7);
    // The workspace summary shows the single seat too.
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(owner))).body.usage.max_users, 1);
    // Starting again is refused and logged.
    const again = await startTrial(owner);
    assert.strictEqual(again.status, 409);
    assert.strictEqual(again.body.code, 'TRIAL_ALREADY_USED');
    const attempts = await runAsTenant(1, () => BillingTrialAttempts.find({}).lean());
    assert.strictEqual(attempts.length, 1);
    assert.deepStrictEqual(attempts[0].matched, ['workspace']);
    // A workspace already on a paid plan needs no trial.
    const paid = await workspace(2);
    await subscribe(paid.owner, 'desk', 1);
    const onPlan = await startTrial(paid.owner, { business_name: 'Other Co', website: 'other.co.in' });
    assert.strictEqual(onPlan.status, 409);
    assert.strictEqual(onPlan.body.code, 'ALREADY_ON_PLAN');
  });

  await t.test('T2. One trial per business, website, WhatsApp number, email and phone; repeats are refused and logged', async () => {
    const first = await workspace(1, { phone: '9800000001', whatsapp: '+91 90000 00001' });
    assert.strictEqual((await startTrial(first.owner)).status, 201);
    const cases = [
      { id: 2, options: { phone: '9800000002', whatsapp: '+91 90000 00002' }, body: { business_name: 'Totally Different', website: 'http://SunriseDental.in/pricing' }, matched: ['website'] },
      { id: 3, options: { phone: '9800000003', whatsapp: '+91 90000 00003' }, body: { business_name: '  SUNRISE   Dental! ', website: 'another-site.in' }, matched: ['business'] },
      { id: 4, options: { phone: '9800000004', whatsapp: '0090000 00001' }, body: { business_name: 'Fourth Shop', website: 'fourth.in' }, matched: ['whatsapp'] },
      { id: 5, options: { phone: '+91-98000-00001', whatsapp: '+91 90000 00005' }, body: { business_name: 'Fifth Shop', website: 'fifth.in' }, matched: ['phone'] },
    ];
    for (const c of cases) {
      const ws = await workspace(c.id, c.options);
      const res = await startTrial(ws.owner, c.body);
      assert.strictEqual(res.status, 409, `${c.matched}: ${JSON.stringify(res.body)}`);
      assert.strictEqual(res.body.code, 'TRIAL_ALREADY_USED');
      assert.ok(!JSON.stringify(res.body).includes('Workspace 1'), 'the other business is not named');
      const attempt = await runAsTenant(c.id, () => BillingTrialAttempts.findOne({}).lean());
      assert.deepStrictEqual(attempt.matched, c.matched);
      assert.strictEqual(attempt.matched_tenant_id, 1);
      assert.strictEqual(await runAsTenant(c.id, () => Subscriptions.countDocuments({})), 0, 'no trial subscription');
    }
    // The same owner email in another workspace: refused too.
    const sixthOwner = await createUser({ tenant_id: 6, role: 'owner', email: 'owner1@acme.test ', name: 'Dup' }).catch(() => null);
    if (sixthOwner) {
      await sys(() => Tenants.create({ id: 6, name: 'Workspace 6', status: 'active', owner_user_id: sixthOwner.id }));
      await runAsTenant(6, () => Clients.create({ name: 'Brand 6', phone: '9800000006', whatsapp_number: '+91 90000 00006' }));
      const res = await startTrial(sixthOwner, { business_name: 'Sixth Shop', website: 'sixth.in' });
      assert.strictEqual(res.status, 409);
      assert.deepStrictEqual((await runAsTenant(6, () => BillingTrialAttempts.findOne({}).lean())).matched, ['email']);
    }
    assert.strictEqual(await sys(() => AuditEvents.countDocuments({ event: 'TRIAL_BLOCKED' })), sixthOwner ? 5 : 4);
    assert.strictEqual(await sys(() => BillingTrials.countDocuments({})), 1);
    // A different business with its own identity gets its trial.
    const fresh = await workspace(7, { phone: '9800000007', whatsapp: '+91 90000 00007' });
    assert.strictEqual((await startTrial(fresh.owner, { business_name: 'Fresh Bakes', website: 'freshbakes.in' })).status, 201);
  });

  await t.test('T3. On the trial: replies to people who wrote first go out; templates, campaigns, exports and extras do not; AI stops at 50', async () => {
    const ws = await aiWorkspace(1);
    assert.strictEqual((await startTrial(ws.owner)).status, 201);

    // The N1 send policy: a service reply inside the window passes, business-initiated sends do not.
    const check = (options) => runAsTenant(1, () => sendPolicy.checkSend({ lead: ws.lead, phoneNumberId: ws.brand.phone_number_id, ...options }));
    assert.strictEqual((await check({ kind: 'service', messageType: 'text' })).ok, true);
    assert.strictEqual((await check({ kind: 'marketing', messageType: 'template' })).code, 'TRIAL_REPLIES_ONLY');
    assert.strictEqual((await check({ kind: 'utility', messageType: 'template' })).code, 'TRIAL_REPLIES_ONLY');
    assert.strictEqual((await check({ kind: 'service', messageType: 'template' })).code, 'TRIAL_REPLIES_ONLY', 'a template is business-initiated');
    const relay = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: ws.lead.id, message: 'Hello from the desk' });
    assert.strictEqual(relay.status, 200, JSON.stringify(relay.body));
    const template = await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: ws.lead.id, template: 'promo_offer' });
    assert.strictEqual(template.status, 403);
    assert.strictEqual(template.body.code, 'TRIAL_REPLIES_ONLY');
    assert.strictEqual(sends.length, 1, 'only the reply reached WhatsApp');

    // Campaigns, exports, extras and a second seat.
    const campaign = await request(app).post('/api/campaigns').set(bearer(ws.owner)).send({ name: 'Diwali', client_id: ws.brand.id, template_id: 1, target_status: 'all' });
    assert.strictEqual(campaign.status, 403);
    assert.strictEqual(campaign.body.code, 'TRIAL_FEATURE_BLOCKED');
    assert.match(campaign.body.error, /not included in the free trial/);
    assert.strictEqual((await request(app).post('/api/leads/exports').set(bearer(ws.owner)).send({ mode: 'all' })).status, 403);
    assert.strictEqual((await request(app).get(`/api/contacts/${ws.lead.id}/export.csv`).set(bearer(ws.owner))).status, 403);
    assert.strictEqual((await request(app).get('/api/data-export/workspace.csv').set(bearer(ws.owner))).status, 403);
    const extra = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
    assert.strictEqual(extra.status, 403);
    assert.strictEqual(extra.body.code, 'TRIAL_FEATURE_BLOCKED');
    const invite = await request(app).post('/api/team/invitations').set(bearer(ws.owner)).send({ email: 'second@acme.test', role: 'agent', name: 'Second' });
    assert.strictEqual(invite.status, 409, 'one seat');
    // Deleting a contact on request still works on a trial.
    assert.notStrictEqual((await request(app).post(`/api/contacts/${ws.lead.id}/erase`).set(bearer(ws.owner)).send({ confirm: true })).status, 403);

    // 50 AI replies in total (the n8n relay above counts as one, as in N3), then the AI stops and the owner is told to upgrade.
    for (let i = 1; i <= 48; i += 1) assert.strictEqual((await aiReply(1, ws, `q${i}`)).body.sent, true, `reply ${i}`);
    assert.strictEqual((await summary(ws.owner)).body.ai.left, 1);
    assert.strictEqual((await aiReply(1, ws, 'q50')).body.sent, true);
    const blocked = await aiReply(1, ws, 'q51');
    assert.strictEqual(blocked.body.sent, false);
    assert.match(blocked.body.reason, /free trial's 50 AI replies are used up/);
    assert.strictEqual(sends.length, 50);
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'ai_blocked' })), 1);
    const relayBlocked = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: ws.lead.id, message: 'one more' });
    assert.strictEqual(relayBlocked.status, 402);
    assert.strictEqual(relayBlocked.body.code, 'TRIAL_AI_USED');
    assert.strictEqual((await check({ kind: 'service', messageType: 'text' })).ok, true, 'a person can still reply in the inbox');
    assert.strictEqual(await runAsTenant(1, () => models.WalletLedger.countDocuments({})), 0, 'a trial never touches a wallet');
  });

  await t.test('T4. Day 5 email, day 7 stop with the end-of-trial email, then everything waits for the upgrade; paying lifts the trial', async () => {
    const ws = await aiWorkspace(1);
    assert.strictEqual((await startTrial(ws.owner)).status, 201);
    const now = Date.now();
    // Nothing on day 4.
    await runAsTenant(1, () => BillingTrials.updateOne({}, { $set: { started_at: new Date(now - 4 * DAY), ends_at: new Date(now + 3 * DAY) } }));
    assert.strictEqual((await billing.trial.sweep()).notified, 0);
    // Day 5: one email, once.
    await runAsTenant(1, async () => {
      await BillingTrials.updateOne({}, { $set: { started_at: new Date(now - 5 * DAY - 3600000), ends_at: new Date(now + 2 * DAY - 3600000) } });
      await Subscriptions.updateOne({}, { $set: { current_period_start: new Date(now - 5 * DAY - 3600000), current_period_end: new Date(now + 2 * DAY - 3600000) } });
    });
    assert.strictEqual((await billing.trial.sweep()).notified, 1);
    assert.strictEqual((await billing.trial.sweep()).notified, 0);
    const day5 = notify.outbox().filter((m) => m.to === ws.owner.email && /ends soon/.test(m.subject));
    assert.strictEqual(day5.length, 1);
    assert.match(day5[0].text, /ends in 2 days/);
    assert.strictEqual((await summary(ws.owner)).body.trial.days_left, 2);

    // Day 7: the trial stops.
    await runAsTenant(1, async () => {
      await BillingTrials.updateOne({}, { $set: { ends_at: new Date(now - 1000) } });
      await Subscriptions.updateOne({}, { $set: { current_period_end: new Date(now - 1000) } });
    });
    const swept = await billing.orders.expireLapsed();
    assert.strictEqual(swept.expired, 1);
    assert.strictEqual(swept.trials, 1);
    assert.strictEqual((await runAsTenant(1, () => BillingTrials.findOne({}).lean())).status, 'expired');
    assert.strictEqual(notify.outbox().filter((m) => m.to === ws.owner.email && /free trial has ended/.test(m.subject)).length, 1);
    await billing.orders.expireLapsed();
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'trial_expired' })), 1, 'told once');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'TRIAL_EXPIRED', tenant_id: 1 })));

    let s = await summary(ws.owner);
    assert.strictEqual(s.body.trial.ended, true);
    assert.strictEqual(s.body.trial.days_left, 0);
    assert.strictEqual(s.body.subscription.status, 'expired');
    assert.deepStrictEqual(s.body.trial.upgrade, { plan_code: 'whatsapp', period_months: 1 });
    assert.strictEqual(s.body.ai.allowed, false);
    assert.match(s.body.ai.reason, /trial has ended/);
    const stopped = await aiReply(1, ws, 'anyone there?');
    assert.strictEqual(stopped.body.sent, false, 'no plan requirement needed: an ended trial is stopped');
    const relay = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: ws.lead.id, message: 'from n8n' });
    assert.strictEqual(relay.status, 402);
    assert.strictEqual(relay.body.code, 'TRIAL_ENDED');
    const manual = await runAsTenant(1, () => sendPolicy.checkSend({ lead: ws.lead, kind: 'service', messageType: 'text', phoneNumberId: ws.brand.phone_number_id }));
    assert.strictEqual(manual.ok, false);
    assert.strictEqual(manual.code, 'TRIAL_ENDED', 'even a typed reply waits for the upgrade');
    assert.strictEqual((await request(app).post('/api/campaigns').set(bearer(ws.owner)).send({ name: 'x' })).body.code, 'TRIAL_ENDED');
    assert.strictEqual(sends.length, 0);

    // One-click upgrade: the normal plan order. The trial is converted, limits lifted, invoice issued.
    const upgraded = await subscribe(ws.owner, s.body.trial.upgrade.plan_code, s.body.trial.upgrade.period_months);
    assert.strictEqual(upgraded.body.subscription.is_trial, false);
    assert.strictEqual(upgraded.body.subscription.plan_code, 'whatsapp');
    assert.match(upgraded.body.message, /trial limits are lifted/);
    assert.strictEqual((await runAsTenant(1, () => BillingTrials.findOne({}).lean())).status, 'converted');
    s = await summary(ws.owner);
    assert.strictEqual(s.body.trial.active, false);
    assert.strictEqual(s.body.trial.status, 'converted');
    assert.strictEqual(s.body.seats.limit, 2);
    assert.strictEqual((await aiReply(1, ws, 'back')).body.sent, true);
    assert.strictEqual((await request(app).post('/api/internal/send-template').set(service(1)).send({ lead_id: ws.lead.id, template: 'promo_offer' })).body.code, 'CONSENT_REQUIRED', 'the N1 rules apply again, not the trial rule');
  });

  await t.test('T5. Staff extend a trial to 14 days at most, with a reason, audited; ops staff and customers cannot', async () => {
    const ws = await workspace(1);
    assert.strictEqual((await startTrial(ws.owner)).status, 201);
    const staff = await founder();
    const ops = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', email: 'ops@nera.test', name: 'Ops' });
    const extend = (user, body) => request(app).post('/api/admin/tenants/1/billing/trial/extend').set(bearer(user)).send(body);
    assert.strictEqual((await extend(staff, {})).status, 400, 'a reason is required');
    assert.strictEqual((await extend(staff, { days: 3, reason: 'x' })).status, 400);
    assert.strictEqual((await extend(ops, { days: 3, reason: 'Customer asked for more time' })).status, 403);
    assert.strictEqual((await extend(ws.owner, { days: 3, reason: 'Please' })).status, 403);
    assert.strictEqual((await extend(staff, { days: 8, reason: 'Customer asked for more time' })).status, 400, '7 + 8 is over 14');

    const started = new Date((await runAsTenant(1, () => BillingTrials.findOne({}).lean())).started_at).getTime();
    const three = await extend(staff, { days: 3, reason: 'Onboarding call moved to next week' });
    assert.strictEqual(three.status, 200, JSON.stringify(three.body));
    assert.strictEqual(three.body.trial.days, 10);
    assert.strictEqual(three.body.trial.days_left, 10);
    assert.strictEqual(new Date(three.body.subscription.current_period_end).getTime(), started + 10 * DAY);
    const toMax = await extend(staff, { reason: 'Second request, approved by founder' });
    assert.strictEqual(toMax.status, 200);
    assert.strictEqual(toMax.body.trial.days, 14);
    assert.strictEqual(toMax.body.trial.can_extend, false);
    assert.strictEqual((await extend(staff, { days: 1, reason: 'One more day' })).status, 400);
    const row = await runAsTenant(1, () => BillingTrials.findOne({}).lean());
    assert.strictEqual(row.extensions.length, 2);
    assert.deepStrictEqual(row.extensions.map((e) => [e.days, e.reason, e.by]), [[3, 'Onboarding call moved to next week', staff.id], [4, 'Second request, approved by founder', staff.id]]);
    const audits = await sys(() => AuditEvents.find({ event: 'TRIAL_EXTENDED', tenant_id: 1 }).sort({ id: 1 }).lean());
    assert.strictEqual(audits.length, 2);
    assert.strictEqual(audits[0].meta.reason, 'Onboarding call moved to next week');
    assert.strictEqual(audits[0].actor_user_id, staff.id);
    assert.strictEqual(audits[1].meta.total_days, 14);
    // The staff billing view shows the trial and its extensions.
    const view = await request(app).get('/api/admin/tenants/1/billing').set(bearer(staff));
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.trial.days, 14);
    assert.strictEqual(view.body.trial.extensions.length, 2);
    // An expired trial can be revived within the 14 days.
    const ws2 = await workspace(2, { phone: '9800000022', whatsapp: '+91 90000 00022' });
    assert.strictEqual((await startTrial(ws2.owner, { business_name: 'Second Shop', website: 'second.in' })).status, 201);
    await runAsTenant(2, async () => {
      await BillingTrials.updateOne({}, { $set: { started_at: new Date(Date.now() - 8 * DAY), ends_at: new Date(Date.now() - DAY) } });
      await Subscriptions.updateOne({}, { $set: { current_period_start: new Date(Date.now() - 8 * DAY), current_period_end: new Date(Date.now() - DAY) } });
    });
    await billing.orders.expireLapsed();
    assert.strictEqual((await summary(ws2.owner)).body.trial.ended, true);
    const revived = await request(app).post('/api/admin/tenants/2/billing/trial/extend').set(bearer(staff)).send({ reason: 'Payment delayed by the customer bank' });
    assert.strictEqual(revived.status, 200, JSON.stringify(revived.body));
    assert.strictEqual(revived.body.trial.status, 'active');
    assert.strictEqual(revived.body.trial.days_left, 6);
    assert.strictEqual((await summary(ws2.owner)).body.trial.active, true);
  });

  await t.test('I1. Isolation: trials, invoices and attempts never cross workspaces; collections fail closed', async () => {
    const a = await workspace(1);
    const b = await workspace(2, { phone: '9800000022', whatsapp: '+91 90000 00022' });
    await startTrial(a.owner);
    await subscribe(b.owner, 'desk', 3);
    const bSummary = await summary(b.owner);
    assert.strictEqual(bSummary.body.trial.active, false);
    assert.strictEqual(bSummary.body.trial.available, false, 'on a plan already');
    assert.strictEqual(bSummary.body.subscription.is_trial, false);
    const aSummary = await summary(a.owner);
    assert.strictEqual(aSummary.body.trial.active, true);
    assert.deepStrictEqual((await request(app).get('/api/billing/invoices').set(bearer(a.owner))).body.invoices, []);
    const rows = await sys(() => Promise.all([BillingTrials.find({}).lean(), BillingInvoices.find({}).lean()]));
    assert.deepStrictEqual(rows[0].map((r) => r.tenant_id), [1]);
    assert.deepStrictEqual(rows[1].map((r) => r.tenant_id), [2]);
    await assert.rejects(() => BillingTrials.find({}), (err) => err.name === 'TenantContextError');
    await assert.rejects(() => BillingInvoices.find({}), (err) => err.name === 'TenantContextError');
    await assert.rejects(() => BillingTrialAttempts.find({}), (err) => err.name === 'TenantContextError');
  });
});
