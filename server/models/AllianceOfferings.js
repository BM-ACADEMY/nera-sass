const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('alliance_offerings', {
  id: { type: Number },
  brand_id: { type: Number },
  offering_code: { type: String },
  offering_type: { type: String, default: "course" },
  name: { type: String },
  category: { type: String },
  tier: { type: String },
  status: { type: String, default: "active" },
  short_description: { type: String },
  fee: { type: String },
  duration: { type: String },
  details: { type: Mixed, default: () => ({}) },
  verified_by: { type: String },
  last_verified_date: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['brand_id']] });
