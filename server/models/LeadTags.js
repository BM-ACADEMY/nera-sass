const { defineModel } = require('../db/mongo');

module.exports = defineModel('lead_tags', {
  lead_id: { type: Number },
  tag_id: { type: Number },
  assigned_at: { type: Date, default: Date.now },
}, { unique: [['lead_id', 'tag_id']], indexes: [['tag_id']] });
