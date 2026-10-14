const { defineModel, Mixed } = require('../db/mongo');

const today = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

module.exports = defineModel('thedal_rank_history', {
  id: { type: Number },
  keyword_id: { type: Number },
  checked_date: { type: Date, default: today },
  rank: { type: Number },
  serp_features: { type: Mixed, default: () => [] },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['keyword_id']] });
