const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_prospect_score_events', {
  id: { type: Number },
  prospect_id: { type: Number },
  channel: { type: String },
  event_key: { type: String },
  intent: { type: String },
  score_delta: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['channel', 'event_key']], indexes: [['prospect_id']] });
