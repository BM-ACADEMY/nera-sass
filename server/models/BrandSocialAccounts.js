const { defineModel } = require('../db/mongo');

module.exports = defineModel('brand_social_accounts', {
  id: { type: Number },
  brand_name: { type: String },
  platform: { type: String },
  account_name: { type: String },
  account_id: { type: String },
  instagram_business_id: { type: String },
  facebook_page_id: { type: String },
  is_active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  access_token: { type: String },
  token_expires_at: { type: Date },
  lead_ads_access_token: { type: String },
}, { autoId: true, unique: [['brand_name', 'platform', 'account_name'], ['brand_name', 'platform']] });
