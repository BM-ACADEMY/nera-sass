const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_ai_suggestions_log', {
  id: { type: Number },
  client_id: { type: Number },
  generated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
