const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('thedal_content', {
  id: { type: Number },
  client_id: { type: Number },
  content_type: { type: String },
  title: { type: String },
  body: { type: String },
  target_keyword: { type: String },
  status: { type: String, default: "draft" },
  created_at: { type: Date, default: Date.now },
  language: { type: String, default: "english" },
  word_count: { type: Number },
  meta_description: { type: String },
  slug: { type: String },
  overrides: { type: Mixed, default: () => ({}) },
}, { autoId: true, indexes: [['client_id']] });
