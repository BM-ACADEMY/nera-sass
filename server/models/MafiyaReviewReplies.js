const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_review_replies', {
  id: { type: Number },
  client_id: { type: Number },
  review_id: { type: String },
  reply_text: { type: String },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['review_id']], indexes: [['client_id']] });
