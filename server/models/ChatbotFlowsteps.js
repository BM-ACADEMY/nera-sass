const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('chatbot_flowsteps', {
  id: { type: Number },
  flow_id: { type: Number },
  step_id: { type: String },
  question: { type: String },
  options: { type: Mixed, default: () => [] },
  next_step: { type: String },
  capture_mapping: { type: String },
  capture_type: { type: String },
  is_entry_point: { type: Boolean, default: false },
  tags_on_reach: { type: Mixed, default: () => [] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['flow_id', 'step_id']] });
