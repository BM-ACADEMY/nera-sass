/**
 * N3: plans, subscriptions and the wallet. Real server.js app, in-memory
 * MongoDB, dummy Razorpay keys; the Razorpay API, WhatsApp and the LLM are
 * stubbed, so nothing leaves the test.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken, TEST_INTERNAL_KEY } = require('./setup');

const KEY_ID = 'rzp_test_dummy_key_id';
const KEY_SECRET = 'test-dummy-razorpay-key-secret';
const WEBHOOK_SECRET = 'test-dummy-razorpay-webhook-secret';
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
  // The N1 per-number send limit (60 a minute) is not what this suite tests;
  // A2 sends over a hundred AI replies in a few seconds.
  process.env.WA_SEND_PER_MINUTE = '100000';
  await startTestDb();
  ({ app } = require('../server'));
});

test.after(async () => {
  await stopTestDb();
});

test('N3: plans, subscriptions and wallet', async (t) => {
  const axios = require('axios');
  const openRouter = require('../services/openrouter');
  const models = require('../models');
  const { Users, Tenants, Clients, Plans, Subscriptions, WalletLedger, BillingOrders, BillingAlerts, BrainProfiles, Leads, Conversations, Messages, AuditEvents } = models;
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const billing = require('../services/billing');
  const notify = require('../services/notify');
  const sys = (fn) => runAsSystem(fn, 'test');
  const bearer = (user) => ({ Authorization: `Bearer ${makeToken(user)}` });
  const service = (tenantId) => ({ 'x-internal-key': TEST_INTERNAL_KEY, 'x-tenant-id': String(tenantId) });

  // Razorpay stand-in: records orders, never calls the network.
  const realCreateOrder = billing.razorpay.gateway.createOrder;
  let gatewayCalls;
  let gatewayFails = false;
  billing.razorpay.gateway.createOrder = async (input) => {
    gatewayCalls.push(input);
    if (gatewayFails) { const err = new Error('socket hang up with secret rzp_live_SHOULD_NOT_LEAK'); throw err; }
    return { id: `order_test_${gatewayCalls.length}`, amount: input.amountPaise, currency: input.currency, status: 'created', receipt: input.receipt };
  };
  const realPost = axios.post;
  const realGenerate = openRouter.models.generateContent;
  let sends;

  t.beforeEach(async () => {
    await clearCollections();
    notify.clearOutbox();
    gatewayCalls = [];
    gatewayFails = false;
    sends = [];
    delete process.env.BILLING_REQUIRE_PLAN;
    await billing.plans.ensureDefaultPlans();
    axios.post = async (url, body) => { sends.push({ url, body }); return { data: { messages: [{ id: `wamid.${sends.length}` }] } }; };
    openRouter.models.generateContent = async () => ({ text: JSON.stringify({ reply: 'Sure, we can help.', handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false }), usage: {} });
  });
  t.after(() => {
    billing.razorpay.gateway.createOrder = realCreateOrder;
    axios.post = realPost;
    openRouter.models.generateContent = realGenerate;
  });

  const createUser = async (fields) => (await sys(() => Users.create({ is_active: true, token_version: 0, password_hash: 'x', ...fields }))).toObject();
  async function workspace(tenantId) {
    const owner = await createUser({ tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@acme.test`, name: `Owner ${tenantId}` });
    await sys(() => Tenants.create({ id: tenantId, name: `Workspace ${tenantId}`, status: 'active', owner_user_id: owner.id, timezone: 'Asia/Kolkata' }));
    const agent = await createUser({ tenant_id: tenantId, role: 'agent', email: `agent${tenantId}@acme.test`, name: 'Agent' });
    const brand = await runAsTenant(tenantId, async () => (await Clients.create({ name: `Brand ${tenantId}`, phone_number_id: `PN${tenantId}`, wa_access_token: 'test-dummy-token' })).toObject());
    return { owner, agent, brand };
  }
  const founder = () => createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'founder', email: 'founder@nera.test', name: 'Founder' });
  const checkoutSignature = (orderId, paymentId) => crypto.createHmac('sha256', KEY_SECRET).update(`${orderId}|${paymentId}`).digest('hex');
  const webhookBody = (orderId, paymentId, amount, extra = {}) => JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: 'captured', ...extra } } },
  });
  const signedWebhook = (body, path = '/webhook/razorpay/billing', secret = WEBHOOK_SECRET) => request(app).post(path)
    .set('Content-Type', 'application/json')
    .set('x-razorpay-signature', crypto.createHmac('sha256', secret).update(body).digest('hex'))
    .send(body);
  const balance = (tenantId) => runAsTenant(tenantId, () => billing.wallet.balancePaise());
  const ledgerRows = (tenantId) => runAsTenant(tenantId, () => WalletLedger.find({}).lean());

  // Pays a plan for a workspace the way the browser would: order, then verified checkout.
  async function subscribe(owner, planCode) {
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: planCode });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.checkout.order_id;
    const paymentId = `pay_${planCode}_${Date.now()}`;
    const verified = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(orderId, paymentId) });
    assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
    return { orderId, paymentId, body: verified.body };
  }
  // Puts money in the wallet the only way money gets in: a signed webhook for a top-up order.
  async function topUp(owner, tenantId, inr) {
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: inr });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.checkout.order_id;
    const paymentId = `pay_topup_${tenantId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const res = await signedWebhook(webhookBody(orderId, paymentId, inr * 100));
    assert.strictEqual(res.status, 200);
    return { orderId, paymentId };
  }
  // A workspace with its AI Brain on, a lead and an open chat.
  async function aiWorkspace(tenantId) {
    const ws = await workspace(tenantId);
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
  const tenantOf = (id) => sys(() => Tenants.findOne({ id }).lean());

  // ── Plans ────────────────────────────────────────────────
  await t.test('P1. The three plans come from the plans table, at 799 / 1999 / 3999 rupees, and a price change is read live', async () => {
    const { owner, agent } = await workspace(1);
    const res = await request(app).get('/api/billing/plans').set(bearer(agent));
    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.plans.map((p) => [p.code, p.price_inr]), [['desk', 799], ['whatsapp', 1999], ['complete', 3999]]);
    assert.strictEqual((await request(app).get('/api/billing/plans')).status, 401, 'login required');

    // Platform Admin changes a price in the table; the next order uses it.
    const staff = await founder();
    const desk = res.body.plans[0];
    const patched = await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ price_inr: 899, ai_replies_month: 250 });
    assert.strictEqual(patched.status, 200, JSON.stringify(patched.body));
    assert.strictEqual(patched.body.plan.price_inr, 899);
    const order = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'desk', amount_inr: 1 });
    assert.strictEqual(order.status, 201);
    // N7: 18 percent GST is added on top of the table price (899 + 161.82).
    assert.strictEqual(order.body.checkout.amount, 106082, 'amount comes from the table (plus GST), never from the browser');
    assert.strictEqual(gatewayCalls[0].amountPaise, 106082);
    assert.strictEqual(order.body.order.price_paise, 89900);
    assert.strictEqual(order.body.order.gst_paise, 16182);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'PLAN_UPDATED' })));
    // Seeding again never overwrites an edited price.
    await billing.plans.ensureDefaultPlans();
    assert.strictEqual((await billing.plans.planByCode('desk')).price_inr, 899);
    // Ops staff may look but not change prices.
    const ops = await createUser({ tenant_id: null, is_platform_staff: true, staff_role: 'ops', email: 'ops@nera.test', name: 'Ops' });
    assert.strictEqual((await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(ops)).send({ price_inr: 1 })).status, 403);
    assert.strictEqual((await request(app).get('/api/admin/billing/plans').set(bearer(ops))).status, 200);
  });

  // ── Wallet ledger ────────────────────────────────────────
  await t.test('W1. wallet_ledger is append-only, the balance is the sum, and each workspace sees only its own money', async () => {
    await workspace(1);
    await workspace(2);
    await runAsTenant(1, async () => {
      await billing.wallet.credit({ amountPaise: 50000, reason: 'adjustment', referenceType: 'test', referenceId: 'c1' });
      await billing.wallet.debit({ amountPaise: 12500, reason: 'ai_overage', referenceType: 'test', referenceId: 'd1' });
    });
    assert.strictEqual(await balance(1), 37500);
    assert.strictEqual(await balance(2), 0, 'tenant 2 has its own empty wallet');
    assert.strictEqual((await ledgerRows(2)).length, 0);
    const row = (await ledgerRows(1))[0];
    for (const attempt of [
      () => WalletLedger.updateOne({ id: row.id }, { $set: { amount_paise: 1 } }),
      () => WalletLedger.updateMany({}, { $set: { signed_paise: 0 } }),
      () => WalletLedger.findOneAndUpdate({ id: row.id }, { $set: { amount_paise: 1 } }),
      () => WalletLedger.deleteOne({ id: row.id }),
      () => WalletLedger.deleteMany({}),
      () => WalletLedger.findOneAndDelete({ id: row.id }),
      () => WalletLedger.replaceOne({ id: row.id }, { amount_paise: 1 }),
    ]) {
      await assert.rejects(() => runAsTenant(1, attempt), (err) => err.name === 'LedgerImmutableError');
      await assert.rejects(() => sys(attempt), (err) => err.name === 'LedgerImmutableError', 'not even platform code');
    }
    await assert.rejects(() => runAsTenant(1, async () => { const doc = await WalletLedger.findOne({ id: row.id }); doc.amount_paise = 1; await doc.save(); }), (err) => err.name === 'LedgerImmutableError');
    assert.strictEqual(await balance(1), 37500, 'nothing changed');
    // Never below zero; a repeated reference is not applied twice.
    await assert.rejects(() => runAsTenant(1, () => billing.wallet.debit({ amountPaise: 37501, reason: 'extra_seat', referenceType: 'test', referenceId: 'd2' })), (err) => err.code === 'INSUFFICIENT_FUNDS');
    const again = await runAsTenant(1, () => billing.wallet.credit({ amountPaise: 50000, reason: 'adjustment', referenceType: 'test', referenceId: 'c1' }));
    assert.strictEqual(again.duplicate, true);
    assert.strictEqual(await balance(1), 37500);
  });

  // ── Orders and checkout ──────────────────────────────────
  await t.test('O1. Orders are created on the server by owners/admins only; bad input and gateway failures never leak details', async () => {
    const { owner, agent } = await workspace(1);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(agent)).send({ purpose: 'subscription', plan_code: 'desk' })).status, 403);
    assert.strictEqual((await request(app).post('/api/billing/orders').send({ purpose: 'subscription', plan_code: 'desk' })).status, 401);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'platinum' })).status, 400);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 5 })).status, 400, 'below the minimum');
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 100.555 })).status, 400);
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'gift' })).status, 400);
    assert.strictEqual(gatewayCalls.length, 0);

    const ok = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 500 });
    assert.strictEqual(ok.status, 201);
    assert.strictEqual(ok.body.checkout.amount, 50000);
    assert.strictEqual(ok.body.checkout.key_id, KEY_ID, 'public key id only');
    assert.ok(!JSON.stringify(ok.body).includes(KEY_SECRET));
    const stored = await runAsTenant(1, () => BillingOrders.findOne({ razorpay_order_id: ok.body.checkout.order_id }).lean());
    assert.strictEqual(stored.tenant_id, 1);
    assert.strictEqual(stored.status, 'created');

    gatewayFails = true;
    const failed = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 500 });
    assert.ok([500, 502].includes(failed.status), `status ${failed.status}`);
    assert.ok(!JSON.stringify(failed.body).includes('SHOULD_NOT_LEAK'), 'the customer never sees the raw error');
    assert.match(failed.body.error, /try again/i, 'a friendly message instead');
    assert.ok(!JSON.stringify(failed.body).includes('socket'));
  });

  await t.test('O2. Checkout: a bad signature is refused; a good one activates the plan for one month and is audited', async () => {
    const { owner } = await workspace(1);
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'whatsapp' });
    const orderId = created.body.checkout.order_id;
    const bad = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: 'deadbeef' });
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(bad.body.code, 'SIGNATURE_INVALID');
    assert.strictEqual(await runAsTenant(1, () => Subscriptions.countDocuments({})), 0);

    const before = Date.now();
    const good = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: checkoutSignature(orderId, 'pay_1') });
    assert.strictEqual(good.status, 200, JSON.stringify(good.body));
    assert.strictEqual(good.body.subscription.plan_code, 'whatsapp');
    assert.strictEqual(good.body.subscription.status, 'active');
    const end = new Date(good.body.subscription.current_period_end).getTime();
    assert.ok(end > before + 27 * 86400000 && end < before + 32 * 86400000, 'about a month');
    assert.strictEqual(good.body.order.status, 'fulfilled');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'SUBSCRIPTION_ACTIVATED', tenant_id: 1 })));

    // Replaying the callback changes nothing; a second verify is idempotent.
    const replay = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: checkoutSignature(orderId, 'pay_1') });
    assert.strictEqual(replay.status, 200);
    assert.strictEqual(await runAsTenant(1, () => Subscriptions.countDocuments({})), 1);
    const sub = await runAsTenant(1, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(new Date(sub.current_period_end).getTime(), end, 'not extended twice');

    // Summary and /api/tenant reflect the plan.
    const summary = await request(app).get('/api/billing/summary').set(bearer(owner));
    assert.strictEqual(summary.status, 200);
    assert.strictEqual(summary.body.plan.code, 'whatsapp');
    assert.strictEqual(summary.body.ai.allowance, 1000);
    assert.strictEqual(summary.body.seats.limit, 2);
    assert.strictEqual(summary.body.wallet.balance_paise, 0);
    const tenant = await request(app).get('/api/tenant').set(bearer(owner));
    assert.strictEqual(tenant.body.usage.max_users, 2);
    assert.strictEqual(tenant.body.subscription.plan_code, 'whatsapp');
    assert.strictEqual(tenant.body.permissions.manage_billing, true);

    // Another workspace cannot verify this order.
    const other = await workspace(2);
    const foreign = await request(app).post('/api/billing/orders/verify').set(bearer(other.owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_1', razorpay_signature: checkoutSignature(orderId, 'pay_1') });
    assert.strictEqual(foreign.status, 404);
  });

  await t.test('O3. Renewal of the same plan extends the period; a different plan starts a new period', async () => {
    const { owner } = await workspace(1);
    const first = await subscribe(owner, 'desk');
    const end1 = new Date(first.body.subscription.current_period_end).getTime();
    const second = await subscribe(owner, 'desk');
    const end2 = new Date(second.body.subscription.current_period_end).getTime();
    assert.ok(end2 > end1 + 27 * 86400000, 'a renewal adds a month to the paid period');
    const upgraded = await subscribe(owner, 'complete');
    assert.strictEqual(upgraded.body.subscription.plan_code, 'complete');
    assert.ok(new Date(upgraded.body.subscription.current_period_end).getTime() < end2, 'a plan change starts from now');
    assert.strictEqual(await runAsTenant(1, () => Subscriptions.countDocuments({})), 1, 'one row per workspace');
  });

  // ── Webhook ──────────────────────────────────────────────
  await t.test('H1. The wallet is credited only by a signed webhook, once per payment id, for the right amount and tenant', async () => {
    const { owner } = await workspace(1);
    await workspace(2);
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 1000 });
    const orderId = created.body.checkout.order_id;

    // The checkout callback alone puts no money in the wallet.
    const verified = await request(app).post('/api/billing/orders/verify').set(bearer(owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: 'pay_w1', razorpay_signature: checkoutSignature(orderId, 'pay_w1') });
    assert.strictEqual(verified.status, 200);
    assert.strictEqual(verified.body.wallet_credit_pending, true);
    assert.strictEqual(await balance(1), 0);

    // Unsigned or wrongly signed: refused, no credit.
    const body = webhookBody(orderId, 'pay_w1', 100000);
    assert.strictEqual((await request(app).post('/webhook/razorpay/billing').set('Content-Type', 'application/json').send(body)).status, 401);
    assert.strictEqual((await signedWebhook(body, '/webhook/razorpay/billing', 'wrong-secret')).status, 401);
    assert.strictEqual(await balance(1), 0);

    // Wrong amount: ignored.
    await signedWebhook(webhookBody(orderId, 'pay_w1', 1000));
    assert.strictEqual(await balance(1), 0);

    // Signed and correct: credited once, however often Razorpay retries.
    assert.strictEqual((await signedWebhook(body)).status, 200);
    assert.strictEqual(await balance(1), 100000);
    await signedWebhook(body);
    await signedWebhook(body);
    assert.strictEqual(await balance(1), 100000);
    assert.strictEqual((await ledgerRows(1)).length, 1);
    assert.strictEqual((await ledgerRows(1))[0].reference_id, 'pay_w1');
    assert.strictEqual(await balance(2), 0, 'the other workspace got nothing');
    const order = await runAsTenant(1, () => BillingOrders.findOne({ razorpay_order_id: orderId }).lean());
    assert.strictEqual(order.status, 'fulfilled');
    assert.strictEqual(order.fulfilled_by, 'webhook');
    assert.ok(await sys(() => AuditEvents.exists({ event: 'PAYMENT_VERIFIED', tenant_id: 1 })));

    // A webhook naming an unknown order, or carrying tenant notes, does nothing.
    await signedWebhook(webhookBody('order_unknown', 'pay_x', 100000, { notes: { tenant_id: '1' } }));
    assert.strictEqual(await balance(1), 100000);

    // The older /webhook/razorpay address forwards billing payments too.
    const second = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 200 });
    await signedWebhook(webhookBody(second.body.checkout.order_id, 'pay_w2', 20000), '/webhook/razorpay');
    await new Promise((resolve) => setTimeout(resolve, 150)); // that route answers before it works
    assert.strictEqual(await balance(1), 120000);
  });

  await t.test('H2. A plan payment that only reaches the webhook still activates, once', async () => {
    const { owner } = await workspace(1);
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'desk' });
    const orderId = created.body.checkout.order_id;
    // 799 plus 18 percent GST (N7) is what Razorpay captures.
    await signedWebhook(webhookBody(orderId, 'pay_s1', 94282));
    await signedWebhook(webhookBody(orderId, 'pay_s1', 94282));
    const sub = await runAsTenant(1, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(sub.plan_code, 'desk');
    assert.strictEqual(sub.status, 'active');
    const end = new Date(sub.current_period_end).getTime();
    assert.ok(end < Date.now() + 32 * 86400000, 'one month, not two');
    assert.strictEqual(await balance(1), 0, 'a plan payment is not wallet money');
  });

  // ── AI replies: allowance, wallet, blocking, warnings ────
  await t.test('A1. AI replies stop when the plan allowance is used and the wallet is empty; the owner is told once', async () => {
    const ws = await aiWorkspace(1);
    const staff = await founder();
    const desk = await billing.plans.planByCode('desk');
    await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ ai_replies_month: 2 });
    await subscribe(ws.owner, 'desk');

    assert.strictEqual((await aiReply(1, ws, 'one')).body.sent, true);
    assert.strictEqual((await aiReply(1, ws, 'two')).body.sent, true);
    const blocked = await aiReply(1, ws, 'three');
    assert.strictEqual(blocked.body.sent, false, JSON.stringify(blocked.body));
    assert.match(blocked.body.reason, /wallet is empty/);
    assert.strictEqual(sends.length, 2, 'the third reply never reached WhatsApp');
    assert.strictEqual((await runAsTenant(1, () => Leads.findOne({ id: ws.lead.id }).lean())).needs_human, true, 'the team is told to take over');

    const alerts = await runAsTenant(1, () => BillingAlerts.find({}).sort({ id: 1 }).lean());
    assert.deepStrictEqual(alerts.map((a) => a.kind), ['ai_allowance_low', 'ai_blocked']);
    const mails = notify.outbox();
    assert.strictEqual(mails.filter((m) => m.to === ws.owner.email && /paused/.test(m.subject)).length, 1);
    await aiReply(1, ws, 'four');
    assert.strictEqual((await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'ai_blocked' }))), 1, 'told once per period');

    const summary = await request(app).get('/api/billing/summary').set(bearer(ws.owner));
    assert.strictEqual(summary.body.ai.allowed, false);
    assert.strictEqual(summary.body.ai.used, 2);
    assert.strictEqual(summary.body.ai.left, 0);
  });

  await t.test('A2. With money in the wallet, overage replies go out and are debited per reply; 20 percent warnings fire once', async () => {
    const ws = await aiWorkspace(1);
    const staff = await founder();
    const desk = await billing.plans.planByCode('desk');
    // 10 replies included, then ₹1 each from the wallet.
    await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ ai_replies_month: 10, ai_overage_price_paise: 100 });
    await subscribe(ws.owner, 'desk');
    await topUp(ws.owner, 1, 100); // ₹100 = 10,000 paise... minimum top-up is ₹100
    assert.strictEqual(await balance(1), 10000);

    for (let i = 1; i <= 10; i += 1) assert.strictEqual((await aiReply(1, ws, `q${i}`)).body.sent, true, `reply ${i}`);
    assert.strictEqual(await balance(1), 10000, 'included replies are free');
    const lowAllowance = await runAsTenant(1, () => BillingAlerts.find({ kind: 'ai_allowance_low' }).lean());
    assert.strictEqual(lowAllowance.length, 1, 'warned once when 20 percent was left');
    assert.ok(notify.outbox().some((m) => m.to === ws.owner.email && /running low/.test(m.subject)));

    assert.strictEqual((await aiReply(1, ws, 'overage 1')).body.sent, true);
    assert.strictEqual(await balance(1), 9900, 'one rupee per overage reply');
    const debit = (await ledgerRows(1)).find((r) => r.reason === 'ai_overage');
    assert.strictEqual(debit.direction, 'debit');
    assert.strictEqual(debit.reference_type, 'message');
    assert.strictEqual(debit.tenant_id, 1);

    // Spend down to the 20 percent line: 79 more replies leave ₹20.
    for (let i = 0; i < 79; i += 1) { const r = await aiReply(1, ws, `o${i}`); assert.strictEqual(r.body.sent, true, `overage reply ${i}: ${JSON.stringify(r.body)}`); }
    assert.strictEqual(await balance(1), 2000);
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'wallet_low' })), 1);
    for (let i = 0; i < 20; i += 1) assert.strictEqual((await aiReply(1, ws, `z${i}`)).body.sent, true);
    assert.strictEqual(await balance(1), 0);
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'wallet_low' })), 1, 'still one wallet warning for this top-up');
    const empty = await aiReply(1, ws, 'no money');
    assert.strictEqual(empty.body.sent, false);
    assert.strictEqual(await balance(1), 0, 'never negative');
    // A fresh top-up turns the AI back on.
    await topUp(ws.owner, 1, 100);
    assert.strictEqual((await aiReply(1, ws, 'back')).body.sent, true);
    assert.strictEqual(await balance(1), 9900);
  });

  await t.test('A3. The older n8n reply route shares the allowance: 402 when blocked, debited when overage', async () => {
    const ws = await aiWorkspace(1);
    const staff = await founder();
    const desk = await billing.plans.planByCode('desk');
    await request(app).patch(`/api/admin/billing/plans/${desk.id}`).set(bearer(staff)).send({ ai_replies_month: 1, ai_overage_price_paise: 500 });
    await subscribe(ws.owner, 'desk');
    const send = () => request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: ws.lead.id, message: 'Hello from WF1' });
    assert.strictEqual((await send()).status, 200);
    const blocked = await send();
    assert.strictEqual(blocked.status, 402);
    assert.strictEqual(blocked.body.code, 'WALLET_EMPTY');
    assert.strictEqual(sends.length, 1);
    await topUp(ws.owner, 1, 100);
    assert.strictEqual((await send()).status, 200);
    assert.strictEqual(await balance(1), 9500);
  });

  await t.test('A4. No plan: existing workspaces keep working (legacy quota or no limit) unless BILLING_REQUIRE_PLAN=true', async () => {
    const ws = await aiWorkspace(1);
    assert.strictEqual((await aiReply(1, ws, 'hi')).body.sent, true, 'launch day: no plan, no block');
    assert.strictEqual(await runAsTenant(1, () => WalletLedger.countDocuments({})), 0, 'nothing charged');

    process.env.BILLING_REQUIRE_PLAN = 'true';
    const noPlan = await aiReply(1, ws, 'hi again');
    assert.strictEqual(noPlan.body.sent, false);
    assert.match(noPlan.body.reason, /no active plan/);
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'ai_blocked' })), 1);
    const relay = await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: ws.lead.id, message: 'WF1' });
    assert.strictEqual(relay.status, 402);
    assert.strictEqual(relay.body.code, 'NO_ACTIVE_PLAN');
    assert.strictEqual((await request(app).post('/api/internal/send-reply').set(service(1)).send({ lead_id: 999999, message: 'WF1' })).status, 404, 'an unknown lead is still 404');
    delete process.env.BILLING_REQUIRE_PLAN;
    assert.strictEqual((await aiReply(1, ws, 'and back')).body.sent, true);

    const legacy = await aiWorkspace(2);
    await sys(() => Tenants.updateOne({ id: 2 }, { $set: { ai_reply_quota_month: 1 } }));
    const wsLegacy = { ...legacy };
    assert.strictEqual((await aiReply(2, wsLegacy, 'a')).body.sent, true);
    const over = await aiReply(2, wsLegacy, 'b');
    assert.strictEqual(over.body.sent, false);
    assert.match(over.body.reason, /limit reached for this month/);
  });

  // ── Extras and seats ─────────────────────────────────────
  await t.test('E1. Extra seats and numbers are paid from the wallet and raise the limits; without money they are refused', async () => {
    const ws = await workspace(1);
    await subscribe(ws.owner, 'desk'); // 1 seat, 1 number, ₹299 / ₹499 extras
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(ws.owner))).body.usage.max_users, 1);
    const invite = () => request(app).post('/api/team/invitations').set(bearer(ws.owner)).send({ email: 'second@acme.test', role: 'agent', name: 'Second' });
    const refused = await invite();
    assert.strictEqual(refused.status, 409);
    assert.match(refused.body.error, /one login/);

    const broke = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
    assert.strictEqual(broke.status, 402);
    assert.strictEqual(broke.body.code, 'INSUFFICIENT_FUNDS');
    assert.ok(!/stack|Error:/.test(JSON.stringify(broke.body)));

    await topUp(ws.owner, 1, 2000);
    // The workspace already has two logins (owner and agent) on a 1-seat plan.
    const seat = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
    assert.strictEqual(seat.status, 200, JSON.stringify(seat.body));
    assert.strictEqual(seat.body.subscription.extra_seats, 1);
    assert.strictEqual(seat.body.balance_paise, 200000 - 29900);
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(ws.owner))).body.usage.max_users, 2);
    const full = await invite();
    assert.strictEqual(full.status, 409);
    assert.match(full.body.error, /all 2 of its seats/);
    const second = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
    assert.strictEqual(second.body.subscription.extra_seats, 2);
    assert.strictEqual((await request(app).get('/api/tenant').set(bearer(ws.owner))).body.usage.max_users, 3);
    const accepted = await invite();
    assert.strictEqual(accepted.status, 201, JSON.stringify(accepted.body));
    const third = await request(app).post('/api/team/invitations').set(bearer(ws.owner)).send({ email: 'third@acme.test', role: 'agent' });
    assert.strictEqual(third.status, 409);
    assert.match(third.body.error, /all 3 of its seats/);

    const number = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'number', quantity: 1 });
    assert.strictEqual(number.status, 200);
    assert.strictEqual(number.body.balance_paise, 200000 - 2 * 29900 - 49900);
    const summary = await request(app).get('/api/billing/summary').set(bearer(ws.owner));
    assert.strictEqual(summary.body.numbers.limit, 2);
    assert.strictEqual((await request(app).post('/api/billing/extras').set(bearer(ws.agent)).send({ kind: 'seat' })).status, 403);
    assert.strictEqual((await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'car' })).status, 400);
    // The wallet never paid Meta: only AI, seats and numbers appear in the ledger.
    const reasons = new Set((await ledgerRows(1)).map((r) => r.reason));
    assert.deepStrictEqual([...reasons].sort(), ['extra_number', 'extra_seat', 'topup']);
  });

  // ── Expiry, staff tools, isolation ───────────────────────
  await t.test('X1. A lapsed period expires (nothing deleted) and the AI then needs a plan; staff can grant and adjust, audited', async () => {
    const ws = await aiWorkspace(1);
    await subscribe(ws.owner, 'desk');
    await runAsTenant(1, () => Subscriptions.updateOne({}, { $set: { current_period_end: new Date(Date.now() - 1000) } }));
    const result = await billing.orders.expireLapsed();
    assert.strictEqual(result.expired, 1);
    assert.strictEqual((await runAsTenant(1, () => Subscriptions.findOne({}).lean())).status, 'expired');
    assert.strictEqual(await runAsTenant(1, () => BillingAlerts.countDocuments({ kind: 'plan_expired' })), 1, 'the owner is told');
    process.env.BILLING_REQUIRE_PLAN = 'true';
    assert.strictEqual((await aiReply(1, ws, 'hi')).body.sent, false, 'an expired plan is no plan');
    const summary = await request(app).get('/api/billing/summary').set(bearer(ws.owner));
    assert.strictEqual(summary.body.subscription.status, 'expired');
    assert.strictEqual(summary.body.ai.allowed, false);

    const staff = await founder();
    const grant = await request(app).post('/api/admin/tenants/1/billing/grant').set(bearer(staff)).send({ plan_code: 'complete', note: 'Paid by bank transfer' });
    assert.strictEqual(grant.status, 200, JSON.stringify(grant.body));
    assert.strictEqual(grant.body.subscription.plan_code, 'complete');
    assert.strictEqual((await aiReply(1, ws, 'hi')).body.sent, true);
    delete process.env.BILLING_REQUIRE_PLAN;

    assert.strictEqual((await request(app).post('/api/admin/tenants/1/billing/wallet/adjust').set(bearer(staff)).send({ amount_inr: 50 })).status, 400, 'a note is required');
    const adjust = await request(app).post('/api/admin/tenants/1/billing/wallet/adjust').set(bearer(staff)).send({ amount_inr: 50, note: 'Goodwill credit' });
    assert.strictEqual(adjust.status, 200);
    assert.strictEqual(adjust.body.balance_paise, 5000);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'WALLET_ADJUSTED', tenant_id: 1 })));
    const view = await request(app).get('/api/admin/tenants/1/billing').set(bearer(staff));
    assert.strictEqual(view.status, 200);
    assert.strictEqual(view.body.wallet.balance_paise, 5000);
    assert.strictEqual(view.body.ledger[0].reason, 'adjustment');
    // Customers cannot reach the staff tools.
    assert.strictEqual((await request(app).post('/api/admin/tenants/1/billing/wallet/adjust').set(bearer(ws.owner)).send({ amount_inr: 50, note: 'x' })).status, 403);
  });

  await t.test('I1. Isolation: ledger, orders, alerts and summary never cross workspaces', async () => {
    const a = await workspace(1);
    const b = await workspace(2);
    await subscribe(a.owner, 'complete');
    await topUp(a.owner, 1, 500);
    const bSummary = await request(app).get('/api/billing/summary').set(bearer(b.owner));
    assert.strictEqual(bSummary.body.wallet.balance_paise, 0);
    assert.strictEqual(bSummary.body.subscription, null);
    assert.strictEqual(bSummary.body.plan, null);
    assert.deepStrictEqual((await request(app).get('/api/billing/wallet/ledger').set(bearer(b.owner))).body.entries, []);
    assert.deepStrictEqual((await request(app).get('/api/billing/orders').set(bearer(b.owner))).body.orders, []);
    const aLedger = await request(app).get('/api/billing/wallet/ledger').set(bearer(a.owner));
    assert.strictEqual(aLedger.body.balance_paise, 50000);
    assert.strictEqual(aLedger.body.entries.length, 1);
    assert.ok(!JSON.stringify(aLedger.body).includes('tenant_id'), 'internal ids stay inside');
    // Raw collections carry the tenant on every row.
    const rows = await sys(() => Promise.all([WalletLedger.find({}).lean(), BillingOrders.find({}).lean(), Subscriptions.find({}).lean()]));
    for (const row of rows.flat()) assert.strictEqual(row.tenant_id, 1);
    // Without a context, billing collections fail closed.
    await assert.rejects(() => WalletLedger.find({}), (err) => err.name === 'TenantContextError');
    await assert.rejects(() => Subscriptions.find({}), (err) => err.name === 'TenantContextError');
  });
});
