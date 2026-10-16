const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_keywords', {
  id: { type: Number },
  client_id: { type: Number },
  keyword: { type: String },
  device: { type: String, default: "desktop" },
  location: { type: String, default: "Pondicherry" },
  current_rank: { type: Number, default: 0 },
  best_rank: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
