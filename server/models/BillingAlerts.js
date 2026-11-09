const { defineModel, Mixed } = require('../db/mongo');

// Billing notices sent to a workspace owner (low AI allowance, low wallet,
// AI paused). The unique key sends each notice once per period / top-up.
module.exports = defineModel('billing_alerts', {
  id: { type: Number },
  alert_key: { type: String },
  kind: { type: String }, // ai_allowance_low | wallet_low | ai_blocked | extras_dropped
  message: { type: String },
  delivered: { type: Boolean, default: false },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'alert_key']], indexes: [['tenant_id', 'created_at']] });
