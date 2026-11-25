const { defineModel } = require('../db/mongo');

// One task on the customer's Sales Tasks page. Automatic tasks (hot_lead, call,
// followup, overdue) are created from a lead's state; `manual` tasks are added
// by the team and carry their own title, due time and assignee.
module.exports = defineModel('sales_tasks', {
  id: { type: Number },
  lead_id: { type: Number, default: null },
  task_type: { type: String },
  title: { type: String },
  description: { type: String },
  // Due time (UTC). Automatic tasks without one use the lead's call/follow-up time.
  due_at: { type: Date, default: null },
  // A user of the same workspace (checked by the route); null = unassigned.
  assigned_to: { type: Number, default: null },
  created_by: { type: Number, default: null },
  status: { type: String, default: "pending" },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
  completed_at: { type: Date },
  unread: { type: Boolean, default: true },
  // Removed from the page. Automatic tasks are kept (hidden) so the next page
  // load does not create them again for the same lead.
  deleted_at: { type: Date, default: null },
}, { autoId: true, indexes: [['lead_id']] });
