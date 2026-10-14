const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_rank_drop_alerts', {
  id: { type: String },
  client_id: { type: Number },
  client_name: { type: String },
  keyword: { type: String },
  url: { type: String },
  old_rank: { type: Number },
  new_rank: { type: Number },
  drop_amount: { type: Number },
  search_volume: { type: Number },
  traffic_risk: { type: Number },
  severity: { type: String, default: "info" },
  is_critical: { type: Boolean, default: false },
  acknowledged: { type: Boolean, default: false },
  acknowledged_at: { type: Date },
  note: { type: String },
  is_demo: { type: Boolean, default: false },
  date_detected: { type: Date, default: Date.now },
}, { unique: [['id']], indexes: [['client_id']] });
