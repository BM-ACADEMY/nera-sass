const { defineModel } = require('../db/mongo');

module.exports = defineModel('gmb_keyword_history', {
  id: { type: Number },
  keyword_id: { type: Number },
  rank: { type: Number },
  checked_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['keyword_id']] });
