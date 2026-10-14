const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_reports', {
  id: { type: Number },
  client_id: { type: Number },
  report_month: { type: String },
  file_url: { type: String },
  keywords_tracked: { type: Number, default: 0 },
  avg_rank: { type: Number, default: 0 },
  generated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
