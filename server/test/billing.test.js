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
    // This suite tests the money flow, so online payment is on unless a test turns it off.
    process.env.BILLING_PAYMENTS_ENABLED = 'true';
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
    assert.strictEqual(order.body.checkout.amount, 106082, 'amount comes from the table plus 18% GST, never from the browser');
    assert.strictEqual(gatewayCalls[0].amountPaise, 106082);
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

  // ── Payment switch ───────────────────────────────────────
  await t.test('PO1. With BILLING_PAYMENTS_ENABLED off, every order/extras route answers 403 PAYMENTS_OFF; verify, invoices and GST details still work', async () => {
    const ws = await workspace(1);
    await subscribe(ws.owner, 'desk'); // payments on: a plan and a pending order to verify later
    const pending = await request(app).post('/api/billing/orders').set(bearer(ws.owner)).send({ purpose: 'wallet_topup', amount_inr: 2000 });
    assert.strictEqual(pending.status, 201);
    const callsBefore = gatewayCalls.length;
    const balanceBefore = await balance(1);

    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      if (value === undefined) delete process.env.BILLING_PAYMENTS_ENABLED; else process.env.BILLING_PAYMENTS_ENABLED = value;
      const routes = [
        ['/api/billing/orders', { purpose: 'subscription', plan_code: 'complete' }], // upgrade
        ['/api/billing/orders', { purpose: 'subscription', plan_code: 'desk' }], // renew / buy
        ['/api/billing/orders', { purpose: 'wallet_topup', amount_inr: 500 }],
        ['/api/billing/extras', { kind: 'seat', quantity: 1 }],
        ['/api/billing/extras', { kind: 'number', quantity: 1 }],
      ];
      for (const [path, body] of routes) {
        const res = await request(app).post(path).set(bearer(ws.owner)).send(body);
        assert.strictEqual(res.status, 403, `${path} ${JSON.stringify(body)} with ${JSON.stringify(value)}`);
        assert.strictEqual(res.body.code, 'PAYMENTS_OFF');
        assert.strictEqual(res.body.error, 'Online payment is not open yet. Please contact us to change your plan.');
      }
      const summary = await request(app).get('/api/billing/summary').set(bearer(ws.owner));
      assert.strictEqual(summary.status, 200);
      assert.strictEqual(summary.body.payments_enabled, false);
      assert.strictEqual(summary.body.payments.enabled, false);
      assert.strictEqual(summary.body.payments.key_id, null);
      assert.strictEqual(summary.body.plan.code, 'desk', 'the current plan still shows');
    }
    assert.strictEqual(gatewayCalls.length, callsBefore, 'no Razorpay order was created');
    assert.strictEqual(await balance(1), balanceBefore, 'no wallet charge');

    // A payment started before the switch went off still verifies and still credits via the webhook.
    const orderId = pending.body.checkout.order_id;
    const paymentId = 'pay_after_switch_off';
    const verified = await request(app).post('/api/billing/orders/verify').set(bearer(ws.owner))
      .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(orderId, paymentId) });
    assert.strictEqual(verified.status, 200, JSON.stringify(verified.body));
    assert.strictEqual((await signedWebhook(webhookBody(orderId, paymentId, 200000))).status, 200);
    assert.strictEqual(await balance(1), balanceBefore + 200000);

    // Invoices and GST details keep working.
    assert.strictEqual((await request(app).get('/api/billing/invoices').set(bearer(ws.owner))).status, 200);
    assert.strictEqual((await request(app).get('/api/billing/invoice-details').set(bearer(ws.owner))).status, 200);
    assert.strictEqual((await request(app).put('/api/billing/invoice-details').set(bearer(ws.owner)).send({ legal_name: 'Acme', gstin: 'BAD' })).status, 400, 'GSTIN still validated');
    assert.strictEqual((await request(app).put('/api/billing/invoice-details').set(bearer(ws.owner)).send({ legal_name: 'Acme', state_code: '33', address: 'Chennai' })).status, 200);
    // Permission is still checked first.
    assert.strictEqual((await request(app).post('/api/billing/orders').set(bearer(ws.agent)).send({ purpose: 'wallet_topup', amount_inr: 500 })).status, 403);

    // Back on: the same routes work normally.
    process.env.BILLING_PAYMENTS_ENABLED = 'true';
    const on = await request(app).get('/api/billing/summary').set(bearer(ws.owner));
    assert.strictEqual(on.body.payments_enabled, true);
    assert.strictEqual(on.body.payments.enabled, true);
    assert.strictEqual(on.body.payments.key_id, KEY_ID);
    const upgrade = await request(app).post('/api/billing/orders').set(bearer(ws.owner)).send({ purpose: 'subscription', plan_code: 'complete' });
    assert.strictEqual(upgrade.status, 201, JSON.stringify(upgrade.body));
    const topup = await request(app).post('/api/billing/orders').set(bearer(ws.owner)).send({ purpose: 'wallet_topup', amount_inr: 500 });
    assert.strictEqual(topup.status, 201);
    const seat = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
    assert.strictEqual(seat.status, 200, JSON.stringify(seat.body));
    const number = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'number', quantity: 1 });
    assert.strictEqual(number.status, 200, JSON.stringify(number.body));
    assert.strictEqual(gatewayCalls.length, callsBefore + 2);
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

  await t.test('O3. Renewal of the same plan extends the period; an upgrade keeps the paid period', async () => {
    const { owner } = await workspace(1);
    const first = await subscribe(owner, 'desk');
    const end1 = new Date(first.body.subscription.current_period_end).getTime();
    const second = await subscribe(owner, 'desk');
    const end2 = new Date(second.body.subscription.current_period_end).getTime();
    assert.ok(end2 > end1 + 27 * 86400000, 'a renewal adds a month to the paid period');
    const upgraded = await subscribe(owner, 'complete');
    assert.strictEqual(upgraded.body.subscription.plan_code, 'complete');
    assert.strictEqual(new Date(upgraded.body.subscription.current_period_end).getTime(), end2, 'an upgrade keeps the period already paid for');
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
    await signedWebhook(webhookBody(orderId, 'pay_s1', 94282)); // ₹799 + 18% GST
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

  await t.test("S1. Staff can grant plans to two workspaces; each subscription gets its own id", async () => {
    await workspace(1);
    await workspace(2);
    const staff = await founder();
    for (const id of [1, 2]) {
      const grant = await request(app).post(`/api/admin/tenants/${id}/billing/grant`).set(bearer(staff)).send({ plan_code: "desk", note: "Invited pilot" });
      assert.strictEqual(grant.status, 200, JSON.stringify(grant.body));
    }
    const rows = await sys(() => Subscriptions.find({}, { _id: 0, id: 1, tenant_id: 1 }).lean());
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((r) => Number.isInteger(r.id)), JSON.stringify(rows));
    assert.notStrictEqual(rows[0].id, rows[1].id);
  });

  await t.test('G1. Plan orders add 18% GST on top and record the split; wallet top-ups carry none', async () => {
    const { owner } = await workspace(1);
    const plan = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'whatsapp' });
    assert.strictEqual(plan.status, 201);
    assert.strictEqual(plan.body.order.base_paise, 199900);
    assert.strictEqual(plan.body.order.gst_paise, 35982);
    assert.strictEqual(plan.body.order.amount_paise, 235882);
    assert.strictEqual(plan.body.checkout.amount, 235882);
    const topup = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'wallet_topup', amount_inr: 500 });
    assert.strictEqual(topup.body.order.gst_paise, 0);
    assert.strictEqual(topup.body.checkout.amount, 50000);
    const plans = await request(app).get('/api/billing/plans').set(bearer(owner));
    assert.strictEqual(plans.body.plans[0].total_paise, 94282);
  });

  await t.test('U1. An upgrade pays the difference for the days left (plus GST) and keeps the period; a downgrade waits for renewal', async () => {
    const { owner } = await workspace(1);
    const first = await subscribe(owner, 'whatsapp');
    const end = new Date(first.body.subscription.current_period_end).getTime();
    const down = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'desk' });
    assert.strictEqual(down.status, 409);
    assert.strictEqual(down.body.code, 'DOWNGRADE_AT_RENEWAL');
    const up = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: 'complete' });
    assert.strictEqual(up.status, 201, JSON.stringify(up.body));
    assert.strictEqual(up.body.order.upgrade, true);
    // Just paid for the month, so nearly all of it is credit: base is a little over 399900 - 199900.
    assert.ok(up.body.order.base_paise >= 200000 && up.body.order.base_paise < 205000, `base ${up.body.order.base_paise}`);
    assert.strictEqual(up.body.order.gst_paise, Math.round(up.body.order.base_paise * 0.18));
    assert.strictEqual(up.body.order.amount_paise, up.body.order.base_paise + up.body.order.gst_paise);
    const orderId = up.body.checkout.order_id;
    await signedWebhook(webhookBody(orderId, 'pay_up1', up.body.order.amount_paise));
    const sub = await runAsTenant(1, () => Subscriptions.findOne({}).lean());
    assert.strictEqual(sub.plan_code, 'complete');
    assert.strictEqual(new Date(sub.current_period_end).getTime(), end, 'the paid period did not move');
  });

  await t.test('R1. A refund or dispute on a plan payment is recorded for staff and changes nothing; staff make good with extra days', async () => {
    const ws = await workspace(1);
    const paid = await subscribe(ws.owner, 'desk');
    const end = new Date(paid.body.subscription.current_period_end).getTime();
    const refundEvent = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_1', payment_id: paid.paymentId, amount: 94282, status: 'processed' } } } });
    const res = await signedWebhook(refundEvent);
    assert.strictEqual(res.status, 200);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'PAYMENT_REFUND_NOTED', tenant_id: 1 })));
    assert.strictEqual((await runAsTenant(1, () => Subscriptions.findOne({}).lean())).status, 'active');
    assert.strictEqual(await balance(1), 0);

    const staff = await founder();
    assert.strictEqual((await request(app).post('/api/admin/tenants/1/billing/extend').set(bearer(staff)).send({ days: 5 })).status, 400, 'a note is required');
    const extended = await request(app).post('/api/admin/tenants/1/billing/extend').set(bearer(staff)).send({ days: 5, note: 'Service issue, made good' });
    assert.strictEqual(extended.status, 200, JSON.stringify(extended.body));
    const after = new Date((await runAsTenant(1, () => Subscriptions.findOne({}).lean())).current_period_end).getTime();
    assert.strictEqual(after, end + 5 * 86400000);
    assert.ok(await sys(() => AuditEvents.exists({ event: 'SUBSCRIPTION_EXTENDED', tenant_id: 1 })));
    assert.strictEqual((await request(app).post('/api/admin/tenants/1/billing/extend').set(bearer(ws.owner)).send({ days: 5, note: 'nope nope' })).status, 403);
  });

  await t.test('I1. A paid plan gets one numbered GST invoice: CGST+SGST in Puducherry, IGST elsewhere; wallet top-ups get none', async () => {
    const a = await workspace(1);
    const paid = await subscribe(a.owner, 'desk');
    // Fulfilling twice does not issue a second invoice.
    await signedWebhook(webhookBody(paid.orderId, paid.paymentId, 94282));
    const list = await request(app).get('/api/billing/invoices').set(bearer(a.owner));
    assert.strictEqual(list.status, 200);
    assert.strictEqual(list.body.invoices.length, 1);
    assert.match(list.body.invoices[0].invoice_number, /^AV\/\d{2}-\d{2}\/0001$/);
    assert.strictEqual(list.body.invoices[0].total_paise, 94282);
    const page = await request(app).get(`/api/billing/invoices/${list.body.invoices[0].id}`).set(bearer(a.owner));
    assert.strictEqual(page.status, 200);
    assert.strictEqual(page.headers['cache-control'], 'no-store', 'the invoice page is never cached');
    assert.strictEqual(page.headers['x-content-type-options'], 'nosniff');
    assert.strictEqual(page.headers['referrer-policy'], 'no-referrer');
    assert.match(page.headers['content-security-policy'], /default-src 'none'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);
    assert.ok(!/<script/i.test(page.text), 'the page needs no script, so the CSP allows none');
    assert.match(page.text, /AFRA VENTURES PRIVATE LIMITED/);
    assert.match(page.text, /34ABGCA7083D1ZS/);
    assert.match(page.text, /CGST @ 9%/);
    assert.match(page.text, /SGST @ 9%/);
    await topUp(a.owner, 1, 500);
    assert.strictEqual((await request(app).get('/api/billing/invoices').set(bearer(a.owner))).body.invoices.length, 1, 'a top-up is not invoiced');

    // A workspace in another state pays IGST; the other workspace cannot see invoice 1.
    const b = await workspace(2);
    const bad = await request(app).put('/api/billing/invoice-details').set(bearer(b.owner)).send({ legal_name: 'Chennai Dental', gstin: 'BAD' });
    assert.strictEqual(bad.status, 400);
    const saved = await request(app).put('/api/billing/invoice-details').set(bearer(b.owner)).send({ legal_name: 'Chennai Dental', state_code: '33', address: 'Anna Nagar, Chennai' });
    assert.strictEqual(saved.status, 200, JSON.stringify(saved.body));
    await subscribe(b.owner, 'desk');
    const listB = await request(app).get('/api/billing/invoices').set(bearer(b.owner));
    assert.strictEqual(listB.body.invoices.length, 1);
    const pageB = await request(app).get(`/api/billing/invoices/${listB.body.invoices[0].id}`).set(bearer(b.owner));
    assert.match(pageB.text, /IGST @ 18%/);
    assert.ok(!/CGST/.test(pageB.text));
    assert.match(pageB.text, /Chennai Dental/);
    assert.notStrictEqual(listB.body.invoices[0].invoice_number, list.body.invoices[0].invoice_number);
    assert.strictEqual((await request(app).get(`/api/billing/invoices/${list.body.invoices[0].id}`).set(bearer(b.owner))).status, 404, 'tenant isolation');
  });

  // ── Invoices: issued at fulfil, retried, numbered without gaps ──
  const invoiceRows = () => sys(() => models.Invoices.find({}, { _id: 0 }).sort({ seq: 1 }).lean());
  // Creates a plan order through the API; returns the Razorpay order id and a unique payment id.
  async function planOrder(owner, planCode = 'desk') {
    const created = await request(app).post('/api/billing/orders').set(bearer(owner)).send({ purpose: 'subscription', plan_code: planCode });
    assert.strictEqual(created.status, 201, JSON.stringify(created.body));
    const orderId = created.body.checkout.order_id;
    return { orderId, paymentId: `pay_${orderId}`, amount: created.body.order.amount_paise };
  }
  const verifyOrder = (owner, { orderId, paymentId }) => request(app).post('/api/billing/orders/verify').set(bearer(owner))
    .send({ razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: checkoutSignature(orderId, paymentId) });
  // Pays a plan while invoicing is broken, as if the server died between fulfilment and the invoice.
  async function subscribeWithoutInvoice(owner) {
    const original = billing.invoices.ensureForOrder;
    billing.invoices.ensureForOrder = async () => { throw new Error('crash between fulfil and invoice'); };
    try { return await subscribe(owner, 'desk'); } finally { billing.invoices.ensureForOrder = original; }
  }

  await t.test('I2. The invoice is issued in the same flow that fulfils the payment', async () => {
    const ws = await workspace(1);
    const paid = await subscribe(ws.owner, 'desk');
    const rows = await invoiceRows();
    assert.strictEqual(rows.length, 1, 'issued by the checkout call itself, before any invoice list is opened');
    const order = await runAsTenant(1, () => BillingOrders.findOne({ razorpay_order_id: paid.orderId }).lean());
    assert.strictEqual(rows[0].billing_order_id, order.id);
    assert.match(rows[0].invoice_number, /^AV\/\d{2}-\d{2}\/0001$/);
    assert.strictEqual(rows[0].seq, 1);
    assert.strictEqual(rows[0].series, rows[0].invoice_number.slice(0, -5));
    assert.strictEqual(rows[0].tenant_id, 1);
  });

  await t.test('I3. The retry job issues an invoice that a fulfilled payment is missing', async () => {
    const ws = await workspace(1);
    await subscribeWithoutInvoice(ws.owner);
    assert.strictEqual((await invoiceRows()).length, 0);
    assert.strictEqual((await runAsTenant(1, () => BillingOrders.findOne({ purpose: 'subscription' }).lean())).status, 'fulfilled');
    const result = await billing.invoices.issueMissing();
    assert.deepStrictEqual(result, { issued: 1, failed: 0 });
    const rows = await invoiceRows();
    assert.strictEqual(rows.length, 1);
    assert.match(rows[0].invoice_number, /\/0001$/);
    assert.strictEqual(rows[0].tenant_id, 1);
    const list = await request(app).get('/api/billing/invoices').set(bearer(ws.owner));
    assert.strictEqual(list.body.invoices.length, 1);
    assert.deepStrictEqual(await billing.invoices.issueMissing(), { issued: 0, failed: 0 }, 'nothing left to do');
  });

  await t.test('I4. Retry job twice at once and alongside a repeated fulfil still gives one invoice per payment', async () => {
    const a = await workspace(1);
    const b = await workspace(2);
    const paidA = await subscribeWithoutInvoice(a.owner);
    await subscribeWithoutInvoice(b.owner);
    const orderA = await runAsTenant(1, () => BillingOrders.findOne({ razorpay_order_id: paidA.orderId }).lean());
    await Promise.all([
      billing.invoices.issueMissing(),
      billing.invoices.issueMissing(),
      runAsTenant(1, () => billing.orders.fulfil(orderA, { paymentId: paidA.paymentId, source: 'webhook' })),
      signedWebhook(webhookBody(paidA.orderId, paidA.paymentId, orderA.amount_paise)),
      runAsTenant(1, () => billing.invoices.ensureForOrder(orderA)),
    ]);
    const rows = await invoiceRows();
    assert.strictEqual(rows.length, 2, JSON.stringify(rows.map((r) => [r.billing_order_id, r.invoice_number])));
    assert.deepStrictEqual(rows.map((r) => r.seq), [1, 2]);
    assert.strictEqual(new Set(rows.map((r) => r.billing_order_id)).size, 2);
    assert.ok(rows.every((r) => typeof r.invoice_number === 'string'));
    assert.deepStrictEqual(await billing.invoices.issueMissing(), { issued: 0, failed: 0 });
  });

  await t.test('I5. Invoice numbers are consecutive: a failed numbering uses up no number, and parallel payments share the series', async () => {
    const ws = [];
    for (let id = 1; id <= 5; id += 1) ws.push(await workspace(id));
    // Workspace 1: numbering fails once after the row was claimed.
    const realUpdateOne = models.Invoices.updateOne;
    let failNumbering = true;
    models.Invoices.updateOne = function patched(filter, update, ...rest) {
      if (failNumbering && update?.$set?.invoice_number) { failNumbering = false; return Promise.reject(new Error('disk full')); }
      return realUpdateOne.call(this, filter, update, ...rest);
    };
    try {
      assert.strictEqual((await verifyOrder(ws[0].owner, await planOrder(ws[0].owner))).status, 200, 'the payment still goes through');
    } finally { models.Invoices.updateOne = realUpdateOne; }
    const pending = await invoiceRows();
    assert.strictEqual(pending.length, 1);
    assert.strictEqual(pending[0].invoice_number, null, 'claimed, not numbered');
    assert.strictEqual((await request(app).get('/api/billing/invoices').set(bearer(ws[0].owner))).body.invoices.length, 0, 'an unnumbered row is not shown');

    // Workspace 2 pays next and takes 0001: the failure used up nothing.
    assert.strictEqual((await verifyOrder(ws[1].owner, await planOrder(ws[1].owner))).status, 200);
    // The retry job numbers workspace 1 next.
    assert.deepStrictEqual(await billing.invoices.issueMissing(), { issued: 1, failed: 0 });
    // Workspaces 3 to 5 pay at the same moment.
    const orders = [];
    for (const w of ws.slice(2)) orders.push(await planOrder(w.owner));
    const results = await Promise.all(ws.slice(2).map((w, i) => verifyOrder(w.owner, orders[i])));
    for (const res of results) assert.strictEqual(res.status, 200, JSON.stringify(res.body));

    const rows = await invoiceRows();
    assert.strictEqual(rows.length, 5);
    assert.deepStrictEqual(rows.map((r) => r.seq), [1, 2, 3, 4, 5]);
    assert.deepStrictEqual(rows.map((r) => r.invoice_number.slice(-4)), ['0001', '0002', '0003', '0004', '0005']);
    assert.strictEqual(new Set(rows.map((r) => r.series)).size, 1);
    assert.deepStrictEqual(rows.slice(0, 2).map((r) => r.tenant_id), [2, 1]);
    for (let i = 1; i < rows.length; i += 1) assert.ok(new Date(rows[i].issued_at) >= new Date(rows[i - 1].issued_at), 'dates follow numbers');
  });

  await t.test('E2. If adding the extra fails after the wallet was charged, the wallet is refunded', async () => {
    const ws = await workspace(1);
    await subscribe(ws.owner, 'desk');
    await topUp(ws.owner, 1, 2000);
    const original = billing.subscriptions.addExtras;
    billing.subscriptions.addExtras = async () => null;
    try {
      const res = await request(app).post('/api/billing/extras').set(bearer(ws.owner)).send({ kind: 'seat', quantity: 1 });
      assert.strictEqual(res.status, 500);
      assert.strictEqual(res.body.code, 'EXTRAS_FAILED');
    } finally { billing.subscriptions.addExtras = original; }
    assert.strictEqual(await balance(1), 200000, 'the wallet got its money back');
    const rows = await ledgerRows(1);
    assert.ok(rows.some((r) => r.reason === 'refund' && r.reference_type === 'extra_undo'));
  });

  await t.test('E3. A billing error in the old /webhook/razorpay address answers 500 so Razorpay retries', async () => {
    const original = billing.orders.handleWebhook;
    billing.orders.handleWebhook = async () => { throw new Error('database down'); };
    try {
      const res = await signedWebhook(webhookBody('order_x', 'pay_retry', 10000), '/webhook/razorpay');
      assert.strictEqual(res.status, 500);
    } finally { billing.orders.handleWebhook = original; }
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
