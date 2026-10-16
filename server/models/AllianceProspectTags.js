const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_prospect_tags', {
  prospect_id: { type: Number },
  tag_id: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { unique: [['prospect_id', 'tag_id']], indexes: [['tag_id']] });
