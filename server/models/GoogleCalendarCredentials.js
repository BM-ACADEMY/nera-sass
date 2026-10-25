const { defineModel } = require('../db/mongo');

// One row per workspace (tenant-scoped): the customer's own Google Calendar
// connection plus the rules the WhatsApp AI follows when it books meetings.
module.exports = defineModel('google_calendar_credentials', {
  refresh_token_encrypted: { type: String },
  connected_email: { type: String },
  connected_at: { type: Date },
  connected_by: { type: Number },
  calendar_id: { type: String, default: 'primary' },
  time_zone: { type: String, default: 'Asia/Kolkata' },
  booking_enabled: { type: Boolean, default: true },
  meeting_minutes: { type: Number, default: 30 },
  work_days: { type: [Number], default: [1, 2, 3, 4, 5, 6] }, // 0 = Sunday
  work_start: { type: String, default: '10:00' },
  work_end: { type: String, default: '19:00' },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['tenant_id']] });
