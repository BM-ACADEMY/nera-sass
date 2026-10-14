const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_inbox_contacts', {
  id: { type: Number },
  wa_id: { type: String },
  phone: { type: String },
  name: { type: String },
  profile_name: { type: String },
  status: { type: String, default: "new" },
  interest: { type: String },
  assigned_to: { type: Number },
  source: { type: String, default: "whatsapp" },
  custom_fields: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  prospect_id: { type: Number },
}, { autoId: true, unique: [['phone'], ['wa_id'], ['prospect_id']] });
