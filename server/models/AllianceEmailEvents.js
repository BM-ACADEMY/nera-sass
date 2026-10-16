const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_email_events', {
  id: { type: Number },
  touch_id: { type: Number },
  campaign_id: { type: Number },
  prospect_id: { type: Number },
  provider_message_id: { type: String },
  event_type: { type: String },
  event_payload: { type: Mixed, default: () => ({}) },
  occurred_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['touch_id'], ['campaign_id'], ['prospect_id']] });
