const { defineModel } = require('../db/mongo');

module.exports = defineModel('meetings', {
  id: { type: Number },
  org_id: { type: Number },
  scheduled: { type: Date },
  type: { type: String, default: "online" },
  meet_link: { type: String },
  agenda: { type: String },
  notes: { type: String },
  outcome: { type: String },
  mou_sent: { type: Boolean, default: false },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['org_id']] });
