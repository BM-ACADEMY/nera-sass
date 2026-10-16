const { defineModel, uuid } = require('../db/mongo');

module.exports = defineModel('drive_folder_monitors', {
  id: { type: String, default: uuid },
  brand_slug: { type: String },
  folder_id: { type: String },
  is_active: { type: Boolean, default: true },
  last_checked_at: { type: Date },
  created_at: { type: Date, default: Date.now },
}, { unique: [['brand_slug'], ['id']] });
