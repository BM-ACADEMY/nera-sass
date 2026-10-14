const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_backlinks', {
  id: { type: Number },
  client_id: { type: Number },
  source_domain: { type: String },
  anchor_text: { type: String },
  link_type: { type: String, default: "dofollow" },
  is_toxic: { type: Boolean, default: false },
  discovered_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
