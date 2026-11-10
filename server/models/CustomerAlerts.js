const { defineModel, Mixed } = require('../db/mongo');

// One notice for a customer workspace (plan N4): template rejected, wallet low,
// number quality drop, setup step unfinished, payment failed.
// Tenant-scoped. `dedupe_key` makes raising the same problem twice a no-op while
// it is open; a resolved notice is reopened (and the customer told again) when
// the problem comes back. `details` never holds secrets or raw provider errors.
module.exports = defineModel('customer_alerts', {
  id: { type: Number },
  type: { type: String },
  dedupe_key: { type: String },
  severity: { type: String, default: 'warning' }, // info | warning | critical
  title: { type: String },
  message: { type: String },
  action_path: { type: String },
  details: { type: Mixed, default: () => ({}) },
  status: { type: String, default: 'open' }, // open | resolved
  // Email is always sent: sent | failed | no_recipient | pending
  // (staff_only for notices only platform staff see, e.g. number_silent)
  email_status: { type: String, default: 'pending' },
  email_attempts: { type: Number, default: 0 },
  email_sent_at: { type: Date },
  // WhatsApp only via an approved utility template, only for opted-in numbers:
  // sent | not_opted_in | not_configured | no_template | failed | skipped
  whatsapp_status: { type: String },
  whatsapp_sent_at: { type: Date },
  read_at: { type: Date },
  raised_count: { type: Number, default: 1 },
  created_at: { type: Date, default: Date.now },
  last_raised_at: { type: Date, default: Date.now },
  resolved_at: { type: Date },
}, { autoId: true, unique: [['tenant_id', 'dedupe_key']], indexes: [['status', 'created_at'], ['type']] });
