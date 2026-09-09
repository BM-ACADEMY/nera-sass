import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, ArrowRight, Bot, CalendarClock, Check, ChevronLeft, ChevronRight, FileText, Filter, Info, Mail, Plus, Search, Send, Sparkles, Trash2, Users } from 'lucide-react';
import { api } from '../../services/api.js';
import { DatePicker } from './DatePicker.jsx';
import { BulkSendLimitControl } from './BulkSendLimitControl.jsx';
import './alliance.css';

const EMPTY_FILTERS = { search: '', audience: '', industry: '', status: '', source: '', location: '', dateFrom: '', dateTo: '' };
const normalizeLineBreaks = (value = '') => String(value).replace(/\\r\\n|\\n|\\r/g, '\n');
const formatImportedDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-IN', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
};
const toLocalDateTimeInput = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const STEPS = [
  { id: 1, label: 'Campaign details', icon: FileText },
  { id: 2, label: 'Audience', icon: Users },
  { id: 3, label: 'Email content', icon: Mail },
  { id: 4, label: 'Schedule', icon: CalendarClock },
  { id: 5, label: 'Review', icon: Check },
];
const EMAIL_CAMPAIGN_DRAFT_KEY = 'alliance_email_campaign_builder_draft_v1';

const EmailClientPreview = ({ brand, senderEmail, recipientName, recipientEmail, subject, body }) => (
  <div className="al-email-preview">
    <div className="al-email-windowbar"><span className="al-window-dots"><i /><i /><i /></span><b>Message preview</b><span>Inbox</span></div>
    <div className="al-email-toolbar"><button type="button" aria-label="Back">←</button><span /><button type="button" aria-label="Archive">▣</button><button type="button" aria-label="More">•••</button></div>
    <div className="al-email-message-head">
      <h3>{subject || 'Your email subject'}</h3>
      <div className="al-email-sender-row">
        <span className="al-email-avatar">{String(brand || 'Alliance OS').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()}</span>
        <div className="al-email-addresses"><b>{brand || 'Alliance OS'}</b><span>&lt;{senderEmail || 'sender@example.com'}&gt;</span><small>to {recipientName || 'recipient'} &lt;{recipientEmail || 'recipient@example.com'}&gt; <i>⌄</i></small></div>
        <div className="al-email-meta"><span>Just now</span><button type="button" aria-label="Star">☆</button><button type="button" aria-label="Reply">↩</button></div>
      </div>
    </div>
    <div className="al-preview-body">{body || 'Start writing to preview your email here.'}</div>
    <div className="al-email-preview-foot"><button type="button">↩ Reply</button><button type="button">↪ Forward</button></div>
  </div>
);

export const EmailCampaignBuilder = () => {
  const navigate = useNavigate();
  const editorRef = useRef(null);
  const [step, setStep] = useState(1);
  const [options, setOptions] = useState({ audiences: [], industries: [], statuses: [], sources: [], locations: [], senders: [] });
  const [audienceConfigs, setAudienceConfigs] = useState([]);
  const [personalizationField, setPersonalizationField] = useState('name');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [prospects, setProspects] = useState([]);
  const [selectedLeads, setSelectedLeads] = useState({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [templates, setTemplates] = useState([]);
  const [activeTouch, setActiveTouch] = useState(0);
  const [brand, setBrand] = useState('');
  const [aiGenerated, setAiGenerated] = useState(false);
  const [form, setForm] = useState({ name: '', objective: '', sender_domain_id: '', launch_mode: 'immediate', scheduled_at: '' });
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [activeCampaigns, setActiveCampaigns] = useState([]);
  const [deleteTouchModal, setDeleteTouchModal] = useState(null);
  const [draftStatus, setDraftStatus] = useState('');
  const draftReadyRef = useRef(false);
  const restoredAudienceRef = useRef('');
  const latestDraftRef = useRef(null);
  const draftDiscardedRef = useRef(false);
  const limit = 10;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(EMAIL_CAMPAIGN_DRAFT_KEY) || 'null');
      if (saved && saved.version === 1) {
        if (saved.step) setStep(Math.min(Math.max(Number(saved.step), 1), 5));
        if (saved.form) setForm({ launch_mode: 'immediate', scheduled_at: '', ...saved.form });
        if (saved.filters) { setFilters({ ...EMPTY_FILTERS, ...saved.filters }); restoredAudienceRef.current = saved.filters.audience || ''; }
        if (Array.isArray(saved.templates)) setTemplates(saved.templates.map((template) => ({ ...template, body: normalizeLineBreaks(template.body) })));
        if (saved.selectedLeads && typeof saved.selectedLeads === 'object') setSelectedLeads(saved.selectedLeads);
        if (Number.isInteger(saved.activeTouch)) setActiveTouch(Math.max(0, saved.activeTouch));
        if (saved.brand) setBrand(saved.brand);
        if (saved.aiGenerated) setAiGenerated(true);
        setDraftStatus('Draft restored');
      }
    } catch {
      localStorage.removeItem(EMAIL_CAMPAIGN_DRAFT_KEY);
    } finally {
      draftReadyRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!draftReadyRef.current) return undefined;
    const hasContent = Boolean(form.name?.trim() || filters.audience || Object.keys(selectedLeads).length || step > 1);
    if (!hasContent) {
      latestDraftRef.current = null;
      localStorage.removeItem(EMAIL_CAMPAIGN_DRAFT_KEY);
      return undefined;
    }
    draftDiscardedRef.current = false;
    const compactSelected = Object.fromEntries(Object.entries(selectedLeads).map(([id, lead]) => [id, {
      id: lead.id, name: lead.name, business_name: lead.business_name, email: lead.email,
      phone: lead.phone, location: lead.location, industry: lead.industry, audience: lead.audience,
      status: lead.status, source: lead.source, channel: lead.channel, channel_pref: lead.channel_pref, consent: lead.consent,
      consent_source: lead.consent_source, ai_score: lead.ai_score,
      custom_fields: lead.custom_fields, created_at: lead.created_at
    }]));
    const snapshot = {
      version: 1, savedAt: new Date().toISOString(), step, form, filters, templates,
      selectedLeads: compactSelected, activeTouch, brand, aiGenerated
    };
    latestDraftRef.current = snapshot;
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(EMAIL_CAMPAIGN_DRAFT_KEY, JSON.stringify(snapshot));
        setDraftStatus('Draft saved');
      } catch {
        setDraftStatus('Draft could not be saved');
      }
    }, 500);
    return () => window.clearTimeout(timer);
  }, [step, form, filters, templates, selectedLeads, activeTouch, brand, aiGenerated]);

  useEffect(() => () => {
    if (!draftDiscardedRef.current && latestDraftRef.current) {
      try { localStorage.setItem(EMAIL_CAMPAIGN_DRAFT_KEY, JSON.stringify(latestDraftRef.current)); } catch { /* Keep navigation available if browser storage is full. */ }
    }
  }, []);

  useEffect(() => {
    api.getAllianceAudiences().then((data) => setAudienceConfigs(data.audiences || [])).catch((error) => toast.error(error.message));
  }, []);

  useEffect(() => {
    api.getAllianceCampaignBuilderOptions({ audience: filters.audience }).then((data) => {
      setOptions(data);
      if (data.senders?.length === 1) setForm((current) => ({ ...current, sender_domain_id: current.sender_domain_id || String(data.senders[0].id) }));
    }).catch((error) => toast.error(error.message));
  }, [filters.audience]);

  useEffect(() => {
    let mounted = true;
    const loadActiveCampaigns = async () => {
      try {
        const data = await api.getAllianceCampaigns();
        if (mounted) setActiveCampaigns((data.campaigns || []).filter((campaign) => ['scheduled', 'running', 'paused'].includes(campaign.status)));
      } catch {
        // Campaign creation remains available if the monitoring request fails.
      }
    };
    loadActiveCampaigns();
    const interval = window.setInterval(loadActiveCampaigns, 10000);
    return () => { mounted = false; window.clearInterval(interval); };
  }, []);

  const loadProspects = useCallback(async () => {
    if (!filters.audience) { setProspects([]); setTotal(0); return; }
    setLoading(true);
    try {
      const data = await api.getAllianceCampaignProspects({ ...filters, limit, offset: (page - 1) * limit });
      setProspects(data.prospects || []);
      setTotal(data.total || 0);
    } catch (error) { toast.error(error.message || 'Failed to load leads'); }
    finally { setLoading(false); }
  }, [filters, page]);

  useEffect(() => { loadProspects(); }, [loadProspects]);
  useEffect(() => {
    if (!filters.audience) {
      if (restoredAudienceRef.current) return;
      setTemplates([]); setBrand(''); return;
    }
    if (restoredAudienceRef.current === filters.audience) {
      restoredAudienceRef.current = '';
      return;
    }
    api.getAllianceCampaignTemplates(filters.audience).then((data) => {
      setTemplates((data.templates || []).map((template) => ({ ...template, body: normalizeLineBreaks(template.body) })));
      setBrand(data.audience?.brand || '');
      setAiGenerated(false);
      setActiveTouch(0);
    }).catch((error) => toast.error(error.message));
  }, [filters.audience]);

  const selected = useMemo(() => new Set(Object.keys(selectedLeads)), [selectedLeads]);
  const sender = options.senders?.find((item) => String(item.id) === String(form.sender_domain_id));
  const audience = options.audiences?.find((item) => item.code === filters.audience);
  const personalizationFields = useMemo(() => {
    const fields = new Map([
      ['name', 'Contact name'], ['org', 'Business / organisation name'],
      ['business_name', 'Business name'], ['location', 'Location'], ['email', 'Email'],
      ['phone', 'Phone'], ['industry', 'Industry'], ['audience', 'Audience'],
      ['source', 'Lead source'], ['status', 'Lead status'], ['channel', 'Channel'],
      ['consent', 'WhatsApp consent'], ['consent_source', 'Consent source'],
      ['ai_score', 'AI score'], ['campaign_name', 'Campaign name'], ['created_at', 'Date added'],
    ]);
    audienceConfigs.forEach((audienceConfig) => {
      (audienceConfig.column_config || [])
        .filter((column) => column.enabled !== false)
        .forEach((column) => fields.set(column.key, column.label || column.key.replaceAll('_', ' ')));
      (audienceConfig.fields || [])
        .filter((field) => field.active !== false)
        .forEach((field) => fields.set(field.field_key, field.label || field.field_key.replaceAll('_', ' ')));
    });
    [...prospects, ...Object.values(selectedLeads)].forEach((prospect) => {
      const customFields = prospect?.custom_fields && typeof prospect.custom_fields === 'object'
        ? prospect.custom_fields : {};
      Object.keys(customFields).forEach((key) => fields.set(key, fields.get(key) || key.replaceAll('_', ' ')));
    });
    return [...fields].map(([key, label]) => ({ key, label }));
  }, [audienceConfigs, prospects, selectedLeads]);
  const previewLead = Object.values(selectedLeads)[0] || prospects[0] || { name: 'Dr. Charles', business_name: 'Example Organisation', location: 'Pondicherry' };
  const pages = Math.max(1, Math.ceil(total / limit));
  const allPageSelected = prospects.length > 0 && prospects.every((lead) => selected.has(String(lead.id)));
  const dailyCapacity = Math.max(1, Number(sender?.daily_cap || 20) - Number(sender?.sent_today || 0));
  const deliveryDays = selected.size ? Math.ceil(selected.size / dailyCapacity) : 0;
  const lastTouchDay = templates.length ? Math.max(...templates.map((item) => Number(item.delay_days || 0))) : 0;
  const scheduledDate = form.scheduled_at ? new Date(form.scheduled_at) : null;
  const scheduledDateIsValid = scheduledDate && !Number.isNaN(scheduledDate.getTime()) && scheduledDate.getTime() > Date.now();
  const minimumScheduleTime = toLocalDateTimeInput(new Date(Date.now() + 5 * 60 * 1000));

  const updateFilter = (key, value) => {
    setFilters((current) => key === 'audience'
      ? { ...current, audience: value, industry: '', status: '', source: '', location: '' }
      : { ...current, [key]: value });
    setPage(1);
    if (key === 'audience') setSelectedLeads({});
  };
  const toggleOne = (lead) => setSelectedLeads((current) => {
    const next = { ...current };
    const leadId = String(lead.id);
    if (next[leadId]) delete next[leadId]; else next[leadId] = lead;
    return next;
  });
  const togglePage = () => setSelectedLeads((current) => {
    const next = { ...current };
    prospects.forEach((lead) => {
      const leadId = String(lead.id);
      if (allPageSelected) delete next[leadId]; else next[leadId] = lead;
    });
    return next;
  });
  const selectAllMatching = async () => {
    setBusy('select');
    try {
      const data = await api.getAllianceCampaignProspects({ ...filters, limit: 5000, offset: 0 });
      setSelectedLeads(Object.fromEntries((data.prospects || []).map((lead) => [lead.id, lead])));
      if (data.total > 5000) toast(`Selected the first 5,000 of ${data.total} matching leads.`);
    } catch (error) { toast.error(error.message); }
    finally { setBusy(''); }
  };
  const suggestWithAI = async () => {
    const requestedTouchIndex = activeTouch;
    const requestedTemplate = templates[requestedTouchIndex];
    if (!requestedTemplate) return toast.error('Select an email touch first.');
    setBusy('ai');
    try {
      const data = await api.suggestAllianceCampaignTemplates({ audience: filters.audience, objective: form.objective, touch_no: requestedTemplate.touch_no || requestedTouchIndex + 1, current_template: requestedTemplate });
      const generatedTouch = data.template;
      if (!generatedTouch) throw new Error(`AI did not return content for Touch ${requestedTouchIndex + 1}.`);
      setTemplates((current) => current.map((template, index) => index === requestedTouchIndex
        ? { ...template, ...generatedTouch, subject: generatedTouch.subject || template.subject, body: normalizeLineBreaks(generatedTouch.body || template.body) }
        : template));
      setAiGenerated(Boolean(data.ai_generated));
      data.warning ? toast(data.warning) : toast.success(`AI content applied to Touch ${requestedTouchIndex + 1}`);
    } catch (error) { toast.error(error.message || 'AI suggestion failed'); }
    finally { setBusy(''); }
  };
  const saveActiveTemplate = async () => {
    const template = templates[activeTouch];
    if (!template?.subject?.trim() || !template?.body?.trim()) return toast.error('Subject and body are required.');
    setBusy('save-template');
    try {
      const result = await api.saveAllianceCampaignTemplate(template.touch_no || activeTouch + 1, { audience: filters.audience, subject: template.subject, body: template.body, purpose: template.purpose, delay_days: template.delay_days });
      toast.success(result.message);
    } catch (error) { toast.error(error.message || 'Failed to save template'); }
    finally { setBusy(''); }
  };
  const addEmailTouch = async () => {
    if (!filters.audience) return toast.error('Select a target audience first.');
    setBusy('add-template');
    try {
      const result = await api.createAllianceCampaignTemplate(filters.audience);
      setTemplates((result.templates || []).map((template) => ({ ...template, body: normalizeLineBreaks(template.body) })));
      setActiveTouch(Math.max(0, (result.templates || []).length - 1));
      toast.success(result.message);
    } catch (error) { toast.error(error.message || 'Failed to add touch'); }
    finally { setBusy(''); }
  };
  const deleteActiveTemplate = async () => {
    const template = templates[activeTouch];
    if (!template) return;
    setDeleteTouchModal({ template, index: activeTouch });
  };
  const confirmDeleteActiveTemplate = async () => {
    const template = deleteTouchModal?.template;
    const templateIndex = deleteTouchModal?.index ?? activeTouch;
    if (!template) return;
    setBusy('delete-template');
    try {
      const result = await api.deleteAllianceCampaignTemplate(template.touch_no || templateIndex + 1, filters.audience);
      setTemplates((result.templates || []).map((item) => ({ ...item, body: normalizeLineBreaks(item.body) })));
      setActiveTouch(Math.max(0, templateIndex - 1));
      setDeleteTouchModal(null);
      toast.success(result.message);
    } catch (error) { toast.error(error.message || 'Failed to delete touch'); }
    finally { setBusy(''); }
  };
  const updateTemplate = (index, key, value) => setTemplates((current) => current.map((item, i) => i === index ? { ...item, [key]: value } : item));
  const insertVariable = (variable) => {
    const textarea = editorRef.current;
    const body = templates[activeTouch]?.body || '';
    const start = textarea?.selectionStart ?? body.length;
    const end = textarea?.selectionEnd ?? body.length;
    updateTemplate(activeTouch, 'body', `${body.slice(0, start)}${variable}${body.slice(end)}`);
    requestAnimationFrame(() => { textarea?.focus(); textarea?.setSelectionRange(start + variable.length, start + variable.length); });
  };
  const personalize = (value = '') => String(value).replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (_match, key) => {
    const aliases = { org: 'business_name' };
    if (key === 'campaign_name') return form.name || previewLead.campaign_name || `{{${key}}}`;
    return String(previewLead[aliases[key] || key] ?? previewLead.custom_fields?.[key] ?? `{{${key}}}`);
  });

  const validateStep = (targetStep) => {
    if (targetStep > 1 && !form.name.trim()) return 'Enter a campaign name.';
    if (targetStep > 1 && !form.sender_domain_id) return 'Select an active Zoho sender.';
    if (targetStep > 2 && !filters.audience) return 'Select an audience.';
    if (targetStep > 2 && !selected.size) return 'Select at least one recipient.';
    if (targetStep > 3 && (!templates.length || templates.some((item) => !item.subject?.trim() || !item.body?.trim()))) return 'Complete every active email touch.';
    if (targetStep > 4 && Number(templates[0]?.delay_days || 0) !== 0) return 'The first email must be scheduled for day 0.';
    if (targetStep > 4 && templates.some((item, index) => index > 0 && Number(item.delay_days) <= Number(templates[index - 1].delay_days))) return 'Each follow-up must be scheduled after the previous email.';
    if (targetStep > 4 && form.launch_mode === 'scheduled' && !scheduledDateIsValid) return 'Choose a future date and time for the scheduled campaign.';
    return '';
  };
  const goTo = (target) => {
    if (target > step) { const error = validateStep(target); if (error) return toast.error(error); }
    setStep(target); window.requestAnimationFrame(() => document.querySelector('.al-wrap')?.scrollTo({ top: 0, behavior: 'smooth' }));
  };
  const createCampaign = async () => {
    const error = validateStep(5); if (error) return toast.error(error);
    setBusy('create');
    try {
      const result = await api.createAllianceEmailCampaign({ name: form.name, objective: form.objective, audience: filters.audience, sender_domain_id: Number(form.sender_domain_id), prospect_ids: Object.values(selectedLeads).map((lead) => lead.id), templates, ai_generated: aiGenerated });
      const launchResult = await api.startAllianceCampaign(result.campaign.id, form.launch_mode === 'scheduled' ? { scheduled_at: scheduledDate.toISOString() } : {});
      draftDiscardedRef.current = true;
      latestDraftRef.current = null;
      localStorage.removeItem(EMAIL_CAMPAIGN_DRAFT_KEY);
      toast.success(launchResult.message);
      navigate('/alliance/planner');
    } catch (requestError) { toast.error(requestError.message || 'Failed to create campaign'); }
    finally { setBusy(''); }
  };

  const activeTemplate = templates[activeTouch] || {};
  const discardDraft = () => {
    draftDiscardedRef.current = true;
    latestDraftRef.current = null;
    localStorage.removeItem(EMAIL_CAMPAIGN_DRAFT_KEY);
    setStep(1); setForm({ name: '', objective: '', sender_domain_id: options.senders?.length === 1 ? String(options.senders[0].id) : '', launch_mode: 'immediate', scheduled_at: '' });
    setFilters(EMPTY_FILTERS); setTemplates([]); setSelectedLeads({}); setActiveTouch(0); setBrand(''); setAiGenerated(false);
    setDraftStatus('Draft discarded');
  };
  return (
    <div className="al-wrap al-campaign-builder">
      <div className="al-cb-header">
        <div><div className="al-eyebrow">AllianceOS · Campaign studio</div><div className="al-page-title">Create email campaign</div><p className="al-page-desc">Build a targeted, personalized sequence and review every detail before launch.</p></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}><small style={{ color: 'var(--al-faint)' }}>{draftStatus}</small><button className="al-btn ghost" onClick={discardDraft}>Discard draft</button><button className="al-btn ghost" onClick={() => navigate('/alliance/planner')}><ArrowLeft size={16} /> View Campaign Planner</button></div>
      </div>

      <section className="al-cb-active-campaigns" aria-label="Active campaigns">
        <div className="al-cb-active-head"><div><b>Active campaigns</b><span>Live campaign activity refreshes every 10 seconds.</span></div><button className="al-link" onClick={() => navigate('/alliance/planner')}>View full details</button></div>
        {activeCampaigns.length ? <div className="al-cb-active-list">{activeCampaigns.map((campaign) => (
          <button key={campaign.id} type="button" onClick={() => navigate('/alliance/planner')}>
            <span><b>{campaign.name}</b><small>{campaign.audience} · {campaign.status}</small></span>
            <span><small>Recipients</small><b>{campaign.prospects || 0}</b></span>
            <span><small>Sent</small><b>{campaign.sent || 0}</b></span>
            <span><small>Replies</small><b>{campaign.replied || 0}</b></span>
            <ArrowRight size={16} />
          </button>
        ))}</div> : <div className="al-cb-active-empty">No scheduled, running, or paused campaigns.</div>}
      </section>

      <nav className="al-cb-steps" aria-label="Campaign creation progress">
        {STEPS.map((item) => { const Icon = item.icon; const done = step > item.id; return <button key={item.id} className={`al-cb-step ${step === item.id ? 'active' : ''} ${done ? 'done' : ''}`} onClick={() => item.id <= step && goTo(item.id)}><span>{done ? <Check size={16} /> : <Icon size={16} />}</span><div><small>Step {item.id}</small><b>{item.label}</b></div></button>; })}
      </nav>

      <div className="al-cb-layout">
        <main className="al-cb-main">
          {step === 1 && <section className="al-cb-card">
            <div className="al-cb-section-head"><span className="al-cb-icon"><FileText size={20} /></span><div><h2>Campaign details</h2><p>Give your campaign a clear internal identity and purpose.</p></div></div>
            <div className="al-cb-grid two"><div className="al-field"><label>Campaign name <b>*</b></label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="August college partnerships" maxLength={255} /><small className="al-help">Visible internally in Campaign Planner.</small></div><div className="al-field"><label>Zoho sender <b>*</b> <Info size={12} title="The authenticated mailbox used to send this campaign." /></label><select value={form.sender_domain_id} onChange={(e) => setForm({ ...form, sender_domain_id: e.target.value })}><option value="">Select active sender</option>{options.senders?.map((item) => <option key={item.id} value={item.id}>{item.inbox_email} · {item.sent_today}/{item.daily_cap} today</option>)}</select><small className="al-help">Credentials remain securely on the server.</small></div></div>
            <div className="al-field"><label>Campaign objective <span>Optional</span></label><textarea className="al-cb-objective" value={form.objective} onChange={(e) => setForm({ ...form, objective: e.target.value })} placeholder="Example: Start conversations with college placement officers about training partnerships." /><small className="al-help">Used by AI to recommend relevant messaging and calls to action.</small></div>
          </section>}

          {step === 2 && <section className="al-cb-card">
            <div className="al-cb-section-head"><span className="al-cb-icon"><Users size={20} /></span><div><h2>Select your audience</h2><p>Filter existing Alliance leads, then choose exactly who should receive this campaign.</p></div></div>
            <div className="al-cb-grid three"><div className="al-field"><label>Audience <b>*</b></label><select value={filters.audience} onChange={(e) => updateFilter('audience', e.target.value)}><option value="">Select audience</option>{options.audiences?.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div><div className="al-field"><label>Brand</label><input value={brand} readOnly placeholder="Assigned automatically" /></div><div className="al-field"><label>Search leads</label><div className="al-input-icon"><Search size={15} /><input value={filters.search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Name, company, or email" /></div></div></div>
            <div className="al-cb-filterbar"><Filter size={16} /><select value={filters.industry} onChange={(e) => updateFilter('industry', e.target.value)}><option value="">All industries</option>{options.industries?.map((v) => <option key={v}>{v}</option>)}</select><select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)}><option value="">All statuses</option>{options.statuses?.map((v) => <option key={v}>{v}</option>)}</select><select value={filters.source} onChange={(e) => updateFilter('source', e.target.value)}><option value="">All sources</option>{options.sources?.map((v) => <option key={v}>{v}</option>)}</select><select value={filters.location} onChange={(e) => updateFilter('location', e.target.value)}><option value="">All locations</option>{options.locations?.map((v) => <option key={v}>{v}</option>)}</select></div>
            <div className="al-cb-grid three" style={{ marginTop: 12 }}>
              <div className="al-field"><label>From date</label><DatePicker value={filters.dateFrom} max={filters.dateTo} onChange={(value) => { updateFilter('dateFrom', value); setSelectedLeads({}); }} /></div>
              <div className="al-field"><label>To date</label><DatePicker value={filters.dateTo} min={filters.dateFrom} onChange={(value) => { updateFilter('dateTo', value); setSelectedLeads({}); }} /></div>
              {(filters.dateFrom || filters.dateTo) && <div className="al-field" style={{ display: 'flex', alignItems: 'flex-end' }}><button type="button" className="al-btn ghost sm" onClick={() => { setFilters((current) => ({ ...current, dateFrom: '', dateTo: '' })); setPage(1); setSelectedLeads({}); }}>Clear dates</button></div>}
            </div>
            <div className="al-cb-selection"><b>{selected.size} selected</b><span>{total} matching eligible leads</span><button className="al-btn ghost sm" disabled={!filters.audience || busy === 'select'} onClick={selectAllMatching}>Select all matching</button><button className="al-link" disabled={!selected.size} onClick={() => setSelectedLeads({})}>Clear selection</button></div>
            <div className="al-cb-table"><table className="al-table"><thead><tr><th><input type="checkbox" checked={allPageSelected} onChange={togglePage} /></th><th>Contact</th><th>Email</th><th>Industry / location</th><th>Status</th><th>Imported date & time</th></tr></thead><tbody>{loading ? <tr><td colSpan="6" className="al-empty">Loading leads…</td></tr> : prospects.map((lead) => <tr key={lead.id} className={selected.has(String(lead.id)) ? 'selected' : ''}><td><input type="checkbox" checked={selected.has(String(lead.id))} onChange={() => toggleOne(lead)} /></td><td><b>{lead.business_name}</b><small>{lead.name || 'No contact name'}</small></td><td>{lead.email}</td><td>{lead.industry || '—'}<small>{lead.location || '—'}</small></td><td><span className="al-cb-status">{lead.status}</span></td><td>{formatImportedDateTime(lead.created_at)}</td></tr>)}{!loading && !prospects.length && <tr><td colSpan="6" className="al-empty">{filters.audience ? 'No eligible leads match these filters.' : 'Select an audience to load leads.'}</td></tr>}</tbody></table></div>
            <div className="al-cb-pagination"><span>Page {page} of {pages}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /></button><button disabled={page >= pages} onClick={() => setPage(page + 1)}><ChevronRight size={16} /></button></div></div>
          </section>}

          {step === 3 && <section className="al-cb-card">
            <div className="al-email-content-head">
              <div className="al-email-content-intro"><span className="al-cb-icon"><Mail size={20} /></span><div><h2>Email content</h2><p>Templates for <b>{audience?.label || 'the selected audience'}</b>. Create, edit, save, or delete sequence touches.</p></div></div>
              <div className="al-email-content-actions">
                <button className="al-btn ghost" disabled={!filters.audience || busy === 'add-template' || templates.length >= 10} onClick={addEmailTouch}><Plus size={16} />{busy === 'add-template' ? 'Adding…' : 'Add touch'}</button>
                <button className="al-btn ghost" disabled={templates.length <= 1 || activeTouch !== templates.length - 1 || busy === 'delete-template'} onClick={deleteActiveTemplate}><Trash2 size={15} />{busy === 'delete-template' ? 'Deleting…' : 'Delete touch'}</button>
                <button className="al-btn ghost" disabled={!filters.audience || busy === 'save-template'} onClick={saveActiveTemplate}><Check size={16} />{busy === 'save-template' ? 'Saving…' : 'Save as default'}</button>
                <button className="al-btn ai" disabled={!filters.audience || busy === 'ai'} onClick={suggestWithAI}><Sparkles size={16} />{busy === 'ai' ? 'Generating…' : 'Suggest with AI'}</button>
              </div>
            </div>
            <div className="al-cb-touch-tabs" style={{ gridTemplateColumns: `repeat(${Math.min(Math.max(templates.length, 1), 5)}, minmax(130px, 1fr))` }}>{templates.map((item, index) => <button key={item.touch_no || index} className={activeTouch === index ? 'active' : ''} onClick={() => setActiveTouch(index)}><span>{item.touch_no || index + 1}</span><div><b>Touch {item.touch_no || index + 1}</b><small>Day {item.delay_days || 0}</small></div>{item.subject?.trim() && item.body?.trim() && <Check size={14} />}</button>)}</div>
            {!templates.length ? <div className="al-empty">Select an audience to load its approved email sequence.</div> : <div className="al-cb-editor-grid"><div className="al-cb-editor"><div className="al-field"><label>Subject <b>*</b></label><input value={activeTemplate.subject || ''} onChange={(e) => updateTemplate(activeTouch, 'subject', e.target.value)} /><small className="al-help">{(activeTemplate.subject || '').length}/120 characters</small></div><div className="al-field"><label>Email body <b>*</b></label><div className="al-editor-toolbar"><span>Personalize:</span><select value={personalizationField} onChange={(e) => setPersonalizationField(e.target.value)}>{personalizationFields.map((field) => <option key={field.key} value={field.key}>{field.label} — {`{{${field.key}}}`}</option>)}</select><button type="button" onClick={() => insertVariable(`{{${personalizationField}}}`)}>Insert field</button></div><textarea ref={editorRef} className="al-cb-editor-area" value={activeTemplate.body || ''} onChange={(e) => updateTemplate(activeTouch, 'body', e.target.value)} /><div className="al-editor-foot"><span>{(activeTemplate.body || '').trim().split(/\s+/).filter(Boolean).length} words</span><span>{aiGenerated && <><Bot size={13} /> AI generated—review required</>}</span></div></div></div><EmailClientPreview brand={brand} senderEmail={sender?.inbox_email} recipientName={previewLead.name || previewLead.business_name} recipientEmail={previewLead.email} subject={personalize(activeTemplate.subject)} body={personalize(activeTemplate.body)} /></div>}
          </section>}

          {step === 4 && <section className="al-cb-card">
            <div className="al-cb-section-head"><span className="al-cb-icon"><CalendarClock size={20} /></span><div><h2>Sequence schedule</h2><p>Control when each follow-up becomes eligible to send after campaign launch.</p></div></div>
            <div className="al-delivery-plan">
              <button type="button" className={form.launch_mode === 'immediate' ? 'active' : ''} onClick={() => setForm((current) => ({ ...current, launch_mode: 'immediate', scheduled_at: '' }))}><Send size={20} /><span><b>Start immediately</b><small>Begin sending as soon as the campaign is created.</small></span></button>
              <button type="button" className={form.launch_mode === 'scheduled' ? 'active' : ''} onClick={() => setForm((current) => ({ ...current, launch_mode: 'scheduled' }))}><CalendarClock size={20} /><span><b>Schedule for later</b><small>Choose the exact date and time to begin sending.</small></span></button>
            </div>
            {form.launch_mode === 'scheduled' && <div className="al-field al-schedule-date"><label>Campaign start date and time <b>*</b></label><DatePicker withTime min={minimumScheduleTime} value={form.scheduled_at} placeholder="dd-mm-yyyy --:--" onChange={(value) => setForm((current) => ({ ...current, scheduled_at: value }))} /><small className="al-help">Choose the date, hour, minute, and AM/PM. Time uses your current browser timezone.</small></div>}
            <div className="al-cb-timeline">{templates.map((item, index) => <div className="al-cb-time" key={item.touch_no || index}><div className="al-time-line"><span>{index + 1}</span>{index < templates.length - 1 && <i />}</div><div><b>Touch {index + 1}</b><p>{item.purpose || item.subject}</p></div><div className="al-field"><label>Send on day</label><input type="number" min="0" max="30" value={item.delay_days ?? 0} onChange={(e) => updateTemplate(index, 'delay_days', Number(e.target.value))} /></div></div>)}</div>
            <div className="al-note success"><Info size={18} /><div><b>Delivery protection:</b> Daily sender limits are still applied. Replies, unsubscribe requests, and closed lead statuses stop future touches automatically.</div></div>
            <BulkSendLimitControl channel="email" recipientCount={selected.size} />
          </section>}

          {step === 5 && <section className="al-cb-card">
            <div className="al-cb-section-head"><span className="al-cb-icon"><Check size={20} /></span><div><h2>Review campaign</h2><p>Confirm the audience, content, and delivery plan before launch.</p></div></div>
            <div className="al-review-list"><div><FileText size={17} /><span><small>Campaign</small><b>{form.name}</b></span><button onClick={() => goTo(1)}>Edit</button></div><div><Users size={17} /><span><small>Audience</small><b>{audience?.label} · {selected.size} recipients</b></span><button onClick={() => goTo(2)}>Edit</button></div><div><Mail size={17} /><span><small>Content</small><b>{templates.length}-touch {aiGenerated ? 'AI-assisted' : 'approved template'} sequence</b></span><button onClick={() => goTo(3)}>Edit</button></div><div><CalendarClock size={17} /><span><small>Delivery</small><b>{form.launch_mode === 'scheduled' && scheduledDateIsValid ? `Scheduled for ${scheduledDate.toLocaleString('en-IN')}` : 'Start immediately'} · Day 0 through day {lastTouchDay}</b></span><button onClick={() => goTo(4)}>Edit</button></div></div>
            <div className="al-launch-note"><Send size={20} /><div><b>{form.launch_mode === 'scheduled' ? 'Campaign will be scheduled' : 'Campaign will start immediately'}</b><p>{form.launch_mode === 'scheduled' ? 'The first email becomes eligible at the selected date and time. Daily sender limits may spread delivery across multiple days.' : 'The first email becomes eligible as soon as creation finishes. Daily sender limits may spread delivery across multiple days.'}</p></div></div>
          </section>}

          <footer className="al-cb-actions"><button className="al-btn ghost" disabled={step === 1} onClick={() => goTo(step - 1)}><ArrowLeft size={16} /> Back</button><span>Step {step} of {STEPS.length}</span>{step < 5 ? <button className="al-btn" onClick={() => goTo(step + 1)}>Continue <ArrowRight size={16} /></button> : <button className="al-btn" disabled={busy === 'create'} onClick={createCampaign}><Check size={16} />{busy === 'create' ? 'Creating…' : form.launch_mode === 'scheduled' ? 'Schedule campaign' : 'Create & start now'}</button>}</footer>
        </main>

        <aside className="al-cb-summary">
          <div className="al-cb-summary-head"><Sparkles size={17} /><b>Campaign summary</b></div>
          <div className="al-cb-metric"><span>Recipients</span><b>{selected.size.toLocaleString()}</b></div><div className="al-cb-metric"><span>Audience</span><b>{audience?.label || 'Not selected'}</b></div><div className="al-cb-metric"><span>Sender</span><b>{sender?.inbox_email || 'Not selected'}</b></div><div className="al-cb-metric"><span>Sequence</span><b>{templates.length || 0} emails · {lastTouchDay} days</b></div>
          <div className="al-cb-estimate"><CalendarClock size={18} /><div><small>Estimated first-touch delivery</small><b>{selected.size ? `${deliveryDays} day${deliveryDays === 1 ? '' : 's'}` : '—'}</b><p>Based on {dailyCapacity} remaining sends/day.</p></div></div>
          <div className="al-cb-checks"><b>Readiness</b><p className={form.name ? 'ok' : ''}><span>{form.name ? '✓' : '·'}</span> Campaign details</p><p className={selected.size ? 'ok' : ''}><span>{selected.size ? '✓' : '·'}</span> Recipients selected</p><p className={templates.length > 0 && templates.every((t) => t.subject && t.body) ? 'ok' : ''}><span>{templates.length > 0 && templates.every((t) => t.subject && t.body) ? '✓' : '·'}</span> Email content reviewed</p><p className={form.sender_domain_id ? 'ok' : ''}><span>{form.sender_domain_id ? '✓' : '·'}</span> Active sender</p></div>
        </aside>
      </div>
      {deleteTouchModal && (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-touch-title" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(2, 8, 23, 0.76)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onMouseDown={(event) => { if (event.target === event.currentTarget && busy !== 'delete-template') setDeleteTouchModal(null); }}>
          <div style={{ width: '100%', maxWidth: 440, background: '#111f35', border: '1px solid #334766', borderRadius: 16, boxShadow: '0 24px 80px rgba(0,0,0,.5)', overflow: 'hidden' }}>
            <div style={{ padding: '18px 22px', borderBottom: '1px solid #263a58', display: 'flex', alignItems: 'center', gap: 11 }}>
              <span style={{ width: 36, height: 36, borderRadius: 9, display: 'grid', placeItems: 'center', background: 'rgba(239,68,68,.12)', color: '#f87171' }}><Trash2 size={18} /></span>
              <div><h3 id="delete-touch-title" style={{ margin: 0, color: '#f8fafc', fontSize: 16 }}>Delete email touch?</h3><small style={{ color: '#8fa7c7' }}>This changes the default sequence for future campaigns.</small></div>
            </div>
            <div style={{ padding: 22 }}>
              <p style={{ margin: 0, color: '#cbd5e1', lineHeight: 1.6, fontSize: 13 }}>Delete <b style={{ color: '#fff' }}>Touch {deleteTouchModal.template.touch_no || deleteTouchModal.index + 1}</b> from <b style={{ color: '#fff' }}>{audience?.label || filters.audience}</b>?</p>
              <p style={{ margin: '9px 0 0', color: '#8fa7c7', fontSize: 11 }}>Existing campaign drafts keep their saved copy. Only the default template sequence is changed.</p>
            </div>
            <div style={{ padding: '14px 22px 20px', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button type="button" className="al-btn ghost" disabled={busy === 'delete-template'} onClick={() => setDeleteTouchModal(null)}>Cancel</button>
              <button type="button" className="al-btn" disabled={busy === 'delete-template'} onClick={confirmDeleteActiveTemplate} style={{ background: '#dc2626', borderColor: '#dc2626' }}>{busy === 'delete-template' ? 'Deleting…' : 'Delete touch'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
