const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('tracked_backlinks', {
  id: { type: Number },
  domain: { type: String },
  added_at: { type: Date, default: Date.now },
  last_checked: { type: Date },
  metrics: { type: Mixed },
  status: { type: String, default: "Monitoring" },
}, { autoId: true, unique: [['domain']] });
