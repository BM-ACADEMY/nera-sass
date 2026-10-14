const { defineModel } = require('../db/mongo');

module.exports = defineModel('ai_decisions', {
  id: { type: Number },
  lead_id: { type: String },
  module: { type: String },
  input: { type: String },
  output: { type: String },
  confidence: { type: Number },
  model: { type: String },
  tokens: { type: Number },
  execution_time_ms: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
