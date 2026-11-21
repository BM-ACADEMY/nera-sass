const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('templates', {
  id: { type: Number },
  name: { type: String },
  category: { type: String, default: "UTILITY" },
  language: { type: String, default: "en" },
  header_format: { type: String, default: "TEXT" },
  header: { type: String },
  body: { type: String },
  footer: { type: String },
  buttons: { type: Mixed, default: () => [] },
  client_id: { type: Number },
  status: { type: String, default: "draft" },
  meta_template_id: { type: String },
  submitted_at: { type: Date },
  approved_at: { type: Date },
  uses: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  samples: { type: Mixed, default: () => [] },
  parameter_definitions: { type: Mixed, default: () => ({}) },
  template_scope: { type: String, default: "shared" },
  // One row per brand, name and language inside a workspace (migration 040 drops the
  // old name-only index that made every workspace share one 'hello_world').
}, { autoId: true, unique: [['tenant_id', 'client_id', 'name', 'language']], indexes: [['client_id']] });
