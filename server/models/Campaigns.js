const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('campaigns', {
  id: { type: Number },
  name: { type: String },
  client_id: { type: Number },
  template_id: { type: Number },
  target_status: { type: String },
  // Audience by label (lead_labels.id), optionally narrowed by target_status.
  target_label_id: { type: Number, default: null },
  // Older audience by tag (lead_tags.tag_id); migrations/043_lead_labels.js
  // moves it to target_label_id. New campaigns never set it.
  target_tag_id: { type: Number, default: null },
  // UTC instant; null means "send now". The owner picks it in `timezone`.
  scheduled_at: { type: Date },
  timezone: { type: String },
  launched_at: { type: Date },
  // scheduled | running | completed | failed | cancelled
  status: { type: String, default: "scheduled" },
  cancelled_at: { type: Date },
  cancelled_by: { type: Number },
  // The owner agreed that what exceeds the number's daily limit goes out on
  // the next day(s).
  send_rest_later: { type: Boolean, default: false },
  created_by: { type: Number },
  created_at: { type: Date, default: Date.now },
  template_parameters: { type: Mixed, default: () => ({}) },
}, { autoId: true, indexes: [['client_id'], ['template_id']] });
