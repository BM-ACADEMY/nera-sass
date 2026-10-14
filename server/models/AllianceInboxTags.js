const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_inbox_tags', {
  id: { type: Number },
  name: { type: String },
  color: { type: String, default: "#000000" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['name']] });
