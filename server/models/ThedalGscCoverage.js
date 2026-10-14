const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_gsc_coverage', {
  id: { type: Number },
  client_id: { type: Number },
  indexed_count: { type: Number, default: 0 },
  error_count: { type: Number, default: 0 },
  excluded_count: { type: Number, default: 0 },
  fetched_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
