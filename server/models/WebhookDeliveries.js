const { defineModel } = require('../db/mongo');

// Delivery log of the outbound reply webhook. It records ids, status codes and
// error codes only: never message text, phone numbers, names, response bodies or
// the full URL (host only). The payload is rebuilt from the message at each
// attempt, so nothing about the content is stored here.
module.exports = defineModel('webhook_deliveries', {
  id: { type: Number },
  event_id: { type: String },
  event_type: { type: String, default: 'message.received' },
  lead_id: { type: Number },
  message_id: { type: Number },
  url_host: { type: String },
  // pending | sending | delivered | failed | dropped | skipped
  status: { type: String, default: 'pending' },
  attempts: { type: Number, default: 0 },
  last_status_code: { type: Number, default: null },
  last_error_code: { type: String, default: null },
  last_attempt_at: { type: Date, default: null },
  next_attempt_at: { type: Date, default: Date.now },
  delivered_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
}, {
  autoId: true,
  unique: [['tenant_id', 'message_id', 'event_type']],
  indexes: [['status', 'next_attempt_at'], ['tenant_id', 'created_at'], ['tenant_id', 'lead_id']],
});
