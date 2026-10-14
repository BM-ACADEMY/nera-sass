const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_email_attachments', {
  id: { type: Number },
  inbound_id: { type: Number },
  attachment_index: { type: Number },
  filename: { type: String },
  content_type: { type: String },
  content_id: { type: String },
  size_bytes: { type: Number, default: 0 },
  content: { type: Buffer },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['inbound_id', 'attachment_index']] });
