const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('tracked_citations', {
  id: { type: Number },
  business_name: { type: String },
  phone: { type: String },
  added_at: { type: Date, default: Date.now },
  last_checked: { type: Date },
  metrics: { type: Mixed },
  status: { type: String, default: "Monitoring" },
}, { autoId: true, unique: [['business_name']] });
