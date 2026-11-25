const { defineModel } = require('../db/mongo');

// What a workspace sells through its AI Brain: a name and a price the AI may
// quote and total. The model never invents a price; it only matches a customer's
// words to a row here. Tenant-scoped like every workspace collection.
module.exports = defineModel('products', {
  id: { type: Number },
  name: { type: String },
  name_key: { type: String }, // lower-case, spaces collapsed: one product per name per workspace
  description: { type: String, default: '' },
  price_paise: { type: Number },
  active: { type: Boolean, default: true },
  created_by: { type: Number, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'name_key']], indexes: [['tenant_id', 'active']] });
