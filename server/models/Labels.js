const { defineModel } = require('../db/mongo');

// Lead labels of one workspace (Leads page, campaign audiences). Tenant-scoped
// (db/tenantScope.js). name_key is the lower-cased name, unique per workspace.
// color is one of services/leadLabels.js PALETTE keys.
module.exports = defineModel('lead_labels', {
  id: { type: Number },
  name: { type: String },
  name_key: { type: String },
  color: { type: String, default: 'slate' },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  // Set by migrations/043_lead_labels.js on labels copied from an old tag.
  migrated_from_tag_id: { type: Number },
}, { autoId: true, unique: [['tenant_id', 'name_key']] });
