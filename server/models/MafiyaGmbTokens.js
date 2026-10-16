const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_gmb_tokens', {
  id: { type: Number },
  client_id: { type: Number },
  access_token: { type: String },
  refresh_token: { type: String },
  expires_at: { type: Date },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
