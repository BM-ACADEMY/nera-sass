/**
 * Razorpay gateway. Keys come from the environment only (RAZORPAY_KEY_ID,
 * RAZORPAY_SECRET, RAZORPAY_WEBHOOK_SECRET) and never reach a client or a log.
 * Orders are created here on the server; checkout and webhook signatures are
 * verified here with constant-time comparison. Tests replace `gateway.createOrder`.
 */
const crypto = require('crypto');

class GatewayError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const keyId = () => String(process.env.RAZORPAY_KEY_ID || '').trim() || null;
const keySecret = () => String(process.env.RAZORPAY_SECRET || process.env.RAZORPAY_KEY_SECRET || '').trim() || null;
const webhookSecret = () => String(process.env.RAZORPAY_WEBHOOK_SECRET || '').trim() || null;

const isConfigured = () => Boolean(keyId() && keySecret());
const webhookConfigured = () => Boolean(webhookSecret());

let client = null;
function sdk() {
  if (!isConfigured()) throw new GatewayError(503, 'Online payments are not available right now. Please try again later.', 'PAYMENTS_NOT_CONFIGURED');
  if (!client) {
    const Razorpay = require('razorpay');
    client = new Razorpay({ key_id: keyId(), key_secret: keySecret() });
  }
  return client;
}

/**
 * Creates a Razorpay order. `receipt` must be unique per order (<= 40 chars);
 * `notes` are plain strings Razorpay shows in its dashboard — never a secret.
 */
async function createOrder({ amountPaise, currency = 'INR', receipt, notes = {} }) {
  const amount = Number(amountPaise);
  if (!Number.isInteger(amount) || amount < 100) throw new GatewayError(400, 'Amount must be at least ₹1', 'INVALID_AMOUNT');
  try {
    const order = await sdk().orders.create({ amount, currency, receipt: String(receipt).slice(0, 40), payment_capture: 1, notes });
    return { id: order.id, amount: Number(order.amount), currency: order.currency, status: order.status, receipt: order.receipt };
  } catch (error) {
    const detail = error?.error?.description || error?.message || 'unknown error';
    console.error('[billing/razorpay] Order creation failed:', detail);
    throw new GatewayError(502, 'The payment provider did not accept the request. Please try again.', 'GATEWAY_ERROR');
  }
}

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a || ''), 'utf8');
  const y = Buffer.from(String(b || ''), 'utf8');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
};

/** Checkout result: HMAC-SHA256(order_id|payment_id) with the key secret. */
function verifyPaymentSignature({ orderId, paymentId, signature }) {
  const secret = keySecret();
  if (!secret || !orderId || !paymentId || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqual(expected, signature);
}

/** Webhook delivery: HMAC-SHA256(raw body) with the webhook secret. */
function verifyWebhookSignature({ rawBody, signature }) {
  const secret = webhookSecret();
  if (!secret || !rawBody || !signature) return false;
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return safeEqual(expected, signature);
}

const gateway = { createOrder };

module.exports = {
  GatewayError,
  gateway,
  keyId,
  isConfigured,
  webhookConfigured,
  verifyPaymentSignature,
  verifyWebhookSignature,
  _resetClient: () => { client = null; },
};
