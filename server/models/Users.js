const { defineModel } = require('../db/mongo');

// Tenant-scoped with optional tenant: customer users always have tenant_id;
// platform staff have tenant_id = null and is_platform_staff = true.
module.exports = defineModel('users', {
  id: { type: Number },
  name: { type: String },
  email: { type: String, lowercase: true, trim: true },
  password_hash: { type: String },
  phone: { type: String },
  // Customer role: owner | admin | manager | agent (services/permissions.js).
  role: { type: String, default: 'agent' },
  is_platform_staff: { type: Boolean, default: false },
  // Platform staff role: founder | ops | support.
  staff_role: { type: String, default: null },
  department_id: { type: Number, default: 2 },
  active: { type: Boolean, default: true },
  is_active: { type: Boolean, default: true },
  deactivated_at: { type: Date },
  deactivated_by: { type: Number },
  // Incremented to revoke every token issued before (logout everywhere,
  // deactivation, password change).
  token_version: { type: Number, default: 0 },
  failed_login_count: { type: Number, default: 0 },
  locked_until: { type: Date },
  password_changed_at: { type: Date },
  reset_token_hash: { type: String },
  reset_token_expires_at: { type: Date },
  mfa_enabled: { type: Boolean, default: false },
  mfa_secret_enc: { type: String },
  mfa_pending_secret_enc: { type: String },
  mfa_recovery_hashes: { type: [String], default: undefined },
  mfa_enrolled_at: { type: Date },
  // Email one-time codes as a second method (mfa_enabled = authenticator app).
  mfa_email_enabled: { type: Boolean, default: false },
  mfa_email_code_hash: { type: String },
  mfa_email_code_purpose: { type: String },
  mfa_email_code_expires_at: { type: Date },
  mfa_email_code_sent_at: { type: Date },
  mfa_email_code_attempts: { type: Number, default: 0 },
  invited_by: { type: Number },
  last_login: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, uniqueCaseInsensitive: [['email']], indexes: [['department_id'], ['reset_token_hash']] });
