const { defineModel } = require('../db/mongo');

// A Facebook Page a workspace connected for Lead Ads (Instant Forms).
// Tenant-scoped. The Page token is stored encrypted (services/clientSecrets
// encryptToken, AES-256-GCM) and never returned by the API. A Page belongs to
// one workspace only: page_id is unique across all tenants, so the leadgen
// webhook can find the workspace from the page id alone.
module.exports = defineModel('facebook_lead_pages', {
  page_id: { type: String },
  page_name: { type: String },
  page_token_enc: { type: String },
  page_token_last4: { type: String },
  subscribed: { type: Boolean, default: false },
  status: { type: String, default: 'connected' }, // connected | error
  last_error: { type: String },
  last_error_at: { type: Date },
  last_lead_at: { type: Date },
  leads_received: { type: Number, default: 0 },
  connected_by: { type: Number },
  connected_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { unique: [['page_id']] });
