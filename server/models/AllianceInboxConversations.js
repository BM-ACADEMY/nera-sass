const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_inbox_conversations', {
  id: { type: Number },
  contact_id: { type: Number },
  phone_number_id: { type: String },
  status: { type: String, default: "open" },
  mode: { type: String, default: "manual" },
  unread_count: { type: Number, default: 0 },
  last_message: { type: String },
  last_message_at: { type: Date },
  last_inbound_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  welcome_status: { type: String, default: "not_eligible" },
  welcome_template_name: { type: String },
  welcome_wa_msg_id: { type: String },
  welcome_sent_at: { type: Date },
  welcome_error: { type: String },
  last_ai_nudge_at: { type: Date },
  ai_nudge_count: { type: Number, default: 0 },
}, { autoId: true, unique: [['contact_id']] });
