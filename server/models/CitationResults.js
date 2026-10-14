const { defineModel } = require('../db/mongo');

module.exports = defineModel('citation_results', {
  id: { type: Number },
  scanId: { type: Number },
  directory: { type: String },
  listingUrl: { type: String },
  businessName: { type: String },
  phone: { type: String },
  address: { type: String },
  website: { type: String },
  status: { type: String },
  confidence: { type: Number },
  checkedAt: { type: Date, default: Date.now },
}, { autoId: true });
