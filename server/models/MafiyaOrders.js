const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('mafiya_orders', {
  id: { type: Number },
  title: { type: String },
  priority: { type: String, default: "High" },
  tag_category: { type: String },
  assignee: { type: String, default: "Satish" },
  client_name: { type: String },
  description: { type: String },
  box_type: { type: String, default: "steps" },
  box_content: { type: Mixed, default: () => ({}) },
  status: { type: String, default: "open" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
