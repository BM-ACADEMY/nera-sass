const { defineModel, Mixed } = require('../db/mongo');

// Price list (Full Scope: Desk 799, WhatsApp 1999, Complete 3999 rupees a
// month). Platform-level catalogue: never tenant-scoped, edited by platform
// staff only (routes/admin.js) and read by every workspace. Prices and
// allowances live here, not in code, so they can change without a deploy.
// Every customer pays Meta directly for WhatsApp conversations; the wallet
// only covers AI overage, extra seats and extra numbers, priced below.
module.exports = defineModel('plans', {
  id: { type: Number },
  code: { type: String }, // desk | whatsapp | complete
  name: { type: String },
  description: { type: String, default: '' },
  // Rupees a month, as sold. Razorpay orders are created in paise from this.
  price_inr: { type: Number },
  currency: { type: String, default: 'INR' },
  billing_cycle: { type: String, default: 'monthly' },
  // AI replies included each billing period; -1 means no limit.
  ai_replies_month: { type: Number, default: 0 },
  // Wallet price of one AI reply beyond the allowance, in paise; 0 = free.
  ai_overage_price_paise: { type: Number, default: 0 },
  seats_included: { type: Number, default: 1 },
  numbers_included: { type: Number, default: 1 },
  // Wallet price of one extra seat / WhatsApp number per billing period.
  extra_seat_price_inr: { type: Number, default: 0 },
  extra_number_price_inr: { type: Number, default: 0 },
  features: { type: [String], default: [] },
  is_active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['code']], indexes: [['is_active', 'sort_order']] });
