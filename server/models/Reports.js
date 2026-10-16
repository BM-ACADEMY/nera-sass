const { defineModel } = require('../db/mongo');

module.exports = defineModel('reports', {
  id: { type: Number },
  student_name: { type: String },
  report_title: { type: String },
  summary: { type: String },
  email: { type: String },
  status: { type: String, default: "pending" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
