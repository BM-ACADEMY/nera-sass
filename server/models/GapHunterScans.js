const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('gap_hunter_scans', {
  id: { type: Number },
  client_domain: { type: String },
  competitor_domain: { type: String },
  scanned_at: { type: Date, default: Date.now },
  results_json: { type: Mixed },
}, { autoId: true });
