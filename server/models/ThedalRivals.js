const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('thedal_rivals', {
  id: { type: Number },
  client_id: { type: Number },
  rival_domain: { type: String },
  shared_keywords: { type: Number, default: 0 },
  content_gap_json: { type: Mixed, default: () => [] },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
