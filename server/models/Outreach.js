const { defineModel } = require('../db/mongo');

module.exports = defineModel('outreach', {
  id: { type: Number },
  org_id: { type: Number },
  channel: { type: String },
  msg_type: { type: String },
  template: { type: String },
  content: { type: String },
  sent_at: { type: Date, default: Date.now },
  delivered: { type: Boolean, default: false },
  replied: { type: Boolean, default: false },
  reply_text: { type: String },
  replied_at: { type: Date },
  opted_out: { type: Boolean, default: false },
}, { autoId: true, indexes: [['org_id']] });
