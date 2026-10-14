const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_gsc_queries', {
  id: { type: Number },
  client_id: { type: Number },
  query: { type: String },
  clicks: { type: Number, default: 0 },
  impressions: { type: Number, default: 0 },
  ctr: { type: Number, default: 0 },
  position: { type: Number, default: 0 },
  fetched_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
