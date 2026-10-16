const { defineModel } = require('../db/mongo');

const today = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

module.exports = defineModel('thedal_gsc_snapshots', {
  id: { type: Number },
  client_id: { type: Number },
  snapshot_date: { type: Date, default: today },
  total_clicks: { type: Number, default: 0 },
  total_impressions: { type: Number, default: 0 },
  avg_ctr: { type: Number, default: 0 },
  avg_position: { type: Number, default: 0 },
}, { autoId: true, indexes: [['client_id']] });
