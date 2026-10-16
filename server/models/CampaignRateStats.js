const { defineModel } = require('../db/mongo');

const today = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

module.exports = defineModel('campaign_rate_stats', {
  id: { type: Number },
  campaign_id: { type: Number },
  date: { type: Date, default: today },
  messages_sent: { type: Number, default: 0 },
  messages_failed: { type: Number, default: 0 },
  rate_limited_count: { type: Number, default: 0 },
}, { autoId: true, unique: [['campaign_id', 'date']] });
