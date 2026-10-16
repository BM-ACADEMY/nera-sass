const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_campaign_prospects', {
  campaign_id: { type: Number },
  prospect_id: { type: Number },
  enrollment_status: { type: String, default: "pending" },
  current_touch: { type: Number, default: 0 },
  next_touch_at: { type: Date },
  stopped_at: { type: Date },
  stop_reason: { type: String },
  created_at: { type: Date, default: Date.now },
}, { unique: [['campaign_id', 'prospect_id']], indexes: [['prospect_id']] });
