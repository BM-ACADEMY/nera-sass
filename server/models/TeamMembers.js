const { defineModel } = require('../db/mongo');

module.exports = defineModel('team_members', {
  id: { type: Number },
  user_id: { type: Number },
  name: { type: String },
  phone: { type: String },
  role: { type: String, default: "ops" },
  brand_access: { type: [String], default: () => ["all"] },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['user_id']] });
