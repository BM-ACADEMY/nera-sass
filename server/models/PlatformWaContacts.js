const { defineModel } = require('../db/mongo');

// A person chatting with the platform's own WhatsApp number (admin inbox).
// Platform data: never scoped to, or visible from, a customer workspace.
module.exports = defineModel('platform_wa_contacts', {
  id: { type: Number },
  wa_id: { type: String }, // phone digits as WhatsApp reports them
  profile_name: { type: String },
  name: { type: String }, // set by staff
  note: { type: String },
  status: { type: String, default: 'open' }, // open | closed
  unread_count: { type: Number, default: 0 },
  last_message_at: { type: Date },
  last_message_preview: { type: String },
  last_message_direction: { type: String },
  last_inbound_at: { type: Date }, // starts Meta's 24-hour customer service window
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['wa_id']], indexes: [['last_message_at']] });
