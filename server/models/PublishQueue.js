const { defineModel } = require('../db/mongo');

module.exports = defineModel('publish_queue', {
  id: { type: Number },
  content_id: { type: Number },
  brand_name: { type: String },
  channel: { type: String },
  status: { type: String, default: "pending" },
  post_id: { type: String },
  error_message: { type: String },
  published_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['content_id', 'channel']] });
