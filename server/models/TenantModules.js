const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('tenant_modules', {
  id: { type: Number },
  module: { type: String },
  active: { type: Boolean, default: true },
  limits: { type: Mixed, default: () => ({}) },
}, { autoId: true });
