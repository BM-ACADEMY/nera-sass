const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_domain_watch_checks', {
  id: { type: Number },
  domain: { type: String },
  keyword: { type: String },
  location: { type: String, default: "India" },
  rank: { type: Number },
  found: { type: Boolean, default: false },
  result_url: { type: String },
  result_title: { type: String },
  checked_at: { type: Date, default: Date.now },
}, { autoId: true });
