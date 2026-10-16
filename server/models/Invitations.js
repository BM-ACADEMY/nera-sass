const { defineModel } = require('../db/mongo');

// One-time, expiring invitation (plan A3). Only a SHA-256 hash of the token is
// stored; the token itself exists only in the email link.
module.exports = defineModel('invitations', {
  id: { type: Number },
  email: { type: String, lowercase: true, trim: true },
  name: { type: String },
  role: { type: String },
  is_platform_staff: { type: Boolean, default: false },
  staff_role: { type: String, default: null },
  token_hash: { type: String },
  expires_at: { type: Date },
  accepted_at: { type: Date },
  accepted_user_id: { type: Number },
  revoked_at: { type: Date },
  revoked_by: { type: Number },
  invited_by: { type: Number },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['token_hash']], indexes: [['email'], ['expires_at']] });
