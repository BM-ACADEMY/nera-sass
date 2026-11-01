const { defineModel } = require('../db/mongo');

// One AI Brain profile per workspace: the onboarding form the tenant fills in.
module.exports = defineModel('brain_profiles', {
  id: { type: Number },
  version_type: { type: String, default: 'client' }, // client | nera
  profile: { type: Object, default: {} },
  system_prompt_override: { type: String, default: null }, // Nera's own workspace only
  ai_enabled: { type: Boolean, default: false },
  brain_version: { type: Number, default: 1 },
  updated_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id']] });
