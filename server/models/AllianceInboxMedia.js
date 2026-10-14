const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_inbox_media', {
  id: { type: Number },
  message_id: { type: Number },
  media_id: { type: String },
  storage_path: { type: String },
  public_url: { type: String },
  mime_type: { type: String },
  filename: { type: String },
  file_size: { type: Number },
  direction: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['message_id']] });
