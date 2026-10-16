const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_plan_features', {
  id: { type: Number },
  plan_id: { type: Number },
  feature_key: { type: String },
  feature_name: { type: String },
  limit_value: { type: Number, default: -1 },
  created_at: { type: Date, default: Date.now },
  text_value: { type: String },
}, { autoId: true, indexes: [['plan_id']] });
