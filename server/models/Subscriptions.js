const { defineModel } = require('../db/mongo');

module.exports = defineModel('subscriptions', {
  id: { type: Number },
  plan: { type: String, default: "starter" },
  price_monthly: { type: Number },
  starts_at: { type: Date, default: Date.now },
  expires_at: { type: Date },
  razorpay_sub_id: { type: String },
  status: { type: String, default: "active" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
