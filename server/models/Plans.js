const { defineModel, Mixed } = require('../db/mongo');

// Plan catalogue (plan B1, minimal). Every price and limit is read from here,
// never from code (Full Scope standing rule 5). Loaded from
// config/plan-catalogue.json by scripts/seed-plan-catalogue.js.
module.exports = defineModel('plans', {
  id: { type: Number },
  code: { type: String },
  name: { type: String },
  product_line: { type: String },
  tier: { type: Number },
  monthly_price: { type: Number },
  onboarding_fee: { type: Number },
  currency: { type: String, default: 'INR' },
  limits: { type: Mixed, default: () => ({}) },
  features: { type: Mixed, default: () => ({}) },
  // Term discounts and onboarding discounts, e.g. { term_discount_pct: { "12": 15 } }.
  pricing_rules: { type: Mixed, default: () => ({}) },
  version: { type: Number, default: 1 },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['code', 'version']] });
