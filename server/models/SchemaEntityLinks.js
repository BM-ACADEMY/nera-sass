const { defineModel } = require('../db/mongo');

module.exports = defineModel('schema_entity_links', {
  id: { type: Number },
  type: { type: String },
  url: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
