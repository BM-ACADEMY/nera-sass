const { defineModel } = require('../db/mongo');

module.exports = defineModel('prompt_templates', {
  id: { type: Number },
  name: { type: String },
  purpose: { type: String },
  prompt_text: { type: String },
  active: { type: Boolean, default: true },
  updated_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
