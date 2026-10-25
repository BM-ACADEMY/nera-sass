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
  // Meta review timing: sent for review, and when Meta decided. Meta's API has
  // no creation time, so for templates made outside Getnera submitted_at is
  // when we first saw them in review (submitted_at_estimated).
  submitted_at: { type: Date },
  submitted_at_estimated: { type: Boolean },
  reviewed_at: { type: Date },
}, { unique: [['template_id']], indexes: [['waba_id']] });
