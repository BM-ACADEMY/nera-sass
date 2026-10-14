const { defineModel } = require('../db/mongo');

module.exports = defineModel('thumb_brain_platforms', {
  id: { type: Number },
  name: { type: String },
  slug: { type: String },
  icon: { type: String, default: "📱" },
  aspect_ratio: { type: String },
  width: { type: Number },
  height: { type: Number },
  safe_margin: { type: Number, default: 5 },
  text_scale: { type: Number, default: 1 },
  optimization_notes: { type: String, default: "" },
  is_active: { type: Boolean, default: true },
  sort_order: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['slug']] });
