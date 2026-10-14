const { defineModel } = require('../db/mongo');

module.exports = defineModel('ai_brain', {
  id: { type: Number },
  brand_id: { type: Number },
  products: { type: String },
  pricing: { type: String },
  objections: { type: String },
  proof: { type: String },
  custom_prompt: { type: String },
  system_prompt: { type: String },
  updated_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['brand_id']] });
