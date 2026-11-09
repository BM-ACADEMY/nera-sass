const { defineModel } = require('../db/mongo');

// One row per webhook event already accepted, so a redelivery is a no-op.
module.exports = defineModel('processed_webhook_events', {
  provider: { type: String },
  event_id: { type: String },
  created_at: { type: Date, default: Date.now },
}, { unique: [['provider', 'event_id']] });
