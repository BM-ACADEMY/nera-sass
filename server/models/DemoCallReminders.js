const { defineModel } = require('../db/mongo');

module.exports = defineModel('demo_call_reminders', {
  id: { type: Number },
  lead_id: { type: Number },
  booking_time: { type: Date },
  reminder_minutes: { type: Number },
  status: { type: String, default: "processing" },
  message: { type: String },
  wa_message_id: { type: String },
  sent_at: { type: Date },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['lead_id', 'booking_time', 'reminder_minutes']] });
