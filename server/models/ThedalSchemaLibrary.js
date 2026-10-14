const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('thedal_schema_library', {
  id: { type: Number },
  client_id: { type: Number },
  schema_type: { type: String },
  schema_json: { type: Mixed },
  target_page: { type: String },
  is_deployed: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
