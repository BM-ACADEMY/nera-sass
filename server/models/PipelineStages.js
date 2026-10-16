const { defineModel } = require('../db/mongo');

module.exports = defineModel('pipeline_stages', {
  id: { type: Number },
  org_id: { type: Number },
  stage: { type: String, default: "contacted" },
  notes: { type: String },
  follow_up_at: { type: Date },
  mou_signed: { type: Boolean, default: false },
  mou_date: { type: Date },
  assigned_to: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['org_id']] });
