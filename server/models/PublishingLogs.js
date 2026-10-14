const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('publishing_logs', {
  id: { type: Number },
  content_id: { type: Number },
  brand_name: { type: String },
  platform: { type: String },
  post_id: { type: String },
  status: { type: String, default: "success" },
  published_at: { type: Date, default: Date.now },
  metadata: { type: Mixed, default: () => ({}) },
}, { autoId: true, indexes: [['content_id']] });
