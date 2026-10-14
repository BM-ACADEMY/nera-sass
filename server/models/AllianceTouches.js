const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_touches', {
  id: { type: Number },
  prospect_id: { type: Number },
  campaign_id: { type: Number },
  touch_no: { type: Number },
  channel: { type: String },
  number_id: { type: Number },
  domain_id: { type: Number },
  message_body: { type: String },
  subject: { type: String },
  status: { type: String, default: "scheduled" },
  scheduled_at: { type: Date },
  sent_at: { type: Date },
  replied_at: { type: Date },
  error_message: { type: String },
  provider_message_id: { type: String },
  processing_started_at: { type: Date },
}, { autoId: true, unique: [['campaign_id', 'prospect_id', 'touch_no']], indexes: [['prospect_id'], ['number_id'], ['domain_id']] });
