const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('ai_analysis', {
  id: { type: Number },
  org_id: { type: Number },
  score: { type: Number },
  offer_recommended: { type: String },
  reason: { type: String },
  bm_course_match: { type: String },
  core_talents_offer: { type: String },
  personalisation_hook: { type: String },
  hiring_potential: { type: String, default: "medium" },
  training_potential: { type: String, default: "medium" },
  website_scraped: { type: String },
  tokens_used: { type: Number, default: 0 },
  raw_json: { type: Mixed },
  created_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['org_id']] });
