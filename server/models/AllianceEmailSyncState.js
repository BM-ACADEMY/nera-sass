const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_email_sync_state', {
  mailbox: { type: String },
  last_checked_at: { type: Date },
  last_success_at: { type: Date },
  last_error: { type: String },
  updated_at: { type: Date, default: Date.now },
  last_uid: { type: Number },
}, { unique: [['mailbox']] });
