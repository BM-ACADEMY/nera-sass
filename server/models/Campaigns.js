const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('campaigns', {
  id: { type: Number },
  name: { type: String },
  client_id: { type: Number },
  template_id: { type: Number },
  target_status: { type: String },
  scheduled_at: { type: Date },
  launched_at: { type: Date },
  status: { type: String, default: "scheduled" },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  template_parameters: { type: Mixed, default: () => ({}) },
}, { autoId: true, indexes: [['client_id'], ['template_id']] });
