const { defineModel } = require('../db/mongo');

module.exports = defineModel('campaign_logs', {
  id: { type: Number },
  campaign_id: { type: Number },
  lead_id: { type: Number },
  status: { type: String, default: "pending" },
  sent_at: { type: Date },
  wa_message_id: { type: String },
  error_message: { type: String },
}, { autoId: true, indexes: [['campaign_id'], ['lead_id']] });
