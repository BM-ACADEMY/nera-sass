const { defineModel } = require('../db/mongo');

// One file kept on the media server (mediaserver/). The bytes are encrypted
// there; this row records which workspace owns it, so the API can refuse to
// sign a link to another workspace's file. Admin-inbox files have scope
// "platform" and no tenant.
module.exports = defineModel('media_files', {
  id: { type: Number },
  file_id: { type: String },
  scope: { type: String }, // t_<tenant id> | platform
  mime_type: { type: String },
  file_size: { type: Number },
  filename: { type: String },
  source: { type: String }, // upload | inbound | migration
  wa_media_id: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['file_id']], indexes: [['scope']] });
