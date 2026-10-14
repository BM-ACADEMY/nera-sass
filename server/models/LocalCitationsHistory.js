const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('local_citations_history', {
  id: { type: Number },
  business_name: { type: String },
  phone: { type: String },
  address: { type: String },
  metrics: { type: Mixed },
  citations: { type: Mixed },
  scanned_at: { type: Date, default: Date.now },
}, { autoId: true });
