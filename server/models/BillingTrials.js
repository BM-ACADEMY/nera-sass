const { defineModel, Mixed } = require('../db/mongo');

// The 7-day free trial of a workspace (N7): one row per workspace, created
// without a card. The normalised keys carry the "one trial per business,
// WhatsApp number, email and phone" rule as unique indexes, so a repeat is
// refused by the database even if two requests race. Tenant-scoped; the
// duplicate check itself runs in the system context (services/billing/trial.js).
module.exports = defineModel('billing_trials', {
  id: { type: Number },
  business_name: { type: String },
  website: { type: String },
  owner_email: { type: String, default: null },
  phone: { type: String, default: null },
  whatsapp_number: { type: String, default: null },
  // Normalised dedupe keys (lower case, digits only for numbers, host for the website).
  business_key: { type: String },
  website_key: { type: String, default: null },
  email_key: { type: String, default: null },
  phone_key: { type: String, default: null },
  whatsapp_key: { type: String, default: null },
  // active | expired | converted (paid a plan)
  status: { type: String, default: 'active' },
  started_at: { type: Date },
  ends_at: { type: Date },
  original_ends_at: { type: Date },
  days: { type: Number, default: 7 },
  ai_replies_total: { type: Number, default: 50 },
  // Staff extensions, each with who, when, how many days and why.
  extensions: { type: [Mixed], default: [] },
  day5_notice_at: { type: Date, default: null },
  expiry_notice_at: { type: Date, default: null },
  converted_at: { type: Date, default: null },
  created_by: { type: Number, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  autoId: true,
  unique: [['tenant_id'], ['business_key'], ['website_key'], ['email_key'], ['phone_key'], ['whatsapp_key']],
  indexes: [['status', 'ends_at']],
});
