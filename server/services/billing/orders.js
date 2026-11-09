/**
 * Payments: Razorpay orders for a plan or a wallet top-up, checkout signature
 * verification, webhook handling and fulfilment.
 *
 *   createOrder   server-side order; the amount comes from the plans table or
 *                 a validated top-up amount, never from the browser
 *   verifyCheckout the browser returns payment_id + signature; the signature
 *                 is checked with the key secret; a plan order is activated
 *                 right away, a wallet top-up waits for the webhook
 *   handleWebhook signed by the webhook secret; credits the wallet once per
 *                 Razorpay payment id (ledger unique key) and activates
 *                 plan orders that the checkout callback never reached
 *
 * The tenant of a payment is always read from the billing_orders row, found
 * by razorpay_order_id — never from the webhook notes.
 */
const { BillingOrders, Subscriptions } = require('../../models');
const { runAsSystem, runAsTenant, requireTenantId } = require('../tenantContext');
const { withLock } = require('../../db/mongo');
const audit = require('../audit');
const plansService = require('./plans');
const subscriptions = require('./subscriptions');
const wallet = require('./wallet');
const alerts = require('./alerts');
const customerAlerts = require('../alerts');
const razorpay = require('./razorpay');

class BillingError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const PURPOSES = Object.freeze(['subscription', 'wallet_topup']);
const topupMinInr = () => Number(process.env.WALLET_TOPUP_MIN_INR || 100);
const topupMaxInr = () => Number(process.env.WALLET_TOPUP_MAX_INR || 100000);

const publicOrder = (order) => order && ({
  id: order.id,
  purpose: order.purpose,
  plan_code: order.plan_code,
  amount_paise: order.amount_paise,
  amount_inr: order.amount_paise / 100,
  currency: order.currency,
  razorpay_order_id: order.razorpay_order_id,
  status: order.status,
  created_at: order.created_at,
  fulfilled_at: order.fulfilled_at,
});

/**
 * createOrder({ purpose, planCode?, amountInr?, userId }) in the tenant context.
 * Returns what Razorpay Checkout needs: order id, amount, currency, key id.
 */
async function createOrder({ purpose, planCode = null, amountInr = null, userId = null }) {
  const tenantId = requireTenantId();
  if (!PURPOSES.includes(purpose)) throw new BillingError(400, 'Unknown purchase type');

  let amountPaise;
  let plan = null;
  if (purpose === 'subscription') {
    plan = await plansService.planByCode(planCode);
    if (!plan || !plan.is_active) throw new BillingError(400, 'Please choose one of the available plans');
    amountPaise = plan.price_paise;
  } else {
    const inr = Number(amountInr);
    if (!Number.isFinite(inr) || inr < topupMinInr() || inr > topupMaxInr() || Math.round(inr * 100) !== inr * 100) {
      throw new BillingError(400, `Top-up amount must be between ₹${topupMinInr()} and ₹${topupMaxInr().toLocaleString('en-IN')}`);
    }
    amountPaise = Math.round(inr * 100);
  }
  if (!Number.isInteger(amountPaise) || amountPaise < 100) throw new BillingError(400, 'Amount must be at least ₹1');

  const receipt = `t${tenantId}-${purpose === 'subscription' ? 'plan' : 'wallet'}-${Date.now().toString(36)}`;
  const created = await razorpay.gateway.createOrder({
    amountPaise,
    currency: 'INR',
    receipt,
    notes: { tenant_id: String(tenantId), purpose, plan_code: plan?.code || '' },
  });
  const order = await BillingOrders.create({
    purpose,
    plan_id: plan?.id ?? null,
    plan_code: plan?.code ?? null,
    amount_paise: amountPaise,
    currency: 'INR',
    razorpay_order_id: created.id,
    status: 'created',
    created_by: userId,
    meta: { receipt },
    created_at: new Date(),
    updated_at: new Date(),
  });
  return { order: publicOrder(order.toObject()), checkout: { key_id: razorpay.keyId(), order_id: created.id, amount: amountPaise, currency: 'INR', name: plan?.name || 'Wallet top-up' } };
}

/**
 * Applies a paid order exactly once. Caller holds the tenant context.
 * `source` is 'checkout' (signature verified) or 'webhook'. Wallet top-ups
 * are credited from the webhook only.
 */
async function fulfil(order, { paymentId, source, now = new Date() }) {
  return withLock(`billing-order:${order.razorpay_order_id}`, async () => {
    const fresh = await BillingOrders.findOne({ id: order.id }, { _id: 0 }).lean();
    if (!fresh) throw new BillingError(404, 'Order not found');
    if (fresh.status === 'fulfilled') return { fulfilled: false, duplicate: true, order: fresh };

    const changes = { razorpay_payment_id: paymentId, updated_at: now };
    let outcome = {};
    if (fresh.purpose === 'subscription') {
      const plan = await plansService.planById(fresh.plan_id);
      if (!plan) throw new BillingError(409, 'The plan on this order no longer exists');
      const { subscription, renewal } = await subscriptions.activate({ plan, orderId: fresh.razorpay_order_id, paymentId, now, source });
      Object.assign(changes, { status: 'fulfilled', fulfilled_at: now, fulfilled_by: source });
      outcome = { subscription: subscriptions.publicSubscription(subscription, now), renewal };
      await audit.record(audit.EVENTS.SUBSCRIPTION_ACTIVATED, {
        tenantId: fresh.tenant_id, targetType: 'subscription', targetId: subscription.id,
        actor: { actor_type: 'system', actor_user_id: null },
        meta: { plan_code: plan.code, price_inr: plan.price_inr, order_id: fresh.razorpay_order_id, payment_id: paymentId, source, renewal },
      });
    } else if (fresh.purpose === 'wallet_topup') {
      if (source !== 'webhook') {
        // The checkout callback only proves the browser saw a success; the money
        // lands in the wallet when Razorpay's signed webhook confirms the capture.
        Object.assign(changes, { status: 'paid', signature_verified_at: fresh.signature_verified_at || now });
        await BillingOrders.updateOne({ id: fresh.id }, { $set: changes });
        return { fulfilled: false, pending_webhook: true, order: { ...fresh, ...changes } };
      }
      const credited = await wallet.credit({
        amountPaise: fresh.amount_paise,
        reason: 'topup',
        referenceType: 'razorpay_payment',
        referenceId: paymentId,
        description: 'Wallet top-up',
        meta: { order_id: fresh.razorpay_order_id },
      });
      Object.assign(changes, { status: 'fulfilled', fulfilled_at: now, fulfilled_by: source });
      outcome = { credited: !credited.duplicate, balance_paise: credited.balance_paise };
      // A top-up lands: the low-wallet and failed-payment notices no longer apply.
      await customerAlerts.evaluateWallet().catch((error) => console.error('[billing/orders] Wallet notice failed:', error.message));
      await customerAlerts.resolve('payment_failed').catch((error) => console.error('[billing/orders] Notice close failed:', error.message));
      await audit.record(audit.EVENTS.PAYMENT_VERIFIED, {
        tenantId: fresh.tenant_id, targetType: 'wallet_ledger', targetId: credited.row?.id,
        actor: { actor_type: 'system', actor_user_id: null },
        meta: { amount_paise: fresh.amount_paise, order_id: fresh.razorpay_order_id, payment_id: paymentId, duplicate: credited.duplicate },
      });
    }
    await BillingOrders.updateOne({ id: fresh.id }, { $set: changes });
    return { fulfilled: true, duplicate: false, order: { ...fresh, ...changes }, ...outcome };
  }, { ttlMs: 20000, waitMs: 15000 });
}

/**
 * Checkout callback from the browser (tenant context, owner/admin):
 * { razorpay_order_id, razorpay_payment_id, razorpay_signature }.
 */
async function verifyCheckout({ orderId, paymentId, signature, userId = null }) {
  const order = await BillingOrders.findOne({ razorpay_order_id: String(orderId || '') }, { _id: 0 }).lean();
  if (!order) throw new BillingError(404, 'Order not found');
  if (!razorpay.verifyPaymentSignature({ orderId: order.razorpay_order_id, paymentId, signature })) {
    await audit.record(audit.EVENTS.PAYMENT_VERIFIED, {
      tenantId: order.tenant_id, targetType: 'billing_order', targetId: order.id,
      actor: { actor_type: 'user', actor_user_id: userId },
      meta: { order_id: order.razorpay_order_id, verified: false },
    });
    throw new BillingError(400, 'The payment could not be verified. If money was taken, it will be matched automatically or refunded.', 'SIGNATURE_INVALID');
  }
  if (order.status === 'created') {
    await BillingOrders.updateOne({ id: order.id }, { $set: { signature_verified_at: new Date(), updated_at: new Date() } });
  }
  const result = await fulfil(order, { paymentId: String(paymentId), source: 'checkout' });
  return { ...result, order: publicOrder(result.order) };
}

const WEBHOOK_EVENTS = new Set(['payment.captured', 'order.paid']);

/**
 * A failed payment becomes a notice for the workspace that owns the order. The
 * tenant and amount come from our own order row, never from the webhook notes.
 */
async function handleFailedPayment(event) {
  const payment = event?.payload?.payment?.entity;
  if (!payment?.order_id || !payment?.id) return { handled: false, status: 200, reason: 'no order or payment id' };
  const order = await runAsSystem(() => BillingOrders.findOne({ razorpay_order_id: String(payment.order_id) }, { _id: 0 }).lean(), 'billing:webhook');
  if (!order) return { handled: false, status: 200, reason: 'not a billing order' };
  if (order.status === 'fulfilled') return { handled: true, status: 200, reason: 'order already paid' };
  await runAsTenant(order.tenant_id, () => customerAlerts.paymentFailed({ reference: payment.id, amount: Number(order.amount_paise) / 100, currency: order.currency || 'INR' }));
  return { handled: true, status: 200, tenant_id: order.tenant_id, reason: 'payment failed' };
}

/**
 * Razorpay webhook (no tenant context: the tenant comes from the order row).
 * Returns { handled, reason } and never throws for a bad payload; the route
 * answers 200 to anything signed so Razorpay does not retry forever.
 */
async function handleWebhook({ rawBody, signature, event }) {
  if (!razorpay.webhookConfigured()) return { handled: false, status: 503, reason: 'RAZORPAY_WEBHOOK_SECRET is not configured' };
  if (!razorpay.verifyWebhookSignature({ rawBody, signature })) return { handled: false, status: 401, reason: 'invalid signature' };
  const name = event?.event;
  if (name === 'payment.failed') return handleFailedPayment(event);
  if (!WEBHOOK_EVENTS.has(name)) return { handled: false, status: 200, reason: `ignored event ${name || 'unknown'}` };
  const payment = event?.payload?.payment?.entity;
  const razorpayOrderId = payment?.order_id || event?.payload?.order?.entity?.id;
  const paymentId = payment?.id;
  if (!razorpayOrderId || !paymentId) return { handled: false, status: 200, reason: 'no order or payment id' };

  const order = await runAsSystem(() => BillingOrders.findOne({ razorpay_order_id: String(razorpayOrderId) }, { _id: 0 }).lean(), 'billing:webhook');
  if (!order) return { handled: false, status: 200, reason: 'not a billing order' };
  if (payment && (Number(payment.amount) !== Number(order.amount_paise) || (payment.currency && payment.currency !== order.currency))) {
    console.warn(`[billing/webhook] Amount mismatch on ${razorpayOrderId}: expected ${order.amount_paise} ${order.currency}, got ${payment.amount} ${payment.currency}`);
    return { handled: false, status: 200, reason: 'amount mismatch' };
  }
  if (payment && payment.status && payment.status !== 'captured') return { handled: false, status: 200, reason: `payment ${payment.status}` };

  const result = await runAsTenant(order.tenant_id, () => fulfil(order, { paymentId: String(paymentId), source: 'webhook' }));
  return { handled: true, status: 200, tenant_id: order.tenant_id, ...result };
}

/**
 * Extra seats and numbers are paid from the wallet for the current period.
 * Tenant context; returns the new subscription and wallet balance.
 */
async function buyExtra({ kind, quantity = 1, userId = null, now = new Date() }) {
  if (!['seat', 'number'].includes(kind)) throw new BillingError(400, 'kind must be seat or number');
  const count = Number(quantity);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new BillingError(400, 'quantity must be between 1 and 50');
  const live = await subscriptions.active(null, now);
  if (!live?.plan) throw new BillingError(409, 'Choose a plan before adding extras', 'NO_ACTIVE_PLAN');
  const unitInr = kind === 'seat' ? live.plan.extra_seat_price_inr : live.plan.extra_number_price_inr;
  const amountPaise = plansService.toPaise(unitInr) * count;
  if (amountPaise <= 0) throw new BillingError(409, `Extra ${kind}s are not sold on the ${live.plan.name} plan`);
  const reference = `extra_${kind}:${live.subscription.id}:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`;
  let debit;
  try {
    debit = await wallet.debit({
      amountPaise, reason: kind === 'seat' ? 'extra_seat' : 'extra_number', referenceType: 'extra', referenceId: reference,
      description: `${count} extra WhatsApp ${kind}${count > 1 ? 's' : ''} until ${new Date(live.subscription.current_period_end).toDateString()}`,
      createdBy: userId, meta: { kind, quantity: count, unit_inr: unitInr },
    });
  } catch (error) {
    if (error instanceof wallet.WalletError) throw new BillingError(402, `Not enough money in the wallet: ${count} extra ${kind}${count > 1 ? 's' : ''} cost ${wallet.formatInr(amountPaise)}. Top up the wallet first.`, 'INSUFFICIENT_FUNDS');
    throw error;
  }
  const sub = await subscriptions.addExtras({ kind, quantity: count, now });
  await audit.record(audit.EVENTS.ENTITLEMENT_CHANGED, {
    tenantId: requireTenantId(), targetType: 'subscription', targetId: sub?.id,
    actor: { actor_type: 'user', actor_user_id: userId },
    meta: { kind, quantity: count, amount_paise: amountPaise },
  });
  return { subscription: subscriptions.publicSubscription(sub, now), balance_paise: debit.balance_paise, charged_paise: amountPaise };
}

/**
 * Daily job: a subscription whose paid period ended is marked expired, and
 * its owner told. Nothing is deleted. Runs in the system context.
 */
async function expireLapsed(now = new Date()) {
  const lapsed = await runAsSystem(() => Subscriptions.find({ status: 'active', current_period_end: { $lte: now } }, { _id: 0, id: 1, tenant_id: 1, plan_name: 1 }).lean(), 'billing:expire');
  for (const sub of lapsed) {
    await runAsTenant(sub.tenant_id, async () => {
      await Subscriptions.updateOne({ id: sub.id, status: 'active' }, { $set: { status: 'expired', updated_at: now } });
      await alerts.raise({ key: `plan_expired:${sub.id}:${now.toISOString().slice(0, 10)}`, kind: 'plan_expired', message: `Your ${sub.plan_name} plan has ended. Renew it in Settings > Billing to keep AI replies on.`, meta: {} });
    });
  }
  return { expired: lapsed.length };
}

/** Orders of the current tenant, newest first. */
async function listOrders(limit = 20) {
  requireTenantId();
  const rows = await BillingOrders.find({}, { _id: 0 }).sort({ id: -1 }).limit(Math.min(Number(limit) || 20, 100)).lean();
  return rows.map(publicOrder);
}

module.exports = { BillingError, PURPOSES, topupMinInr, topupMaxInr, publicOrder, createOrder, fulfil, verifyCheckout, handleWebhook, buyExtra, expireLapsed, listOrders };
