const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_kb', {
  id: { type: Number },
  audience: { type: String },
  brand: { type: String },
  fact_key: { type: String },
  fact_value: { type: String },
  source_id: { type: String },
  active: { type: Boolean, default: true },
  synced_at: { type: Date },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['brand', 'fact_key']] });
