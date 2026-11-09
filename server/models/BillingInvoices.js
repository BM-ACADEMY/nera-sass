const { defineModel, Mixed } = require('../db/mongo');

// One numbered tax invoice per Razorpay payment (N7). Written once when the
// order is fulfilled, never edited: a correction would be a credit note, which
// this module does not issue (refunds are an open decision). Tenant-scoped;
// the customer downloads it as a PDF from Settings > Billing.
module.exports = defineModel('billing_invoices', {
  id: { type: Number },
  // Sequential across the platform, e.g. GN-2026-000042 (counters collection).
  invoice_number: { type: String },
  issued_at: { type: Date, default: Date.now },
  order_id: { type: Number, default: null },
  razorpay_order_id: { type: String, default: null },
  razorpay_payment_id: { type: String },
  // What the invoice is for: plan (subscription) or wallet_topup.
  purpose: { type: String },
  customer_business_name: { type: String, default: '' },
  customer_email: { type: String, default: '' },
  plan_code: { type: String, default: null },
  plan_name: { type: String, default: null },
  period_months: { type: Number, default: null },
  description: { type: String, default: '' },
  currency: { type: String, default: 'INR' },
  price_paise: { type: Number },
  gst_rate_percent: { type: Number, default: 0 },
  gst_paise: { type: Number, default: 0 },
  total_paise: { type: Number },
  status: { type: String, default: 'paid' },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['invoice_number'], ['tenant_id', 'razorpay_payment_id']], indexes: [['tenant_id', 'issued_at']] });
