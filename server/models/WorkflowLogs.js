const { defineModel } = require('../db/mongo');

module.exports = defineModel('workflow_logs', {
  id: { type: Number },
  workflow: { type: String },
  lead_id: { type: String },
  status: { type: String },
  message: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
