const { defineModel } = require('../db/mongo');

module.exports = defineModel('lead_notes', {
  id: { type: Number },
  lead_id: { type: Number },
  user_id: { type: Number },
  note: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['lead_id'], ['user_id']] });
