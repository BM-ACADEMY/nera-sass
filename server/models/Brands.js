const { defineModel } = require('../db/mongo');

module.exports = defineModel('brands', {
  id: { type: Number },
  name: { type: String },
  slug: { type: String },
  color: { type: String, default: "#007B83" },
  whatsapp_number: { type: String },
  meta_page_id: { type: String },
  meta_ad_account: { type: String },
  keywords: { type: [String] },
  description: { type: String },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
