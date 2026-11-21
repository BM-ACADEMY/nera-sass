const { defineModel, Mixed } = require('../db/mongo');

// An order a customer confirmed in a WhatsApp chat with the AI Brain. Items keep
// the name and price as they were when the customer confirmed, so a later price
// change never rewrites an old order. Payment is outside Getnera: the customer
// pays the business directly (its own UPI or payment link) and the owner marks
// the order paid.
module.exports = defineModel('shop_orders', {
  id: { type: Number },
  order_no: { type: Number }, // 1, 2, 3 ... within the workspace
  lead_id: { type: Number },
  customer_name: { type: String },
  phone: { type: String, default: null },
  items: { type: Mixed, default: () => ([]) }, // [{ product_id, name, unit_paise, quantity }]
  total_paise: { type: Number },
  status: { type: String, default: 'pending_payment' }, // pending_payment | paid | fulfilled | cancelled
  language: { type: String, default: 'en' },
  paid_at: { type: Date, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'order_no']], indexes: [['tenant_id', 'status', 'created_at'], ['tenant_id', 'lead_id']] });
