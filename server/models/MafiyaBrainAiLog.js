const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_brain_ai_log', {
  id: { type: Number },
  client_id: { type: Number },
  used_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
