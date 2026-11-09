const { defineModel } = require('../db/mongo');

// The prepaid wallet of a workspace. `reference_amount` is the balance right
// after the last top-up: "below 20 percent" means balance < 20% of it.
// Tenant-scoped. Written only through services/wallet.js.
module.exports = defineModel('tenant_wallets', {
  id: { type: Number },
  balance: { type: Number, default: 0 },
  reference_amount: { type: Number, default: 0 },
  currency: { type: String, default: 'INR' },
  last_topup_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id']] });
