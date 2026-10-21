const { defineModel } = require('../db/mongo');

// One message in the admin inbox. Outbound messages record which staff
// member sent them.
module.exports = defineModel('platform_wa_messages', {
  id: { type: Number },
  contact_id: { type: Number },
  direction: { type: String }, // inbound | outbound
  type: { type: String, default: 'text' }, // text | template | image | audio | ...
  text: { type: String },
  template_name: { type: String },
  media_id: { type: String },
  wa_message_id: { type: String },
  status: { type: String }, // received | sending | sent | delivered | read | failed
  error: { type: String },
  sent_by: { type: Number },
  sent_by_name: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['wa_message_id']], indexes: [['contact_id', 'created_at']] });
