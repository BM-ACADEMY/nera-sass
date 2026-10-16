const { defineModel } = require('../db/mongo');

module.exports = defineModel('payments', {
  id: { type: Number },
  lead_id: { type: Number },
  amount: { type: Number },
  currency: { type: String, default: "INR" },
  status: { type: String, default: "pending" },
  razorpay_payment_id: { type: String },
  razorpay_link_id: { type: String },
  payment_link: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['lead_id']] });
