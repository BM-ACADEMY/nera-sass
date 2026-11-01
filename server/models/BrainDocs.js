const { defineModel } = require('../db/mongo');

module.exports = defineModel('brain_docs', {
  id: { type: Number },
  client_id: { type: Number },
  doc_type: { type: String },
  content: { type: String },
  // AI Brain knowledge items use doc_type "<kind>:<key>" (faq, product, policy,
  // brochure, other) because (client_id, doc_type) is unique.
  title: { type: String },
  is_active: { type: Boolean, default: true },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['client_id', 'doc_type']] });
