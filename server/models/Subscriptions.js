const { defineModel, Mixed } = require('../db/mongo');

// A tenant's subscription (plan B2, minimal). Prices and limits are copied from
// the plan catalogue when the subscription is created and never recomputed
// (Full Scope p10: "store the computed contract value on the subscription").
module.exports = defineModel('subscriptions', {
  id: { type: Number },
  plan_code: { type: String },
  plan_name: { type: String },
  plan_version: { type: Number },
  product_line: { type: String },
  term_months: { type: Number },
  monthly_price: { type: Number },
  discount_pct: { type: Number, default: 0 },
  contract_value: { type: Number },
  onboarding_fee: { type: Number },
  currency: { type: String, default: 'INR' },
  limits: { type: Mixed, default: () => ({}) },
  features: { type: Mixed, default: () => ({}) },
  // 'active' | 'cancelled' | 'replaced'
  status: { type: String, default: 'active' },
  current_period_start: { type: Date },
  current_period_end: { type: Date },
  // 'manual_grant' (Milestone A, staff-logged) | 'razorpay' (B5, later)
  payment_method: { type: String },
  payment_reference: { type: String },
  granted_by: { type: Number },
  // Why a manual grant was authorized (required when payment_method is 'manual_grant').
  grant_reason: { type: String },
  // Legacy columns kept for compatibility with existing rows.
  plan: { type: String },
  price_monthly: { type: Number },
  starts_at: { type: Date },
  expires_at: { type: Date },
  razorpay_sub_id: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['status'], ['current_period_end']] });
