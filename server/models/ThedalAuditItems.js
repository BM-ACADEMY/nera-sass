const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_audit_items', {
  id: { type: Number },
  audit_id: { type: Number },
  check_key: { type: String },
  status: { type: String, default: "fail" },
  score: { type: Number, default: 0 },
  message: { type: String },
  fix_guide: { type: String },
}, { autoId: true, indexes: [['audit_id']] });
