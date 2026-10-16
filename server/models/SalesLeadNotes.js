const { defineModel } = require('../db/mongo');

module.exports = defineModel('sales_lead_notes', {
  id: { type: Number },
  lead_id: { type: Number },
  note: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['lead_id']] });
