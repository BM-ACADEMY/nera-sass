const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_campaigns', {
  id: { type: Number },
  name: { type: String },
  audience: { type: String },
  channel: { type: String, default: "auto" },
  status: { type: String, default: "draft" },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  started_at: { type: Date },
  completed_at: { type: Date },
  objective: { type: String },
  sender_domain_id: { type: Number },
  scheduled_start_at: { type: Date },
  tenant_id: { type: Number },
}, { autoId: true, indexes: [['sender_domain_id'], ['tenant_id']] });
