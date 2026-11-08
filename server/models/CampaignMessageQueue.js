const { defineModel, Mixed } = require('../db/mongo');

// The WhatsApp send queue (services/whatsappSendQueue.js). Campaign rows carry
// the template and recipient data they were queued with; other rows carry a
// ready Graph API `payload`. Every row is sent from the brand number of its
// tenant with per-number rate limits, a daily cap and retries with backoff.
module.exports = defineModel('campaign_message_queue', {
  id: { type: Number },
  campaign_id: { type: Number },
  lead_id: { type: Number },
  phone: { type: String },
  name: { type: String },
  template_name: { type: String },
  template_language: { type: String, default: "en" },
  template_body: { type: String },
  template_header: { type: String },
  template_parameters: { type: Mixed, default: () => ({}) },
  recipient_parameters: { type: Mixed, default: () => ({}) },
  recipient_data: { type: Mixed, default: () => ({}) },
  campaign_name: { type: String },
  brand_name: { type: String },
  phone_number_id: { type: String },
  // marketing | utility | service — decides which consent and pause rules apply.
  kind: { type: String, default: 'marketing' },
  // Graph API message object without `to` for non-campaign rows.
  payload: { type: Mixed },
  // What the inbox shows for the sent message (non-campaign rows).
  content: { type: String },
  msg_type: { type: String },
  source: { type: String },
  // pending | processing | sent | failed | skipped | cancelled
  status: { type: String, default: "pending" },
  attempts: { type: Number, default: 0 },
  next_attempt_at: { type: Date },
  last_attempt_at: { type: Date },
  error_message: { type: String },
  skip_reason: { type: String },
  wa_message_id: { type: String },
  created_at: { type: Date, default: Date.now },
  processed_at: { type: Date },
}, { autoId: true, indexes: [['campaign_id'], ['lead_id'], ['status', 'next_attempt_at'], ['phone']] });
