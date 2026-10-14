const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_templates', {
  id: { type: Number },
  audience: { type: String },
  channel: { type: String },
  touch_no: { type: Number },
  template_name: { type: String },
  subject: { type: String },
  body: { type: String },
  provider_status: { type: String },
  active: { type: Boolean, default: true },
  updated_at: { type: Date, default: Date.now },
  language: { type: String, default: "en" },
}, { autoId: true, unique: [['audience', 'channel', 'touch_no']] });
