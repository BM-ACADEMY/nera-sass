const { defineModel } = require('../db/mongo');

// One row per customer business (Full Scope decision 2: one brand = one tenant).
// Platform-level collection: never tenant-scoped; only platform staff and the
// auth middleware read it directly.
module.exports = defineModel('tenants', {
  id: { type: Number },
  name: { type: String },
  // Staff-controlled access switch: 'active' | 'suspended' | 'deleted'.
  status: { type: String, default: 'active' },
  // Subscription lifecycle (services/lifecycle.js): active | grace | restricted |
  // suspended | archived | deletion_due. Recomputed daily and on every request.
  lifecycle_state: { type: String, default: 'active' },
  lifecycle_changed_at: { type: Date },
  owner_user_id: { type: Number, default: null },
  // Tenant-level settings (Full Scope standing rule 6).
  language: { type: String, default: 'en' },
  currency: { type: String, default: 'INR' },
  tax_treatment: { type: String, default: 'gst' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  is_founding_client: { type: Boolean, default: false },
  suspended_at: { type: Date },
  suspended_reason: { type: String },
  suspended_by: { type: Number },
  archived_at: { type: Date },
  archive_file: { type: String },
  deletion_request_reference: { type: String },
  deletion_requested_at: { type: Date },
  deleted_at: { type: Date },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['status'], ['lifecycle_state']] });
