const { defineModel, Mixed } = require('../db/mongo');

// The minimal record kept after "delete this contact": THAT a deletion happened,
// when, by whom and how many rows went. It holds no name, phone number, email or
// message text. phone_hash (HMAC, see services/erasure.js) lets the server
// refuse sends to that number later without keeping the number itself.
module.exports = defineModel('contact_erasures', {
  id: { type: Number },
  lead_id: { type: Number },
  phone_hash: { type: String, default: null },
  status: { type: String, default: 'in_progress' }, // in_progress | completed
  erased_by_user_id: { type: Number, default: null },
  counts: { type: Mixed, default: () => ({}) },
  requested_at: { type: Date, default: Date.now },
  completed_at: { type: Date, default: null },
}, {
  autoId: true,
  unique: [['tenant_id', 'lead_id']],
  indexes: [['tenant_id', 'phone_hash']],
});
