const { defineModel } = require('../db/mongo');

// AI Brain profiles: the onboarding form the tenant fills in.
// A workspace has one default brain (client_id absent or null), or one brain
// per brand when several brands share its WhatsApp number (see
// services/brandRouter.js). client_id is the brand: the workspace's own client
// id, or an id reserved from the clients counter for another brand on the same
// number (no clients row: a workspace has exactly one). Knowledge documents
// (brain_docs) carry the same client_id, so a brand brain only ever loads its
// own brand's documents. Migration 045 drops the older one-per-workspace index.
module.exports = defineModel('brain_profiles', {
  id: { type: Number },
  client_id: { type: Number, default: null },
  brand_name: { type: String, default: null },
  version_type: { type: String, default: 'client' }, // client | nera
  profile: { type: Object, default: {} },
  system_prompt_override: { type: String, default: null }, // Nera's own workspace only
  ai_enabled: { type: Boolean, default: false },
  brain_version: { type: Number, default: 1 },
  updated_by: { type: Number },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'client_id']] });
