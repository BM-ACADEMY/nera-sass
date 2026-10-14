const { defineModel, Mixed } = require('../db/mongo');

module.exports = defineModel('chatbot_userprogresses', {
  id: { type: Number },
  lead_id: { type: Number },
  flow_id: { type: Number },
  current_step: { type: String },
  selected_options: { type: Mixed, default: () => [] },
  follow_up_history: { type: Mixed, default: () => [] },
  completed: { type: Boolean, default: false },
  last_step_id: { type: String },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now },
}, { autoId: true, unique: [['lead_id', 'flow_id']], indexes: [['flow_id']] });
