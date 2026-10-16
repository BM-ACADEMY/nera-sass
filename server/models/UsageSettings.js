const { defineModel } = require('../db/mongo');

module.exports = defineModel('usage_settings', {
  key: { type: String },
  value: { type: String },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['key']] });
