const { defineModel, Mixed } = require('../db/mongo');

// One row per workspace: the plan it is on and the current paid period.
// Renewals extend the same row; every payment behind it is a billing_orders
// row. Tenant-scoped (required tenant).
module.exports = defineModel('subscriptions', {
  id: { type: Number },
  plan_id: { type: Number },
  plan_code: { type: String },
  plan_name: { type: String },
  // Snapshot of the price paid for the current period, in rupees.
  price_inr: { type: Number },
  currency: { type: String, default: 'INR' },
  // active (paid, inside the period) | expired (period ended) | cancelled
  status: { type: String, default: 'active' },
  current_period_start: { type: Date },
  current_period_end: { type: Date },
  // Extras bought from the wallet for the current period.
  extra_seats: { type: Number, default: 0 },
  extra_numbers: { type: Number, default: 0 },
  razorpay_order_id: { type: String, default: null },
  razorpay_payment_id: { type: String, default: null },
  activated_at: { type: Date },
  cancelled_at: { type: Date, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id']], indexes: [['status', 'current_period_end']] });
