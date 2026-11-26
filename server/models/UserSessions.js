const { defineModel, Mixed } = require('../db/mongo');

// Days a session row is kept after its token expired (then MongoDB deletes it).
const KEEP_AFTER_EXPIRY_DAYS = 30;

// One row per signed-in browser or device ("My sessions").
// Tenant-scoped with optional tenant: customer sessions carry the user's
// tenant_id; platform staff sessions have tenant_id = null.
// Never stores a token: session_hash is the SHA-256 of the random session id
// carried inside the signed login token. The IP is stored masked only.
module.exports = defineModel('user_sessions', {
  id: { type: Number },
  user_id: { type: Number },
  session_hash: { type: String },
  // The user's token_version when this session's token was issued; a later
  // bump (deactivation, reset, logout everywhere) ends the session.
  token_version: { type: Number, default: 0 },
  user_agent: { type: String },
  browser: { type: String },
  os: { type: String },
  device_type: { type: String }, // desktop | mobile | tablet | unknown
  // From User-Agent Client Hints sent by the app (Chromium only), cleaned:
  // e.g. model 'SM-S918B', platform 'Android', platform_version '14.0.0'.
  model: { type: String, default: null },
  platform: { type: String, default: null },
  platform_version: { type: String, default: null },
  // The user's own name for this device ("Aakash's laptop"), plain text.
  name: { type: String, default: null },
  ip_masked: { type: String },
  location: { type: Mixed, default: null }, // { city, region, country, country_code }
  created_at: { type: Date, default: Date.now },
  last_seen_at: { type: Date, default: Date.now },
  expires_at: { type: Date },
  revoked_at: { type: Date, default: null },
  revoked_reason: { type: String, default: null },
  // "Confirm it's you" for two-step changes (services/stepUp.js): valid for a
  // few minutes, for this session only, while token_version is unchanged.
  stepup_until: { type: Date, default: null },
  stepup_token_version: { type: Number },
  stepup_second_factor: { type: Boolean },
}, {
  autoId: true,
  unique: [['session_hash']],
  indexes: [['user_id', 'revoked_at']],
  configure(schema) {
    schema.index({ expires_at: 1 }, { expireAfterSeconds: KEEP_AFTER_EXPIRY_DAYS * 86400 });
  },
});
