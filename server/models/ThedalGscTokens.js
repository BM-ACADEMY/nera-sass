const { defineModel } = require('../db/mongo');

module.exports = defineModel('thedal_gsc_tokens', {
  id: { type: Number },
  client_id: { type: Number },
  access_token: { type: String },
  refresh_token: { type: String },
  expires_at: { type: Date },
}, { autoId: true, indexes: [['client_id']] });
