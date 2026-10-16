const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('failed_webhooks', {
  id: { type: Number },
  page_id: { type: String },
  leadgen_id: { type: String },
  payload: { type: Mixed },
  error_message: { type: String },
  status: { type: String, default: "failed" },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
