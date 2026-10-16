const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('chatbot_knowledgebase', {
  id: { type: Number },
  flow_id: { type: Number },
  title: { type: String },
  content: { type: String },
  embedding: { type: Mixed },
  tags: { type: Mixed, default: () => [] },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['flow_id']] });
