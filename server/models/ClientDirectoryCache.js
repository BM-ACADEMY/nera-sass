const { defineModel } = require('../db/mongo');

module.exports = defineModel('client_directory_cache', {
  id: { type: Number },
  client_id: { type: Number },
  directory: { type: String },
  listing_url: { type: String },
  business_name: { type: String },
  address: { type: String },
  phone: { type: String },
  website: { type: String },
  status: { type: String },
  last_scraped_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['client_id', 'directory']] });
