const { defineModel } = require('../db/mongo');

module.exports = defineModel('api_usage_logs', {
  id: { type: Number },
  provider: { type: String, default: "valueserp" },
  client_id: { type: Number },
  client_name: { type: String },
  search_query: { type: String },
  directory: { type: String },
  credits_consumed: { type: Number, default: 1 },
  request_time: { type: Date, default: Date.now },
  response_status: { type: String, default: "200" },
  scan_duration_ms: { type: Number, default: 0 },
  is_cached: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
