const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_suppression', {
  id: { type: Number },
  email: { type: String },
  phone: { type: String },
  reason: { type: String, default: "manual" },
  source: { type: String, default: "manual" },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['phone']], uniqueCaseInsensitive: [['email']] });
