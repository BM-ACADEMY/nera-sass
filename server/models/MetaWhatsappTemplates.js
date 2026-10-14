const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('meta_whatsapp_templates', {
  template_id: { type: String },
  waba_id: { type: String },
  name: { type: String },
  language: { type: String },
  status: { type: String },
  category: { type: String },
  components: { type: Mixed, default: () => [] },
  raw_data: { type: Mixed, default: () => ({}) },
  last_synced_at: { type: Date, default: Date.now },
}, { unique: [['template_id']] });
