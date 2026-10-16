const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_whatsapp_followup_jobs', {
  id: { type: Number },
  campaign_id: { type: Number },
  prospect_id: { type: Number },
  followup_no: { type: Number },
  status: { type: String, default: "pending" },
  scheduled_at: { type: Date },
  claimed_at: { type: Date },
  claim_id: { type: String },
  wa_msg_id: { type: String },
  error_message: { type: String },
  sent_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  activity_cutoff_at: { type: Date },
  trigger_source: { type: String, default: "initial_campaign" },
}, { autoId: true, unique: [['campaign_id', 'prospect_id', 'followup_no']], indexes: [['prospect_id']] });
