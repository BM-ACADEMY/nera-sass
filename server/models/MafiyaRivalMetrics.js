const { defineModel } = require('../db/mongo');

module.exports = defineModel('mafiya_rival_metrics', {
  id: { type: Number },
  rival_id: { type: Number },
  their_rank: { type: Number },
  our_rank: { type: Number },
  their_reviews: { type: Number },
  our_reviews: { type: Number },
  their_rating: { type: Number },
  our_rating: { type: Number },
  status: { type: String },
  last_updated: { type: Date, default: Date.now },
}, { autoId: true, indexes: [['rival_id']] });
