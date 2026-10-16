const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_geogrid_scans_log', {
  id: { type: Number },
  client_id: { type: Number },
  scanned_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
