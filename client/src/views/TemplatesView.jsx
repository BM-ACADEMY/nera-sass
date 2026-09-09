import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, Check, AlertCircle, Loader2, Smartphone, ChevronDown, Image, Video, FileText, Link, MessageSquare, Type, RefreshCw, Search, Phone, Download } from 'lucide-react';
import { C } from '../constants/theme.js';
import { TBadge } from '../components/ui.jsx';
import { useTemplates } from '../hooks/useTemplates.js';
import { api } from '../services/api.js';

const PARAMETER_SOURCE_OPTIONS = {
  leados: [
    ['recipient_name', 'Lead name'], ['recipient_phone', 'Lead phone'],
    ['recipient_email', 'Lead email'], ['lead_status', 'Lead status'],
    ['lead_source', 'Lead source'], ['lead_interest', 'Lead interest'],
    ['lead_score', 'Lead score'], ['brand_name', 'Brand name'],
    ['campaign_name', 'Campaign name'], ['custom', 'Custom value'],
    ['excel_parameter', 'Excel column']
  ],
  alliance: [
    ['name', 'Prospect contact name'], ['business_name', 'Prospect business name'],
    ['phone', 'Prospect phone'], ['email', 'Prospect email'],
    ['audience', 'Prospect audience'], ['industry', 'Prospect industry'],
    ['location', 'Prospect location'], ['source', 'Prospect source'],
    ['ai_score', 'AI score'], ['channel', 'Channel'], ['consent', 'WhatsApp consent'],
    ['consent_source', 'Consent source'], ['campaign_name', 'Campaign name'],
    ['status', 'Prospect status'], ['created_at', 'Date added']
  ]
};
const defaultParameterSource = (scope, index) => scope === 'alliance'
  ? (['name', 'business_name', 'location'][index] || 'name')
  : (index === 0 ? 'recipient_name' : 'custom');

// ── Toast Notification ────────────────────────────────────
const Toast = ({ toast, onClose }) => {
  if (!toast) return null;
  const isError = toast.type === 'error';
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
      background: isError ? '#2d1010' : '#0a2018',
      border: `1px solid ${isError ? '#7c2d12' : '#065f46'}`,
      borderRadius: 12, padding: '14px 20px', minWidth: 300, maxWidth: 420,
      display: 'flex', alignItems: 'flex-start', gap: 12,
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
      animation: 'slideInUp 0.3s ease'
    }}>
      <style>{`@keyframes slideInUp{from{transform:translateY(20px);opacity:0}to{transform:translateY(0);opacity:1}}`}</style>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        background: isError ? '#7c2d12' : '#065f46',
        display: 'flex', alignItems: 'center', justifyContent: 'center'
      }}>
        {isError ? <AlertCircle size={14} color="#ef4444" /> : <Check size={14} color="#34d399" />}
      </div>
      <div style={{ flex: 1 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: isError ? '#ef4444' : '#34d399', marginBottom: 2 }}>
          {isError ? 'Error' : 'Success'}
        </p>
        <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.4 }}>{toast.message}</p>
      </div>
      <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#475569', padding: 0 }}>
        <X size={14} />
      </button>
    </div>
  );
};

// ── WhatsApp Live Preview ─────────────────────────────────
const WaPreview = ({ form }) => {
  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;

  const renderBody = (text) => {
    if (!text) return <span style={{ color: '#667781' }}>Your message body will appear here...</span>;
    return text.split(/(\{\{[^}]+\}\})/g).map((part, i) =>
      /^\{\{[^}]+\}\}$/.test(part)
        ? <span key={i} style={{ background: '#dcf8c6', color: '#075e54', borderRadius: 3, padding: '0 3px', fontWeight: 600 }}>{part}</span>
        : part
    );
  };

  const hasHeader = form.header_format !== 'NONE' && (form.header || form.header_format !== 'TEXT');
  const hasButtons = form.buttons && form.buttons.length > 0;

  return (
    <div style={{
      background: 'linear-gradient(180deg, #0d1b2a 0%, #1a2e4a 100%)',
      borderRadius: 14, padding: 20, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
      border: `1px solid ${C.border}`, position: 'sticky', top: 20
    }}>
      <p style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 600 }}>Live Preview</p>

      {/* Phone frame */}
      <div style={{
        width: 260, background: '#111b21', borderRadius: 22, padding: '12px 6px',
        boxShadow: '0 0 0 2px #1a2e4a, 0 30px 60px rgba(0,0,0,0.5)'
      }}>
        {/* Status bar */}
        <div style={{ background: '#202c33', borderRadius: '16px 16px 0 0', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#2a3942', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Smartphone size={14} color="#8696a0" />
            </div>
            <div>
              <p style={{ fontSize: 10, color: '#e9edef', fontWeight: 600 }}>{form.name || 'Template Name'}</p>
              <p style={{ fontSize: 8, color: '#8696a0' }}>Business Account</p>
            </div>
          </div>
        </div>

        {/* Chat area */}
        <div style={{
          background: '#0b141a',
          backgroundImage: 'radial-gradient(circle at 1px 1px, #1a2833 1px, transparent 0)',
          backgroundSize: '20px 20px',
          minHeight: 320, padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 8
        }}>
          {/* Date chip */}
          <div style={{ textAlign: 'center' }}>
            <span style={{ background: '#182229', color: '#8696a0', fontSize: 10, padding: '3px 10px', borderRadius: 8 }}>Today</span>
          </div>

          {/* Message bubble */}
          <div style={{ alignSelf: 'flex-end', maxWidth: '90%' }}>
            <div style={{ background: '#005c4b', borderRadius: '12px 12px 0 12px', overflow: 'hidden' }}>
              {/* Header */}
              {form.header_format === 'IMAGE' && (
                form.media_preview ? (
                  <img src={form.media_preview} alt="Header" style={{ width: '100%', height: 120, objectFit: 'cover' }} />
                ) : (
                  <div style={{ background: '#0d2a25', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Image size={24} color="#34d399" />
                    <span style={{ fontSize: 10, color: '#34d399', marginLeft: 6 }}>Image</span>
                  </div>
                )
              )}
              {form.header_format === 'VIDEO' && (
                form.media_preview ? (
                  <div style={{ position: 'relative', width: '100%', height: 120, background: '#000' }}>
                    <video src={form.media_preview} style={{ width: '100%', height: '100%', objectFit: 'cover' }} autoPlay loop muted playsInline />
                  </div>
                ) : (
                  <div style={{ background: '#1a1a2e', height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Video size={24} color="#818cf8" />
                    <span style={{ fontSize: 10, color: '#818cf8', marginLeft: 6 }}>Video</span>
                  </div>
                )
              )}
              {form.header_format === 'DOCUMENT' && (
                <div style={{ background: '#1e2a3a', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <FileText size={22} color="#60a5fa" />
                  <span style={{ fontSize: 10, color: '#60a5fa', marginLeft: 6 }}>Document</span>
                </div>
              )}
              {form.header_format === 'TEXT' && form.header && (
                <div style={{ padding: '8px 10px 4px' }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#e9edef' }}>{form.header}</p>
                </div>
              )}

              {/* Body */}
              <div style={{ padding: '6px 10px 4px' }}>
                <p style={{ fontSize: 11, color: '#e9edef', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{renderBody(form.body)}</p>
              </div>

              {/* Footer */}
              {form.footer && (
                <div style={{ padding: '0 10px 6px' }}>
                  <p style={{ fontSize: 9, color: '#8696a0' }}>{form.footer}</p>
                </div>
              )}

              {/* Timestamp */}
              <div style={{ padding: '0 10px 6px', textAlign: 'right' }}>
                <span style={{ fontSize: 8, color: '#8696a0' }}>{timeStr} ✓✓</span>
              </div>
            </div>

            {/* Buttons */}
            {hasButtons && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 2 }}>
                {form.buttons.map((btn, i) => {
                  const PreviewTag = btn.type === 'URL' || btn.type === 'PHONE_NUMBER' ? 'a' : 'div';
                  const previewHref = btn.type === 'URL' ? btn.url : btn.type === 'PHONE_NUMBER' ? `tel:${btn.phone_number || ''}` : undefined;
                  return <PreviewTag key={i} href={previewHref} target={btn.type === 'URL' ? '_blank' : undefined} rel={btn.type === 'URL' ? 'noopener noreferrer' : undefined} style={{
                    background: '#005c4b', borderRadius: 8, padding: '7px 10px',
                    textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, textDecoration: 'none'
                  }}>
                    {btn.type === 'URL' ? <Link size={10} color="#53bdeb" /> : btn.type === 'PHONE_NUMBER' ? <Phone size={10} color="#53bdeb" /> : <MessageSquare size={10} color="#53bdeb" />}
                    <span style={{ fontSize: 11, color: '#53bdeb', fontWeight: 600 }}>{btn.text || 'Button'}</span>
                  </PreviewTag>;
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Category badge */}
      <div style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 20,
        padding: '4px 14px', fontSize: 10, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8
      }}>
        {form.category || 'No Category'}
      </div>
    </div>
  );
};

// ── Category defaults ─────────────────────────────────────
const CATEGORY_DEFAULTS = {
  MARKETING: {
    body: 'Hi {{1}}! 🎉 We have an exclusive offer just for you.\n\nGet {{2}} off on your next purchase. Use code: {{3}}\n\nOffer valid till {{4}}. Don\'t miss out!',
    footer: 'Reply STOP to unsubscribe',
    allowMedia: true,
  },
  UTILITY: {
    body: 'Hello {{1}},\n\nYour order #{{2}} has been {{3}}.\n\nExpected delivery: {{4}}\nTracking: {{5}}\n\nThank you for choosing us!',
    footer: 'For support, reply to this message.',
    allowMedia: true,
  },
  AUTHENTICATION: {
    body: '{{1}} is your verification code for {{2}}. This code expires in {{3}} minutes.\n\nDo not share this code with anyone.',
    footer: 'If you didn\'t request this, please ignore.',
    allowMedia: false,
  },
};

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'hi', label: 'Hindi' },
  { code: 'ta', label: 'Tamil' },
  { code: 'ar', label: 'Arabic' },
  { code: 'es', label: 'Spanish' },
  { code: 'pt_BR', label: 'Portuguese (Brazil)' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'id', label: 'Indonesian' },
];

const HEADER_FORMATS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'];

// ── Input style helper ────────────────────────────────────
const inp = (extra = {}) => ({
  width: '100%', background: '#0c1525', border: `1px solid ${C.border}`,
  borderRadius: 8, padding: '9px 12px', fontSize: 12, color: C.text,
  outline: 'none', fontFamily: "'DM Sans', sans-serif",
  ...extra
});

// ── Main Component ────────────────────────────────────────
export const TemplatesView = () => {
  const { templates: apiTemplates, loading: tableLoading, error, refetch } = useTemplates();
  const templates = apiTemplates || [];

  const [showBuilder, setShowBuilder] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(null); // id of template being submitted
  const [syncLoading, setSyncLoading] = useState(null); // id of template being synced
  const [bulkSyncLoading, setBulkSyncLoading] = useState(false);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState([]);
  const [bulkWorkspace, setBulkWorkspace] = useState('leados');
  const [bulkWorkspaceLoading, setBulkWorkspaceLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterLanguage, setFilterLanguage] = useState('all');
  const [filterWorkspace, setFilterWorkspace] = useState('all');
  const [filterStatuses, setFilterStatuses] = useState([]);
  const [filterDate, setFilterDate] = useState('all');
  const [showStatusDropdown, setShowStatusDropdown] = useState(false);
  const [toast, setToast] = useState(null);
  const [clients, setClients] = useState([]);
  const [allianceAudiences, setAllianceAudiences] = useState([]);
  const [previewTemplate, setPreviewTemplate] = useState(null); // template object to preview
  const [templateToDelete, setTemplateToDelete] = useState(null); // template object to delete
  const [deleteConfirmText, setDeleteConfirmText] = useState(''); // text for delete confirmation
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [mediaUploading, setMediaUploading] = useState(false);

  const defaultForm = {
    name: '',
    category: 'MARKETING',
    language: 'en',
    header_format: 'NONE',
    header: '',
    body: CATEGORY_DEFAULTS.MARKETING.body,
    footer: CATEGORY_DEFAULTS.MARKETING.footer,
    buttons: [],
    client_id: '',
    samples: [],
    parameter_definitions: { body: {}, header: {} },
    template_scope: 'leados',
    alliance_audience: '',
  };
  const [form, setForm] = useState(defaultForm);

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  }, []);

  useEffect(() => {
    api.getClients().then(d => setClients(d.clients || [])).catch(() => {});
    api.getAllianceAudiences().then(d => setAllianceAudiences(d.audiences || [])).catch(() => {});
  }, []);

  const selectedAllianceAudience = allianceAudiences.find((audience) => audience.code === form.alliance_audience);
  const allianceParameterOptions = (() => {
    const fields = new Map(PARAMETER_SOURCE_OPTIONS.alliance);
    const applicableAudiences = selectedAllianceAudience ? [selectedAllianceAudience] : allianceAudiences;
    applicableAudiences.forEach((audience) => {
      (audience.column_config || []).filter((column) => column.enabled !== false).forEach((column) => fields.set(column.key, column.label || column.key.replaceAll('_', ' ')));
      (audience.fields || []).filter((field) => field.active !== false).forEach((field) => fields.set(field.field_key, field.label || field.field_key.replaceAll('_', ' ')));
    });
    return [...fields.entries()];
  })();

  const handleCategoryChange = (cat) => {
    const defaults = CATEGORY_DEFAULTS[cat] || {};
    setForm(f => ({
      ...f,
      category: cat,
      body: defaults.body || f.body,
      footer: defaults.footer || f.footer,
      header_format: defaults.allowMedia ? f.header_format : 'NONE',
    }));
  };

  const addButton = (type) => {
    if (form.buttons.length >= 3) return showToast('Maximum 3 buttons allowed', 'error');
    setForm(f => ({
      ...f,
      buttons: [...f.buttons, { type, text: '', ...(type === 'URL' ? { url: '' } : {}), ...(type === 'PHONE_NUMBER' ? { phone_number: '' } : {}) }]
    }));
  };

  const removeButton = (i) => setForm(f => ({ ...f, buttons: f.buttons.filter((_, idx) => idx !== i) }));

  const updateButton = (i, field, value) => {
    setForm(f => ({
      ...f,
      buttons: f.buttons.map((b, idx) => idx === i ? { ...b, [field]: value } : b)
    }));
  };

  const handleSubmitTemplate = async (id) => {
    setSubmitLoading(id);
    try {
      await api.submitTemplate(id);
      showToast('Template submitted to Meta for approval! You\'ll be notified once reviewed.');
      if (refetch) refetch();
    } catch (err) {
      // Detect expired / invalid Meta access token
      const msg = err.message || '';
      if (msg.includes('190') || msg.toLowerCase().includes('access token') || msg.toLowerCase().includes('oauth')) {
        showToast('Meta access token is expired or invalid. Please update META_PAGE_ACCESS_TOKEN in your .env and restart the server.', 'error');
      } else {
        showToast('Submit failed: ' + msg, 'error');
      }
    } finally {
      setSubmitLoading(null);
    }
  };

  const handleSyncTemplate = async (id) => {
    setSyncLoading(id);
    try {
      const res = await api.syncTemplate(id);
      if (res.template.status !== 'pending') {
        showToast(`Template is now ${res.template.status}!`);
        if (refetch) refetch();
      } else {
        showToast('Template is still pending on Meta.');
      }
    } catch (err) {
      const message = err.message || 'Unknown template status error';
      if (/access token|oauth|\(190\)/i.test(message)) {
        showToast(`Meta authentication failed: ${message}`, 'error');
      } else if (/business account|waba|template id/i.test(message)) {
        showToast(`Meta template configuration issue: ${message}`, 'error');
      } else {
        showToast(`Failed to check status: ${message}`, 'error');
      }
    } finally {
      setSyncLoading(null);
    }
  };

  const handleBulkSyncTemplates = async () => {
    setBulkSyncLoading(true);
    let totalImported = 0;
    let totalUpdated = 0;
    try {
      const mainRes = await api.syncAllTemplates(null);
      totalImported += mainRes.imported || 0;
      totalUpdated += mainRes.updated || 0;

      for (const client of clients) {
        if (client.phone_number_id && client.wa_access_token) {
          try {
            const clientRes = await api.syncAllTemplates(client.id);
            totalImported += clientRes.imported || 0;
            totalUpdated += clientRes.updated || 0;
          } catch (e) {
            console.error(`Failed to sync for client ${client.name}:`, e.message);
          }
        }
      }

      showToast(`Templates synchronized successfully! Imported ${totalImported} new templates, updated ${totalUpdated} statuses.`);
      if (refetch) refetch();
    } catch (err) {
      showToast('Templates Sync failed: ' + err.message, 'error');
    } finally {
      setBulkSyncLoading(false);
    }
  };

  const handleBulkWorkspaceUpdate = async () => {
    if (!selectedTemplateIds.length) return showToast('Select at least one template', 'error');
    setBulkWorkspaceLoading(true);
    try {
      const result = await api.updateTemplateScopes(selectedTemplateIds, bulkWorkspace);
      showToast(`${result.updated} template${result.updated === 1 ? '' : 's'} moved to ${bulkWorkspace === 'alliance' ? 'AllianceOS' : bulkWorkspace === 'leados' ? 'LeadOS' : 'Shared'}`);
      setSelectedTemplateIds([]);
      if (refetch) await refetch();
    } catch (err) {
      showToast('Workspace update failed: ' + err.message, 'error');
    } finally {
      setBulkWorkspaceLoading(false);
    }
  };

  const handleMediaUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMediaUploading(true);
    try {
      const res = await api.uploadTemplateMedia(file, form.client_id);
      if (res.handle) {
        const previewUrl = URL.createObjectURL(file);
        setForm(f => ({ ...f, header: res.handle, media_preview: previewUrl }));
        showToast('Media uploaded successfully!');
      }
    } catch (err) {
      showToast('Media upload failed: ' + err.message, 'error');
    } finally {
      setMediaUploading(false);
      e.target.value = ''; // reset input
    }
  };

  const handleCreateTemplate = async () => {
    if (!form.name.trim()) return showToast('Template name is required', 'error');
    if (!form.body.trim()) return showToast('Message body is required', 'error');
    if (form.template_scope === 'alliance' && !form.alliance_audience) return showToast('Select the AllianceOS audience this template is created for', 'error');
    if (!/^[a-z0-9_]+$/.test(form.name)) return showToast('Template name must be lowercase letters, numbers, underscores only', 'error');
    
    const matches = form.body.match(/\{\{(\d+)\}\}/g);
    const maxVar = matches ? Math.max(...matches.map(m => parseInt(m.replace(/\D/g, '')))) : 0;
    if (maxVar > 0) {
      for (let i = 0; i < maxVar; i++) {
        if (!form.samples || !form.samples[i] || !form.samples[i].trim()) {
          return showToast(`Please provide a sample value for {{${i + 1}}}`, 'error');
        }
        if (!form.parameter_definitions?.body?.[String(i + 1)]?.label?.trim()) {
          return showToast(`Please describe what {{${i + 1}}} means`, 'error');
        }
      }
    }

    const normalizedButtons = [];
    for (const button of form.buttons) {
      if (!button.text?.trim()) return showToast('Every button requires a label', 'error');
      if (button.type === 'URL') {
        try {
          const url = new URL(button.url);
          if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid protocol');
          normalizedButtons.push({ ...button, text: button.text.trim(), url: url.toString() });
        } catch {
          return showToast('Enter a valid URL starting with https:// or http://', 'error');
        }
      } else if (button.type === 'PHONE_NUMBER') {
        const digits = String(button.phone_number || '').replace(/\D/g, '');
        if (digits.length < 10 || digits.length > 15) return showToast('Phone button requires a valid 10 to 15 digit number', 'error');
        const internationalNumber = digits.length === 10 ? `+91${digits}` : `+${digits}`;
        normalizedButtons.push({ ...button, text: button.text.trim(), phone_number: internationalNumber });
      } else {
        normalizedButtons.push({ ...button, text: button.text.trim() });
      }
    }

    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        category: form.category,
        language: form.language,
        header_format: form.header_format !== 'NONE' ? form.header_format : 'TEXT',
        header: form.header_format === 'NONE' ? null : form.header || null,
        body: form.body,
        footer: form.footer || null,
        buttons: normalizedButtons,
        client_id: form.client_id || null,
        samples: form.samples,
        parameter_definitions: { ...form.parameter_definitions, alliance_audience: form.template_scope === 'alliance' ? form.alliance_audience : undefined },
        template_scope: form.template_scope,
      };
      if (editingId) {
        await api.updateTemplate(editingId, payload);
        showToast(`Template "${form.name}" updated successfully!`);
      } else {
        await api.createTemplate(payload);
        showToast(`Template "${form.name}" created successfully as a draft!`);
      }
      setShowBuilder(false);
      setForm(defaultForm);
      setEditingId(null);
      if (refetch) refetch();
    } catch (err) {
      showToast(`Failed to ${editingId ? 'update' : 'create'} template: ` + err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEditTemplate = (t) => {
    setForm({
      name: t.name,
      category: t.category,
      language: t.language || 'en',
      header_format: t.header_format || 'NONE',
      header: t.header || '',
      body: t.body,
      footer: t.footer || '',
      buttons: (() => { try { return typeof t.buttons === 'string' ? JSON.parse(t.buttons) : (t.buttons || []); } catch { return []; } })(),
      client_id: t.client_id || '',
      samples: (() => { try { return typeof t.samples === 'string' ? JSON.parse(t.samples) : (t.samples || []); } catch { return []; } })(),
      parameter_definitions: (() => { try { return typeof t.parameter_definitions === 'string' ? JSON.parse(t.parameter_definitions) : (t.parameter_definitions || { body: {}, header: {} }); } catch { return { body: {}, header: {} }; } })(),
      template_scope: t.template_scope || 'shared',
      alliance_audience: (() => { try { const definitions = typeof t.parameter_definitions === 'string' ? JSON.parse(t.parameter_definitions) : t.parameter_definitions; return definitions?.alliance_audience || ''; } catch { return ''; } })(),
    });
    setEditingId(t.id);
    setShowBuilder(true);
  };

  const handleOpenDeleteModal = (t) => {
    setTemplateToDelete(t);
    setDeleteConfirmText('');
  };

  const confirmDeleteTemplate = async () => {
    if (!templateToDelete || deleteConfirmText !== 'delete-my-template' || deleteLoading) return;
    setDeleteLoading(true);
    try {
      await api.deleteTemplate(templateToDelete.id);
      showToast('Template deleted successfully');
      setTemplateToDelete(null);
      if (refetch) refetch();
    } catch (err) {
      showToast('Failed to delete: ' + err.message, 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  const allowMedia = CATEGORY_DEFAULTS[form.category]?.allowMedia ?? true;
  const availableHeaderFormats = allowMedia ? HEADER_FORMATS : ['NONE', 'TEXT'];

  // Pagination & Filters calculation
  const statusOptions = [
    'Active – High quality',
    'Active – Low quality',
    'Active – Quality pending',
    'Active – Medium quality',
    'Appealed – In review',
    'Paused',
    'In review',
    'Rejected',
    'Archived',
    'Disabled'
  ];

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterCategory, filterLanguage, filterWorkspace, filterStatuses, filterDate]);

  const filteredTemplates = templates.filter(t => {
    const searchTerms = searchQuery.toLowerCase().split(/\s+/).filter(Boolean);
    const matchesSearch = searchTerms.length === 0 || searchTerms.every(term => t.name.toLowerCase().includes(term));
    const matchesCategory = filterCategory === 'all' || t.category?.toLowerCase() === filterCategory.toLowerCase();
    const matchesLanguage = filterLanguage === 'all' || t.language === filterLanguage;
    const matchesWorkspace = filterWorkspace === 'all' || (t.template_scope || 'shared') === filterWorkspace;
    
    let matchesStatus = true;
    if (filterStatuses.length > 0) {
      const metaStatus = (t.status || '').toLowerCase();
      matchesStatus = filterStatuses.some(statusOpt => {
        if (statusOpt === 'Active – High quality' || statusOpt === 'Active – Low quality' || statusOpt === 'Active – Medium quality' || statusOpt === 'Active – Quality pending') {
          return metaStatus === 'approved';
        }
        if (statusOpt === 'In review') return metaStatus === 'pending';
        if (statusOpt === 'Paused') return metaStatus === 'paused';
        if (statusOpt === 'Rejected') return metaStatus === 'rejected';
        if (statusOpt === 'Disabled') return metaStatus === 'disabled';
        if (statusOpt === 'Appealed – In review') return metaStatus === 'appealed' || metaStatus === 'pending';
        return false;
      });
    }
    
    let matchesDate = true;
    if (filterDate !== 'all') {
      const createdDate = new Date(t.created_at || t.submitted_at || Date.now());
      const diffDays = Math.ceil((new Date() - createdDate) / (1000 * 60 * 60 * 24));
      if (filterDate === '7d') matchesDate = diffDays <= 7;
      else if (filterDate === '30d') matchesDate = diffDays <= 30;
      else if (filterDate === '60d') matchesDate = diffDays <= 60;
      else if (filterDate === '90d') matchesDate = diffDays <= 90;
    }
    return matchesSearch && matchesCategory && matchesLanguage && matchesWorkspace && matchesStatus && matchesDate;
  });

  const itemsPerPage = 10;
  const totalItems = filteredTemplates.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const activePage = Math.min(currentPage, totalPages);
  const startIndex = (activePage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
  const currentTemplates = filteredTemplates.slice(startIndex, endIndex);

  // ── Render ─────────────────────────────────────────────
  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <Toast toast={toast} onClose={() => setToast(null)} />
      <style>{`
        .hover-highlight-light:hover { background: #1a2e4a !important; }
      `}</style>

      {/* Header */}
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>Template Management</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Create, submit and track Meta WhatsApp template approvals</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleBulkSyncTemplates}
            disabled={bulkSyncLoading}
            style={{ background: C.card, border: `1px solid ${C.border}`, color: C.text, padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: bulkSyncLoading ? 'not-allowed' : 'pointer' }}
          >
            <RefreshCw size={13} className={bulkSyncLoading ? 'animate-spin' : ''} style={{ animation: bulkSyncLoading ? 'spin 1s linear infinite' : 'none' }} />
            {bulkSyncLoading ? 'Syncing...' : 'Sync from Meta'}
          </button>
          <button
            onClick={() => setShowBuilder(true)}
            style={{ background: C.accent, border: 'none', color: '#fff', padding: '9px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 4px 20px ${C.accent}40` }}
          >
            <Plus size={13} /> Create Template
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#2d1010', border: '1px solid #7c2d12', borderRadius: 8, padding: 12, marginBottom: 18, color: '#ef4444', fontSize: 12 }}>
          Error loading templates: {error}
        </div>
      )}

      {/* Stats */}
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 22 }}>
        {[
          ['Approved', templates.filter(t => t.status === 'approved').length, C.green],
          ['Pending', templates.filter(t => t.status === 'pending').length, C.accent],
          ['Rejected', templates.filter(t => t.status === 'rejected').length, C.red],
          ['Draft', templates.filter(t => t.status === 'draft').length, C.muted],
        ].map(([l, v, col]) => (
          <div key={l} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '13px 18px', flex: 1 }}>
            <p style={{ fontSize: 10, color: C.muted, marginBottom: 5 }}>{l}</p>
            <p style={{ fontSize: 22, fontWeight: 700, color: col, fontFamily: "'Syne',sans-serif" }}>{v}</p>
          </div>
        ))}
      </div>

      {/* Filters Row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'center' }} className="flex-col-mobile">
        
        {/* Fuzzy Search */}
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <input
            type="text"
            placeholder="Search templates..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%', background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '8px 12px 8px 36px', fontSize: 12, color: C.text,
              outline: 'none', fontFamily: "'DM Sans', sans-serif"
            }}
          />
          <Search size={14} color={C.muted} style={{ position: 'absolute', left: 12, top: 10 }} />
        </div>

        {/* Category */}
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text,
            outline: 'none', minWidth: 120, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif"
          }}
        >
          <option value="all">Category</option>
          <option value="marketing">Marketing</option>
          <option value="utility">Utility</option>
          <option value="authentication">Authentication</option>
        </select>

        {/* Language */}
        <select
          value={filterLanguage}
          onChange={(e) => setFilterLanguage(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text,
            outline: 'none', minWidth: 120, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif"
          }}
        >
          <option value="all">Language</option>
          {LANGUAGES.map(language => <option key={language.code} value={language.code}>{language.label}</option>)}
        </select>

        <select value={filterWorkspace} onChange={(e) => setFilterWorkspace(e.target.value)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text, outline: 'none', minWidth: 125, cursor: 'pointer' }}>
          <option value="all">Workspace</option>
          <option value="leados">LeadOS</option>
          <option value="alliance">AllianceOS</option>
          <option value="shared">Shared</option>
        </select>

        {/* Status Custom Multi-Select Dropdown */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => setShowStatusDropdown(!showStatusDropdown)}
            style={{
              background: C.card, border: `1px solid ${C.border}`,
              borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text,
              outline: 'none', minWidth: 150, cursor: 'pointer', display: 'flex',
              justifyContent: 'space-between', alignItems: 'center', gap: 8,
              fontFamily: "'DM Sans', sans-serif"
            }}
          >
            <span>
              {filterStatuses.length === 0 
                ? 'Status' 
                : `${filterStatuses.length} selected`}
            </span>
            <ChevronDown size={14} color={C.muted} />
          </button>
          
          {showStatusDropdown && (
            <>
              <div 
                style={{ position: 'fixed', inset: 0, zIndex: 99, background: 'transparent' }} 
                onClick={() => setShowStatusDropdown(false)} 
              />
              <div style={{
                position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100,
                background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
                padding: 6, width: 220, maxHeight: 260, overflowY: 'auto',
                boxShadow: '0 10px 35px rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', gap: 2
              }}>
                <div 
                  onClick={() => {
                    if (filterStatuses.length === statusOptions.length) {
                      setFilterStatuses([]);
                    } else {
                      setFilterStatuses([...statusOptions]);
                    }
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                    borderRadius: 6, cursor: 'pointer', fontSize: 11, color: C.text,
                    background: 'transparent', userSelect: 'none'
                  }}
                  className="hover-highlight-light"
                >
                  <input 
                    type="checkbox" 
                    checked={filterStatuses.length === statusOptions.length}
                    style={{ accentColor: C.accent, cursor: 'pointer' }}
                    readOnly 
                  />
                  <span style={{ fontWeight: 700 }}>Select all</span>
                </div>
                
                <div style={{ borderTop: `1px solid ${C.border}`, margin: '4px 0' }} />

                {statusOptions.map(opt => {
                  const checked = filterStatuses.includes(opt);
                  return (
                    <div
                      key={opt}
                      onClick={() => {
                        if (checked) {
                          setFilterStatuses(filterStatuses.filter(s => s !== opt));
                        } else {
                          setFilterStatuses([...filterStatuses, opt]);
                        }
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
                        borderRadius: 6, cursor: 'pointer', fontSize: 11, color: C.text,
                        background: 'transparent', userSelect: 'none'
                      }}
                      className="hover-highlight-light"
                    >
                      <input 
                        type="checkbox" 
                        checked={checked} 
                        style={{ accentColor: C.accent, cursor: 'pointer' }}
                        readOnly 
                      />
                      <span>{opt}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>

        {/* Date Filter */}
        <select
          value={filterDate}
          onChange={(e) => setFilterDate(e.target.value)}
          style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 12px', fontSize: 12, color: C.text,
            outline: 'none', minWidth: 130, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif"
          }}
        >
          <option value="all">Date Filter</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="60d">Last 60 days</option>
          <option value="90d">Last 90 days</option>
        </select>
      </div>

      {/* Table */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10, padding: '10px 12px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10 }}>
        <strong style={{ color: C.text, fontSize: 11 }}>{selectedTemplateIds.length} selected</strong>
        <select value={bulkWorkspace} onChange={(e) => setBulkWorkspace(e.target.value)} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 7, color: C.text, padding: '7px 10px', fontSize: 11 }}>
          <option value="leados">Move to LeadOS</option>
          <option value="alliance">Move to AllianceOS</option>
          <option value="shared">Make Shared</option>
        </select>
        <button onClick={handleBulkWorkspaceUpdate} disabled={!selectedTemplateIds.length || bulkWorkspaceLoading} style={{ background: C.accent, border: 'none', borderRadius: 7, color: '#fff', padding: '7px 12px', fontSize: 11, fontWeight: 700, cursor: selectedTemplateIds.length ? 'pointer' : 'not-allowed', opacity: selectedTemplateIds.length ? 1 : 0.5 }}>
          {bulkWorkspaceLoading ? 'Updating...' : 'Apply Workspace'}
        </button>
        <span style={{ color: C.muted, fontSize: 10 }}>Use Workspace column below to verify where each template will appear.</span>
      </div>
      <div className="table-responsive" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: '11px 10px', textAlign: 'center' }}>
                <input type="checkbox" checked={currentTemplates.length > 0 && currentTemplates.every((template) => selectedTemplateIds.includes(template.id))} onChange={(e) => {
                  const pageIds = currentTemplates.map((template) => template.id);
                  setSelectedTemplateIds((current) => e.target.checked ? [...new Set([...current, ...pageIds])] : current.filter((id) => !pageIds.includes(id)));
                }} style={{ accentColor: C.accent }} title="Select all templates on this page" />
              </th>
              {['Template Name', 'Workspace', 'Category', 'Brand', 'Status', 'Submitted', 'Approved', 'Uses', 'Actions'].map(h => (
                <th key={h} style={{ padding: '11px 14px', fontSize: 9, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentTemplates.map(t => (
              <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                <td style={{ padding: '13px 10px', textAlign: 'center' }}><input type="checkbox" checked={selectedTemplateIds.includes(t.id)} onChange={(e) => setSelectedTemplateIds((current) => e.target.checked ? [...new Set([...current, t.id])] : current.filter((id) => id !== t.id))} style={{ accentColor: C.accent }} /></td>
                <td style={{ padding: '13px 14px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, color: C.accent, background: C.accent + '10', padding: '2px 7px', borderRadius: 5 }}>{t.name}</span>
                </td>
                <td style={{ padding: '13px 14px', fontSize: 10, color: t.template_scope === 'alliance' ? C.purple : t.template_scope === 'shared' ? C.muted : C.accent, fontWeight: 700, textTransform: 'capitalize' }}>{t.template_scope || 'shared'}</td>
                <td style={{ padding: '13px 14px' }}>
                  <span style={{ fontSize: 10, color: C.blue, background: '#0f1e38', padding: '2px 7px', borderRadius: 10 }}>{t.category || t.cat}</span>
                </td>
                <td style={{ padding: '13px 14px', fontSize: 11, color: C.muted }}>{t.brand_name || t.brand || '—'}</td>
                <td style={{ padding: '13px 14px' }}><TBadge status={t.status} /></td>
                <td style={{ padding: '13px 14px', fontSize: 10, color: C.dim }}>{t.submitted_at ? new Date(t.submitted_at).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '13px 14px', fontSize: 10, color: t.approved_at ? C.green : C.dim }}>{t.approved_at ? new Date(t.approved_at).toLocaleDateString() : '—'}</td>
                <td style={{ padding: '13px 14px', fontSize: 12, color: C.text, fontWeight: 600 }}>{t.uses || 0}</td>
                <td style={{ padding: '13px 14px' }}>
                  <div style={{ display: 'flex', gap: 5 }}>
                    {t.status === 'draft' && (
                      <button
                        onClick={() => handleSubmitTemplate(t.id)}
                        disabled={submitLoading === t.id}
                        style={{ background: C.accent + '20', border: `1px solid ${C.accentDim}`, borderRadius: 5, color: C.accent, padding: '3px 9px', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        {submitLoading === t.id ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                        Submit
                      </button>
                    )}
                    {t.status === 'rejected' && (
                      <button onClick={() => handleEditTemplate(t)} style={{ background: 'transparent', border: `1px solid ${C.red}40`, borderRadius: 5, color: C.red, padding: '3px 9px', fontSize: 9, cursor: 'pointer' }}>Edit & Resubmit</button>
                    )}
                    {t.status !== 'draft' && (
                      <button
                        onClick={() => handleSyncTemplate(t.id)}
                        disabled={syncLoading === t.id}
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '3px 9px', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        {syncLoading === t.id ? <Loader2 size={9} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                        Check Status
                      </button>
                    )}
                    <button
                      onClick={() => setPreviewTemplate(t)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.muted, padding: '3px 9px', fontSize: 9, cursor: 'pointer' }}
                    >Preview</button>
                    <a
                      href={`${api.baseUrl}/api/templates/${t.id}/campaign-sheet`}
                      download
                      title="Download an Excel recipient sheet with columns matching this template's parameters"
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.green, padding: '3px 9px', fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, textDecoration: 'none' }}
                    ><Download size={9} /> Excel</a>
                    <button
                      onClick={() => handleEditTemplate(t)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.blue, padding: '3px 9px', fontSize: 9, cursor: 'pointer' }}
                    >Edit</button>
                    <button
                      onClick={() => handleOpenDeleteModal(t)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.red, padding: '3px 9px', fontSize: 9, cursor: 'pointer' }}
                    >Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {/* Pagination Bar */}
        {totalItems > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: `1px solid ${C.border}`, background: C.surface }}>
            <div style={{ fontSize: 11, color: C.muted }}>
              Showing <span style={{ color: C.text, fontWeight: 600 }}>{totalItems === 0 ? 0 : startIndex + 1}</span> to <span style={{ color: C.text, fontWeight: 600 }}>{endIndex}</span> of <span style={{ color: C.text, fontWeight: 600 }}>{totalItems}</span> templates
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={activePage === 1}
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  color: activePage === 1 ? C.dim : C.text,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: activePage === 1 ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Previous
              </button>

              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1;
                if (totalPages > 5 && Math.abs(pageNum - activePage) > 2 && pageNum !== 1 && pageNum !== totalPages) {
                  if (pageNum === 2 || pageNum === totalPages - 1) {
                    return <span key={pageNum} style={{ color: C.muted, padding: '0 4px', fontSize: 11 }}>...</span>;
                  }
                  return null;
                }

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    style={{
                      background: activePage === pageNum ? C.accent : 'transparent',
                      border: activePage === pageNum ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
                      borderRadius: 6,
                      color: activePage === pageNum ? '#fff' : C.text,
                      minWidth: 26,
                      height: 26,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.2s'
                    }}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={activePage === totalPages}
                style={{
                  background: 'transparent',
                  border: `1px solid ${C.border}`,
                  borderRadius: 6,
                  color: activePage === totalPages ? C.dim : C.text,
                  padding: '5px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: activePage === totalPages ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {templates.length === 0 && !tableLoading && <div style={{ textAlign: 'center', padding: 32, color: C.muted }}>No templates found. Create your first one!</div>}
        {tableLoading && (
          <div style={{ textAlign: 'center', padding: 32, color: C.muted, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading templates...
          </div>
        )}
      </div>

      {/* ── DELETE CONFIRMATION MODAL ─────────────────────── */}
      {templateToDelete && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          backdropFilter: 'blur(4px)'
        }} onClick={() => setTemplateToDelete(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14,
              width: '100%', maxWidth: 400,
              animation: 'fadeIn 0.2s ease', overflow: 'hidden'
            }}
          >
            <div style={{ padding: '24px 24px 16px' }}>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 18, fontWeight: 700, color: C.text, marginBottom: 8 }}>Delete Template?</h3>
              <p style={{ color: C.muted, fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
                Are you sure you want to delete <strong style={{ color: C.accent }}>{templateToDelete.name}</strong>? This action cannot be undone.
              </p>
              <p style={{ color: C.muted, fontSize: 12, marginBottom: 8 }}>
                Please type <strong style={{ color: C.text }}>delete-my-template</strong> to confirm.
              </p>
              <input
                type="text"
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                placeholder="delete-my-template"
                style={{
                  width: '100%',
                  background: 'rgba(0,0,0,0.2)',
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  padding: '10px 12px',
                  color: C.text,
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                onClick={() => setTemplateToDelete(null)}
                style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={confirmDeleteTemplate}
                disabled={deleteConfirmText !== 'delete-my-template' || deleteLoading}
                style={{ background: C.red, border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: deleteConfirmText === 'delete-my-template' && !deleteLoading ? 'pointer' : 'not-allowed', opacity: deleteConfirmText === 'delete-my-template' && !deleteLoading ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 6 }}
              >
                {deleteLoading && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />}
                {deleteLoading ? 'Deleting...' : 'Yes, Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── TEMPLATE PREVIEW MODAL ─────────────────────── */}
      {previewTemplate && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          backdropFilter: 'blur(4px)'
        }} onClick={() => setPreviewTemplate(null)}>
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 18,
              width: '100%', maxWidth: 520, maxHeight: '90vh',
              animation: 'fadeIn 0.2s ease', overflowY: 'auto'
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', borderBottom: `1px solid ${C.border}` }}>
              <div>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 700, color: C.text }}>
                  <span style={{ fontFamily: 'monospace', color: C.accent }}>{previewTemplate.name}</span>
                </h3>
                <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                  <span style={{ fontSize: 10, color: C.blue, background: '#0f1e38', padding: '2px 8px', borderRadius: 10 }}>{previewTemplate.category}</span>
                  <span style={{ fontSize: 10, color: C.muted, background: C.card, padding: '2px 8px', borderRadius: 10 }}>{previewTemplate.language || 'en'}</span>
                  <TBadge status={previewTemplate.status} />
                </div>
              </div>
              <button onClick={() => setPreviewTemplate(null)} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: '6px 10px' }}>
                <X size={15} />
              </button>
            </div>

            {/* Preview content */}
            <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
              <WaPreview form={{
                name: previewTemplate.name,
                category: previewTemplate.category,
                header_format: previewTemplate.header_format || 'NONE',
                header: previewTemplate.header || '',
                body: previewTemplate.body || '',
                footer: previewTemplate.footer || '',
                buttons: (() => { try { return typeof previewTemplate.buttons === 'string' ? JSON.parse(previewTemplate.buttons) : (previewTemplate.buttons || []); } catch { return []; } })()
              }} />
            </div>

            {/* Template details */}
            <div style={{ padding: '0 24px 20px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {previewTemplate.brand_name && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11, alignItems: 'center' }}>
                  <span style={{ color: C.muted, minWidth: 80 }}>Brand:</span>
                  <span style={{ color: C.text }}>{previewTemplate.brand_name}</span>
                </div>
              )}
              {previewTemplate.submitted_at && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                  <span style={{ color: C.muted, minWidth: 80 }}>Submitted:</span>
                  <span style={{ color: C.text }}>{new Date(previewTemplate.submitted_at).toLocaleString()}</span>
                </div>
              )}
              {previewTemplate.approved_at && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                  <span style={{ color: C.green, minWidth: 80 }}>Approved:</span>
                  <span style={{ color: C.green }}>{new Date(previewTemplate.approved_at).toLocaleString()}</span>
                </div>
              )}
              {previewTemplate.meta_template_id && (
                <div style={{ display: 'flex', gap: 8, fontSize: 11 }}>
                  <span style={{ color: C.muted, minWidth: 80 }}>Meta ID:</span>
                  <span style={{ color: C.dim, fontFamily: 'monospace' }}>{previewTemplate.meta_template_id}</span>
                </div>
              )}
            </div>

            <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              {previewTemplate.status === 'draft' && (
                <button
                  onClick={() => { handleSubmitTemplate(previewTemplate.id); setPreviewTemplate(null); }}
                  style={{ background: C.accent, border: 'none', color: '#fff', padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  Submit to Meta
                </button>
              )}
              <button
                onClick={() => setPreviewTemplate(null)}
                style={{ background: C.card, border: `1px solid ${C.border}`, color: C.muted, padding: '8px 18px', borderRadius: 8, fontSize: 12, fontWeight: 600 }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── BUILDER MODAL ──────────────────────────────── */}
      {showBuilder && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          backdropFilter: 'blur(4px)'
        }}>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes fadeIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>
          <div style={{
            background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 18,
            width: '100%', maxWidth: 1000, maxHeight: '92vh', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', animation: 'fadeIn 0.25s ease'
          }}>
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: `1px solid ${C.border}` }}>
              <div>
                <h2 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, color: C.text }}>Create WhatsApp Template</h2>
                <p style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>Build your template with live preview</p>
              </div>
              <button onClick={() => { setShowBuilder(false); setForm(defaultForm); setEditingId(null); }} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: '6px 10px' }}>
                <X size={15} />
              </button>
            </div>

            {/* Modal body — two columns */}
            <div className="flex-col-mobile" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

              {/* LEFT: Builder */}
              <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Category */}
                <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Created For *</label>
                  <select style={inp()} value={form.template_scope} onChange={e => setForm(f => ({ ...f, template_scope: e.target.value, parameter_definitions: { body: {}, header: {} } }))}>
                    <option value="leados">LeadOS — map from lead fields</option>
                    <option value="alliance">AllianceOS — map from prospect fields</option>
                    <option value="shared">Shared — configure when sending</option>
                  </select>
                  <p style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Templates remain in this common library; this controls which campaign builder and fields they use.</p>
                </div>

                {form.template_scope === 'alliance' && <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>AllianceOS Audience *</label>
                  <select style={inp()} value={form.alliance_audience} onChange={e => setForm(f => ({ ...f, alliance_audience: e.target.value, parameter_definitions: { body: {}, header: {} } }))}>
                    <option value="">Select audience</option>
                    {allianceAudiences.map((audience) => <option key={audience.code} value={audience.code}>{audience.label}</option>)}
                  </select>
                  <p style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Variable sources below load from this audience's current system and custom columns.</p>
                </div>}

                {/* Category */}
                <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 10 }}>Category *</label>
                  <div className="flex-col-mobile" style={{ display: 'flex', gap: 10 }}>
                    {[
                      { key: 'MARKETING', label: 'Marketing', desc: 'Promotions & offers', color: C.accent, icon: '📢' },
                      { key: 'UTILITY', label: 'Utility', desc: 'Order & transactional', color: C.blue, icon: '🔔' },
                      { key: 'AUTHENTICATION', label: 'Authentication', desc: 'OTP & verification', color: C.green, icon: '🔐' },
                    ].map(({ key, label, desc, color, icon }) => {
                      const active = form.category === key;
                      return (
                        <button
                          key={key}
                          onClick={() => handleCategoryChange(key)}
                          style={{
                            flex: 1, padding: '12px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                            background: active ? color + '15' : C.card,
                            border: `1.5px solid ${active ? color : C.border}`,
                            transition: 'all 0.15s'
                          }}
                        >
                          <div style={{ fontSize: 18, marginBottom: 5 }}>{icon}</div>
                          <p style={{ fontSize: 12, fontWeight: 700, color: active ? color : C.text }}>{label}</p>
                          <p style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{desc}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Name & Language */}
                <div className="flex-col-mobile" style={{ display: 'flex', gap: 14 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Template Name *</label>
                    <input
                      style={inp()}
                      placeholder="e.g. promo_offer_v1"
                      value={form.name}
                      onChange={e => setForm(f => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                    />
                    <p style={{ fontSize: 10, color: C.muted, marginTop: 4 }}>Lowercase letters, numbers, underscores only</p>
                  </div>
                  <div style={{ width: 160 }}>
                    <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Language *</label>
                    <div style={{ position: 'relative' }}>
                      <select
                        style={{ ...inp(), appearance: 'none', paddingRight: 28 }}
                        value={form.language}
                        onChange={e => setForm(f => ({ ...f, language: e.target.value }))}
                      >
                        {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                      </select>
                      <ChevronDown size={12} color={C.muted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                    </div>
                  </div>
                </div>

                {/* Brand */}
                <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Brand (Optional)</label>
                  <div style={{ position: 'relative' }}>
                    <select
                      style={{ ...inp(), appearance: 'none', paddingRight: 28 }}
                      value={form.client_id}
                      onChange={e => setForm(f => ({ ...f, client_id: e.target.value }))}
                    >
                      <option value="">— No specific brand —</option>
                      {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown size={12} color={C.muted} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                  </div>
                </div>

                {/* Header */}
                <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 8 }}>Header (Optional)</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                    {availableHeaderFormats.map(fmt => {
                      const active = form.header_format === fmt;
                      const icons = { NONE: <X size={11} />, TEXT: <Type size={11} />, IMAGE: <Image size={11} />, VIDEO: <Video size={11} />, DOCUMENT: <FileText size={11} /> };
                      return (
                        <button
                          key={fmt}
                          onClick={() => setForm(f => ({ ...f, header_format: fmt, header: fmt === 'NONE' || fmt !== f.header_format ? '' : f.header, media_preview: fmt !== f.header_format ? null : f.media_preview }))}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 20, fontSize: 11, fontWeight: 600,
                            background: active ? C.accent + '20' : C.card,
                            border: `1.5px solid ${active ? C.accent : C.border}`,
                            color: active ? C.accent : C.muted, cursor: 'pointer', transition: 'all 0.15s'
                          }}
                        >
                          {icons[fmt]} {fmt}
                        </button>
                      );
                    })}
                  </div>
                  {form.header_format === 'TEXT' && (
                    <input
                      style={inp()}
                      placeholder="Enter header text (max 60 chars)"
                      maxLength={60}
                      value={form.header}
                      onChange={e => setForm(f => ({ ...f, header: e.target.value }))}
                    />
                  )}
                  {['IMAGE', 'VIDEO', 'DOCUMENT'].includes(form.header_format) && (
                    <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '14px', textAlign: 'center', marginTop: 8 }}>
                      {form.header && form.header.startsWith('h:') ? (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                          <Check size={20} color={C.green} />
                          <p style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Media Sample Uploaded</p>
                          <p style={{ fontSize: 10, color: C.dim, fontFamily: 'monospace', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.header}</p>
                          <button onClick={() => setForm(f => ({ ...f, header: '', media_preview: null }))} style={{ background: 'transparent', border: `1px solid ${C.red}40`, color: C.red, padding: '4px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer', marginTop: 4 }}>Remove</button>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                          <p style={{ fontSize: 11, color: C.muted }}>Upload a sample {form.header_format.toLowerCase()} for Meta approval.</p>
                          <label style={{
                            background: mediaUploading ? C.card : C.accent, border: mediaUploading ? `1px solid ${C.border}` : 'none', color: mediaUploading ? C.muted : '#fff', padding: '7px 16px', borderRadius: 8, fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: mediaUploading ? 'not-allowed' : 'pointer'
                          }}>
                            {mediaUploading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : (form.header_format === 'IMAGE' ? <Image size={13} /> : form.header_format === 'VIDEO' ? <Video size={13} /> : <FileText size={13} />)}
                            {mediaUploading ? 'Uploading...' : `Upload ${form.header_format}`}
                            <input
                              type="file"
                              accept={form.header_format === 'IMAGE' ? 'image/*' : form.header_format === 'VIDEO' ? 'video/mp4' : 'application/pdf'}
                              style={{ display: 'none' }}
                              onChange={handleMediaUpload}
                              disabled={mediaUploading}
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Body */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Message Body *</label>
                    <span style={{ fontSize: 10, color: C.dim }}>{form.body.length}/1024</span>
                  </div>
                  <textarea
                    style={{ ...inp(), resize: 'vertical', minHeight: 120, lineHeight: 1.6 }}
                    placeholder="Enter your message. Use {{1}}, {{2}} for variables."
                    maxLength={1024}
                    value={form.body}
                    onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
                  />
                  <p style={{ fontSize: 10, color: C.dim, marginTop: 4 }}>Use <code style={{ color: C.accent, background: C.accent + '10', padding: '1px 4px', borderRadius: 3 }}>{'{{1}}'}</code> for dynamic variables</p>
                  
                  {(() => {
                    const matches = form.body.match(/\{\{(\d+)\}\}/g);
                    const maxVar = matches ? Math.max(...matches.map(m => parseInt(m.replace(/\D/g, '')))) : 0;
                    if (maxVar > 0) {
                      return (
                        <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '14px', marginTop: 12 }}>
                          <h4 style={{ fontSize: 12, color: C.text, fontWeight: 700, marginBottom: 4 }}>Variable definitions</h4>
                          <p style={{ fontSize: 10, color: C.muted, marginBottom: 12 }}>Name what each variable means, choose its usual data source, and provide Meta's review sample.</p>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {Array.from({ length: maxVar }).map((_, i) => (
                              <div key={i} style={{ display: 'grid', gridTemplateColumns: '45px 1fr 150px 1fr', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 45, textAlign: 'center', fontSize: 11, fontWeight: 600, color: C.muted, background: C.surface, padding: '6px 0', borderRadius: 6, border: `1px solid ${C.border}` }}>
                                  {`{{${i + 1}}}`}
                                </div>
                                <input
                                  style={{ ...inp(), padding: '6px 10px' }}
                                  placeholder={`Meaning, e.g. Candidate name`}
                                  value={form.parameter_definitions?.body?.[String(i + 1)]?.label || ''}
                                  onChange={e => setForm(f => ({
                                    ...f,
                                    parameter_definitions: {
                                      ...(f.parameter_definitions || {}),
                                      body: {
                                        ...(f.parameter_definitions?.body || {}),
                                        [String(i + 1)]: {
                                          ...(f.parameter_definitions?.body?.[String(i + 1)] || {}),
                                          label: e.target.value,
                                          default_source: f.parameter_definitions?.body?.[String(i + 1)]?.default_source || defaultParameterSource(f.template_scope, i)
                                        }
                                      }
                                    }
                                  }))}
                                />
                                <select
                                  style={{ ...inp(), padding: '6px 8px' }}
                                  value={form.parameter_definitions?.body?.[String(i + 1)]?.default_source || defaultParameterSource(form.template_scope, i)}
                                  onChange={e => setForm(f => ({
                                    ...f,
                                    parameter_definitions: {
                                      ...(f.parameter_definitions || {}),
                                      body: {
                                        ...(f.parameter_definitions?.body || {}),
                                        [String(i + 1)]: {
                                          ...(f.parameter_definitions?.body?.[String(i + 1)] || {}),
                                          label: f.parameter_definitions?.body?.[String(i + 1)]?.label || '',
                                          default_source: e.target.value
                                        }
                                      }
                                    }
                                  }))}
                                >
                                  {(form.template_scope === 'shared'
                                    ? [...PARAMETER_SOURCE_OPTIONS.leados, ...PARAMETER_SOURCE_OPTIONS.alliance.filter(([value]) => !PARAMETER_SOURCE_OPTIONS.leados.some(([leadValue]) => leadValue === value))]
                                    : form.template_scope === 'alliance' ? allianceParameterOptions : PARAMETER_SOURCE_OPTIONS[form.template_scope]
                                  ).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                                </select>
                                <input
                                  style={{ ...inp(), padding: '6px 10px' }}
                                  placeholder={`Meta sample for {{${i + 1}}}`}
                                  value={form.samples?.[i] || ''}
                                  onChange={e => {
                                    const newSamples = [...(form.samples || [])];
                                    newSamples[i] = e.target.value;
                                    setForm(f => ({ ...f, samples: newSamples }));
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  })()}
                </div>

                {/* Footer */}
                <div>
                  <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, display: 'block', marginBottom: 6 }}>Footer (Optional)</label>
                  <input
                    style={inp()}
                    placeholder="e.g. Reply STOP to unsubscribe"
                    maxLength={60}
                    value={form.footer}
                    onChange={e => setForm(f => ({ ...f, footer: e.target.value }))}
                  />
                </div>

                {/* Buttons */}
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                    <label style={{ fontSize: 11, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8 }}>Buttons (Optional, max 3)</label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => addButton('QUICK_REPLY')}
                        disabled={form.buttons.length >= 3}
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: '4px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <MessageSquare size={10} /> Quick Reply
                      </button>
                      <button
                        onClick={() => addButton('URL')}
                        disabled={form.buttons.length >= 3}
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: '4px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Link size={10} /> URL
                      </button>
                      <button
                        onClick={() => addButton('PHONE_NUMBER')}
                        disabled={form.buttons.length >= 3}
                        style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.muted, padding: '4px 10px', fontSize: 10, display: 'flex', alignItems: 'center', gap: 4 }}
                      >
                        <Phone size={10} /> Phone Number
                      </button>
                    </div>
                  </div>
                  <div style={{ background: `${C.blue}0D`, border: `1px solid ${C.blue}30`, borderRadius: 8, padding: '10px 12px', marginBottom: 10, display: 'grid', gap: 5 }}>
                    <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', lineHeight: 1.6 }}><strong style={{ color: C.green }}>Quick Reply:</strong> Sends the button label back as a WhatsApp reply. It does not call a number or open a website.</p>
                    <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', lineHeight: 1.6 }}><strong style={{ color: C.blue }}>URL:</strong> Opens the specified website in the device browser. Use a complete address beginning with <code style={{ color: '#f1f5f9', background: '#172033', border: `1px solid ${C.border}`, padding: '1px 5px', borderRadius: 4 }}>https://</code>.</p>
                    <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', lineHeight: 1.6 }}><strong style={{ color: C.accent }}>Phone Number:</strong> Opens the device dialer with the number pre-filled. Use the international country code; 10-digit Indian numbers receive <code style={{ color: '#f1f5f9', background: '#172033', border: `1px solid ${C.border}`, padding: '1px 5px', borderRadius: 4 }}>+91</code> automatically.</p>
                  </div>
                  {form.buttons.length === 0 && (
                    <div style={{ background: C.card, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '12px', textAlign: 'center', color: C.dim, fontSize: 11 }}>
                      No buttons added. Add a Quick Reply, URL, or Phone Number button.
                    </div>
                  )}
                  {form.buttons.map((btn, i) => (
                    <div key={i} style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ fontSize: 10, color: btn.type === 'URL' ? C.blue : btn.type === 'PHONE_NUMBER' ? C.accent : C.green, fontWeight: 600 }}>
                          {btn.type === 'URL' ? '🔗 URL Button' : btn.type === 'PHONE_NUMBER' ? '📞 Phone Number Button' : '💬 Quick Reply'}
                        </span>
                        <button onClick={() => removeButton(i)} style={{ background: 'none', border: 'none', color: C.red, padding: 0 }}><Trash2 size={12} /></button>
                      </div>
                      <input
                        style={{ ...inp(), marginBottom: ['URL', 'PHONE_NUMBER'].includes(btn.type) ? 8 : 0 }}
                        placeholder="Button label"
                        value={btn.text}
                        onChange={e => updateButton(i, 'text', e.target.value)}
                      />
                      {btn.type === 'URL' && (
                        <input
                          style={inp()}
                          placeholder="https://example.com"
                          value={btn.url || ''}
                          onChange={e => updateButton(i, 'url', e.target.value)}
                        />
                      )}
                      {btn.type === 'PHONE_NUMBER' && (
                        <>
                          <input
                            type="tel"
                            style={inp()}
                            placeholder="+918807226257"
                            value={btn.phone_number || ''}
                            onChange={e => updateButton(i, 'phone_number', e.target.value)}
                          />
                          <p style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>10-digit Indian numbers automatically receive the +91 country code.</p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* RIGHT: Preview */}
              <div style={{ width: 300, borderLeft: `1px solid ${C.border}`, padding: '20px 18px', overflowY: 'auto', background: '#090f1a' }}>
                <WaPreview form={form} />
              </div>
            </div>

            {/* Modal footer */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '14px 24px', borderTop: `1px solid ${C.border}` }}>
              <button
                onClick={() => { setShowBuilder(false); setForm(defaultForm); setEditingId(null); }}
                style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, color: C.muted, padding: '9px 18px', fontSize: 12, fontWeight: 600 }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTemplate}
                disabled={submitting}
                style={{
                  background: submitting ? C.accentDim : C.accent, border: 'none', color: '#fff',
                  padding: '9px 22px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', gap: 7, cursor: submitting ? 'not-allowed' : 'pointer',
                  boxShadow: submitting ? 'none' : `0 4px 16px ${C.accent}40`
                }}
              >
                {submitting ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><Check size={13} /> {editingId ? 'Save Changes' : 'Save as Draft'}</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
