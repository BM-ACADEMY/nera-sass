const { defineModel, Mixed } = require('../db/mongo');

// GST tax invoices for plan payments. One per paid order (unique order id).
// The seller and buyer details are copied onto the row when it is issued, so an
// invoice never changes if a profile is edited later. Numbers run in sequence
// per financial year: AV/26-27/0001. Tenant-scoped like the order it belongs to.
module.exports = defineModel('invoices', {
  id: { type: Number },
  invoice_number: { type: String },
  financial_year: { type: String }, // 26-27
  billing_order_id: { type: Number },
  razorpay_order_id: { type: String },
  razorpay_payment_id: { type: String, default: null },
  issued_at: { type: Date, default: Date.now },
  seller: { type: Mixed, default: () => ({}) },
  buyer: { type: Mixed, default: () => ({}) },
  place_of_supply_code: { type: String },
  lines: { type: Mixed, default: () => ([]) }, // [{ description, sac, base_paise }]
  base_paise: { type: Number },
  cgst_paise: { type: Number, default: 0 },
  sgst_paise: { type: Number, default: 0 },
  igst_paise: { type: Number, default: 0 },
  gst_rate_percent: { type: Number },
  total_paise: { type: Number },
  currency: { type: String, default: 'INR' },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['invoice_number'], ['billing_order_id']], indexes: [['tenant_id', 'issued_at']] });
