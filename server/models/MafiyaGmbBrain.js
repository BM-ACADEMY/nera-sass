const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_gmb_brain', {
  id: { type: Number },
  client_id: { type: Number },
  entry_type: { type: String },
  content: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['client_id']] });
