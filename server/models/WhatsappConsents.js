const { defineModel, Mixed } = require('../db/mongo');

// Marketing consent for one contact (phone number) of a workspace.
// Tenant-scoped: a consent given to one business never applies to another.
// `phone_key` is the last 10 digits, the same key the rest of LeadOS uses to
// match a phone number whatever country-code prefix it was stored with.
module.exports = defineModel('whatsapp_consents', {
  id: { type: Number },
  lead_id: { type: Number },
  phone: { type: String },
  phone_key: { type: String },
  // none | opted_in | opted_out
  status: { type: String, default: 'none' },
  // How, when and with which wording the contact agreed to marketing messages.
  opt_in_source: { type: String },
  opt_in_at: { type: Date },
  opt_in_text: { type: String },
  opt_in_by: { type: Number },
  // How and when the contact asked us to stop (STOP keyword, agent, import...).
  opt_out_source: { type: String },
  opt_out_at: { type: Date },
  opt_out_text: { type: String },
  opt_out_by: { type: Number },
  // Full history: [{ type: 'opt_in' | 'opt_out', source, text, at, by }]
  events: { type: Mixed, default: () => [] },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'phone_key']], indexes: [['lead_id'], ['status']] });
