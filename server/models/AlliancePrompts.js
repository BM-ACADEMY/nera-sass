const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_prompts', {
  id: { type: Number },
  job: { type: String },
  channel: { type: String },
  prompt_text: { type: String },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['job', 'channel', 'version']] });
