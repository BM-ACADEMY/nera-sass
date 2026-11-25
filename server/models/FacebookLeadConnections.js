const { defineModel, Mixed } = require('../db/mongo');

// A Facebook sign-in in progress, one per workspace (tenant-scoped): after
// Facebook Login the owner still has to pick which Pages to connect. Holds the
// long-lived user token (encrypted) only until the Pages are chosen, the
// connection is cancelled, or pending_expires_at passes.
module.exports = defineModel('facebook_lead_connections', {
  user_token_enc: { type: String },
  user_token_last4: { type: String },
  pending_pages: { type: Mixed, default: () => [] }, // [{ id, name }]
  pending_expires_at: { type: Date },
  connected_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['tenant_id']] });
