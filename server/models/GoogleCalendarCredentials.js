const { defineModel } = require('../db/mongo');

module.exports = defineModel('google_calendar_credentials', {
  id: { type: Number, default: 1 },
  refresh_token_encrypted: { type: String },
  connected_email: { type: String },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['id']] });
