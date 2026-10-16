const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_objections', {
  id: { type: Number },
  audience: { type: String },
  objection: { type: String },
  approved_answer: { type: String },
  active: { type: Boolean, default: true },
  approved_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true });
