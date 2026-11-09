const { defineModel } = require('../db/mongo');

// One outbound reply-webhook setting per workspace. The signing secret is stored
// only encrypted (AES-256-GCM, utils/crypto.js); the API shows it once, when it
// is created or rotated, and afterwards only its last four characters.
module.exports = defineModel('reply_webhooks', {
  id: { type: Number },
  url: { type: String },
  enabled: { type: Boolean, default: true },
  secret_enc: { type: String },
  secret_last4: { type: String },
  secret_rotated_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id']] });
