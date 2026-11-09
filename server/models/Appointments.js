const { defineModel } = require('../db/mongo');

// One row per appointment the AI booked for a customer (plan N2). Tenant-scoped
// like every other workspace collection. `slot_key` ("<start ISO>#<seat>") is
// unique, so two customers can never take the same seat of the same slot even
// when their requests arrive together; cancelling clears it to free the seat.
module.exports = defineModel('appointments', {
  id: { type: Number },
  lead_id: { type: Number },
  customer_name: { type: String },
  phone: { type: String },
  service: { type: String },
  start_at: { type: Date },
  end_at: { type: Date },
  status: { type: String, default: 'confirmed' }, // confirmed | cancelled | completed | no_show
  slot_key: { type: String, default: null },
  language: { type: String, default: 'en' },
  source: { type: String, default: 'ai_brain' },
  reminder_at: { type: Date, default: null },
  reminder_queue_id: { type: Number, default: null },
  reminder_status: { type: String, default: 'none' }, // none | queued | skipped | failed | cancelled
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, {
  autoId: true,
  unique: [['tenant_id', 'slot_key']],
  indexes: [['tenant_id', 'start_at'], ['tenant_id', 'lead_id', 'status']],
});
