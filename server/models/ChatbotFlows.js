const { defineModel } = require('../db/mongo');

module.exports = defineModel('chatbot_flows', {
  id: { type: Number },
  name: { type: String },
  description: { type: String },
  is_active: { type: Boolean, default: true },
  is_published: { type: Boolean, default: false },
  client_id: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
