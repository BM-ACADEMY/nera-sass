const { defineModel } = require('../db/mongo');

module.exports = defineModel('alliance_inbox_settings', {
  id: { type: Number },
  phone_number_id: { type: String },
  waba_id: { type: String },
  display_phone_number: { type: String },
  verified_name: { type: String },
  access_token_env: { type: String, default: "ALLIANCE_WA_ACCESS_TOKEN" },
  webhook_verify_token_env: { type: String, default: "ALLIANCE_WA_VERIFY_TOKEN" },
  active: { type: Boolean, default: true },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['phone_number_id']] });
