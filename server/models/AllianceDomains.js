const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_domains', {
  id: { type: Number },
  inbox_email: { type: String },
  provider: { type: String },
  credential_ref: { type: String },
  warmup_stage: { type: Number, default: 1 },
  daily_cap: { type: Number, default: 20 },
  sent_today: { type: Number, default: 0 },
  reputation: { type: String, default: "unknown" },
  status: { type: String, default: "inactive" },
  last_reset: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  tenant_id: { type: Number },
}, { autoId: true, unique: [['inbox_email']], indexes: [['tenant_id']] });
