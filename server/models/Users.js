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
  // When the person first chose their own password (a reset/set-password link,
  // a password change, or an invitation without a preset password). Staff-set
  // passwords leave it empty. With last_login, this tells "Send to client"
  // that the owner has taken control of the login.
  password_claimed_at: { type: Date },
  // Set when an Owner/Admin (or platform staff) chose a temporary password for
  // this person (Settings > Team). Until they choose their own, every request
  // except the password change itself is refused (PASSWORD_CHANGE_REQUIRED).
  must_change_password: { type: Boolean, default: false },
  // Removed from the workspace (Settings > Team): deactivated and hidden from
  // the team list. The row stays for the audit trail.
  removed_at: { type: Date },
  removed_by: { type: Number },
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
  // WhatsApp one-time codes as a third method (whatsappOtp.js): the verified
  // number (digits with country code), the number being verified, and the
  // current code (hash only).
  mfa_whatsapp_enabled: { type: Boolean, default: false },
  mfa_whatsapp_number: { type: String },
  mfa_whatsapp_pending_number: { type: String },
  mfa_whatsapp_verified_at: { type: Date },
  mfa_wa_code_hash: { type: String },
  mfa_wa_code_purpose: { type: String },
  mfa_wa_code_expires_at: { type: Date },
  mfa_wa_code_sent_at: { type: Date },
  mfa_wa_code_attempts: { type: Number, default: 0 },
  // WhatsApp sign-in codes sent on this India-time day (YYYY-MM-DD).
  mfa_wa_login_day: { type: String },
  mfa_wa_login_sends: { type: Number },
  // Different numbers a WhatsApp setup code was sent to in the current 24-hour
  // window (for the per-day cap).
  mfa_whatsapp_setup_window_start: { type: Date },
  mfa_whatsapp_setup_set: { type: [String], default: undefined },
  // Wrong two-step codes across all channels (codeFailures.js).
  mfa_code_failures: { type: Number, default: 0 },
  mfa_code_window_start: { type: Date },
  mfa_code_locked_until: { type: Date },
  // The method offered first at sign-in ('totp' | 'email' | 'whatsapp').
  mfa_default_method: { type: String },
  // A method added with the password alone cannot confirm sensitive changes
  // until then (services/mfa.js).
  mfa_totp_hold_until: { type: Date },
  mfa_email_hold_until: { type: Date },
  mfa_whatsapp_hold_until: { type: Date },
  // Until when a re-authenticated enrolment may be confirmed.
  mfa_stepup_until: { type: Date },
  invited_by: { type: Number },
  last_login: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, uniqueCaseInsensitive: [['email']], indexes: [['department_id'], ['reset_token_hash']] });
