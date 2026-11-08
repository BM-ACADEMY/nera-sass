const { defineModel, Mixed } = require('../db/mongo');

// Razorpay orders created by the server for a workspace: a plan payment or a
// wallet top-up. The tenant and the amount come from this row, never from
// the browser or from the webhook payload.
module.exports = defineModel('billing_orders', {
  id: { type: Number },
  purpose: { type: String }, // subscription | wallet_topup
  plan_id: { type: Number, default: null },
  plan_code: { type: String, default: null },
  amount_paise: { type: Number },
  currency: { type: String, default: 'INR' },
  razorpay_order_id: { type: String },
  razorpay_payment_id: { type: String, default: null },
  // created | paid (checkout signature verified) | fulfilled | failed
  status: { type: String, default: 'created' },
  signature_verified_at: { type: Date, default: null },
  fulfilled_at: { type: Date, default: null },
  fulfilled_by: { type: String, default: null }, // webhook | checkout
  created_by: { type: Number, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['razorpay_order_id']], indexes: [['tenant_id', 'created_at'], ['razorpay_payment_id']] });
