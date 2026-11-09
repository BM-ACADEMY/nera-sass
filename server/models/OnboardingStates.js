const { defineModel } = require('../db/mongo');

// What the guided onboarding (N5) remembers about one workspace that the other
// collections cannot tell it: that the customer asked our team to connect
// WhatsApp, when the test message went out, and when the workspace went live.
// One row per workspace. Tenant-scoped (required tenant). Holds no secrets.
module.exports = defineModel('onboarding_states', {
  id: { type: Number },
  // Customer asked our team to connect their WhatsApp account (staff-assisted).
  wa_connect_requested_at: { type: Date, default: null },
  wa_connect_requested_by: { type: Number, default: null },
  // Staff saved the WhatsApp account details (never the details themselves).
  wa_connected_at: { type: Date, default: null },
  wa_connected_by: { type: Number, default: null },
  // Test message to the customer's own phone: last success and recent attempts.
  test_message_sent_at: { type: Date, default: null },
  test_message_template: { type: String, default: null },
  test_attempts: { type: [Date], default: () => [] },
  went_live_at: { type: Date, default: null },
  went_live_by: { type: Number, default: null },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id']] });
