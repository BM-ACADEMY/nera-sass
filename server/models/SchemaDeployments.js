const { defineModel } = require('../db/mongo');

module.exports = defineModel('schema_deployments', {
  id: { type: Number },
  template_id: { type: Number },
  client_url: { type: String },
  deployed_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['template_id']] });
