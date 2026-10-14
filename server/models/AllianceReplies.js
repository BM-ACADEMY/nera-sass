const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_replies', {
  id: { type: Number },
  prospect_id: { type: Number },
  channel: { type: String },
  body: { type: String },
  ai_intent: { type: String },
  ai_draft: { type: String },
  ai_score: { type: Number },
  status: { type: String, default: "new" },
  routed_to: { type: Number },
  approved_by: { type: Number },
  approved_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  email_inbound_id: { type: Number },
  tenant_id: { type: Number },
}, { autoId: true, unique: [['email_inbound_id']], indexes: [['prospect_id'], ['tenant_id']] });
