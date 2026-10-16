const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('meta_whatsapp_accounts', {
  waba_id: { type: String },
  business_id: { type: String },
  name: { type: String },
  currency: { type: String },
  timezone_id: { type: String },
  template_namespace: { type: String },
  ownership_type: { type: String },
  raw_data: { type: Mixed, default: () => ({}) },
  last_synced_at: { type: Date, default: Date.now },
}, { unique: [['waba_id']] });
