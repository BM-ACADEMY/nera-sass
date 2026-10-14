const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_prompt_rules', {
  id: { type: Number },
  name: { type: String },
  job: { type: String },
  channel: { type: String, default: "all" },
  audience: { type: String },
  condition_text: { type: String },
  instruction_text: { type: String },
  priority: { type: Number, default: 100 },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
