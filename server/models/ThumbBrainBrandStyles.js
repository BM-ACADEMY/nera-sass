const { defineModel } = require('../db/mongo');

module.exports = defineModel('thumb_brain_brand_styles', {
  id: { type: Number },
  name: { type: String },
  slug: { type: String },
  primary_color: { type: String, default: "#000000" },
  secondary_color: { type: String, default: "#ffffff" },
  accent_color: { type: String, default: "#f97316" },
  typography_style: { type: String, default: "Bold" },
  lighting_preset: { type: String, default: "Cinematic" },
  background_style: { type: String, default: "Gradient" },
  design_keywords: { type: [String], default: () => [] },
  prompt_injection: { type: String, default: "" },
  is_active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['slug']] });
