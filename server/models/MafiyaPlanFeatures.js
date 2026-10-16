const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_plan_features', {
  id: { type: Number },
  plan_id: { type: Number },
  feature_key: { type: String },
  feature_name: { type: String },
  limit_value: { type: Number, default: -1 },
  created_at: { type: Date, default: Date.now },
  limit_period: { type: String, default: "monthly" },
  daily_limit: { type: Number, default: -1 },
}, { autoId: true, indexes: [['plan_id']] });
