const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('seo_audits', {
  id: { type: Number },
  client_id: { type: String },
  url: { type: String },
  audit_data: { type: Mixed, default: () => ({}) },
  off_page_checklist: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['client_id']] });
