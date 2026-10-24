import { api, API_URL } from '../../services/api.js';

// Axios-shaped wrapper ({ data }) over the customer panel API, so the template
// editor shared with the admin panel works unchanged. Errors keep the
// `err.response.data` shape the editor reads.
const path = (p) => (p.startsWith('/api') ? p : `/api${p}`);
const withQuery = (p, params) => {
  const query = params ? new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString() : '';
  return query ? `${p}?${query}` : p;
};

async function upload(p, formData) {
  const response = await fetch(`${API_URL}${path(p)}`, {
    method: 'POST',
    headers: localStorage.getItem('leados_token') ? { Authorization: `Bearer ${localStorage.getItem('leados_token')}` } : {},
    body: formData,
  });
  const data = await response.json().catch(() => ({ error: 'Upload failed' }));
  if (!response.ok) {
    const err = new Error(data.error || 'Upload failed');
    err.response = { data, status: response.status };
    throw err;
  }
  return { data };
}

const templatesClient = {
  get: async (p, config = {}) => ({ data: await api.get(withQuery(p, config.params)) }),
  post: async (p, body) => (body instanceof FormData ? upload(p, body) : { data: await api.post(p, body ?? {}) }),
  put: async (p, body) => ({ data: await api.put(p, body) }),
  delete: async (p) => ({ data: await api.delete(p) }),
};

export default templatesClient;
