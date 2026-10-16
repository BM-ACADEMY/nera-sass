const { defineModel } = require('../db/mongo');

module.exports = defineModel('organisations', {
  id: { type: Number },
  brand_id: { type: Number },
  name: { type: String },
  type: { type: String },
  website: { type: String },
  email: { type: String },
  phone: { type: String },
  location: { type: String },
  district: { type: String },
  contact_name: { type: String },
  contact_role: { type: String },
  industry: { type: String },
  student_count: { type: Number },
  lead_source: { type: String },
  status: { type: String, default: "new" },
  campaign: { type: String },
  opted_out: { type: Boolean, default: false },
  assigned_to: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['brand_id']] });
