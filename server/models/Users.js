const { defineModel } = require('../db/mongo');

module.exports = defineModel('users', {
  id: { type: Number },
  name: { type: String },
  email: { type: String },
  password_hash: { type: String },
  phone: { type: String },
  role: { type: String, default: "ops" },
  department_id: { type: Number, default: 2 },
  active: { type: Boolean, default: true },
  last_login: { type: Date },
  created_at: { type: Date, default: Date.now },
  is_active: { type: Boolean, default: true },
}, { autoId: true, unique: [['email']], indexes: [['department_id']] });
