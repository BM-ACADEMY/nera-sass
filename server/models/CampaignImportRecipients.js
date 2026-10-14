const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('campaign_import_recipients', {
  batch_id: { type: String },
  lead_id: { type: Number },
  created_at: { type: Date, default: Date.now },
  template_parameters: { type: Mixed, default: () => ({}) },
}, { unique: [['batch_id', 'lead_id']], indexes: [['lead_id']] });
