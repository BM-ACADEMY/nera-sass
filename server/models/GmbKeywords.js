const { defineModel } = require('../db/mongo');

module.exports = defineModel('gmb_keywords', {
  id: { type: Number },
  client_id: { type: Number },
  keyword: { type: String },
  rank: { type: Number },
  previous_rank: { type: Number },
  pack_status: { type: String, default: "Not in Pack" },
  checked_at: { type: Date, default: Date.now },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
