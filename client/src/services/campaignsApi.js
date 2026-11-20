/**
 * Campaigns page calls that are not in api.js: audience counts, the number's
 * daily limit, the contact-list uploader, live progress, cancel and edit.
 * JSON calls go through api.request (same auth, data mode and 401 handling);
 * the upload and the sample download need FormData / a file, so they use fetch
 * with the same token.
 */
import { api, API_URL } from './api.js';

const authHeaders = () => {
  const token = api.token || localStorage.getItem('leados_token');
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    'x-data-mode': localStorage.getItem('leados_data_mode') || 'live',
  };
};

const failure = (status, data, fallback) => {
  const err = new Error(data?.error || fallback);
  err.status = status;
  err.code = data?.code;
  err.response = { data };
  return err;
};

export const campaignsApi = {
  audienceCounts(clientId) {
    return api.request(`/api/campaigns/audience-counts${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`);
  },
  sendingLimit(clientId) {
    return api.request(`/api/campaigns/sending-limit${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ''}`);
  },
  progress(id) {
    return api.request(`/api/campaigns/${id}/progress`);
  },
  cancel(id) {
    return api.request(`/api/campaigns/${id}/cancel`, { method: 'POST' });
  },
  update(id, changes) {
    return api.request(`/api/campaigns/${id}`, { method: 'PATCH', body: JSON.stringify(changes) });
  },

  /** Checks a CSV/XLSX list (save=false) or stores it as an audience (save=true). */
  async uploadList({ file, clientId, templateParameters, save = false }) {
    const form = new FormData();
    form.append('client_id', String(clientId));
    form.append('template_parameters', JSON.stringify(templateParameters || {}));
    form.append('save', save ? 'true' : 'false');
    form.append('file', file);
    let response;
    try {
      response = await fetch(`${API_URL}/api/campaigns/audience/upload`, { method: 'POST', headers: authHeaders(), body: form });
    } catch {
      throw failure(0, null, 'Could not reach the server. Check your internet connection and try again.');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok) throw failure(response.status, data, 'Could not process this list. Please try again.');
    return data;
  },

  /** Downloads the sample contact list for the chosen template. */
  async downloadSample(templateParameters) {
    const query = `mappings=${encodeURIComponent(JSON.stringify(templateParameters || {}))}`;
    const response = await fetch(`${API_URL}/api/campaigns/audience/sample?${query}`, { headers: authHeaders() });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw failure(response.status, data, 'Could not download the sample file.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'campaign_contacts_sample.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
