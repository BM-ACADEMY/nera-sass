const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('thumb_brain_config', {
  id: { type: Number },
  version_number: { type: Number, default: 1 },
  version_name: { type: String, default: "Untitled" },
  config: { type: Mixed },
  is_active: { type: Boolean, default: false },
  created_at: { type: Date, default: Date.now },
}, { autoId: true });
