import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Plus, Upload, Send, Clock, Trash2, Download, RefreshCw, FileSpreadsheet, CheckCircle2, AlertTriangle, X, Users,
  Gauge, ShieldCheck, Pencil, Ban, BarChart3, Info,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import { campaignsApi } from '../services/campaignsApi.js';
import {
  DEFAULT_TZ, getTemplateVariables, getCampaignTemplateError, createDefaultParameterMappings, SOURCE_LABELS, renderPreview,
  isMarketing, nowInZone, toZoneInput, formatInZone, formatLocalInput, formatNumber, TIER_TEXT, friendlyError, plainReason, STATUS_META, statusOf,
} from './campaigns/helpers.js';

// ── small presentational pieces ─────────────────────────────
const TONES = {
  blue: { fg: C.blue, bg: '#eff6ff', border: '#bfdbfe' },
  green: { fg: C.green, bg: '#f0fdf4', border: '#bbf7d0' },
  amber: { fg: '#b45309', bg: '#fffbeb', border: '#fde68a' },
  red: { fg: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
  grey: { fg: C.muted, bg: '#f1f5f9', border: C.border },
  purple: { fg: C.purple, bg: '#f5f3ff', border: '#ddd6fe' },
};

const Pill = ({ tone = 'grey', children, style }) => (
  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: TONES[tone].bg, color: TONES[tone].fg, border: `1px solid ${TONES[tone].border}`, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap', ...style }}>{children}</span>
);

const Card = ({ title, subtitle, icon: Icon, children, style, action }) => (
  <section style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 20, minWidth: 0, ...style }}>
    {title && (
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {Icon && <span style={{ width: 30, height: 30, borderRadius: 8, background: C.accentDim, color: C.accent, display: 'grid', placeItems: 'center', flexShrink: 0 }}><Icon size={16} /></span>}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{title}</h3>
            {subtitle && <p style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{subtitle}</p>}
          </div>
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);

const Field = ({ label, hint, children, action }) => (
  <div style={{ marginBottom: 16 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <label style={{ fontSize: 12, color: C.text, fontWeight: 600 }}>{label}</label>
      {action}
    </div>
    {children}
    {hint && <p style={{ fontSize: 11, color: C.muted, marginTop: 5, lineHeight: 1.5 }}>{hint}</p>}
  </div>
);

const inputStyle = { width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '9px 11px', fontSize: 13, outline: 'none' };
const linkButton = { background: 'transparent', border: 'none', color: C.accent, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, padding: 0 };
const secondaryButton = { background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '9px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };
const primaryButton = { background: C.accent, border: 'none', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 13, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 };

const Modal = ({ label, children, maxWidth = 560 }) => (
  <div role="dialog" aria-label={label} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 16 }}>
    <div className="cmp-pop" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth, maxHeight: '90vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 20px 50px rgba(15,23,42,.18)' }}>
      {children}
    </div>
  </div>
);

const ModalHeader = ({ title, subtitle, onClose, extra }) => (
  <div style={{ padding: '16px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{title}</h3>
        {extra}
      </div>
      {subtitle && <p style={{ fontSize: 12, color: C.muted, marginTop: 3 }}>{subtitle}</p>}
    </div>
    {onClose && <button type="button" aria-label="Close" onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, padding: 4 }}><X size={18} /></button>}
  </div>
);

const Stat = ({ label, value, tone = 'grey', big }) => (
  <div style={{ background: TONES[tone].bg, border: `1px solid ${TONES[tone].border}`, borderRadius: 10, padding: big ? '12px 14px' : '10px 12px', minWidth: 0 }}>
    <div className="cmp-count" key={String(value)} style={{ fontSize: big ? 24 : 18, fontWeight: 800, color: TONES[tone].fg, lineHeight: 1.1 }}>{value}</div>
    <div style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{label}</div>
  </div>
);

const Bar = ({ parts, total, height = 10, animated }) => (
  <div style={{ display: 'flex', width: '100%', height, background: '#e2e8f0', borderRadius: 999, overflow: 'hidden' }} className={animated ? 'cmp-stripes' : undefined}>
    {parts.map(([value, color], i) => (
      <div key={i} style={{ width: `${total > 0 ? Math.min(100, (value / total) * 100) : 0}%`, background: color, transition: 'width .6s ease' }} />
    ))}
  </div>
);

const PAGE_CSS = `
@keyframes cmp-fade { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@keyframes cmp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: .35; } }
@keyframes cmp-spin { to { transform: rotate(360deg); } }
@keyframes cmp-stripes { from { background-position: 0 0; } to { background-position: 28px 0; } }
@keyframes cmp-fly { 0% { transform: translateX(-6px) translateY(3px); opacity: .4; } 50% { transform: translateX(4px) translateY(-3px); opacity: 1; } 100% { transform: translateX(-6px) translateY(3px); opacity: .4; } }
.cmp-pop { animation: cmp-fade .2s ease-out; position: relative; }
.cmp-count { animation: cmp-fade .35s ease-out; }
.cmp-pulse { animation: cmp-pulse 1.4s ease-in-out infinite; }
.cmp-spin { animation: cmp-spin .9s linear infinite; }
.cmp-fly { animation: cmp-fly 1.6s ease-in-out infinite; }
.cmp-stripes > div:first-child { background-image: linear-gradient(45deg, rgba(255,255,255,.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,.25) 50%, rgba(255,255,255,.25) 75%, transparent 75%, transparent) !important; background-size: 28px 28px; animation: cmp-stripes 1s linear infinite; }
.cmp-drop:hover { border-color: ${C.accent} !important; background: ${C.accentDim} !important; }
.cmp-create { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 18px; align-items: start; }
@media (max-width: 960px) { .cmp-create { grid-template-columns: 1fr; } }
`;

const AUDIENCE_TAG = 'tag';
const AUDIENCE_LIST = 'custom_csv';

export const CampaignsView = () => {
  const [tab, setTab] = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState('');
  const [timezone, setTimezone] = useState(DEFAULT_TZ);

  // Form
  const [name, setName] = useState('');
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [templates, setTemplates] = useState([]);
  const [templateId, setTemplateId] = useState('');
  const [templateParameters, setTemplateParameters] = useState({ body: {}, header: {} });
  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const syncedBrandIds = useRef(new Set());
  const [audience, setAudience] = useState(null); // { total, statuses, tags }
  const [targetStatus, setTargetStatus] = useState('');
  const [tagId, setTagId] = useState('');
  const [sendType, setSendType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [limit, setLimit] = useState(null);

  // Custom list
  const [listFile, setListFile] = useState(null);
  const [listCheck, setListCheck] = useState(null); // { summary } | { error, summary? }
  const [checkingList, setCheckingList] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const savedList = useRef(null); // { key, batchId } so a re-review does not store the list twice
  const fileInput = useRef(null);

  // Review, sending and reports
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [previewState, setPreviewState] = useState(null);
  const [sendRestLater, setSendRestLater] = useState(false);
  const [progressView, setProgressView] = useState(null); // { id, name, progress }
  const [reportModal, setReportModal] = useState(null);
  const [campaignLogs, setCampaignLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [reportFilter, setReportFilter] = useState('all');
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [editModal, setEditModal] = useState(null); // { campaign, name, scheduledAt, saving, error }
  const [cancelModal, setCancelModal] = useState(null);

  const selectedBrand = clients.find((c) => String(c.id) === String(clientId));
  const selectedTemplate = templates.find((t) => String(t.id) === String(templateId));
  const isBrandConnected = (brand) => Boolean(brand?.wa_token_configured && brand?.wa_business_id);

  // ── data loading ──────────────────────────────────────────
  const fetchCampaigns = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const data = await api.getCampaigns();
      setCampaigns(data.campaigns || []);
      if (data.timezone) setTimezone(data.timezone);
      setListError('');
    } catch (err) {
      if (!quiet) setListError(friendlyError(err, 'Could not load your campaigns. Please refresh the page.'));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  // The template list is the local copy of the brand's Meta templates;
  // POST /api/templates/sync-all refreshes it, then the list is reloaded.
  const syncTemplatesFromMeta = async (brands, { manual = false } = {}) => {
    const connected = brands.filter(isBrandConnected);
    if (!connected.length) {
      if (manual) toast.error('Connect WhatsApp for this brand in Settings first.');
      return;
    }
    connected.forEach((brand) => syncedBrandIds.current.add(String(brand.id)));
    setSyncingTemplates(true);
    try {
      const results = await Promise.allSettled(connected.map((brand) => api.syncAllTemplates(brand.id)));
      const templatesData = await api.getTemplates();
      setTemplates(templatesData.templates || []);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed && manual) toast.error(friendlyError(failed.reason, 'Could not sync templates from Meta. Please try again in a minute.'));
      else if (manual) toast.success('Templates synced from Meta');
    } catch (err) {
      if (manual) toast.error(friendlyError(err, 'Could not load templates.'));
    } finally {
      setSyncingTemplates(false);
    }
  };

  const fetchFormMetadata = async () => {
    try {
      const [clientsData, templatesData] = await Promise.all([api.getClients(), api.getTemplates()]);
      const brands = clientsData.clients || [];
      setClients(brands);
      setTemplates(templatesData.templates || []);
      // Most workspaces have one brand: choose it (a connected one first).
      setClientId((current) => current || String((brands.find(isBrandConnected) || brands[0])?.id || ''));
      syncTemplatesFromMeta(brands);
    } catch (err) {
      setFormError(friendlyError(err, 'Could not load your brands and templates. Please refresh the page.'));
    }
  };

  useEffect(() => {
    fetchCampaigns();
    fetchFormMetadata();
  }, []);

  // A newly selected brand is synced once per visit (the Sync button forces it).
  useEffect(() => {
    if (!clientId || syncedBrandIds.current.has(String(clientId))) return;
    const brand = clients.find((c) => String(c.id) === String(clientId));
    if (brand) syncTemplatesFromMeta([brand]);
  }, [clientId, clients]);

  // Audience counts and the number's daily limit follow the brand.
  const loadBrandData = useCallback(async () => {
    if (!clientId) return;
    const [counts, sending] = await Promise.allSettled([campaignsApi.audienceCounts(clientId), campaignsApi.sendingLimit(clientId)]);
    if (counts.status === 'fulfilled') setAudience(counts.value);
    else setAudience({ total: 0, statuses: [], tags: [], error: friendlyError(counts.reason, 'Could not count your contacts.') });
    if (sending.status === 'fulfilled') {
      setLimit(sending.value);
      if (sending.value.timezone) setTimezone(sending.value.timezone);
    } else setLimit({ error: friendlyError(sending.reason, 'Could not load your daily sending limit.') });
  }, [clientId]);
  useEffect(() => { loadBrandData(); }, [loadBrandData]);

  // Keep the audience choice valid: only options that have contacts.
  useEffect(() => {
    if (!audience) return;
    const valid = new Set([...(audience.statuses || []).map((s) => s.value), ...(audience.total > 0 ? ['all'] : []), AUDIENCE_LIST, ...(audience.tags?.length ? [AUDIENCE_TAG] : [])]);
    if (!targetStatus || !valid.has(targetStatus)) setTargetStatus(audience.statuses?.[0]?.value || (audience.total > 0 ? 'all' : AUDIENCE_LIST));
  }, [audience]);

  const campaignTemplates = templates
    .filter((t) => t.status === 'approved' || t.status === 'active')
    .filter((t) => !t.template_scope || t.template_scope === 'leados' || t.template_scope === 'shared')
    .filter((t) => !clientId || Number(t.client_id) === Number(clientId) || t.client_id == null);

  const usesListValues = ['header', 'body'].some((section) => Object.values(templateParameters[section] || {}).some((m) => m?.source === 'excel_parameter'));
  const listKey = listFile ? `${listFile.name}:${listFile.size}:${listFile.lastModified}:${clientId}:${JSON.stringify(templateParameters)}` : '';

  // ── custom list ───────────────────────────────────────────
  const checkList = async (file, mappings = templateParameters) => {
    if (!file) return;
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setListCheck({ error: 'Upload a .csv or .xlsx file.' });
      return;
    }
    if (!clientId) {
      setListCheck({ error: 'Choose a brand first.' });
      return;
    }
    setCheckingList(true);
    setListCheck(null);
    try {
      const data = await campaignsApi.uploadList({ file, clientId, templateParameters: mappings, save: false });
      setListCheck({ summary: data.summary });
    } catch (err) {
      setListCheck({ error: friendlyError(err, 'Could not read this list. Please try again.'), summary: err.response?.data?.summary });
    } finally {
      setCheckingList(false);
    }
  };

  const pickFile = (file) => {
    if (!file) return;
    setListFile(file);
    savedList.current = null;
    checkList(file);
  };

  // Re-check the list when the template's sheet columns change.
  const mappingKey = JSON.stringify(templateParameters);
  useEffect(() => {
    if (listFile && targetStatus === AUDIENCE_LIST) checkList(listFile);
  }, [mappingKey, clientId]);

  const downloadSample = async () => {
    try {
      await campaignsApi.downloadSample(templateParameters);
    } catch (err) {
      toast.error(friendlyError(err, 'Could not download the sample file.'));
    }
  };

  // ── audience estimate (before the server preview) ─────────
  const estimate = useMemo(() => {
    if (!audience) return null;
    if (targetStatus === AUDIENCE_LIST) return listCheck?.summary?.ready ?? null;
    if (targetStatus === AUDIENCE_TAG) return audience.tags?.find((t) => String(t.id) === String(tagId))?.lead_count ?? null;
    if (targetStatus === 'all') return audience.total;
    return audience.statuses?.find((s) => s.value === targetStatus)?.count ?? null;
  }, [audience, targetStatus, tagId, listCheck]);

  const limitLeft = limit && !limit.error && limit.connected ? limit.remaining_today : null;
  const overToday = sendType === 'now' && limitLeft != null && estimate != null && estimate > limitLeft;

  // ── submit: preview, then confirm ─────────────────────────
  const validateForm = () => {
    if (!name.trim()) return 'Give the campaign a name.';
    if (!clientId) return 'Choose a brand.';
    if (!templateId) return 'Choose an approved template.';
    const templateError = getCampaignTemplateError(selectedTemplate);
    if (templateError) return templateError;
    for (const section of ['header', 'body']) {
      for (const number of getTemplateVariables(selectedTemplate?.[section])) {
        const mapping = templateParameters[section]?.[String(number)];
        if (!mapping || (mapping.source === 'custom' && !mapping.value?.trim())) return `Fill in the value for {{${number}}} in the ${section === 'header' ? 'header' : 'message'}.`;
        if (mapping.source === 'excel_parameter' && targetStatus !== AUDIENCE_LIST) return `{{${number}}} takes its value from an uploaded list. Choose "Upload Custom List" or pick another value.`;
      }
    }
    if (!targetStatus) return 'Choose who should receive it.';
    if (targetStatus === AUDIENCE_TAG && !tagId) return 'Choose a tag.';
    if (targetStatus === AUDIENCE_LIST) {
      if (!listFile) return 'Upload your contact list.';
      if (checkingList) return 'Your list is still being checked. One moment.';
      if (!listCheck?.summary?.ready) return listCheck?.error || 'Your list has no contacts that can be used.';
    }
    if (sendType === 'later') {
      if (!scheduledAt) return 'Pick the date and time to send.';
      if (scheduledAt < nowInZone(timezone)) return 'The scheduled time has already passed. Pick a time in the future.';
    }
    return '';
  };

  const handleReview = async (e) => {
    e.preventDefault();
    const problem = validateForm();
    setFormError(problem);
    if (problem) return;
    setSubmitting(true);
    try {
      let finalTarget = targetStatus === AUDIENCE_TAG ? 'all' : targetStatus;
      if (targetStatus === AUDIENCE_LIST) {
        if (savedList.current?.key !== listKey) {
          const saved = await campaignsApi.uploadList({ file: listFile, clientId, templateParameters, save: true });
          savedList.current = { key: listKey, batchId: saved.batch_id };
        }
        finalTarget = savedList.current.batchId;
      }
      const payload = {
        name: name.trim(), client_id: clientId, template_id: templateId,
        target_status: finalTarget, target_tag_id: targetStatus === AUDIENCE_TAG ? Number(tagId) : null,
        // A wall-clock time: the server reads it in the workspace's time zone.
        scheduled_at: sendType === 'later' ? scheduledAt : null,
        template_parameters: templateParameters,
      };
      const { preview } = await api.previewCampaign(payload);
      setSendRestLater(false);
      setPreviewState({ data: preview, payload });
    } catch (err) {
      setFormError(friendlyError(err, 'Could not prepare the campaign. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmSend = async () => {
    const p = previewState?.data;
    if (!p?.can_send || (p.sending?.over_limit && !sendRestLater)) return;
    setSubmitting(true);
    try {
      const res = await api.createCampaign({ ...previewState.payload, preview_confirmed: true, send_rest_later: Boolean(p.sending?.over_limit && sendRestLater) });
      const created = res.campaign;
      setPreviewState(null);
      resetForm();
      fetchCampaigns({ quiet: true });
      loadBrandData();
      if (created.scheduled_at) {
        toast.success(`Scheduled for ${formatInZone(created.scheduled_at, timezone, { withZone: true })}`);
        setTab('list');
      } else {
        setProgressView({ id: created.id, name: created.name, expected: p.audience?.will_send || 0, progress: null });
      }
    } catch (err) {
      if (err.code === 'DAILY_LIMIT_EXCEEDED') {
        setPreviewState((prev) => prev && { ...prev, data: { ...prev.data, sending: { ...prev.data.sending, ...(err.response?.data?.sending || {}), over_limit: true } } });
      }
      toast.error(friendlyError(err, 'Could not start the campaign. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setName('');
    setTemplateId('');
    setTemplateParameters({ body: {}, header: {} });
    setTagId('');
    setListFile(null);
    setListCheck(null);
    savedList.current = null;
    setSendType('now');
    setScheduledAt('');
    setFormError('');
  };

  // ── live progress after launch ────────────────────────────
  useEffect(() => {
    if (!progressView?.id || progressView.progress?.done) return undefined;
    let stopped = false;
    let failures = 0;
    const poll = async () => {
      try {
        const { progress } = await campaignsApi.progress(progressView.id);
        failures = 0;
        if (!stopped) setProgressView((prev) => (prev && prev.id === progress.id ? { ...prev, progress } : prev));
        if (progress.done) fetchCampaigns({ quiet: true });
      } catch {
        failures += 1;
        if (failures >= 5 && !stopped) setProgressView((prev) => prev && { ...prev, pollError: 'We lost touch with the server. Sending continues in the background; check the campaign list in a minute.' });
      }
    };
    poll();
    const timer = setInterval(poll, 2000);
    return () => { stopped = true; clearInterval(timer); };
  }, [progressView?.id, progressView?.progress?.done]);

  // Keep the list fresh while something is sending or waiting to start.
  const hasActive = campaigns.some((c) => ['running'].includes(c.status) || (c.status === 'scheduled' && !c.scheduled_at));
  useEffect(() => {
    if (!hasActive || tab !== 'list') return undefined;
    const timer = setInterval(() => fetchCampaigns({ quiet: true }), 5000);
    return () => clearInterval(timer);
  }, [hasActive, tab, fetchCampaigns]);

  // ── reports, cancel, edit, delete ─────────────────────────
  const handleViewReport = async (c) => {
    setReportModal(c);
    setReportFilter('all');
    setLoadingLogs(true);
    try {
      const res = await api.getCampaignLogs(c.id);
      setCampaignLogs(res.logs || []);
    } catch (err) {
      setCampaignLogs([]);
      toast.error(friendlyError(err, 'Could not load the report.'));
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleRetry = async (c) => {
    try {
      await api.retryCampaign(c.id);
      toast.success('Campaign restarted');
      setProgressView({ id: c.id, name: c.name, expected: 0, progress: null });
      fetchCampaigns({ quiet: true });
    } catch (err) {
      toast.error(friendlyError(err, 'Could not restart the campaign. Please try again in a few minutes.'));
    }
  };

  const handleCancel = async () => {
    const c = cancelModal;
    try {
      await campaignsApi.cancel(c.id);
      toast.success('Campaign cancelled. Nothing was sent.');
      setCancelModal(null);
      fetchCampaigns({ quiet: true });
    } catch (err) {
      toast.error(friendlyError(err, 'Could not cancel the campaign. Please try again.'));
      setCancelModal(null);
      fetchCampaigns({ quiet: true });
    }
  };

  const handleSaveEdit = async () => {
    const edit = editModal;
    if (!edit.name.trim()) return setEditModal({ ...edit, error: 'Give the campaign a name.' });
    if (!edit.scheduledAt || edit.scheduledAt < nowInZone(timezone)) return setEditModal({ ...edit, error: 'Pick a time in the future.' });
    setEditModal({ ...edit, saving: true, error: '' });
    try {
      await campaignsApi.update(edit.campaign.id, { name: edit.name.trim(), scheduled_at: edit.scheduledAt });
      toast.success('Campaign updated');
      setEditModal(null);
      fetchCampaigns({ quiet: true });
    } catch (err) {
      setEditModal({ ...edit, saving: false, error: friendlyError(err, 'Could not update the campaign. Please try again.') });
    }
  };

  const handleConfirmDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteCampaign(deleteModal.id);
      toast.success('Campaign deleted');
      setDeleteModal(null);
      fetchCampaigns({ quiet: true });
    } catch (err) {
      toast.error(friendlyError(err, 'Could not delete the campaign. Please try again.'));
    } finally {
      setDeleting(false);
    }
  };

  // ── derived values for the list ───────────────────────────
  const totalSent = campaigns.reduce((a, c) => a + Number(c.sent_count || 0), 0);
  const totalDelivered = campaigns.reduce((a, c) => a + Number(c.delivered_count || 0), 0);
  const totalRead = campaigns.reduce((a, c) => a + Number(c.read_count || 0), 0);
  const readRate = totalDelivered > 0 ? `${Math.round((totalRead / totalDelivered) * 100)}%` : '—';
  const upcoming = campaigns.filter((c) => c.status === 'scheduled' && c.scheduled_at).length;

  const successLogs = campaignLogs.filter((l) => !['failed', 'skipped'].includes(l.status));
  const failedLogs = campaignLogs.filter((l) => l.status === 'failed');
  const skippedLogs = campaignLogs.filter((l) => l.status === 'skipped');
  const filteredLogs = { success: successLogs, failed: failedLogs, skipped: skippedLogs }[reportFilter] || campaignLogs;

  const audienceLabel = (c) => {
    if (String(c.target_status || '').startsWith('csv_')) return 'Uploaded list';
    if (c.target_tag_id != null) return c.tag_name ? `Tag: ${c.tag_name}` : 'Tagged contacts';
    if (!c.target_status || c.target_status === 'all') return 'All contacts';
    return audience?.statuses?.find((s) => s.value === c.target_status)?.label || `${c.target_status} leads`;
  };

  // ── render ────────────────────────────────────────────────
  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <style>{PAGE_CSS}</style>
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 21, fontWeight: 800, color: C.text }}>Bulk Campaigns</h1>
          <p style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>Send an approved WhatsApp template to many contacts at once, now or later.</p>
        </div>
        {tab === 'list' && (
          <button type="button" onClick={() => setTab('create')} style={primaryButton}><Plus size={14} /> New Campaign</button>
        )}
      </div>

      <div role="tablist" style={{ display: 'flex', background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, overflow: 'hidden', marginBottom: 18, width: 'fit-content' }}>
        {[['list', 'Campaign List'], ['create', 'Create Campaign']].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} type="button" onClick={() => setTab(key)} style={{ padding: '8px 18px', fontSize: 12, fontWeight: 600, border: 'none', background: tab === key ? C.accent : 'transparent', color: tab === key ? '#fff' : C.muted }}>{label}</button>
        ))}
      </div>

      {tab === 'list' ? (
        <>
          <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12, marginBottom: 18 }}>
            {[['Campaigns', formatNumber(campaigns.length), C.accent], ['Scheduled', formatNumber(upcoming), C.blue], ['Messages sent', formatNumber(totalSent), C.green], ['Read rate', readRate, C.purple]].map(([label, value, color]) => (
              <div key={label} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 11, padding: '14px 18px' }}>
                <p style={{ fontSize: 11, color: C.muted, marginBottom: 5 }}>{label}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color }}>{value}</p>
              </div>
            ))}
          </div>

          {listError && <p role="alert" style={{ color: TONES.red.fg, background: TONES.red.bg, border: `1px solid ${TONES.red.border}`, padding: '10px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>{listError}</p>}

          <div className="table-responsive" style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
            {loading && !campaigns.length ? (
              <p style={{ padding: 24, color: C.muted, fontSize: 13 }}>Loading campaigns…</p>
            ) : !campaigns.length ? (
              <div style={{ padding: 36, textAlign: 'center' }}>
                <Send size={28} color={C.dim} style={{ margin: '0 auto 10px' }} />
                <p style={{ color: C.text, fontWeight: 600, fontSize: 14 }}>No campaigns yet</p>
                <p style={{ color: C.muted, fontSize: 13, margin: '4px 0 14px' }}>Create your first campaign to message your contacts in bulk.</p>
                <button type="button" onClick={() => setTab('create')} style={primaryButton}><Plus size={14} /> New Campaign</button>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, background: '#f8fafc' }}>
                    {['Campaign', 'Audience', 'Sent', 'Delivered', 'Read', 'Replied', 'Status', 'When', ''].map((h) => (
                      <th key={h} style={{ padding: '10px 14px', fontSize: 11, color: C.muted, fontWeight: 600, textAlign: 'left' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {campaigns.map((c) => {
                    const st = statusOf(c);
                    const meta = STATUS_META[st] || { label: c.status, tone: 'grey' };
                    const waiting = c.status === 'scheduled' && c.scheduled_at;
                    return (
                      <tr key={c.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{c.name}</div>
                          <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.template_name || 'Template removed'}</div>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: C.muted }}>{audienceLabel(c)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: C.text }}>{formatNumber(c.sent_count)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: C.green }}>{formatNumber(c.delivered_count)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: C.blue }}>{formatNumber(c.read_count)}</td>
                        <td style={{ padding: '12px 14px', fontSize: 13, color: C.purple }}>{formatNumber(c.replied_count)}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <Pill tone={meta.tone}>
                            {st === 'running' && <span className="cmp-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: TONES.amber.fg }} />}
                            {meta.label}
                          </Pill>
                          {Number(c.failed_count) > 0 && <div style={{ fontSize: 11, color: TONES.red.fg, marginTop: 3 }}>{formatNumber(c.failed_count)} failed</div>}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: C.text, whiteSpace: 'nowrap' }}>
                          {waiting ? (
                            <><div>{formatInZone(c.scheduled_at, timezone)}</div><div style={{ fontSize: 11, color: C.blue, marginTop: 2 }}>Sends automatically</div></>
                          ) : (
                            <><div>{formatInZone(c.launched_at || c.scheduled_at || c.created_at, timezone)}</div><div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{c.scheduled_at ? 'Was scheduled' : 'Sent now'}</div></>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {waiting ? (
                              <>
                                <button type="button" title="Change name or time" onClick={() => setEditModal({ campaign: c, name: c.name, scheduledAt: toZoneInput(c.scheduled_at, timezone), error: '' })} style={{ ...secondaryButton, padding: '6px 10px' }}><Pencil size={13} /> Edit</button>
                                <button type="button" title="Cancel this campaign" onClick={() => setCancelModal(c)} style={{ ...secondaryButton, padding: '6px 10px', color: TONES.red.fg }}><Ban size={13} /> Cancel</button>
                              </>
                            ) : (
                              <button type="button" onClick={() => (st === 'running' || st === 'starting' ? setProgressView({ id: c.id, name: c.name, expected: 0, progress: null }) : handleViewReport(c))} style={{ ...secondaryButton, padding: '6px 10px' }}>
                                <BarChart3 size={13} /> {st === 'running' || st === 'starting' ? 'Watch' : 'Report'}
                              </button>
                            )}
                            {c.status === 'failed' && (
                              <button type="button" title="Try again" onClick={() => handleRetry(c)} style={{ ...secondaryButton, padding: '6px 10px' }}><RefreshCw size={13} /> Retry</button>
                            )}
                            {c.status !== 'running' && (
                              <button type="button" title="Delete campaign" aria-label="Delete campaign" onClick={() => setDeleteModal(c)} style={{ background: 'transparent', border: 'none', color: C.dim, padding: 6, display: 'flex' }}><Trash2 size={15} /></button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : (
        <form onSubmit={handleReview} className="cmp-create" noValidate>
          {/* ── Left: setup ── */}
          <Card title="Campaign setup" subtitle="Name it and choose who receives it." icon={Users}>
            <Field label="Campaign name">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Diwali offer for hot leads" maxLength={120} style={inputStyle} />
            </Field>

            <Field label="Brand" hint={clients.length === 1 ? 'Your workspace brand is selected.' : undefined}>
              <select value={clientId} onChange={(e) => { setClientId(e.target.value); setTemplateId(''); setTemplateParameters({ body: {}, header: {} }); }} style={inputStyle}>
                {!clients.length && <option value="">No brand yet</option>}
                {clients.length > 1 && !clientId && <option value="">Select a brand</option>}
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{isBrandConnected(c) ? '' : ' (WhatsApp not connected)'}</option>)}
              </select>
            </Field>

            <Field label="Target audience" hint={audience?.error || (audience && !audience.total ? 'You have no contacts yet. Upload a list to send to new people.' : 'Only groups that have contacts are shown.')}>
              <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} style={inputStyle} disabled={!audience}>
                {!audience && <option value="">Counting contacts…</option>}
                {audience?.statuses?.map((s) => <option key={s.value} value={s.value}>{s.label} ({formatNumber(s.count)})</option>)}
                {audience?.total > 0 && <option value="all">All contacts ({formatNumber(audience.total)})</option>}
                {audience?.tags?.length > 0 && <option value={AUDIENCE_TAG}>Contacts with a tag</option>}
                {audience && <option value={AUDIENCE_LIST}>Upload Custom List</option>}
              </select>
            </Field>

            {targetStatus === AUDIENCE_TAG && (
              <Field label="Tag">
                <select value={tagId} onChange={(e) => setTagId(e.target.value)} style={inputStyle}>
                  <option value="">Select a tag</option>
                  {audience?.tags?.map((tag) => <option key={tag.id} value={tag.id}>{tag.name} ({formatNumber(tag.lead_count)})</option>)}
                </select>
              </Field>
            )}

            {targetStatus === AUDIENCE_LIST && (
              <Field
                label="Contact list"
                action={<button type="button" onClick={downloadSample} style={linkButton}><Download size={13} /> Download sample file</button>}
                hint={<>Columns: <strong>phone</strong> (with country code, e.g. 919876543210), <strong>name</strong> (optional), <strong>whatsapp_opt_in</strong> (yes for people who agreed to offers){usesListValues ? <>, and one column per value marked “From my uploaded list”</> : null}. CSV or Excel, up to 10,000 rows.</>}
              >
                <div
                  className="cmp-drop"
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInput.current?.click()}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.current?.click(); } }}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
                  style={{ border: `1.5px dashed ${dragOver ? C.accent : listCheck?.summary?.ready ? C.green : C.border}`, background: dragOver ? C.accentDim : C.surface, borderRadius: 10, padding: '22px 16px', textAlign: 'center', cursor: 'pointer', transition: 'all .15s' }}
                >
                  <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ''; }} style={{ display: 'none' }} />
                  {listFile ? <FileSpreadsheet size={26} color={C.green} style={{ margin: '0 auto 8px' }} /> : <Upload size={26} color={C.muted} style={{ margin: '0 auto 8px' }} />}
                  <p style={{ fontSize: 13, color: C.text, fontWeight: 600 }}>{listFile ? listFile.name : 'Drag your file here, or click to choose'}</p>
                  <p style={{ fontSize: 11, color: C.muted, marginTop: 3 }}>{listFile ? 'Click to choose a different file' : '.csv or .xlsx'}</p>
                </div>
                {checkingList && <p style={{ fontSize: 12, color: C.muted, marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}><RefreshCw size={13} className="cmp-spin" /> Checking every row…</p>}
                {listCheck && <ListSummary check={listCheck} />}
              </Field>
            )}
          </Card>

          {/* ── Right: message & schedule ── */}
          <Card
            title="Message & schedule"
            subtitle="Pick an approved template and when to send."
            icon={Send}
          >
            <Field
              label="Approved template"
              action={(
                <button type="button" onClick={() => syncTemplatesFromMeta(selectedBrand ? [selectedBrand] : clients, { manual: true })} disabled={syncingTemplates} style={{ ...linkButton, opacity: syncingTemplates ? 0.6 : 1 }}>
                  <RefreshCw size={13} className={syncingTemplates ? 'cmp-spin' : undefined} /> {syncingTemplates ? 'Syncing…' : 'Sync from Meta'}
                </button>
              )}
            >
              <select value={templateId} onChange={(e) => {
                const template = templates.find((item) => String(item.id) === String(e.target.value));
                setTemplateId(e.target.value);
                setTemplateParameters(createDefaultParameterMappings(template));
              }} style={inputStyle}>
                <option value="">{campaignTemplates.length ? 'Select a template' : 'No approved templates'}</option>
                {campaignTemplates.map((t) => {
                  const problem = getCampaignTemplateError(t);
                  return <option key={t.id} value={t.id} disabled={Boolean(problem)}>{t.name} · {isMarketing(t) ? 'Marketing' : String(t.category || 'Utility').charAt(0) + String(t.category || 'utility').slice(1).toLowerCase()}{problem ? ' (cannot be used)' : ''}</option>;
                })}
              </select>
              {!campaignTemplates.length && (
                <p style={{ color: C.muted, fontSize: 12, marginTop: 6 }}>
                  {syncingTemplates ? 'Syncing templates from Meta…'
                    : selectedBrand && !isBrandConnected(selectedBrand) ? 'WhatsApp is not connected for this brand. Connect it in Settings first.'
                      : 'No approved templates yet. Create one in Templates, or click Sync from Meta.'}
                </p>
              )}
              {selectedTemplate && getCampaignTemplateError(selectedTemplate) && <p style={{ color: TONES.red.fg, fontSize: 12, marginTop: 6 }}>{getCampaignTemplateError(selectedTemplate)}</p>}
            </Field>

            {selectedTemplate && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                  {isMarketing(selectedTemplate) ? <Pill tone="amber"><ShieldCheck size={12} /> Marketing · opt-in needed</Pill> : <Pill tone="blue">{String(selectedTemplate.category || 'Utility').toLowerCase()}</Pill>}
                  {selectedTemplate.language && <Pill>{selectedTemplate.language}</Pill>}
                </div>
                {isMarketing(selectedTemplate) && (
                  <p style={{ fontSize: 12, color: TONES.amber.fg, background: TONES.amber.bg, border: `1px solid ${TONES.amber.border}`, padding: '8px 10px', borderRadius: 8, marginBottom: 10, lineHeight: 1.5 }}>
                    Marketing messages go only to contacts who agreed to receive offers on WhatsApp. Everyone else is skipped automatically, and you are not charged for them.
                  </p>
                )}
                <TemplatePreview template={selectedTemplate} mappings={templateParameters} campaignName={name} brandName={selectedBrand?.name} />
              </div>
            )}

            {selectedTemplate && ['header', 'body'].map((section) => {
              const variables = getTemplateVariables(selectedTemplate?.[section]);
              if (!variables.length) return null;
              return (
                <div key={section} style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <p style={{ fontSize: 12, color: C.text, fontWeight: 700 }}>{section === 'header' ? 'Header values' : 'Message values'}</p>
                  <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 10px' }}>Fill each {'{{n}}'} in the template.</p>
                  {variables.map((number) => {
                    const mapping = templateParameters[section]?.[String(number)] || { source: 'custom', value: '', section, number };
                    const update = (next) => setTemplateParameters((current) => ({ ...current, [section]: { ...current[section], [String(number)]: { ...mapping, ...next } } }));
                    const label = selectedTemplate?.parameter_definitions?.[section]?.[String(number)]?.label;
                    return (
                      <div key={number} style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, .6fr) minmax(0, 1.2fr) minmax(0, 1.4fr)', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ color: C.accent, fontSize: 12, fontWeight: 700 }}>{`{{${number}}}`}{label && <small style={{ display: 'block', color: C.muted, fontSize: 10, fontWeight: 500 }}>{label}</small>}</span>
                        <select aria-label={`Value source for {{${number}}}`} value={mapping.source} onChange={(e) => update({ source: e.target.value, value: e.target.value === 'custom' ? mapping.value : '' })} style={{ ...inputStyle, padding: '7px 8px', fontSize: 12 }}>
                          {Object.entries(SOURCE_LABELS).map(([value, text]) => (
                            <option key={value} value={value} disabled={value === 'excel_parameter' && targetStatus !== AUDIENCE_LIST}>{text}{value === 'excel_parameter' && targetStatus !== AUDIENCE_LIST ? ' (needs a list)' : ''}</option>
                          ))}
                        </select>
                        {mapping.source === 'custom' ? (
                          <input aria-label={`Text for {{${number}}}`} value={mapping.value || ''} onChange={(e) => update({ value: e.target.value })} placeholder="Type the text" style={{ ...inputStyle, padding: '7px 8px', fontSize: 12, borderColor: mapping.value?.trim() ? C.border : '#fca5a5' }} />
                        ) : (
                          <span style={{ color: C.muted, fontSize: 11 }}>{mapping.source === 'excel_parameter' ? `Column “${section === 'header' ? 'Header' : 'Body'} {{${number}}}”` : 'Filled for each contact'}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <Field label="When to send" hint={sendType === 'later' ? `Time is in your workspace time zone (${timezone === 'Asia/Kolkata' ? 'India, IST' : timezone}). It sends automatically; you can edit or cancel it until then.` : undefined}>
              <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', maxWidth: 360 }}>
                {[['now', 'Send now', Send], ['later', 'Schedule later', Clock]].map(([key, label, Icon]) => (
                  <button key={key} type="button" aria-pressed={sendType === key} onClick={() => { setSendType(key); if (key === 'later' && !scheduledAt) setScheduledAt(nowInZone(timezone, 60)); }} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 12px', fontSize: 12, fontWeight: 600, border: 'none', background: sendType === key ? C.accent : 'transparent', color: sendType === key ? '#fff' : C.muted }}>
                    <Icon size={14} /> {label}
                  </button>
                ))}
              </div>
              {sendType === 'later' && (
                <input type="datetime-local" aria-label="Send date and time" value={scheduledAt} min={nowInZone(timezone)} onChange={(e) => setScheduledAt(e.target.value)} style={{ ...inputStyle, marginTop: 10, maxWidth: 360 }} />
              )}
            </Field>
          </Card>

          {/* ── Summary ── */}
          <Card style={{ gridColumn: '1 / -1' }}>
            <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1fr)', gap: 20, alignItems: 'center' }}>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 }}>Summary</h3>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
                  <SummaryItem label="Audience" value={estimate == null ? '—' : `${formatNumber(estimate)} contact${estimate === 1 ? '' : 's'}`} note={targetStatus === AUDIENCE_LIST ? 'from your list' : (selectedTemplate && isMarketing(selectedTemplate) ? 'opted-in only receive it' : undefined)} />
                  <SummaryItem label="Template" value={selectedTemplate?.name || '—'} />
                  <SummaryItem label="Sends" value={sendType === 'now' ? 'Right away' : scheduledAt ? `${formatLocalInput(scheduledAt)}${timezone === 'Asia/Kolkata' ? ' IST' : ''}` : 'Pick a time'} />
                </div>
              </div>
              <LimitCard limit={limit} estimate={estimate} sendNow={sendType === 'now'} />
            </div>
            {overToday && (
              <p style={{ marginTop: 14, fontSize: 12, color: TONES.amber.fg, background: TONES.amber.bg, border: `1px solid ${TONES.amber.border}`, padding: '9px 11px', borderRadius: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>This audience is larger than what your number can still send today ({formatNumber(limitLeft)}). You can send the first {formatNumber(limitLeft)} now and the rest tomorrow, schedule it for another day, or pick a smaller audience.</span>
              </p>
            )}
            {formError && <p role="alert" style={{ marginTop: 14, fontSize: 13, color: TONES.red.fg, background: TONES.red.bg, border: `1px solid ${TONES.red.border}`, padding: '9px 11px', borderRadius: 8 }}>{formError}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
              <button type="button" onClick={() => { resetForm(); setTab('list'); }} style={secondaryButton}>Cancel</button>
              <button type="submit" disabled={submitting || checkingList} style={{ ...primaryButton, opacity: submitting || checkingList ? 0.7 : 1, minWidth: 200 }}>
                {submitting ? <><RefreshCw size={14} className="cmp-spin" /> Preparing…</> : <>{sendType === 'now' ? <Send size={14} /> : <Clock size={14} />} Review before {sendType === 'now' ? 'sending' : 'scheduling'}</>}
              </button>
            </div>
          </Card>
        </form>
      )}

      {/* ── Review before sending ── */}
      {previewState && (() => {
        const p = previewState.data;
        const left = p.audience?.left_out || {};
        const skipped = (left.no_consent || 0) + (left.opted_out || 0) + (left.invalid_phone || 0);
        const needsAgreement = p.can_send && p.sending?.over_limit;
        const canConfirm = p.can_send && (!needsAgreement || sendRestLater) && !submitting;
        return (
          <Modal label="Review before sending">
            <ModalHeader title="Review before sending" subtitle="Nothing has been sent yet." onClose={() => setPreviewState(null)} />
            <div style={{ padding: 20, overflowY: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <Stat big label="Will receive it" value={formatNumber(p.audience?.will_send)} tone="green" />
                <Stat big label="In this audience" value={formatNumber(p.audience?.total)} tone="grey" />
              </div>
              {skipped > 0 && (
                <p style={{ fontSize: 12, color: C.muted, marginBottom: 12, lineHeight: 1.6 }}>
                  Skipped: {left.no_consent > 0 && <>{formatNumber(left.no_consent)} have not agreed to marketing messages{(left.opted_out || left.invalid_phone) ? ', ' : ''}</>}
                  {left.opted_out > 0 && <>{formatNumber(left.opted_out)} asked you to stop{left.invalid_phone ? ', ' : ''}</>}
                  {left.invalid_phone > 0 && <>{formatNumber(left.invalid_phone)} have no valid number</>}.
                </p>
              )}
              {p.template && (
                <p style={{ fontSize: 12, color: C.text, marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  Template <strong>{p.template.name}</strong> {isMarketing(p.template) ? <Pill tone="amber">Marketing</Pill> : <Pill tone="blue">{String(p.template.category || 'utility').toLowerCase()}</Pill>}
                </p>
              )}
              {p.sample?.map((example, index) => (
                <div key={index} style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: C.muted, marginBottom: 4 }}>Example to {example.name || 'a contact'} ({example.phone})</div>
                  <div style={{ fontSize: 13, color: C.text, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{example.message}</div>
                </div>
              ))}
              <p style={{ fontSize: 12, color: C.muted, margin: '10px 0' }}>
                {p.schedule?.immediate ? 'Starts as soon as you confirm.' : `Sends automatically on ${p.schedule?.local || formatInZone(p.schedule?.at, timezone)} (${(p.timezone || timezone) === 'Asia/Kolkata' ? 'IST' : p.timezone || timezone}).`}
              </p>
              {p.sending && (
                <p style={{ fontSize: 12, color: C.muted, marginBottom: 10 }}>
                  Daily limit: {formatNumber(p.sending.used_today)} of {formatNumber(p.sending.daily_limit)} messages used today.
                </p>
              )}
              {p.warnings?.map((w) => <p key={w} style={{ fontSize: 12, color: TONES.amber.fg, marginBottom: 6 }}>{w}</p>)}
              {p.blockers?.map((b) => <p key={b} role="alert" style={{ fontSize: 13, color: TONES.red.fg, background: TONES.red.bg, border: `1px solid ${TONES.red.border}`, padding: '8px 10px', borderRadius: 8, marginBottom: 6 }}>{b}</p>)}
              {needsAgreement && (
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: C.text, background: TONES.amber.bg, border: `1px solid ${TONES.amber.border}`, padding: '10px 12px', borderRadius: 8, marginTop: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={sendRestLater} onChange={(e) => setSendRestLater(e.target.checked)} style={{ marginTop: 2 }} />
                  <span>
                    Send the first {formatNumber(p.sending.available_on_send_day)} {p.schedule?.immediate ? 'today' : 'on that day'} and the remaining {formatNumber(p.sending.overflow)} automatically {p.sending.days_needed > 2 ? `over the next ${p.sending.days_needed - 1} days` : 'the next day'}.
                    <span style={{ display: 'block', fontSize: 11, color: C.muted, marginTop: 2 }}>Without this, the campaign cannot start: it is larger than your number's daily limit.</span>
                  </span>
                </label>
              )}
            </div>
            <div style={{ padding: '14px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => setPreviewState(null)} style={{ ...secondaryButton, flex: 1 }}>Go back and edit</button>
              <button type="button" onClick={handleConfirmSend} disabled={!canConfirm} style={{ ...primaryButton, flex: 1, background: canConfirm ? C.green : '#cbd5e1', cursor: canConfirm ? 'pointer' : 'not-allowed' }}>
                {submitting ? 'Starting…' : p.schedule?.immediate ? 'Confirm and send' : 'Confirm and schedule'}
              </button>
            </div>
          </Modal>
        );
      })()}

      {/* ── Live sending progress ── */}
      {progressView && (
        <ProgressModal
          view={progressView}
          timezone={timezone}
          onClose={() => { setProgressView(null); setTab('list'); fetchCampaigns({ quiet: true }); }}
          onReport={() => {
            const c = campaigns.find((x) => x.id === progressView.id) || { id: progressView.id, name: progressView.name, status: progressView.progress?.status };
            setProgressView(null);
            setTab('list');
            handleViewReport(c);
          }}
        />
      )}

      {/* ── Report ── */}
      {reportModal && (
        <Modal label="Campaign report" maxWidth={720}>
          <ModalHeader title={reportModal.name} subtitle={`${reportModal.template_name || 'Template'} · ${audienceLabel(reportModal)}`} onClose={() => setReportModal(null)} extra={<Pill tone={(STATUS_META[statusOf(reportModal)] || {}).tone || 'grey'}>{(STATUS_META[statusOf(reportModal)] || {}).label || reportModal.status}</Pill>} />
          <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 10, marginBottom: 16 }}>
              <Stat label="Sent" value={formatNumber(reportModal.sent_count)} tone="blue" />
              <Stat label="Delivered" value={formatNumber(reportModal.delivered_count)} tone="green" />
              <Stat label="Read" value={formatNumber(reportModal.read_count)} tone="purple" />
              <Stat label="Replied" value={formatNumber(reportModal.replied_count)} tone="purple" />
              <Stat label="Failed" value={formatNumber(reportModal.failed_count)} tone="red" />
              <Stat label="Skipped" value={formatNumber(reportModal.skipped_count)} tone="grey" />
            </div>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 12 }}>
              {reportModal.scheduled_at ? `Scheduled for ${formatInZone(reportModal.scheduled_at, timezone, { withZone: true })}` : `Sent on ${formatInZone(reportModal.launched_at || reportModal.created_at, timezone, { withZone: true })}`}
            </p>
            {campaignLogs.length > 0 && (
              <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden', width: 'fit-content', marginBottom: 12, flexWrap: 'wrap' }}>
                {[['all', `All (${campaignLogs.length})`], ['success', `Sent (${successLogs.length})`], ['failed', `Failed (${failedLogs.length})`], ['skipped', `Skipped (${skippedLogs.length})`]].map(([key, label]) => (
                  <button key={key} type="button" onClick={() => setReportFilter(key)} style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, border: 'none', background: reportFilter === key ? C.accent : 'transparent', color: reportFilter === key ? '#fff' : C.muted }}>{label}</button>
                ))}
              </div>
            )}
            {loadingLogs ? (
              <p style={{ color: C.muted, fontSize: 13 }}>Loading…</p>
            ) : !campaignLogs.length ? (
              <p style={{ color: C.muted, fontSize: 13 }}>
                {reportModal.status === 'failed' ? 'This campaign could not start. Check that the template is still approved and that your audience has contacts, then try again.'
                  : reportModal.status === 'cancelled' ? 'This campaign was cancelled before it started. Nothing was sent.'
                    : 'No messages have been sent yet.'}
              </p>
            ) : !filteredLogs.length ? (
              <p style={{ color: C.muted, fontSize: 13 }}>Nobody in this group.</p>
            ) : (
              <div className="table-responsive" style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead style={{ background: '#f8fafc' }}>
                    <tr>{['Name', 'Phone', 'Status', 'Time'].map((h) => <th key={h} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const tone = log.status === 'failed' ? 'red' : log.status === 'skipped' ? 'grey' : log.status === 'read' || log.status === 'replied' ? 'purple' : log.status === 'delivered' ? 'green' : 'blue';
                      return (
                        <tr key={log.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '9px 12px', fontSize: 13, color: C.text }}>{log.name || 'Unknown'}</td>
                          <td style={{ padding: '9px 12px', fontSize: 12, color: C.muted }}>{log.phone ? `+${String(log.phone).replace(/^\+/, '')}` : '—'}</td>
                          <td style={{ padding: '9px 12px' }}>
                            <Pill tone={tone} style={{ textTransform: 'capitalize' }}>{log.status}</Pill>
                            {log.error_message && <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{plainReason(log.error_message)}</div>}
                          </td>
                          <td style={{ padding: '9px 12px', fontSize: 12, color: C.muted, whiteSpace: 'nowrap' }}>{log.sent_at ? formatInZone(log.sent_at, timezone) : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setReportModal(null)} style={secondaryButton}>Close</button>
          </div>
        </Modal>
      )}

      {/* ── Edit a scheduled campaign ── */}
      {editModal && (
        <Modal label="Edit scheduled campaign" maxWidth={440}>
          <ModalHeader title="Edit scheduled campaign" subtitle="You can change it until it starts." onClose={() => setEditModal(null)} />
          <div style={{ padding: 20 }}>
            <Field label="Campaign name"><input value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} style={inputStyle} maxLength={120} /></Field>
            <Field label="Send on" hint={`Time zone: ${timezone === 'Asia/Kolkata' ? 'India (IST)' : timezone}`}>
              <input type="datetime-local" value={editModal.scheduledAt} min={nowInZone(timezone)} onChange={(e) => setEditModal({ ...editModal, scheduledAt: e.target.value })} style={inputStyle} />
            </Field>
            {editModal.error && <p role="alert" style={{ color: TONES.red.fg, fontSize: 13 }}>{editModal.error}</p>}
          </div>
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setEditModal(null)} style={secondaryButton}>Close</button>
            <button type="button" onClick={handleSaveEdit} disabled={editModal.saving} style={primaryButton}>{editModal.saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </Modal>
      )}

      {/* ── Cancel a scheduled campaign ── */}
      {cancelModal && (
        <Modal label="Cancel campaign" maxWidth={420}>
          <ModalHeader title="Cancel this campaign?" onClose={() => setCancelModal(null)} />
          <div style={{ padding: 20, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            <strong>{cancelModal.name}</strong> was going to send on {formatInZone(cancelModal.scheduled_at, timezone, { withZone: true })}. If you cancel it, nothing will be sent. You can still see it in the list.
          </div>
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setCancelModal(null)} style={secondaryButton}>Keep it</button>
            <button type="button" onClick={handleCancel} style={{ ...primaryButton, background: TONES.red.fg }}><Ban size={14} /> Cancel campaign</button>
          </div>
        </Modal>
      )}

      {/* ── Delete ── */}
      {deleteModal && (
        <Modal label="Delete campaign" maxWidth={420}>
          <ModalHeader title="Delete this campaign?" onClose={() => setDeleteModal(null)} />
          <div style={{ padding: 20, fontSize: 13, color: C.text, lineHeight: 1.6 }}>
            <strong>{deleteModal.name}</strong> and its delivery report will be deleted. Messages already sent stay in your chats. This cannot be undone.
          </div>
          <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => setDeleteModal(null)} style={secondaryButton}>Keep it</button>
            <button type="button" onClick={handleConfirmDelete} disabled={deleting} style={{ ...primaryButton, background: TONES.red.fg, opacity: deleting ? 0.7 : 1 }}><Trash2 size={14} /> {deleting ? 'Deleting…' : 'Delete'}</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ── pieces of the create form ───────────────────────────────

const SummaryItem = ({ label, value, note }) => (
  <div style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px', minWidth: 0 }}>
    <div style={{ fontSize: 11, color: C.muted }}>{label}</div>
    <div style={{ fontSize: 13, color: C.text, fontWeight: 700, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(value)}>{value}</div>
    {note && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{note}</div>}
  </div>
);

const LimitCard = ({ limit, estimate, sendNow }) => {
  if (!limit) return <div style={{ fontSize: 12, color: C.muted }}>Loading your daily limit…</div>;
  if (limit.error) return <div style={{ fontSize: 12, color: C.muted }}>{limit.error}</div>;
  if (!limit.connected) return <div style={{ fontSize: 12, color: TONES.amber.fg }}>No WhatsApp number is connected for this brand. Connect it in Settings to send campaigns.</div>;
  const used = Number(limit.used_today || 0);
  const cap = Number(limit.daily_limit || 0);
  const pct = cap > 0 ? used / cap : 0;
  const tone = pct >= 0.9 ? 'red' : pct >= 0.7 ? 'amber' : 'green';
  const planned = sendNow && estimate ? Math.min(estimate, Math.max(0, cap - used)) : 0;
  return (
    <div style={{ background: '#f8fafc', border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: C.text }}><Gauge size={14} color={TONES[tone].fg} /> Daily sending limit</span>
        {limit.quality_rating && limit.quality_rating !== 'UNKNOWN' && (
          <Pill tone={['GREEN', 'HIGH'].includes(limit.quality_rating) ? 'green' : ['YELLOW', 'MEDIUM'].includes(limit.quality_rating) ? 'amber' : 'red'}>Quality: {({ GREEN: 'High', HIGH: 'High', YELLOW: 'Medium', MEDIUM: 'Medium', RED: 'Low', LOW: 'Low' })[limit.quality_rating] || limit.quality_rating}</Pill>
        )}
      </div>
      <p style={{ fontSize: 14, color: C.text, marginBottom: 8 }}>Today: <strong>{formatNumber(used)}</strong> of <strong>{formatNumber(cap)}</strong> messages used</p>
      <Bar total={cap} parts={[[used, TONES[tone].fg], [planned, '#93c5fd']]} />
      <p style={{ fontSize: 11, color: C.muted, marginTop: 7, lineHeight: 1.5 }}>
        {formatNumber(Math.max(0, cap - used))} left today{planned ? `, this campaign uses ${formatNumber(planned)}` : ''}. Resets daily at 5:30 AM IST.
        {limit.messaging_limit && <> Meta lets this number message {TIER_TEXT[limit.messaging_limit] || limit.messaging_limit}.</>}
      </p>
      {limit.marketing_paused && <p style={{ fontSize: 12, color: TONES.red.fg, marginTop: 6 }}>Marketing is paused on this number until Meta rates it healthy again.</p>}
    </div>
  );
};

const ListSummary = ({ check }) => {
  const s = check.summary;
  if (check.error && !s) {
    return <p role="alert" style={{ marginTop: 10, fontSize: 12, color: TONES.red.fg, background: TONES.red.bg, border: `1px solid ${TONES.red.border}`, padding: '9px 11px', borderRadius: 8, display: 'flex', gap: 6 }}><AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} /> {check.error}</p>;
  }
  const ok = s.ready > 0;
  return (
    <div style={{ marginTop: 10, border: `1px solid ${ok ? '#bbf7d0' : TONES.red.border}`, background: ok ? '#f0fdf4' : TONES.red.bg, borderRadius: 8, padding: '10px 12px' }}>
      <p style={{ fontSize: 13, color: ok ? TONES.green.fg : TONES.red.fg, fontWeight: 700, display: 'flex', gap: 6, alignItems: 'center' }}>
        {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
        {formatNumber(s.ready)} contact{s.ready === 1 ? '' : 's'} ready{s.skipped_count ? `, ${formatNumber(s.skipped_count)} row${s.skipped_count === 1 ? '' : 's'} skipped` : ''}
      </p>
      {check.error && <p style={{ fontSize: 12, color: TONES.red.fg, marginTop: 4 }}>{check.error}</p>}
      {s.skipped_count > 0 && (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: C.text, lineHeight: 1.6, maxHeight: 120, overflowY: 'auto' }}>
          {s.skipped.map((item) => <li key={item.row}>Row {item.row}: {item.reason}</li>)}
          {s.skipped_count > s.skipped.length && <li style={{ color: C.muted }}>…and {formatNumber(s.skipped_count - s.skipped.length)} more</li>}
        </ul>
      )}
      {s.added_country_code > 0 && <p style={{ fontSize: 11, color: C.muted, marginTop: 6, display: 'flex', gap: 4 }}><Info size={12} style={{ flexShrink: 0, marginTop: 2 }} /> {formatNumber(s.added_country_code)} number{s.added_country_code === 1 ? '' : 's'} had no country code; we added +91 (India).</p>}
      {ok && !s.has_opt_in_column && <p style={{ fontSize: 11, color: TONES.amber.fg, marginTop: 6 }}>Your file has no whatsapp_opt_in column. For marketing templates, only contacts who already agreed to offers will receive it.</p>}
      {ok && s.has_opt_in_column && <p style={{ fontSize: 11, color: C.muted, marginTop: 6 }}>{formatNumber(s.opted_in)} marked as agreed to receive offers.</p>}
    </div>
  );
};

const TemplatePreview = ({ template, mappings, campaignName, brandName }) => {
  const context = { campaignName, brandName };
  const headerText = String(template.header_format || 'TEXT').toUpperCase() === 'TEXT' ? template.header : '';
  const buttons = Array.isArray(template.buttons) ? template.buttons.filter((b) => b?.text) : [];
  return (
    <div style={{ background: '#efeae2', borderRadius: 12, padding: 14 }}>
      <div style={{ background: '#fff', borderRadius: '4px 12px 12px 12px', padding: '10px 12px', maxWidth: 360, boxShadow: '0 1px 1px rgba(0,0,0,.08)' }}>
        {template.header_format && String(template.header_format).toUpperCase() !== 'TEXT' && (
          <div style={{ background: '#e2e8f0', borderRadius: 8, padding: 16, textAlign: 'center', fontSize: 11, color: C.muted, marginBottom: 8 }}>{String(template.header_format).toLowerCase()} header</div>
        )}
        {headerText && <p style={{ fontSize: 13, fontWeight: 700, color: '#111b21', marginBottom: 4 }}>{renderPreview(headerText, 'header', mappings, context)}</p>}
        <p style={{ fontSize: 13, color: '#111b21', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{renderPreview(template.body, 'body', mappings, context)}</p>
        {template.footer && <p style={{ fontSize: 11, color: '#667781', marginTop: 6 }}>{template.footer}</p>}
        {buttons.length > 0 && (
          <div style={{ borderTop: '1px solid #e9edef', marginTop: 8, paddingTop: 6, display: 'grid', gap: 4 }}>
            {buttons.map((b, i) => <span key={i} style={{ textAlign: 'center', color: '#0a7cff', fontSize: 13 }}>{b.text}</span>)}
          </div>
        )}
      </div>
    </div>
  );
};

// ── live sending view ───────────────────────────────────────

const ProgressModal = ({ view, timezone, onClose, onReport }) => {
  const p = view.progress;
  const total = p?.total || view.expected || 0;
  const processed = p ? p.sent + p.failed + p.skipped : 0;
  const done = Boolean(p?.done);
  const preparing = !p || (p.total === 0 && !done);
  const waitingForTomorrow = p && !done && p.queued > 0 && p.waiting_until && new Date(p.waiting_until) - new Date(p.server_time) > 10 * 60 * 1000;
  const phase = done ? (p.status === 'completed' ? 'done' : 'failed') : preparing ? 'preparing' : waitingForTomorrow ? 'waiting' : 'sending';
  const steps = [['preparing', 'Queued'], ['sending', 'Sending'], ['done', 'Done']];
  const stepIndex = phase === 'preparing' ? 0 : phase === 'sending' || phase === 'waiting' ? 1 : 2;
  return (
    <Modal label="Sending campaign" maxWidth={520}>
      <ModalHeader
        title={done ? (phase === 'done' ? 'Campaign sent' : 'Campaign could not be sent') : 'Sending your campaign'}
        subtitle={view.name}
        onClose={onClose}
        extra={!done && <Pill tone="amber"><span className="cmp-pulse" style={{ width: 6, height: 6, borderRadius: 999, background: TONES.amber.fg }} /> Live</Pill>}
      />
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          {steps.map(([key, label], i) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, flex: i < steps.length - 1 ? 1 : 'none' }}>
              <span style={{ width: 24, height: 24, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 700, background: i < stepIndex || (done && i === stepIndex) ? (phase === 'failed' && i === 2 ? TONES.red.fg : C.green) : i === stepIndex ? C.accent : '#e2e8f0', color: i <= stepIndex ? '#fff' : C.muted, transition: 'background .3s' }}>
                {i < stepIndex || (done && i === stepIndex) ? (phase === 'failed' && i === 2 ? '!' : '✓') : i + 1}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, color: i <= stepIndex ? C.text : C.muted }}>{label}</span>
              {i < steps.length - 1 && <span style={{ flex: 1, height: 2, background: i < stepIndex ? C.green : '#e2e8f0', transition: 'background .3s' }} />}
            </div>
          ))}
        </div>

        {phase === 'preparing' && (
          <div style={{ textAlign: 'center', padding: '10px 0 18px' }}>
            <Send size={30} color={C.accent} className="cmp-fly" style={{ margin: '0 auto 10px' }} />
            <p style={{ fontSize: 14, color: C.text, fontWeight: 600 }}>Getting your messages ready…</p>
            <p style={{ fontSize: 12, color: C.muted, marginTop: 4 }}>Checking each contact and lining up the messages.</p>
          </div>
        )}

        {phase !== 'preparing' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: C.muted, marginBottom: 6 }}>
              <span>{formatNumber(processed)} of {formatNumber(total)} processed</span>
              <span>{total ? Math.round((processed / total) * 100) : 0}%</span>
            </div>
            <Bar animated={!done} total={total} parts={[[p.sent, C.green], [p.failed, TONES.red.fg], [p.skipped, '#94a3b8']]} height={12} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, marginTop: 14 }}>
              <Stat label="Waiting" value={formatNumber(p.queued)} tone="blue" />
              <Stat label="Sent" value={formatNumber(p.sent)} tone="green" />
              <Stat label="Failed" value={formatNumber(p.failed)} tone="red" />
              <Stat label="Skipped" value={formatNumber(p.skipped)} tone="grey" />
            </div>
            {(p.delivered > 0 || done) && (
              <p style={{ fontSize: 12, color: C.muted, marginTop: 12 }}>
                {formatNumber(p.delivered)} delivered · {formatNumber(p.read)} read{p.replied ? ` · ${formatNumber(p.replied)} replied` : ''} so far. These keep updating as people open your message.
              </p>
            )}
            {phase === 'waiting' && (
              <p style={{ fontSize: 12, color: TONES.amber.fg, background: TONES.amber.bg, border: `1px solid ${TONES.amber.border}`, padding: '9px 11px', borderRadius: 8, marginTop: 12 }}>
                Today's limit is reached. The remaining {formatNumber(p.queued)} will go out automatically from {formatInZone(p.waiting_until, timezone, { withZone: true })}. You can close this window.
              </p>
            )}
            {done && p.skipped > 0 && <p style={{ fontSize: 12, color: C.muted, marginTop: 8 }}>Skipped contacts had not agreed to marketing messages, had asked you to stop, or had an invalid number.</p>}
            {done && phase === 'failed' && <p style={{ fontSize: 12, color: TONES.red.fg, marginTop: 8 }}>No message could be sent. Open the report to see why, fix it, and use Retry from the list.</p>}
          </>
        )}
        {view.pollError && <p style={{ fontSize: 12, color: TONES.amber.fg, marginTop: 10 }}>{view.pollError}</p>}
        {!done && <p style={{ fontSize: 11, color: C.dim, marginTop: 12 }}>Sending continues even if you close this window.</p>}
      </div>
      <div style={{ padding: '12px 20px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
        {done && <button type="button" onClick={onReport} style={secondaryButton}><BarChart3 size={14} /> View report</button>}
        <button type="button" onClick={onClose} style={done ? primaryButton : secondaryButton}>{done ? 'Done' : 'Close'}</button>
      </div>
    </Modal>
  );
};
