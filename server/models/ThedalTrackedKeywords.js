const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_tracked_keywords', {
  id: { type: Number },
  client_domain: { type: String },
  keyword: { type: String },
  tracked_since: { type: Date, default: Date.now },
}, { autoId: true });
