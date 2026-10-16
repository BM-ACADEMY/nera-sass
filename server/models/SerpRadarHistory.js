const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('serp_radar_history', {
  id: { type: Number },
  keyword: { type: String },
  scanned_at: { type: Date, default: Date.now },
  competitors_json: { type: Mixed },
  features_json: { type: Mixed },
  volatility_score: { type: Number },
  client_id: { type: Number },
}, { autoId: true, indexes: [['client_id']] });
