const { defineModel } = require('../db/mongo');

// Sending health of one WhatsApp Business number (phone_number_id) of a
// workspace: today's counters for the rate limiter, the daily cap and how it
// grows, Meta's quality signals and whether marketing is paused on it.
module.exports = defineModel('whatsapp_number_state', {
  id: { type: Number },
  phone_number_id: { type: String },
  client_id: { type: Number },
  // Counters. `day` is the UTC date (YYYY-MM-DD) the daily counters belong
  // to; `minute` the UTC minute (YYYY-MM-DDTHH:MM) of the per-minute counter.
  day: { type: String },
  sent_today: { type: Number, default: 0 },
  // Business-initiated (template) messages today: what the daily cap limits.
  templates_today: { type: Number, default: 0 },
  minute: { type: String },
  sent_this_minute: { type: Number, default: 0 },
  // Daily cap for business-initiated messages. Starts low for a new number
  // and grows after each full day of healthy use (services/numberHealth.js).
  daily_cap: { type: Number },
  // Meta's messaging limit tier for the number when known (TIER_250, ...).
  messaging_limit: { type: String },
  cap_raised_at: { type: Date },
  first_send_at: { type: Date },
  // Meta quality signals: GREEN | YELLOW | RED | UNKNOWN and the last event
  // (FLAGGED, UNFLAGGED, DOWNGRADE, UPGRADE, ONBOARDING, DISABLED_UPDATE...).
  quality_rating: { type: String },
  quality_event: { type: String },
  quality_updated_at: { type: Date },
  quality_source: { type: String },
  // Marketing pause. Service and utility messages keep flowing.
  marketing_paused: { type: Boolean, default: false },
  marketing_paused_reason: { type: String },
  marketing_paused_at: { type: Date },
  // Set when a person paused it; an automatic (quality) pause leaves it null
  // and lifts by itself when Meta reports the number healthy again.
  marketing_paused_by: { type: Number, default: null },
  marketing_resumed_at: { type: Date },
  marketing_resumed_by: { type: Number },
  owner_notified_at: { type: Date },
  rate_limit_hits: { type: Number, default: 0 },
  last_rate_limited_at: { type: Date },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['tenant_id', 'phone_number_id']], indexes: [['client_id']] });
