// Lead labels API (server/routes/leados/labels.js). Every call is limited to
// the signed-in workspace by the server.
import { api } from '../../../services/api.js';
import { labelColor, nearestLabelColor } from '../labelsPolicy.js';

const json = (body) => JSON.stringify(body);

export const labelsApi = {
  /** { labels: [{ id, name, color, lead_count }], colors } */
  list: () => api.request('/api/labels'),
  create: ({ name, color }) => api.request('/api/labels', { method: 'POST', body: json({ name, color }) }),
  update: (id, changes) => api.request(`/api/labels/${id}`, { method: 'PATCH', body: json(changes) }),
  remove: (id) => api.request(`/api/labels/${id}`, { method: 'DELETE' }),
  forLead: (leadId) => api.request(`/api/leads/${leadId}/labels`),
  /** Sets the exact labels of a lead. Returns { labels }. */
  setForLead: (leadId, labelIds) => api.request(`/api/leads/${leadId}/labels`, { method: 'PUT', body: json({ label_ids: labelIds }) }),
  add: (leadId, labelId) => api.request(`/api/leads/${leadId}/labels/${labelId}`, { method: 'POST' }),
  removeFromLead: (leadId, labelId) => api.request(`/api/leads/${leadId}/labels/${labelId}`, { method: 'DELETE' }),
};

// The inbox's tag menu (InboxWorkspace, LeadOS mode) works with
// { id, name, color: CSS colour }; these calls give it this workspace's labels.
export const labelsAsInboxTags = {
  async getTags() {
    const data = await labelsApi.list();
    return (data.labels || []).map((label) => ({ id: label.id, name: label.name, color: labelColor(label.color).hex }));
  },
  async createTag(name, hex) {
    const { label } = await labelsApi.create({ name, color: nearestLabelColor(hex) });
    return { id: label.id, name: label.name, color: labelColor(label.color).hex };
  },
  deleteTag: (id) => labelsApi.remove(id),
};
