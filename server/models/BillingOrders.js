const { defineModel, Mixed } = require('../db/mongo');

// Razorpay orders created by the server for a workspace: a plan payment or a
// wallet top-up. The tenant and the amount come from this row, never from
// the browser or from the webhook payload.
module.exports = defineModel('billing_orders', {
  id: { type: Number },
  purpose: { type: String }, // subscription | wallet_topup
  plan_id: { type: Number, default: null },
  plan_code: { type: String, default: null },
  // N7: billing period bought (1, 3 or 6 months) for a plan order.
  period_months: { type: Number, default: null },
  // N7: the price, the GST on it and the total, kept apart. amount_paise is
  // what Razorpay is asked to charge and always equals total_paise.
  price_paise: { type: Number, default: null },
  gst_rate_percent: { type: Number, default: 0 },
  gst_paise: { type: Number, default: 0 },
  total_paise: { type: Number, default: null },
  amount_paise: { type: Number },
  currency: { type: String, default: 'INR' },
  razorpay_order_id: { type: String },
  razorpay_payment_id: { type: String, default: null },
  // created | paid (checkout signature verified) | fulfilled | failed
  status: { type: String, default: 'created' },
  signature_verified_at: { type: Date, default: null },
  fulfilled_at: { type: Date, default: null },
  fulfilled_by: { type: String, default: null }, // webhook | checkout
  // N7: the tax invoice written when the order was fulfilled.
  invoice_id: { type: Number, default: null },
  created_by: { type: Number, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['razorpay_order_id']], indexes: [['tenant_id', 'created_at'], ['razorpay_payment_id']] });
