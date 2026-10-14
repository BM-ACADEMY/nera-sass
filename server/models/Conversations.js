const { defineModel } = require('../db/mongo');

module.exports = defineModel('conversations', {
  id: { type: Number },
  lead_id: { type: Number },
  brand_id: { type: Number },
  phone: { type: String },
  last_message: { type: String },
  last_message_at: { type: Date },
  unread_count: { type: Number, default: 0 },
  status: { type: String, default: "open" },
  assigned_to: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['lead_id'], ['brand_id']] });
