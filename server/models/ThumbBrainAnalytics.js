const { defineModel } = require('../db/mongo');

module.exports = defineModel('thumb_brain_analytics', {
  id: { type: Number },
  content_id: { type: Number },
  brand_style_id: { type: Number },
  platform_slug: { type: String },
  model_used: { type: String },
  engine_used: { type: String },
  generation_time_ms: { type: Number },
  prompt_length: { type: Number },
  was_approved: { type: Boolean },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['content_id'], ['brand_style_id']] });
