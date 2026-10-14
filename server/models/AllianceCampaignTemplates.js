const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_campaign_templates', {
  id: { type: Number },
  campaign_id: { type: Number },
  touch_no: { type: Number },
  delay_days: { type: Number },
  subject: { type: String },
  body: { type: String },
  ai_generated: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['campaign_id', 'touch_no']] });
