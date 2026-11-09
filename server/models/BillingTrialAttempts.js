const { defineModel, Mixed } = require('../db/mongo');

// Every refused trial request (N7): which workspace asked, what it sent and
// which rule matched (business, website, WhatsApp number, email, phone, or a
// trial already used by this workspace). Append-only bookkeeping for staff;
// never shown to the customer beyond a short message.
module.exports = defineModel('billing_trial_attempts', {
  id: { type: Number },
  user_id: { type: Number, default: null },
  business_name: { type: String, default: '' },
  website: { type: String, default: '' },
  // Which keys matched an existing trial, e.g. ['email', 'whatsapp'].
  matched: { type: [String], default: [] },
  reason: { type: String, default: '' },
  // The workspace the earlier trial belongs to, when one matched.
  matched_tenant_id: { type: Number, default: null },
  ip: { type: String, default: null },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['tenant_id', 'created_at']] });
