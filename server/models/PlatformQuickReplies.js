const { defineModel } = require('../db/mongo');

// Saved replies for the admin inbox: staff type "/" + shortcut to insert the text.
module.exports = defineModel('platform_quick_replies', {
  id: { type: Number },
  shortcut: { type: String }, // lowercase, no spaces, e.g. "price"
  text: { type: String },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['shortcut']] });
