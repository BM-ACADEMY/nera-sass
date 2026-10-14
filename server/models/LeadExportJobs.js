const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('lead_export_jobs', {
  id: { type: Number },
  user_id: { type: Number },
  mode: { type: String },
  filters: { type: Mixed, default: () => ({}) },
  status: { type: String, default: "queued" },
  total_records: { type: Number, default: 0 },
  processed_records: { type: Number, default: 0 },
  file_path: { type: String },
  error_message: { type: String },
  created_at: { type: Date, default: Date.now },
  started_at: { type: Date },
  completed_at: { type: Date },
}, { autoId: true, indexes: [['user_id']] });
