const { defineModel } = require('../db/mongo');

module.exports = defineModel('followup_rules', {
  id: { type: Number },
  brand: { type: String },
  stage: { type: String },
  touch_number: { type: Number },
  delay_minutes: { type: Number },
  action_type: { type: String },
  template_id: { type: String },
  payload_template: { type: String },
  ai_prompt_template: { type: String },
  priority: { type: Number, default: 1 },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
