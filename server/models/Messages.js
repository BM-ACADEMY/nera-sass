const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('messages', {
  id: { type: Number },
  conversation_id: { type: Number },
  direction: { type: String },
  content: { type: String },
  msg_type: { type: String, default: "text" },
  template_name: { type: String },
  wa_msg_id: { type: String },
  status: { type: String, default: "sent" },
  is_ai: { type: Boolean, default: false },
  sent_by: { type: Number },
  sent_at: { type: Date, default: Date.now },
  read_at: { type: Date },
  is_deleted: { type: Boolean, default: false },
  media_url: { type: String },
  reply_to_wa_id: { type: String },
  is_forwarded: { type: Boolean, default: false },
  pinned_until: { type: Date },
  is_starred: { type: Boolean, default: false },
  reactions: { type: Mixed, default: () => ({}) },
}, { autoId: true, indexes: [['conversation_id']] });
