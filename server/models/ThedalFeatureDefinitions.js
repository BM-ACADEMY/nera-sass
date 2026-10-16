const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_feature_definitions', {
  id: { type: Number },
  key: { type: String },
  name: { type: String },
  type: { type: String, default: "boolean" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['key']] });
