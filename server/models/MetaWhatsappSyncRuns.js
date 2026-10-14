const { defineModel } = require('../db/mongo');

module.exports = defineModel('meta_whatsapp_sync_runs', {
  id: { type: Number },
  status: { type: String },
  wabas_count: { type: Number, default: 0 },
  phones_count: { type: Number, default: 0 },
  templates_count: { type: Number, default: 0 },
  error: { type: String },
  started_at: { type: Date, default: Date.now },
  completed_at: { type: Date },
}, { autoId: true });
