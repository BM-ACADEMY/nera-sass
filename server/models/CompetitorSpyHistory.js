const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('competitor_spy_history', {
  id: { type: Number },
  query: { type: String },
  location: { type: String },
  results_json: { type: Mixed },
  scanned_at: { type: Date, default: Date.now },
  client_id: { type: Number },
}, { autoId: true, indexes: [['client_id']] });
