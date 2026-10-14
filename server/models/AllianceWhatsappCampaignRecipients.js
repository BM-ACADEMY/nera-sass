const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_whatsapp_campaign_recipients', {
  id: { type: Number },
  campaign_id: { type: Number },
  prospect_id: { type: Number },
  status: { type: String, default: "queued" },
  scheduled_at: { type: Date },
  wa_msg_id: { type: String },
  error_message: { type: String },
  sent_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  reshare_status: { type: String, default: "not_started" },
  reshare_updated_at: { type: Date },
  reshare_updated_by: { type: Number },
}, { autoId: true, unique: [['campaign_id', 'prospect_id']], indexes: [['prospect_id']] });
