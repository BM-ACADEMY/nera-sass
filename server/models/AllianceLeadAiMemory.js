const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_lead_ai_memory', {
  prospect_id: { type: Number },
  lead_key: { type: String },
  summary: { type: String, default: "" },
  memory: { type: Mixed, default: () => ({}) },
  last_channel: { type: String },
  last_message_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['lead_key'], ['prospect_id']] });
