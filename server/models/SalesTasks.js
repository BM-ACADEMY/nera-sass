const { defineModel } = require('../db/mongo');

module.exports = defineModel('sales_tasks', {
  id: { type: Number },
  lead_id: { type: Number },
  task_type: { type: String },
  status: { type: String, default: "pending" },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  completed_at: { type: Date },
  unread: { type: Boolean, default: true },
}, { autoId: true, indexes: [['lead_id']] });
