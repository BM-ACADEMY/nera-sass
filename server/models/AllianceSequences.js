const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_sequences', {
  id: { type: Number },
  audience: { type: String },
  channel: { type: String },
  touch_no: { type: Number },
  delay_days: { type: Number },
  purpose: { type: String },
  active: { type: Boolean, default: true },
}, { autoId: true, unique: [['audience', 'channel', 'touch_no']] });
