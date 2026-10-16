const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_products', {
  id: { type: Number },
  client_id: { type: Number },
  name: { type: String },
  price: { type: Number },
  category: { type: String },
  description: { type: String },
  photo_url: { type: String },
  link: { type: String },
  status: { type: String, default: "active" },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  discount_price: { type: Number },
  is_special: { type: Boolean, default: false },
  sync_status: { type: String, default: "not_synced" },
}, { autoId: true, indexes: [['client_id']] });
