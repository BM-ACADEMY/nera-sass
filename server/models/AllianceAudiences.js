const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_audiences', {
  id: { type: Number },
  code: { type: String },
  label: { type: String },
  brand: { type: String },
  default_channel: { type: String, default: "email" },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  template_samples: { type: Mixed, default: () => [] },
  column_config: { type: Mixed, default: () => [] },
}, { autoId: true, unique: [['code']] });
