const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('citation_scans', {
  id: { type: Number },
  businessId: { type: Number },
  score: { type: Number },
  lastScan: { type: Date, default: Date.now },
  totalDirectories: { type: Number },
  matched: { type: Number },
  mismatched: { type: Number },
  missing: { type: Number },
  debugData: { type: Mixed },
}, { autoId: true });
