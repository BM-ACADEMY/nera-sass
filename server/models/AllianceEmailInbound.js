const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_email_inbound', {
  id: { type: Number },
  message_id: { type: String },
  in_reply_to: { type: String },
  message_references: { type: [String], default: () => [] },
  from_email: { type: String },
  from_name: { type: String },
  to_email: { type: String },
  subject: { type: String },
  text_body: { type: String },
  html_body: { type: String },
  received_at: { type: Date, default: Date.now },
  prospect_id: { type: Number },
  campaign_id: { type: Number },
  touch_id: { type: Number },
  processing_status: { type: String, default: "received" },
  processing_error: { type: String },
  raw_headers: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['message_id']], indexes: [['prospect_id'], ['campaign_id'], ['touch_id']] });
