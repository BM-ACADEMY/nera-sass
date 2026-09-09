/**
 * LeadOS API Client
 * Base URL from environment: VITE_API_URL
 */

const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3600').replace(/\/+$/, '');

class LeadOSAPI {
  constructor() {
    this.token = localStorage.getItem('leados_token');
  }

  get baseUrl() {
    return API_URL;
  }

  setToken(token) {
    this.token = token;
    localStorage.setItem('leados_token', token);
  }

  clearToken() {
    this.token = null;
    localStorage.removeItem('leados_token');
  }

  async request(endpoint, options = {}) {
    const dataMode = localStorage.getItem('leados_data_mode') || 'live';
    const headers = {
      'Content-Type': 'application/json',
      'x-data-mode': dataMode,
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.clearToken();
      window.location.href = '/login';
    }

    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch (e) {
      console.error('API Error: Non-JSON response:', text);
      throw new Error('Received invalid data from server');
    }

    if (!response.ok) {
      const err = new Error(data.error || 'API Error');
      err.response = { data };
      throw err;
    }

    return data;
  }

  async get(endpoint, options = {}) {
    const path = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
    return this.request(path, { ...options, method: 'GET' });
  }

  async post(endpoint, body, options = {}) {
    const path = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
    return this.request(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body)
    });
  }

  async put(endpoint, body, options = {}) {
    const path = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
    return this.request(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body)
    });
  }

  async delete(endpoint, options = {}) {
    const path = endpoint.startsWith('/api') ? endpoint : `/api${endpoint}`;
    return this.request(path, {
      ...options,
      method: 'DELETE'
    });
  }
  // ─── AUTH ───────────────────────────────
  async login(email, password) {
    const data = await this.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async changePassword(current, newPassword) {
    return this.request('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ current, newPassword }),
    });
  }

  // ─── LEADS ──────────────────────────────
  async getLeads(filters = {}) {
    const params = new URLSearchParams({
      limit: filters.limit || 100,
      offset: filters.offset || 0,
      ...(filters.status && { status: filters.status }),
      ...(filters.brand && { brand: filters.brand }),
      ...(filters.search && { search: filters.search }),
      ...(filters.source && { source: filters.source }),
      ...(filters.campaignName && { campaign_name: filters.campaignName }),
      ...(filters.adName && { ad_name: filters.adName }),
      ...(filters.metaPageId && { meta_page_id: filters.metaPageId }),
      ...(filters.from && { from: filters.from }),
      ...(filters.to && { to: filters.to }),
      ...(filters.tagId && { tag_id: filters.tagId }),
    });
    return this.request(`/api/leads?${params}`);
  }

  async assignTag(leadId, tagId) {
    return this.request(`/api/leads/${leadId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tagId })
    });
  }

  async removeTag(leadId, tagId) {
    return this.request(`/api/leads/${leadId}/tags/${tagId}`, { method: 'DELETE' });
  }

  async getLead(id) {
    return this.request(`/api/leads/${id}`);
  }

  async createLeadExport(options) {
    return this.request('/api/leads/exports', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async getLeadExport(id) {
    return this.request(`/api/leads/exports/${id}`);
  }

  async downloadLeadExport(id) {
    const token = localStorage.getItem('leados_token');
    const response = await fetch(`${API_URL}/api/leads/exports/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Export download failed');
    }
    return response.blob();
  }

  async createLead(leadData) {
    return this.request('/api/leads', {
      method: 'POST',
      body: JSON.stringify(leadData),
    });
  }

  async updateLead(id, updates) {
    return this.request(`/api/leads/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteLead(id) {
    return this.request(`/api/leads/${id}`, {
      method: 'DELETE',
    });
  }

  async getUsers() {
    return this.request('/api/users');
  }

  async getSources() {
    return this.request('/api/leads/sources');
  }

  // ─── WHATSAPP ───────────────────────────
  async sendWhatsAppMessage(leadId, message, mediaUrl = null, msgType = 'text', replyToWaId = null, isForwarded = false) {
    return this.request('/api/whatsapp/send', {
      method: 'POST',
      body: JSON.stringify({ lead_id: leadId, message, media_url: mediaUrl, msg_type: msgType, reply_to_wa_id: replyToWaId, is_forwarded: isForwarded }),
    });
  }

  // ─── TEMPLATES ──────────────────────────
  async getTemplates() {
    return this.request('/api/templates');
  }

  async createTemplate(templateData) {
    return this.request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(templateData),
    });
  }

  async submitTemplate(id) {
    return this.request(`/api/templates/${id}/submit`, {
      method: 'POST',
    });
  }

  async syncTemplate(id) {
    return this.request(`/api/templates/${id}/sync`, {
      method: 'GET',
    });
  }

  async syncAllTemplates(clientId = null) {
    return this.request('/api/templates/sync-all', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId })
    });
  }

  async updateTemplateScopes(templateIds, templateScope) {
    return this.request('/api/templates/bulk-scope', {
      method: 'POST',
      body: JSON.stringify({ template_ids: templateIds, template_scope: templateScope })
    });
  }

  async updateTemplate(id, templateData) {
    return this.request(`/api/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(templateData),
    });
  }

  async deleteTemplate(id) {
    return this.request(`/api/templates/${id}`, {
      method: 'DELETE',
    });
  }

  async uploadTemplateMedia(file, clientId) {
    const formData = new FormData();
    formData.append('file', file);
    if (clientId) {
      formData.append('client_id', clientId);
    }
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const res = await fetch(`${this.baseUrl}/api/templates/upload-media`, {
      method: 'POST',
      headers,
      body: formData,
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || 'Failed to upload media');
    }
    return res.json();
  }


  // ─── SALESOS REPORTS ──────────────────────
  async getSalesOSReports() {
    // Fetch all SalesOS metrics concurrently
    const [revToday, revMonth, brandRev, sources, conv, pendingF, sla, ai] = await Promise.all([
      this.request('/api/reports/revenue-today'),
      this.request('/api/reports/revenue-month'),
      this.request('/api/reports/brand-revenue'),
      this.request('/api/reports/lead-sources'),
      this.request('/api/reports/conversion-rate'),
      this.request('/api/reports/followups-pending'),
      this.request('/api/reports/sla-breaches'),
      this.request('/api/reports/ai-performance')
    ]);
    return {
      revenueToday: revToday?.revenue || 0,
      revenueMonth: revMonth?.revenue || 0,
      brandRevenue: brandRev?.data || [],
      leadSources: sources?.sources || [],
      conversionRate: conv?.data || [],
      pendingFollowups: pendingF?.pending || 0,
      slaBreaches: sla?.breaches || 0,
      aiPerformance: ai?.avg_confidence || 0
    };
  }

  // ─── CAMPAIGNS ──────────────────────────
  async getInbox() {
    return this.request('/api/inbox');
  }

  async getMessages(leadId, limit = 20, offset = 0) {
    return this.request(`/api/leads/${leadId}/messages?limit=${limit}&offset=${offset}`);
  }

  async readConversation(leadId) {
    return this.request(`/api/conversations/${leadId}/read`, {
      method: 'PUT'
    });
  }

  async editMessage(id, content) {
    return this.request(`/api/messages/${id}/edit`, {
      method: 'PUT',
      body: JSON.stringify({ content })
    });
  }

  async deleteMessage(id) {
    return this.request(`/api/messages/${id}/delete`, {
      method: 'PUT'
    });
  }

  async pinMessage(id, durationHours) {
    return this.request(`/api/messages/${id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ duration: durationHours })
    });
  }

  async unpinMessage(id) {
    return this.request(`/api/messages/${id}/pin`, {
      method: 'PUT',
      body: JSON.stringify({ unpin: true })
    });
  }

  async toggleStarMessage(id, isStarred) {
    return this.request(`/api/messages/${id}/star`, {
      method: 'PUT',
      body: JSON.stringify({ is_starred: isStarred })
    });
  }

  async reactToMessage(id, emoji, action = 'add') {
    return this.request(`/api/messages/${id}/react`, {
      method: 'PUT',
      body: JSON.stringify({ emoji, action })
    });
  }

  async uploadMedia(formData, onProgress) {
    const token = localStorage.getItem('leados_token');
    if (!token) throw new Error('No authentication token found');
    
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api/messages/upload`);
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      if (onProgress && xhr.upload) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const percentComplete = Math.round((event.loaded / event.total) * 100);
            onProgress(percentComplete);
          }
        };
      }

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            resolve(xhr.responseText);
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.error || `HTTP error! status: ${xhr.status}`));
          } catch (e) {
            reject(new Error(`HTTP error! status: ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  }

  // ─── CAMPAIGNS ──────────────────────────
  async getCampaigns() {
    return this.request('/api/campaigns');
  }

  async createCampaign(campaignData) {
    return this.request('/api/campaigns', {
      method: 'POST',
      body: JSON.stringify(campaignData),
    });
  }

  async deleteCampaign(id) {
    return this.request(`/api/campaigns/${id}`, {
      method: 'DELETE',
    });
  }

  async retryCampaign(id) {
    return this.request(`/api/campaigns/${id}/retry`, {
      method: 'POST',
    });
  }

  async executeCampaign(id) {
    return this.request(`/api/campaigns/execute`, {
      method: 'POST',
      body: JSON.stringify({ campaign_id: id }),
    });
  }

  async getCampaignLogs(id) {
    return this.request(`/api/campaigns/${id}/logs`);
  }

  // ─── CLIENTS (Brands) ───────────────────
  async getClients() {
    return this.request('/api/clients');
  }

  async createClient(clientData) {
    return this.request('/api/clients', {
      method: 'POST',
      body: JSON.stringify(clientData),
    });
  }

  async getClient(id) {
    return this.request(`/api/clients/${id}`);
  }

  async updateClient(id, clientData) {
    return this.request(`/api/clients/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(clientData),
    });
  }

  async deleteClient(id) {
    return this.request(`/api/clients/${id}`, {
      method: 'DELETE',
    });
  }

  async setupClientWhatsApp(id) {
    return this.request(`/api/clients/${id}/whatsapp-setup`, {
      method: 'POST'
    });
  }

  async uploadClientMetaLogo(id, file) {
    const formData = new FormData();
    formData.append('logo', file);
    const response = await fetch(`${API_URL}/api/clients/${id}/meta-profile-logo`, {
      method: 'POST',
      headers: this.token ? { Authorization: `Bearer ${this.token}` } : {},
      body: formData,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Failed to upload Meta profile logo');
    return data;
  }

  async getMetaEmbeddedSignupConfig() {
    return this.request('/api/meta/embedded-signup/config');
  }

  async completeMetaEmbeddedSignup(id, data) {
    return this.request(`/api/clients/${id}/meta-embedded-signup/complete`, {
      method: 'POST', body: JSON.stringify(data)
    });
  }

  async getMetaWhatsAppInventory() {
    return this.request('/api/meta/whatsapp/inventory');
  }

  async syncMetaWhatsApp() {
    return this.request('/api/meta/whatsapp/sync', { method: 'POST' });
  }

  async deleteMetaWhatsAppCache(wabaId) {
    return this.request(`/api/meta/whatsapp/cache/wabas/${encodeURIComponent(wabaId)}`, {
      method: 'DELETE'
    });
  }

  async registerMetaWhatsAppPhone(phoneId, pin) {
    return this.request(`/api/meta/whatsapp/phone-numbers/${encodeURIComponent(phoneId)}/register`, {
      method: 'POST', body: JSON.stringify({ pin })
    });
  }

  async mapMetaPhoneNumber(phoneId, clientId) {
    return this.request(`/api/meta/whatsapp/phone-numbers/${phoneId}/map`, {
      method: 'PATCH', body: JSON.stringify({ client_id: clientId })
    });
  }


  async importLeads(formData, forceStatus = null) {
    const token = localStorage.getItem('leados_token');
    if (!token) throw new Error('No authentication token found');
    
    if (forceStatus) {
      formData.append('force_status', forceStatus);
    }
    
    // FormData requires a direct fetch because our this.request stringifies the body
    // if the body is an object, and FormData shouldn't be stringified, nor should the
    // Content-Type be set to application/json (browser sets it to multipart/form-data with boundary)
    const response = await fetch(`${API_URL}/api/leads/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  // ─── PAYMENTS ───────────────────────────
  async createPaymentLink(leadId, amount, description) {
    return this.request('/api/payments/create-link', {
      method: 'POST',
      body: JSON.stringify({ lead_id: leadId, amount, description }),
    });
  }

  async getPayments(filters = {}) {
    const params = new URLSearchParams({
      ...(filters.leadId && { lead_id: filters.leadId }),
    });
    return this.request(`/api/payments?${params}`);
  }

  // ─── AI BRAIN ───────────────────────────
  async getBrainDocs(clientId) {
    const params = new URLSearchParams({
      ...(clientId && { client_id: clientId }),
    });
    return this.request(`/api/brain?${params}`);
  }

  async saveBrainDoc(clientId, docType, content) {
    return this.request('/api/brain', {
      method: 'POST',
      body: JSON.stringify({ client_id: clientId, doc_type: docType, content }),
    });
  }

  async getDashboardStats(params = {}) {
    const cleanParams = {};
    Object.keys(params).forEach(key => {
      if (params[key] !== undefined && params[key] !== null) {
        cleanParams[key] = params[key];
      }
    });
    const query = new URLSearchParams(cleanParams).toString();
    return this.request(`/api/reports/summary${query ? '?' + query : ''}`);
  }

  async getFounderDashboard() {
    return this.request('/api/reports/founder-dashboard');
  }

  // ─── ALLIANCE OS ────────────────────────
  async uploadAllianceCSV(formData) {
    const token = localStorage.getItem('leados_token');
    if (!token) throw new Error('No authentication token found');
    const response = await fetch(`${API_URL}/api/alliance/prospects/import`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  async getAllianceProspects(params = {}) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();
    return this.request(`/api/alliance/prospects${query ? `?${query}` : ''}`);
  }

  async exportAllianceProspects(params = {}) {
    const query = new URLSearchParams(
      Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')
    ).toString();
    const url = `/api/alliance/prospects/export${query ? `?${query}` : ''}`;
    
    const response = await fetch(`${API_URL}${url}`, {
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
      }
    });

    if (!response.ok) {
      throw new Error('Failed to export prospects');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    // Extract filename from Content-Disposition header if available
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'Prospects_Export.xlsx';
    if (disposition && disposition.indexOf('filename=') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) { 
        filename = matches[1].replace(/['"]/g, '');
      }
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  async exportSalesTasks(ids) {
    const response = await fetch(`${API_URL}/api/sales-tasks/export`, {
      method: 'POST',
      headers: {
        'Authorization': this.token ? `Bearer ${this.token}` : '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ids })
    });

    if (!response.ok) throw new Error('Failed to export sales tasks');

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    const disposition = response.headers.get('Content-Disposition');
    let filename = 'Sales_Tasks_Export.xlsx';
    if (disposition && disposition.indexOf('filename=') !== -1) {
      const filenameRegex = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/;
      const matches = filenameRegex.exec(disposition);
      if (matches != null && matches[1]) { filename = matches[1].replace(/['"]/g, ''); }
    }
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(downloadUrl);
  }

  async getAllianceAnalytics() {
    return this.request(`/api/alliance/analytics?_=${Date.now()}`);
  }

  async getAllianceBulkSendLimits() {
    return this.request('/api/alliance/bulk-send-limits');
  }

  async updateAllianceBulkSendLimit(channel, payload) {
    return this.request(`/api/alliance/bulk-send-limits/${encodeURIComponent(channel)}`, { method: 'PUT', body: JSON.stringify(payload) });
  }

  async createAllianceProspect(prospect) {
    return this.request('/api/alliance/prospects', {
      method: 'POST',
      body: JSON.stringify(prospect),
    });
  }

  async updateAllianceProspect(id, updates) {
    return this.request(`/api/alliance/prospects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(updates),
    });
  }

  async deleteAllianceProspect(id) {
    return this.request(`/api/alliance/prospects/${id}`, { method: 'DELETE' });
  }

  async bulkDeleteAllianceProspects(ids) {
    return this.request('/api/alliance/prospects/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    });
  }

  async assignProspectTag(prospectId, tagId) {
    return this.request(`/api/alliance/prospects/${prospectId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tagId }),
    });
  }

  async removeProspectTag(prospectId, tagId) {
    return this.request(`/api/alliance/prospects/${prospectId}/tags/${tagId}`, {
      method: 'DELETE',
    });
  }

  async repairAllianceProspectNames() {
    return this.request('/api/alliance/prospects/repair-imported-names', { method: 'POST' });
  }

  async getAllianceAudiences() {
    return this.request('/api/alliance/audiences');
  }

  async downloadAllianceAudienceTemplate(code) {
    const token = localStorage.getItem('leados_token');
    const response = await fetch(`${API_URL}/api/alliance/audiences/${encodeURIComponent(code)}/template`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to download Excel template');
    }
    return response.blob();
  }

  async getAllianceAudienceTemplatePreview(code) {
    return this.request(`/api/alliance/audiences/${encodeURIComponent(code)}/template-preview`);
  }

  async createAllianceAudience(payload) {
    return this.request('/api/alliance/audiences', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getAllianceCampaigns(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return this.request(`/api/alliance/campaigns${query.toString() ? `?${query}` : ''}`);
  }

  async getAllianceEmailCampaignDetail(id, params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
    return this.request(`/api/alliance/campaigns/${id}/detail${query ? `?${query}` : ''}`);
  }

  async updateAllianceAudience(code, payload) {
    return this.request(`/api/alliance/audiences/${encodeURIComponent(code)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async deleteAllianceAudience(code) {
    return this.request(`/api/alliance/audiences/${encodeURIComponent(code)}`, { method: 'DELETE' });
  }

  async getAllianceCampaign(id) {
    return this.request(`/api/alliance/campaigns/${id}`);
  }

  async startAllianceCampaign(id, payload = {}) {
    return this.request(`/api/alliance/campaigns/${id}/start`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async pauseAllianceCampaign(id) {
    return this.request(`/api/alliance/campaigns/${id}/pause`, { method: 'POST' });
  }

  async retryFailedAllianceCampaignEmails(id) {
    return this.request(`/api/alliance/campaigns/${id}/retry-failed`, { method: 'POST' });
  }

  async stopAllianceCampaign(id) {
    return this.request(`/api/alliance/campaigns/${id}/stop`, { method: 'POST' });
  }

  async deleteAllianceCampaign(id) {
    return this.request(`/api/alliance/campaigns/${id}`, { method: 'DELETE' });
  }

  async sendAllianceCampaignTest(id, payload) {
    return this.request(`/api/alliance/campaigns/${id}/test-email`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getAllianceEmailReplies(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return this.request(`/api/alliance/replies${query.toString() ? `?${query}` : ''}`);
  }

  async getAllianceEmailConversation(prospectId) {
    return this.request(`/api/alliance/reply-conversations/${prospectId}`);
  }

  async getAllianceWhatsAppProspects(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return this.request(`/api/alliance/whatsapp-campaigns/prospects?${query}`);
  }

  async getAllianceWhatsAppCampaigns() {
    return this.request('/api/alliance/whatsapp-campaigns');
  }

  async getAllianceWhatsAppCampaignDetail(id, params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null));
    return this.request(`/api/alliance/whatsapp-campaigns/${id}${query.toString() ? `?${query}` : ''}`);
  }

  async updateAllianceWhatsAppFailedLeadReshare(campaignId, recipientIds, reshareStatus) {
    return this.request(`/api/alliance/whatsapp-campaigns/${campaignId}/failed-leads/reshare`, {
      method: 'POST',
      body: JSON.stringify({ recipient_ids: recipientIds, reshare_status: reshareStatus }),
    });
  }

  async retryAllianceWhatsAppFailedLeads(campaignId, recipientIds) {
    return this.request(`/api/alliance/whatsapp-campaigns/${campaignId}/retry-failed`, {
      method: 'POST',
      body: JSON.stringify({ recipient_ids: recipientIds }),
    });
  }

  async createAllianceWhatsAppCampaign(payload) {
    return this.request('/api/alliance/whatsapp-campaigns', { method: 'POST', body: JSON.stringify(payload) });
  }

  async testAllianceWhatsAppCampaign(payload) {
    return this.request('/api/alliance/whatsapp-campaigns/test', { method: 'POST', body: JSON.stringify(payload) });
  }

  async pauseAllianceWhatsAppCampaign(id) {
    return this.request(`/api/alliance/whatsapp-campaigns/${id}/pause`, { method: 'POST' });
  }

  async resumeAllianceWhatsAppCampaign(id) {
    return this.request(`/api/alliance/whatsapp-campaigns/${id}/resume`, { method: 'POST' });
  }

  async stopAllianceWhatsAppCampaign(id) {
    return this.request(`/api/alliance/whatsapp-campaigns/${id}/stop`, { method: 'POST' });
  }

  async deleteAllianceWhatsAppCampaign(id) {
    return this.request(`/api/alliance/whatsapp-campaigns/${id}`, { method: 'DELETE' });
  }

  async getAllianceBrainBrands() {
    return this.request('/api/alliance/brain/brands');
  }

  async extractAllianceBrainBrand(text) {
    return this.request('/api/alliance/brain/brands/extract', { method: 'POST', body: JSON.stringify({ text }) });
  }

  async createAllianceBrainBrand(payload) {
    return this.request('/api/alliance/brain/brands', { method: 'POST', body: JSON.stringify(payload) });
  }

  async updateAllianceBrainBrand(id, payload) {
    return this.request(`/api/alliance/brain/brands/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async deleteAllianceBrainBrand(id) {
    return this.request(`/api/alliance/brain/brands/${id}`, { method: 'DELETE' });
  }

  async getAllianceBrainOfferings(brandId) {
    return this.request(`/api/alliance/brain/brands/${brandId}/offerings`);
  }

  async createAllianceBrainOffering(payload) {
    return this.request('/api/alliance/brain/offerings', { method: 'POST', body: JSON.stringify(payload) });
  }

  async importAllianceBrainOfferingsBulk(payload) {
    return this.request('/api/alliance/brain/offerings/import-bulk', { method: 'POST', body: JSON.stringify(payload) });
  }

  async updateAllianceBrainOffering(id, payload) {
    return this.request(`/api/alliance/brain/offerings/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async deleteAllianceBrainOffering(id) {
    return this.request(`/api/alliance/brain/offerings/${id}`, { method: 'DELETE' });
  }

  async getAllianceBrainFaqs(offeringId) {
    return this.request(`/api/alliance/brain/offerings/${offeringId}/faqs`);
  }

  async createAllianceBrainFaq(offeringId, payload) {
    return this.request(`/api/alliance/brain/offerings/${offeringId}/faqs`, { method: 'POST', body: JSON.stringify(payload) });
  }

  async updateAllianceBrainFaq(id, payload) {
    return this.request(`/api/alliance/brain/faqs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async deleteAllianceBrainFaq(id) {
    return this.request(`/api/alliance/brain/faqs/${id}`, { method: 'DELETE' });
  }

  async getAlliancePromptRules() {
    return this.request('/api/alliance/prompt-rules');
  }

  async extractAlliancePromptRule(text) {
    return this.request('/api/alliance/prompt-rules/extract', { method: 'POST', body: JSON.stringify({ text }) });
  }

  async createAlliancePromptRule(payload) {
    return this.request('/api/alliance/prompt-rules', { method: 'POST', body: JSON.stringify(payload) });
  }

  async updateAlliancePromptRule(id, payload) {
    return this.request(`/api/alliance/prompt-rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
  }

  async deleteAlliancePromptRule(id) {
    return this.request(`/api/alliance/prompt-rules/${id}`, { method: 'DELETE' });
  }

  async sendAllianceEmailReply(id, body) {
    return this.request(`/api/alliance/replies/${id}/send`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }

  async suggestAllianceEmailReply(id) {
    return this.request(`/api/alliance/replies/${id}/suggest`, { method: 'POST' });
  }

  async getAllianceEmailSettings() {
    return this.request('/api/alliance/email-settings');
  }

  async getAllianceNumberHealth() {
    return this.request('/api/alliance/number-health');
  }

  async saveAllianceEmailSettings(settings) {
    return this.request('/api/alliance/email-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async verifyAllianceEmailSettings() {
    return this.request('/api/alliance/email-settings/verify', { method: 'POST' });
  }

  async getAllianceCampaignBuilderOptions(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null)).toString();
    return this.request(`/api/alliance/campaign-builder/options${query ? `?${query}` : ''}`);
  }

  async getAllianceCampaignProspects(params = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value !== undefined && value !== null)).toString();
    return this.request(`/api/alliance/campaign-builder/prospects${query ? `?${query}` : ''}`);
  }

  async getAllianceCampaignTemplates(audience) {
    return this.request(`/api/alliance/campaign-builder/templates?audience=${encodeURIComponent(audience)}`);
  }

  async saveAllianceCampaignTemplate(touchNo, payload) {
    return this.request(`/api/alliance/campaign-builder/templates/${touchNo}`, {
      method: 'PUT', body: JSON.stringify(payload)
    });
  }

  async createAllianceCampaignTemplate(audience) {
    return this.request('/api/alliance/campaign-builder/templates', {
      method: 'POST', body: JSON.stringify({ audience })
    });
  }

  async deleteAllianceCampaignTemplate(touchNo, audience) {
    return this.request(`/api/alliance/campaign-builder/templates/${touchNo}?audience=${encodeURIComponent(audience)}`, { method: 'DELETE' });
  }

  async suggestAllianceCampaignTemplates(payload) {
    return this.request('/api/alliance/campaign-builder/ai-suggestion', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async createAllianceEmailCampaign(payload) {
    return this.request('/api/alliance/campaigns', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async getPipeline(type = 'college') {
    return this.request(`/api/pipeline?type=${type}`);
  }

  async analyzeBatch(orgIds) {
    return this.request('/api/analyze/batch', {
      method: 'POST',
      body: JSON.stringify({ orgIds })
    });
  }

  async getKnowledgeBase() {
    return this.request('/api/knowledge');
  }

  async deleteKnowledgeDoc(id) {
    return this.request(`/api/knowledge/${id}`, { method: 'DELETE' });
  }

  async uploadKnowledgeDoc(formData) {
    const token = localStorage.getItem('leados_token');
    if (!token) throw new Error('No authentication token found');
    const response = await fetch(`${API_URL}/api/knowledge/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: formData
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  async getAllianceInbox() {
    return this.request('/api/alliance-inbox');
  }

  async getAllianceLead(id) {
    return this.request(`/api/alliance-inbox/${id}`);
  }

  async sendAllianceMessage(orgId, message) {
    return this.request(`/api/alliance-inbox/${orgId}/send`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  }

  // ─── CONTENT OS ─────────────────────────
  async getSocialAccounts() {
    return this.request('/api/content/social-accounts');
  }

  async getContentQueue(filters = {}) {
    const query = new URLSearchParams();
    if (filters.status) query.append('status', filters.status);
    if (filters.search) query.append('search', filters.search);
    if (filters.startDate) query.append('startDate', filters.startDate);
    if (filters.endDate) query.append('endDate', filters.endDate);
    
    return this.request(`/api/content?${query.toString()}`);
  }

  async getContentStats() {
    return this.request('/api/content/stats');
  }

  async updateContent(id, updates) {
    return this.request(`/api/content/${id}/edit`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async approveContent(id, body = {}) {
    return this.request(`/api/content/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async scheduleContent(id, scheduledAt) {
    return this.request(`/api/content/${id}/schedule`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_at: scheduledAt }),
    });
  }

  async publishContent(id) {
    return this.request(`/api/content/${id}/publish`, {
      method: 'POST',
    });
  }

  async rejectContent(id, reason) {
    return this.request(`/api/content/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({ rejection_reason: reason })
    });
  }

  async deletePostFromPlatforms(id) {
    return this.request(`/api/content/${id}`, { method: 'DELETE' });
  }

  // ── Thumbnail Brain Studio ───────────────────────────────────────────────
  getThumbnailBrainConfig()            { return this.get('/content-os/thumb-brain/config'); }
  saveThumbnailBrainConfig(config, versionName) { return this.post('/content-os/thumb-brain/config', { config, version_name: versionName }); }
  getThumbnailBrainVersions()          { return this.get('/content-os/thumb-brain/versions'); }
  activateThumbnailBrainVersion(id)    { return this.post(`/content-os/thumb-brain/versions/${id}/activate`, {}); }
  deleteThumbnailBrainVersion(id)      { return this.request(`/api/content-os/thumb-brain/versions/${id}`, { method: 'DELETE' }); }
  getThumbnailBrainSocialPlatforms()              { return this.get('/content-os/thumb-brain/social-platforms'); }
  saveThumbnailBrainPlatformOverride(slug, data)  { return this.put(`/content-os/thumb-brain/social-platforms/${slug}`, data); }
  getThumbnailBrainPlatforms()         { return this.get('/content-os/thumb-brain/platforms'); }
  createThumbnailBrainPlatform(data)   { return this.post('/content-os/thumb-brain/platforms', data); }
  updateThumbnailBrainPlatform(id, d)  { return this.put(`/content-os/thumb-brain/platforms/${id}`, d); }
  deleteThumbnailBrainPlatform(id)     { return this.request(`/api/content-os/thumb-brain/platforms/${id}`, { method: 'DELETE' }); }
  getThumbnailBrainSocialBrandStyles()              { return this.get('/content-os/thumb-brain/social-brand-styles'); }
  saveThumbnailBrainBrandStyleOverride(slug, data)  { return this.put(`/content-os/thumb-brain/social-brand-styles/${slug}`, data); }
  getThumbnailBrainBrandStyles()       { return this.get('/content-os/thumb-brain/brand-styles'); }
  createThumbnailBrainBrandStyle(data) { return this.post('/content-os/thumb-brain/brand-styles', data); }
  updateThumbnailBrainBrandStyle(id,d) { return this.put(`/content-os/thumb-brain/brand-styles/${id}`, d); }
  deleteThumbnailBrainBrandStyle(id)   { return this.request(`/api/content-os/thumb-brain/brand-styles/${id}`, { method: 'DELETE' }); }
  getThumbnailBrainAnalytics()         { return this.get('/content-os/thumb-brain/analytics'); }
  recordThumbnailBrainAnalytics(data)  { return this.post('/content-os/thumb-brain/analytics', data); }

  async generateAIImage(prompt, aspectRatio = '1:1', style = 'Photorealistic', model = 'gemini-3.1-flash-image') {
    return this.post('/content/generate-ai-image', { prompt, aspectRatio, style, model });
  }

  async generatePoster(id, frameUrl, prompt = null, model = null, config = null, description = '') {
    return this.request(`/api/content/${id}/generate-poster`, {
      method: 'POST',
      body: JSON.stringify({
        frame_url: frameUrl,
        ...(prompt ? { prompt } : {}),
        ...(model ? { model } : {}),
        ...(config ? { config } : {}),
        ...(description ? { description } : {}),
      }),
    });
  }

  async generateThumbnailHeadline(id, caption, description) {
    return this.request(`/api/content/${id}/generate-thumbnail-headline`, {
      method: 'POST',
      body: JSON.stringify({ caption, description }),
    });
  }

  async uploadPosterOverlay(id, posterDataUrl) {
    return this.request(`/api/content/${id}/upload-poster-overlay`, {
      method: 'POST',
      body: JSON.stringify({ poster_data_url: posterDataUrl }),
    });
  }

  async generateThumbnails(id, context = '') {
    return this.request(`/api/content/${id}/generate-thumbnails`, {
      method: 'POST',
      body: JSON.stringify({ context }),
    });
  }

  async generateCaptions(brandName, videoUrl, platforms) {
    return this.request('/api/content/generate-captions', {
      method: 'POST',
      body: JSON.stringify({ brand_name: brandName, video_url: videoUrl, platforms }),
    });
  }

  async createBatchContent(items) {
    return this.request('/api/content/batch', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  }

  async getFolderMonitors() {
    return this.request('/api/content/monitors', {
      method: 'GET',
    });
  }

  async upsertFolderMonitor(brandName, folderId) {
    return this.request('/api/content/monitors', {
      method: 'POST',
      body: JSON.stringify({ brand_name: brandName, folder_id: folderId }),
    });
  }

  async getAiCaptionSuggestions(id, tone = 'engaging', platform = null, contextInfo = '') {
    return this.request(`/api/content/${id}/suggest-captions`, {
      method: 'POST',
      body: JSON.stringify({ tone, platform, contextInfo })
    });
  }

  async getAiStorySuggestions(id, tone = 'engaging', contextInfo = '') {
    return this.request(`/api/content/${id}/suggest-stories`, {
      method: 'POST',
      body: JSON.stringify({ tone, contextInfo })
    });
  }

  // Workflow Logs
  async getWorkflowLogs() {
    return this.request('/api/workflows/logs', {
      method: 'GET'
    });
  }

  async deleteWorkflowLog(id) {
    return this.request(`/api/workflows/logs/${id}`, {
      method: 'DELETE'
    });
  }

  async getWorkflowTelemetry() {
    return this.request('/api/workflows/telemetry', {
      method: 'GET'
    });
  }
}

export const api = new LeadOSAPI();

export const allianceInboxApi = {
  getLeads(filters = {}) {
    const params = new URLSearchParams({
      limit: filters.limit || 20,
      offset: filters.offset || 0,
      ...(filters.search && { search: filters.search }),
    });
    return api.request(`/api/alliance-inbox/contacts?${params}`);
  },
  getLead(id) { return api.request(`/api/alliance-inbox/contacts/${id}`); },
  getMessages(id, limit = 100, offset = 0) { return api.request(`/api/alliance-inbox/contacts/${id}/messages?limit=${limit}&offset=${offset}`); },
  readConversation(id) { return api.request(`/api/alliance-inbox/conversations/${id}/read`, { method: 'PUT' }); },
  updateLead(id, updates) { return api.request(`/api/alliance-inbox/contacts/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }); },
  suggestReply(id) { return api.request(`/api/alliance-inbox/contacts/${id}/ai-suggestion`, { method: 'POST' }); },
  sendWhatsAppMessage(id, message, mediaUrl = null, msgType = 'text', replyToWaId = null, isForwarded = false, senderType = 'human', waMediaId = null) {
    return api.request(`/api/alliance-inbox/contacts/${id}/messages`, {
      method: 'POST', body: JSON.stringify({ message, mediaUrl, msgType, replyToMessageId: replyToWaId, isForwarded, senderType, waMediaId }),
    });
  },
  editMessage(id, content) { return api.request(`/api/alliance-inbox/messages/${id}/edit`, { method: 'PUT', body: JSON.stringify({ content }) }); },
  deleteMessage(id) { return api.request(`/api/alliance-inbox/messages/${id}/delete`, { method: 'PUT' }); },
  pinMessage(id, duration) { return api.request(`/api/alliance-inbox/messages/${id}/pin`, { method: 'PUT', body: JSON.stringify({ duration }) }); },
  unpinMessage(id) { return api.request(`/api/alliance-inbox/messages/${id}/pin`, { method: 'PUT', body: JSON.stringify({ unpin: true }) }); },
  toggleStarMessage(id, is_starred) { return api.request(`/api/alliance-inbox/messages/${id}/star`, { method: 'PUT', body: JSON.stringify({ is_starred }) }); },
  reactToMessage(id, emoji, action = 'add') { return api.request(`/api/alliance-inbox/messages/${id}/react`, { method: 'PUT', body: JSON.stringify({ emoji, action }) }); },
  getTags() { return api.request('/api/alliance-inbox/tags'); },
  createTag(name, color) { return api.request('/api/alliance-inbox/tags', { method: 'POST', body: JSON.stringify({ name, color }) }); },
  deleteTag(id) { return api.request(`/api/alliance-inbox/tags/${id}`, { method: 'DELETE' }); },
  assignTag(contactId, tagId) { return api.request(`/api/alliance-inbox/contacts/${contactId}/tags`, { method: 'POST', body: JSON.stringify({ tagId }) }); },
  removeTag(contactId, tagId) { return api.request(`/api/alliance-inbox/contacts/${contactId}/tags/${tagId}`, { method: 'DELETE' }); },
  put() { return Promise.resolve({ success: true }); },
  uploadMedia(formData, onProgress) {
    const token = localStorage.getItem('leados_token');
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_URL}/api/alliance-inbox/media/upload`);
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      if (onProgress) xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* handled below */ }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(Object.assign(new Error(data.error || 'Alliance media upload failed'), { response: { data } }));
      };
      xhr.onerror = () => reject(new Error('Alliance media upload failed'));
      xhr.send(formData);
    });
  },
};
