const { defineModel } = require('../db/mongo');

module.exports = defineModel('knowledge_base', {
  id: { type: Number },
  title: { type: String },
  category: { type: String },
  brand: { type: String },
  content: { type: String },
  file_name: { type: String },
  char_count: { type: Number, default: 0 },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
