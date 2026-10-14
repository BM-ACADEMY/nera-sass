const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_numbers', {
  id: { type: Number },
  label: { type: String },
  phone_number: { type: String },
  phone_number_id: { type: String },
  waba_id: { type: String },
  credential_ref: { type: String },
  quality_rating: { type: String, default: "green" },
  warmup_stage: { type: Number, default: 1 },
  daily_cap: { type: Number, default: 10 },
  sent_today: { type: Number, default: 0 },
  status: { type: String, default: "inactive" },
  paused_until: { type: Date },
  last_reset: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  tenant_id: { type: Number },
}, { autoId: true, unique: [['phone_number']], indexes: [['tenant_id']] });
