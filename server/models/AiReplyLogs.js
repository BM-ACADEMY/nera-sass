const { defineModel, Mixed } = require('../db/mongo');

// One row per customer message the AI Brain answered, for tracing and usage.
// The unique key also stops an n8n retry from answering a message twice.
module.exports = defineModel('ai_reply_logs', {
  id: { type: Number },
  lead_id: { type: Number },
  conversation_id: { type: Number },
  message_id: { type: Number },
  sent_message_id: { type: Number, default: null },
  status: { type: String, default: 'processing' }, // processing | sent | no_send | failed
  brain_version: { type: Number },
  layer1_version: { type: String },
  retrieved_doc_ids: { type: [Number], default: [] },
  prompt: { type: String },
  handoff: { type: Boolean, default: false },
  handoff_reason: { type: String, default: null },
  opt_out: { type: Boolean, default: false },
  meeting: { type: Mixed, default: null }, // the model's booking proposal, for debugging
  prompt_tokens: { type: Number, default: null },
  completion_tokens: { type: Number, default: null },
  latency_ms: { type: Number, default: null },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'message_id']], indexes: [['tenant_id', 'created_at']] });
