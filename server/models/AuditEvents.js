const { defineModel, Mixed } = require('../db/mongo');

const WRITE_OPS = ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete'];
const refuse = () => { throw new Error('audit_events is append-only'); };

// Append-only audit trail (plan T10): the application can insert and read,
// never update or delete.
module.exports = defineModel('audit_events', {
  id: { type: Number },
  event: { type: String },
  actor_type: { type: String },
  actor_user_id: { type: Number, default: null },
  target_type: { type: String },
  target_id: { type: String },
  ip: { type: String },
  meta: { type: Mixed, default: () => ({}) },
  created_at: { type: Date, default: Date.now },
}, {
  autoId: true,
  indexes: [['event'], ['created_at']],
  configure(schema) {
    schema.pre(WRITE_OPS, refuse);
    schema.pre('deleteOne', { document: true, query: false }, refuse);
    schema.pre('save', function onlyInsert() {
      if (!this.isNew) refuse();
    });
  },
});
