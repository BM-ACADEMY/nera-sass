const { defineModel } = require('../db/mongo');

module.exports = defineModel('booking_notification_log', {
  id: { type: Number },
  calendar_event_id: { type: String },
  meeting_start: { type: Date },
  recipient: { type: String },
  message_id: { type: String },
  sent_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['calendar_event_id', 'meeting_start', 'recipient']] });
