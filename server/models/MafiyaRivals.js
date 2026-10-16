const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_rivals', {
  id: { type: Number },
  business_id: { type: Number },
  competitor_name: { type: String },
  place_id: { type: String },
  gbp_url: { type: String },
  city: { type: String },
  keyword: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['business_id']] });
