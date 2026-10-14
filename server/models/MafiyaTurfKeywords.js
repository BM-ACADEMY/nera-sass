const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_turf_keywords', {
  id: { type: Number },
  client_id: { type: Number },
  keyword: { type: String },
  initial_rank: { type: Number, default: 100 },
  current_rank: { type: Number },
  previous_rank: { type: Number },
  pack_status: { type: String, default: "Not in Pack" },
  last_checked: { type: Date },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
