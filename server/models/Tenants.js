const { defineModel } = require('../db/mongo');

module.exports = defineModel('tenants', {
  id: { type: Number },
  name: { type: String },
  status: { type: String, default: "active" },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
