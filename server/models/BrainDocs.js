const { defineModel } = require('../db/mongo');

module.exports = defineModel('brain_docs', {
  id: { type: Number },
  client_id: { type: Number },
  doc_type: { type: String },
  content: { type: String },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['client_id', 'doc_type']] });
