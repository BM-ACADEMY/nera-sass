const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_plans', {
  id: { type: Number },
  name: { type: String },
  price: { type: Number, default: 0 },
  currency: { type: String, default: "INR" },
  billing_cycle: { type: String, default: "Monthly" },
  status: { type: String, default: "active" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
