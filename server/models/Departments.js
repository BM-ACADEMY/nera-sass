const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('departments', {
  id: { type: Number },
  name: { type: String },
  access: { type: Mixed, default: () => ({}) },
}, { autoId: true });
