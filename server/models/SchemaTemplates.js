const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('schema_templates', {
  id: { type: Number },
  name: { type: String },
  schema_type: { type: String },
  schema_data: { type: Mixed },
  description: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
