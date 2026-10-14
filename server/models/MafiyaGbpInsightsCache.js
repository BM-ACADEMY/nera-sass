const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_gbp_insights_cache', {
  id: { type: Number },
  client_id: { type: Number },
  insights_data: { type: String },
  location_name: { type: String },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['client_id']] });
