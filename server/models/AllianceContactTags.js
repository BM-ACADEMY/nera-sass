const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_contact_tags', {
  contact_id: { type: Number },
  tag_id: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { unique: [['contact_id', 'tag_id']], indexes: [['tag_id']] });
