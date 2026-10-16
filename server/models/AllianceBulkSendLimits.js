const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_bulk_send_limits', {
  channel: { type: String },
  limit_mode: { type: String, default: "unlimited" },
  custom_limit: { type: Number },
  updated_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['channel']] });
