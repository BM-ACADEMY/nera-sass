const { defineModel } = require('../db/mongo');
const { encryptedFields } = require('../db/encryptedFields');

// Google OAuth tokens: stored encrypted, read and written as plain strings
// through this model (db/encryptedFields.js).
module.exports = defineModel('thedal_gsc_tokens', {
  id: { type: Number },
  client_id: { type: Number },
  access_token: { type: String },
  refresh_token: { type: String },
  expires_at: { type: Date },
}, {
  autoId: true,
  indexes: [['client_id']],
  configure(schema) { encryptedFields(schema, 'thedal_gsc_tokens', ['access_token', 'refresh_token']); },
});
