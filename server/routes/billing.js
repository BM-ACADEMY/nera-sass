/**
 * Customer billing API (/api/billing): plans, the workspace's subscription,
 * the prepaid wallet and Razorpay checkout. Every route requires a customer
 * login (`auth`) and runs in that user's tenant context, so a workspace only
 * ever sees its own subscription, orders and ledger. Platform staff manage
 * billing through /api/admin.
 *
 * Money flow: the server creates the Razorpay order (amount from the plans
 * table), the browser pays with Razorpay Checkout, the server verifies the
 * returned signature, and the wallet is credited only by the signed webhook
 * (services/billing/orders.js), once per Razorpay payment id.
 */
const express = require('express');
const { auth } = require('../middleware/authMiddleware');
const { requirePermission, can } = require('../services/permissions');
const { seatUsage } = require('../services/entitlements');
const { MetaWhatsappPhoneNumbers, Clients } = require('../models');
const { runAsSystem } = require('../services/tenantContext');
const billing = require('../services/billing');

const router = express.Router();
router.use(auth);

// Customers never see a raw error: known problems keep their message, the
// rest becomes a generic answer and is logged here.
function fail(res, error, where) {
  if (error && error.status && error.status < 500) {
    return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
  if (error && error.status === 503) return res.status(503).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  if (error && error.status === 502) return res.status(502).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  console.error(`[billing] ${where}:`, error?.message || error);
  return res.status(500).json({ error: 'Something went wrong on our side. Please try again.' });
}

// WhatsApp numbers this workspace has connected (read only; the sending code is untouched).
async function numbersInUse(tenantId) {
  const brand = await Clients.findOne({}, { _id: 0, id: 1, phone_number_id: 1 }).lean();
  const linked = await runAsSystem(() => MetaWhatsappPhoneNumbers.countDocuments({ client_id: brand?.id ?? -1, platform_inbox: { $ne: true } }), 'billing');
  return Math.max(linked, brand?.phone_number_id ? 1 : 0);
}

// GET /api/billing/plans — the price list (any signed-in member).
router.get('/plans', async (req, res) => {
  try {
    res.json({ plans: await billing.plans.listPlans() });
  } catch (error) {
    fail(res, error, 'plans');
  }
});

// GET /api/billing/summary — plan, period, wallet, usage and notices.
router.get('/summary', async (req, res) => {
  try {
    const tenantId = req.identity.tenantId;
    const now = new Date();
    const [sub, balance, seats, numbers, gate, limits, notices] = await Promise.all([
      billing.subscriptions.current(),
      billing.wallet.balancePaise(),
      seatUsage(tenantId),
      numbersInUse(tenantId),
      billing.aiAllowance.check(req.tenant, now),
      billing.limits(null, now),
      billing.alerts.recent(10),
    ]);
    const subscription = billing.subscriptions.publicSubscription(sub, now);
    res.json({
      subscription,
      plan: gate.plan || (sub ? await billing.plans.planById(sub.plan_id) : null),
      wallet: { balance_paise: balance, balance_inr: balance / 100, currency: 'INR', topup_min_inr: billing.orders.topupMinInr(), topup_max_inr: billing.orders.topupMaxInr() },
      ai: {
        allowed: gate.allowed,
        reason: gate.reason,
        source: gate.source,
        allowance: gate.allowance,
        used: gate.used,
        left: gate.left,
        overage_price_paise: gate.plan ? gate.plan.ai_overage_price_paise : 0,
        period_start: gate.period_start,
        period_end: subscription?.current_period_end || null,
      },
      seats: { used: seats.used, active_users: seats.activeUsers, pending_invitations: seats.pendingInvitations, limit: limits.seats, extra: subscription?.extra_seats || 0 },
      numbers: { used: numbers, limit: limits.numbers, extra: subscription?.extra_numbers || 0 },
      alerts: notices,
      payments: { enabled: billing.razorpay.isConfigured(), key_id: billing.razorpay.keyId() },
      meta_billing_note: 'WhatsApp conversation charges are billed to you by Meta directly. The wallet pays only for AI replies beyond your plan, extra seats and extra numbers.',
      permissions: { manage_billing: can(req.identity, 'billing.manage') },
    });
  } catch (error) {
    fail(res, error, 'summary');
  }
});

// GET /api/billing/wallet/ledger?limit=&before=
router.get('/wallet/ledger', requirePermission('billing.view'), async (req, res) => {
  try {
    const rows = await billing.wallet.ledger({ limit: req.query.limit, before: req.query.before });
    res.json({
      balance_paise: await billing.wallet.balancePaise(),
      entries: rows.map((row) => ({
        id: row.id, direction: row.direction, amount_paise: row.amount_paise, amount_inr: row.amount_paise / 100,
        reason: row.reason, description: row.description, reference_type: row.reference_type, created_at: row.created_at,
      })),
    });
  } catch (error) {
    fail(res, error, 'ledger');
  }
});

// GET /api/billing/orders
router.get('/orders', requirePermission('billing.view'), async (req, res) => {
  try {
    res.json({ orders: await billing.orders.listOrders(req.query.limit) });
  } catch (error) {
    fail(res, error, 'orders');
  }
});

// POST /api/billing/orders { purpose: 'subscription', plan_code } | { purpose: 'wallet_topup', amount_inr }
router.post('/orders', requirePermission('billing.manage'), async (req, res) => {
  try {
    const purpose = String(req.body?.purpose || '');
    const result = await billing.orders.createOrder({
      purpose,
      planCode: req.body?.plan_code,
      amountInr: req.body?.amount_inr,
      userId: req.user.id,
    });
    res.status(201).json(result);
  } catch (error) {
    fail(res, error, 'create order');
  }
});

// POST /api/billing/orders/verify { razorpay_order_id, razorpay_payment_id, razorpay_signature }
router.post('/orders/verify', requirePermission('billing.manage'), async (req, res) => {
  try {
    const { razorpay_order_id: orderId, razorpay_payment_id: paymentId, razorpay_signature: signature } = req.body || {};
    if (![orderId, paymentId, signature].every((v) => typeof v === 'string' && v.length > 0 && v.length < 200)) {
      return res.status(400).json({ error: 'razorpay_order_id, razorpay_payment_id and razorpay_signature are required' });
    }
    const result = await billing.orders.verifyCheckout({ orderId, paymentId, signature, userId: req.user.id });
    res.json({
      verified: true,
      order: result.order,
      subscription: result.subscription || null,
      wallet_credit_pending: Boolean(result.pending_webhook),
      message: result.pending_webhook
        ? 'Payment received. Your wallet will be credited as soon as Razorpay confirms it (usually within a minute).'
        : (result.subscription ? `Your ${result.subscription.plan_name} plan is active.` : 'Payment confirmed.'),
    });
  } catch (error) {
    fail(res, error, 'verify order');
  }
});

// POST /api/billing/extras { kind: 'seat' | 'number', quantity }
router.post('/extras', requirePermission('billing.manage'), async (req, res) => {
  try {
    const result = await billing.orders.buyExtra({ kind: String(req.body?.kind || ''), quantity: req.body?.quantity ?? 1, userId: req.user.id });
    res.json(result);
  } catch (error) {
    fail(res, error, 'extras');
  }
});

// POST /api/billing/subscription/cancel — stops renewals at period end.
router.post('/subscription/cancel', requirePermission('billing.manage'), async (req, res) => {
  try {
    const sub = await billing.subscriptions.cancel({});
    if (!sub) return res.status(404).json({ error: 'This workspace has no plan to cancel' });
    res.json({ subscription: billing.subscriptions.publicSubscription(sub) });
  } catch (error) {
    fail(res, error, 'cancel');
  }
});

module.exports = router;
