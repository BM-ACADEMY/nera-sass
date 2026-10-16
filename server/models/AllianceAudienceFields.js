const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_audience_fields', {
  id: { type: Number },
  audience_id: { type: Number },
  field_key: { type: String },
  label: { type: String },
  data_type: { type: String, default: "text" },
  required: { type: Boolean, default: false },
  active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  sample_value: { type: String },
}, { autoId: true, unique: [['audience_id', 'field_key']] });
