const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_audits', {
  id: { type: Number },
  client_id: { type: Number },
  overall_score: { type: Number, default: 0 },
  pass_count: { type: Number, default: 0 },
  warn_count: { type: Number, default: 0 },
  fail_count: { type: Number, default: 0 },
  run_date: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
