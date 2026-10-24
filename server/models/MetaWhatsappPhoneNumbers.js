const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('meta_whatsapp_phone_numbers', {
  phone_number_id: { type: String },
  waba_id: { type: String },
  client_id: { type: Number },
  display_phone_number: { type: String },
  verified_name: { type: String },
  verification_status: { type: String },
  connection_status: { type: String },
  quality_rating: { type: String },
  platform_type: { type: String },
  raw_data: { type: Mixed, default: () => ({}) },
  last_synced_at: { type: Date, default: Date.now },
  profile_picture_url: { type: String },
  profile_about: { type: String },
  profile_address: { type: String },
  profile_description: { type: String },
  profile_email: { type: String },
  profile_websites: { type: Mixed, default: () => [] },
  profile_vertical: { type: String },
  // The platform's own number (admin panel WhatsApp Chat); at most one row.
  platform_inbox: { type: Boolean, default: false },
}, { unique: [['phone_number_id']], indexes: [['client_id'], ['platform_inbox']] });
