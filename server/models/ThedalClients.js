const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_clients', {
  id: { type: Number },
  domain: { type: String },
  plan: { type: String, default: "Free" },
  gsc_connected: { type: Boolean, default: false },
  gmb_client_id: { type: Number },
  score: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  client_name: { type: String },
  phone: { type: String },
  email: { type: String },
  business_name: { type: String },
  status: { type: String, default: "active" },
  subscription_duration: { type: String, default: "1 Month" },
  business_category: { type: String },
  payment_status: { type: String, default: "active" },
  razorpay_order_id: { type: String },
  location: { type: String, default: "Pondicherry" },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['gmb_client_id']] });
