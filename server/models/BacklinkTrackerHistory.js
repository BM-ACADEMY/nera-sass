const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('backlink_tracker_history', {
  id: { type: Number },
  domain: { type: String },
  metrics: { type: Mixed },
  links: { type: Mixed },
  scanned_at: { type: Date, default: Date.now },
}, { autoId: true });
