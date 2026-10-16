const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_offering_faqs', {
  id: { type: Number },
  offering_id: { type: Number },
  question: { type: String },
  answer: { type: String },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['offering_id']] });
