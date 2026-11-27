const { defineModel } = require('../db/mongo');

// Which lead carries which label (lead_labels.id). Tenant-scoped.
module.exports = defineModel('lead_label_links', {
  lead_id: { type: Number },
  label_id: { type: Number },
  added_by: { type: Number },
  added_at: { type: Date, default: Date.now },
}, { unique: [['lead_id', 'label_id']], indexes: [['label_id'], ['lead_id']] });
