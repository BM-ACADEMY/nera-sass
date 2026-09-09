import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, FileSpreadsheet, Trash2, UploadCloud } from 'lucide-react';
import { api } from '../../services/api.js';
import './alliance.css';

const COLUMNS = ['name', 'business_name', 'email', 'phone', 'audience', 'industry', 'location', 'source', 'channel_pref', 'consent', 'consent_source', 'consent_at', 'consent_evidence', 'consent_scope'];
const defaultSystemColumns = () => COLUMNS.map((key) => ({ key, label: key, enabled: true, required: false }));
const normalizeAudienceColumns = (columns) => {
  const configured = new Map((Array.isArray(columns) ? columns : []).map((column) => [column.key, column]));
  return defaultSystemColumns().map((column) => ({ ...column, ...(configured.get(column.key) || {}) }));
};
const requiredSystemKeys = (channel) => new Set([
  ...(['email', 'both'].includes(channel) ? ['email'] : []),
  ...(['whatsapp', 'both'].includes(channel) ? ['phone', 'consent', 'consent_source', 'consent_at', 'consent_evidence', 'consent_scope'] : []),
]);
const enforceChannelColumns = (columns, channel) => {
  const required = requiredSystemKeys(channel);
  return columns.map((column) => required.has(column.key) ? { ...column, enabled: true, required: true } : column);
};
const UPLOAD_DRAFT_KEY = 'alliance_upload_leads_draft_v1';
const readUploadDraft = () => {
  try { return JSON.parse(localStorage.getItem(UPLOAD_DRAFT_KEY) || 'null') || {}; }
  catch { return {}; }
};
const uploadDraftSignature = ({ audience, campaign, channel, fileName, draftFileName }) => JSON.stringify({ audience, campaign, channel, fileName, draftFileName });
const audienceCodeFromLabel = (label) => String(label || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '');

const DEFAULT_AUDIENCES = [
  { code: 'college', label: 'College principals / TPOs', default_channel: 'email', fields: [] },
  { code: 'hr', label: 'Company HR / corporates', default_channel: 'email', fields: [] },
  { code: 'smb', label: 'Local clinics / shops / SMBs', default_channel: 'email', fields: [] },
  { code: 'iv', label: 'IV trip coordinators', default_channel: 'email', fields: [] },
];

export const UploadLeads = () => {
  const [initialDraft] = useState(readUploadDraft);
  const [audience, setAudience] = useState(initialDraft.audience || 'college');
  const [campaign, setCampaign] = useState(initialDraft.campaign || '');
  const [channel, setChannel] = useState(initialDraft.channel || 'auto');
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState('');
  const [draftFileName, setDraftFileName] = useState(initialDraft.file_name || '');
  const [draftStatus, setDraftStatus] = useState(initialDraft.saved_at ? 'Draft restored' : '');
  const [result, setResult] = useState(null);
  const [audiences, setAudiences] = useState(DEFAULT_AUDIENCES);
  const [brandOptions, setBrandOptions] = useState([]);
  const [showAudienceForm, setShowAudienceForm] = useState(false);
  const [editingAudienceCode, setEditingAudienceCode] = useState('');
  const [audienceCodeManuallyEdited, setAudienceCodeManuallyEdited] = useState(false);
  const [deletingAudience, setDeletingAudience] = useState(null);
  const [editingFieldKey, setEditingFieldKey] = useState('');
  const [newAudience, setNewAudienceState] = useState({ code: '', label: '', brand: '', default_channel: 'email', fields: [], system_columns: defaultSystemColumns() });
  const setNewAudience = (next) => {
    const normalizedColumns = normalizeAudienceColumns(next.system_columns);
    const required = requiredSystemKeys(next.default_channel);
    const removedRequired = normalizedColumns.filter((column) => required.has(column.key) && !column.enabled);
    if (removedRequired.length) {
      const channelLabel = next.default_channel === 'both' ? 'Email + WhatsApp' : next.default_channel;
      toast.error(`${removedRequired.map((column) => column.key).join(', ')} cannot be deleted because ${channelLabel} requires it.`);
    }
    setNewAudienceState({ ...next, system_columns: enforceChannelColumns(normalizedColumns, next.default_channel) });
  };
  const [newField, setNewField] = useState({ field_key: '', label: '', data_type: 'auto', required: false, sample_value: '' });
  const [savingAudience, setSavingAudience] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [templatePreview, setTemplatePreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const fileInputRef = useRef(null);
  const discardedDraftSignatureRef = useRef('');

  const loadAudiences = async () => {
    try {
      const data = await api.getAllianceAudiences();
      if (data.audiences?.length) {
        setAudiences(data.audiences);
        setAudience((current) => data.audiences.some((item) => item.code === current) ? current : data.audiences[0].code);
      }
    } catch (_) { /* Database readiness is displayed by upload when used. */ }
  };

  useEffect(() => {
    loadAudiences();
    api.getClients().then((data) => {
      const brands = [...new Set((data.clients || []).map((client) => String(client.name || '').trim()).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b));
      setBrandOptions(brands);
    }).catch(() => setBrandOptions([]));
  }, []);

  useEffect(() => {
    if (uploading || result?.report) return undefined;
    const signature = uploadDraftSignature({ audience, campaign, channel, fileName, draftFileName });
    if (discardedDraftSignatureRef.current === signature) return undefined;
    setDraftStatus('Saving draft…');
    const timer = window.setTimeout(() => {
      try {
        const rememberedFile = fileName || draftFileName || '';
        localStorage.setItem(UPLOAD_DRAFT_KEY, JSON.stringify({
          audience, campaign, channel, file_name: rememberedFile, saved_at: new Date().toISOString(),
        }));
        setDraftFileName(rememberedFile);
        setDraftStatus('Draft saved automatically');
      } catch { setDraftStatus('Draft could not be saved'); }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [audience, campaign, channel, fileName, draftFileName, uploading, result]);

  const discardDraft = () => {
    const resetAudience = audiences[0]?.code || 'college';
    const reset = { audience: resetAudience, campaign: '', channel: 'auto', fileName: '', draftFileName: '' };
    discardedDraftSignatureRef.current = uploadDraftSignature(reset);
    localStorage.removeItem(UPLOAD_DRAFT_KEY);
    setAudience(resetAudience);
    setCampaign('');
    setChannel('auto');
    setFileName('');
    setDraftFileName('');
    setResult(null);
    setDraftStatus('Draft discarded');
    if (fileInputRef.current) fileInputRef.current.value = '';
    toast.success('Draft discarded');
  };

  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      setPreviewLoading(true);
      setPreviewError('');
      try {
        const data = await api.getAllianceAudienceTemplatePreview(audience);
        if (!cancelled) setTemplatePreview(data);
      } catch (error) {
        if (!cancelled) {
          setTemplatePreview(null);
          setPreviewError(error.message || 'Failed to load template preview');
        }
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    loadPreview();
    return () => { cancelled = true; };
  }, [audience]);

  const downloadTemplate = async (event) => {
    event.stopPropagation();
    setDownloadingTemplate(true);
    try {
      const blob = await api.downloadAllianceAudienceTemplate(audience);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `AllianceOS_${audience}_Lead_Template.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(error.message || 'Failed to download Excel template');
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const addAudience = async () => {
    setSavingAudience(true);
    try {
      const wasEditing = Boolean(editingAudienceCode);
      const data = wasEditing ? await api.updateAllianceAudience(editingAudienceCode, newAudience) : await api.createAllianceAudience(newAudience);
      await loadAudiences();
      setAudience(data.audience.code);
      setNewAudience({ code: '', label: '', brand: '', default_channel: 'email', fields: [], system_columns: defaultSystemColumns() });
      setEditingAudienceCode('');
      setAudienceCodeManuallyEdited(false);
      setEditingFieldKey('');
      setShowAudienceForm(false);
      toast.success(wasEditing ? 'Audience and custom fields updated' : 'Audience and custom columns added');
    } catch (error) {
      toast.error(error.message || 'Failed to add audience');
    } finally {
      setSavingAudience(false);
    }
  };

  const addCustomField = () => {
    const fieldKey = newField.field_key.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
    if (!fieldKey) return toast.error('Enter a field name');
    if (!newField.sample_value.trim()) return toast.error('Enter a sample value for this field');
    if (newAudience.fields.some((field) => field.field_key === fieldKey && field.field_key !== editingFieldKey)) return toast.error('That field already exists');
    const nextField = { ...newField, field_key: fieldKey, label: newField.label.trim() || fieldKey.replace(/_/g, ' '), original_field_key: editingFieldKey || undefined };
    setNewAudience({
      ...newAudience,
      fields: editingFieldKey ? newAudience.fields.map((field) => field.field_key === editingFieldKey ? nextField : field) : [...newAudience.fields, nextField],
    });
    setNewField({ field_key: '', label: '', data_type: 'auto', required: false, sample_value: '' });
    setEditingFieldKey('');
  };

  const removeCustomField = (fieldKey) => {
    setNewAudience({ ...newAudience, fields: newAudience.fields.filter((field) => field.field_key !== fieldKey) });
    if (editingFieldKey === fieldKey) { setEditingFieldKey(''); setNewField({ field_key: '', label: '', data_type: 'auto', required: false, sample_value: '' }); }
  };

  const openAddAudience = () => {
    setEditingAudienceCode(''); setEditingFieldKey('');
    setAudienceCodeManuallyEdited(false);
    setNewAudience({ code: '', label: '', brand: '', default_channel: 'email', fields: [], system_columns: defaultSystemColumns() });
    setNewField({ field_key: '', label: '', data_type: 'auto', required: false, sample_value: '' });
    setShowAudienceForm(true);
  };
  const openEditAudience = () => {
    if (!selectedAudience) return;
    setEditingAudienceCode(selectedAudience.code); setEditingFieldKey('');
    setAudienceCodeManuallyEdited(false);
    const existingColumns = normalizeAudienceColumns(selectedAudience.column_config);
    setNewAudience({ code: selectedAudience.code, label: selectedAudience.label, brand: selectedAudience.brand || '', default_channel: selectedAudience.default_channel, fields: (selectedAudience.fields || []).map((field) => ({ ...field })), system_columns: enforceChannelColumns(existingColumns, selectedAudience.default_channel) });
    setNewField({ field_key: '', label: '', data_type: 'auto', required: false, sample_value: '' });
    setShowAudienceForm(true);
  };
  const editCustomField = (field) => {
    setEditingFieldKey(field.field_key);
    setNewField({ field_key: field.field_key, original_field_key: field.field_key, label: field.label || '', data_type: field.data_type, required: Boolean(field.required), sample_value: field.sample_value || '' });
  };
  const confirmDeleteAudience = async () => {
    if (!deletingAudience) return;
    setSavingAudience(true);
    try {
      const result = await api.deleteAllianceAudience(deletingAudience.code);
      toast.success(result.message);
      const remaining = audiences.filter((item) => item.code !== deletingAudience.code);
      setAudiences(remaining); setAudience(remaining[0]?.code || ''); setDeletingAudience(null);
    } catch (error) { toast.error(error.message || 'Failed to delete audience'); }
    finally { setSavingAudience(false); }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const processFile = async (file) => {
    if (!file) return;
    if (!file.name.endsWith('.csv') && !file.name.endsWith('.xlsx')) {
      toast.error('Only CSV or XLSX files are supported.');
      return;
    }
    setFileName(file.name);
    setResult(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('audience', audience);
      formData.append('campaign', campaign);
      formData.append('channel', channel);
      const res = await api.uploadAllianceCSV(formData);
      setResult(res);
      localStorage.removeItem(UPLOAD_DRAFT_KEY);
      setFileName('');
      setDraftFileName('');
      setDraftStatus('');
      toast.success(res.message || `Uploaded ${res.imported || 0} prospects — sequence starting`);
    } catch (err) {
      toast.error(err.message || 'Failed to upload');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const selectedAudience = audiences.find((item) => item.code === audience);
  const selectedSystemColumns = selectedAudience?.column_config?.length ? selectedAudience.column_config : defaultSystemColumns();
  const displayedColumns = [...selectedSystemColumns.filter((column) => column.enabled !== false).map((column) => column.label || column.key), ...(selectedAudience?.fields || []).map((field) => field.field_key)];

  return (
    <div className="al-wrap al-upload-page">
      <div className="al-eyebrow">AllianceOS · Screen 1</div>
      <div className="al-page-title">Upload your list</div>
      <p className="al-page-desc">
        Drop a CSV of businesses, colleges, or companies — with their emails and phone numbers — and AllianceOS takes over from here.
      </p>

      <div className="al-upload-draftbar">
        {draftStatus && <span style={{ color: 'var(--al-muted)', fontSize: 12 }}>{draftStatus}</span>}
        {draftStatus && draftStatus !== 'Draft discarded' && <button className="al-btn ghost sm" type="button" onClick={discardDraft}><Trash2 size={14} /> Discard draft</button>}
      </div>

      {draftFileName && !fileName && <div className="al-note" style={{ marginBottom: 16 }}><span>i</span><div>Draft file: <b>{draftFileName}</b>. For browser security, choose this file again before uploading.</div></div>}

      {/* Dropzone */}
      <div
        className="al-drop al-upload-drop"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{ opacity: uploading ? 0.6 : 1, pointerEvents: uploading ? 'none' : 'auto' }}
      >
        <div className="al-drop-ic"><UploadCloud size={25} /></div>
        <h3>{uploading ? 'Uploading…' : fileName ? fileName : 'Drop your CSV or Excel file here'}</h3>
        <p>{fileName ? 'File ready — or click to replace' : 'or choose a file — max 5,000 rows per upload'}</p>
        <button className="al-btn" type="button" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
          <FileSpreadsheet size={16} /> {uploading ? 'Uploading…' : 'Choose CSV or Excel'}
        </button>
        <div className="al-fmt">
          {displayedColumns.map(c => <code key={c}>{c}</code>)}
        </div>
        <input
          type="file"
          accept=".csv,.xlsx"
          ref={fileInputRef}
          onChange={(e) => processFile(e.target.files?.[0])}
          style={{ display: 'none' }}
        />
      </div>

      <div className="al-note al-upload-requirements" style={{ marginTop: 16 }}>
        <span>i</span>
        <div>
          <b>Required:</b> business_name, audience, and the contact field needed by the selected channel.
          Email requires email. WhatsApp requires phone and complete, verifiable consent details.
          <div style={{ marginTop: 5 }}>Audience must match the selected configuration. channel_pref can be blank, email, whatsapp, or both. Both requires email plus a consented WhatsApp number.</div>
          {!!selectedAudience?.fields?.length && (
            <div style={{ marginTop: 5 }}>Custom columns: {selectedAudience.fields.map((field) => `${field.field_key}${field.required ? ' (required)' : ''}`).join(', ')}</div>
          )}
        </div>
      </div>

      <details className="al-upload-sop" open>
        <summary>Spreadsheet SOP — what to enter in every column</summary>
        <div className="al-upload-sop-intro"><b>Important:</b> Format the <code>phone</code> column as <b>Text</b> in Excel before entering numbers. Do not let Excel convert it to scientific notation such as <code>9.19E+11</code>.</div>
        <div className="al-upload-sop-table-wrap">
          <table className="al-table al-upload-sop-table">
            <thead><tr><th>Column</th><th>What it is used for</th><th>How to enter it</th><th>Example</th></tr></thead>
            <tbody>
              <tr><td><code>name</code></td><td>Contact person’s name used for personalization.</td><td>Plain text; do not include titles twice.</td><td>Dr. Rajesh Kumar</td></tr>
              <tr><td><code>business_name</code></td><td>College, company, clinic, or organisation name.</td><td>Plain text. Required when configured as mandatory.</td><td>Sunrise Arts &amp; Science College</td></tr>
              <tr><td><code>email</code></td><td>Email delivery and duplicate checking.</td><td>One valid email address. Required for Email or Both.</td><td>rajesh@sunrisecollege.edu</td></tr>
              <tr><td><code>phone</code></td><td>WhatsApp delivery and duplicate checking.</td><td>Excel Text format; digits with country code, without <code>+</code>. Required for WhatsApp or Both.</td><td>919876543210</td></tr>
              <tr><td><code>audience</code></td><td>Connects the lead to the selected audience configuration.</td><td>Accepted configured codes: {audiences.map((item) => <code key={item.code} style={{ marginRight: 5 }}>{item.code}</code>)}</td><td>{audience || 'college'}</td></tr>
              <tr><td><code>industry</code></td><td>Filtering and AI personalization.</td><td>Plain text; optional unless configured as required.</td><td>Education</td></tr>
              <tr><td><code>location</code></td><td>Location filtering and personalization.</td><td>City, district, or region.</td><td>Coimbatore</td></tr>
              <tr><td><code>source</code></td><td>Records where the lead came from.</td><td>Free text. Recommended: <code>website_form</code>, <code>manual_research</code>, <code>csv_import</code>, <code>referral</code>, <code>event</code>, <code>linkedin</code>, <code>google_search</code>, <code>existing_customer</code>, <code>partner</code>, or <code>other</code>.</td><td>website_form</td></tr>
              <tr><td><code>channel_pref</code></td><td>Overrides the import channel for this individual row.</td><td>Enter only <code>email</code>, <code>whatsapp</code>, <code>both</code>, or leave blank.</td><td>both</td></tr>
              <tr><td><code>consent</code></td><td>Confirms permission to send WhatsApp messages.</td><td>Accepted opt-in values: <code>true</code>, <code>yes</code>, <code>y</code>, <code>1</code>, <code>opted_in</code>, or <code>opt-in</code>. Blank or any other value means no consent.</td><td>true</td></tr>
              <tr><td><code>consent_source</code></td><td>Records how WhatsApp consent was obtained.</td><td>Required for WhatsApp. Enter only <code>website_form</code>, <code>click_to_whatsapp_ad</code>, <code>qr_code_optin</code>, <code>inbound_whatsapp_optin</code>, <code>event_registration</code>, <code>customer_request</code>, or <code>written_consent</code>.</td><td>website_form</td></tr>
              <tr><td><code>consent_at</code></td><td>Records when the recipient opted in.</td><td>Required for WhatsApp. Use an ISO date/time including timezone.</td><td>2026-08-20T10:30:00+05:30</td></tr>
              <tr><td><code>consent_evidence</code></td><td>Provides an auditable reference to the opt-in.</td><td>Required for WhatsApp. Enter a form submission ID, message ID, ticket ID, or securely stored evidence URL. Do not enter unsupported claims.</td><td>form_submission_4821</td></tr>
              <tr><td><code>consent_scope</code></td><td>Records what the recipient agreed to receive.</td><td>Required for WhatsApp. Enter only <code>marketing</code>, <code>service</code>, or <code>both</code>.</td><td>marketing</td></tr>
              {(selectedAudience?.fields || []).map((field) => <tr key={field.field_key}><td><code>{field.field_key}</code>{field.required ? ' *' : ''}</td><td>Custom information configured for {selectedAudience?.label || audience}.</td><td>{field.required ? 'Required. ' : 'Optional. '}Enter a valid {field.data_type === 'auto' ? 'value' : field.data_type}.</td><td>{field.sample_value || '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
      </details>

      {result?.report && (
        <div className="al-note success al-upload-result" style={{ marginTop: 18 }}>
          <span>✓</span>
          <div>
            <b>{result.campaign?.name}</b>
            <div style={{ marginTop: 5 }}>
              Imported {result.report.imported} · Duplicates {result.report.duplicates} · Suppressed {result.report.suppressed} · Invalid {result.report.invalid}
            </div>
            {result.report.errors?.length > 0 && (
              <div style={{ marginTop: 5 }}>First issue: row {result.report.errors[0].row} — {result.report.errors[0].reasons.join(', ')}</div>
            )}
          </div>
        </div>
      )}

      {/* Fields */}
      <section className="al-fields al-upload-settings" style={{ marginTop: 20 }}>
        <div className="al-upload-section-heading"><span>1</span><div><b>Import settings</b><small>Choose where these leads belong before selecting your file.</small></div></div>
        <div className="al-field">
          <label>Audience for this list</label>
          <select value={audience} onChange={(e) => setAudience(e.target.value)}>
            {audiences.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><button className="al-btn ghost sm" type="button" onClick={openAddAudience}>+ Add</button><button className="al-btn ghost sm" type="button" disabled={!selectedAudience} onClick={openEditAudience}>Edit</button><button className="al-btn ghost sm" type="button" disabled={!selectedAudience} style={{ color: '#EF9A9A' }} onClick={() => setDeletingAudience(selectedAudience)}>Delete</button></div>
        </div>
        <div className="al-field">
          <label>Campaign</label>
          <input
            value={campaign}
            onChange={(e) => setCampaign(e.target.value)}
            placeholder="e.g. Aug — TN Colleges"
          />
        </div>
        <div className="al-field">
          <label>Channel</label>
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="auto">Auto (by audience)</option>
            <option value="email">Email only</option>
            <option value="whatsapp">WhatsApp only</option>
            <option value="both">Email + WhatsApp</option>
          </select>
        </div>
      </section>

      <section className="al-upload-preview" style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
        <div style={{ marginBottom: 12 }}>
          <div className="al-upload-preview-title"><FileSpreadsheet size={18} /><span><b>Excel template preview</b><small>{displayedColumns.length} columns configured</small></span></div>
          <div style={{ color: 'var(--al-muted)', fontSize: 11.5, marginTop: 3 }}>{selectedAudience?.label || audience} · The downloaded workbook will match this table.</div>
        </div>
        {previewLoading ? (
          <div style={{ color: 'var(--al-muted)', padding: '18px 4px' }}>Loading preview…</div>
        ) : previewError ? (
          <div className="al-note"><span>!</span><div>{previewError}</div></div>
        ) : templatePreview ? (
          <div style={{ overflowX: 'auto', border: '1px solid var(--al-line)', borderRadius: 8 }}>
            <table className="al-table" style={{ minWidth: Math.max(900, templatePreview.columns.length * 135) }}>
              <thead><tr>{templatePreview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
              <tbody>
                {templatePreview.rows.map((row, index) => (
                  <tr key={index}>{templatePreview.columns.map((column) => <td key={column}>{String(row[column] ?? '') || <span style={{ color: 'var(--al-faint)' }}>—</span>}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <button className="al-btn" type="button" disabled={downloadingTemplate || previewLoading || !templatePreview} onClick={downloadTemplate} style={{ marginTop: 14 }}>
          <Download size={16} /> {downloadingTemplate ? 'Generating…' : 'Download Excel template'}
        </button>
      </section>

      {showAudienceForm && (
        <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div className="al-fields">
            <div className="al-field"><label>Display label</label><input value={newAudience.label} placeholder="Hospitals / administrators" onChange={(e) => { const label = e.target.value; setNewAudience({ ...newAudience, label, ...(!audienceCodeManuallyEdited ? { code: audienceCodeFromLabel(label) } : {}) }); }} /></div>
            <div className="al-field"><label>Audience code</label><input value={newAudience.code} placeholder="hospitals_administrators" onChange={(e) => { const code = audienceCodeFromLabel(e.target.value); setAudienceCodeManuallyEdited(Boolean(code)); setNewAudience({ ...newAudience, code }); }} /><small style={{ color: 'var(--al-muted)' }}>{editingAudienceCode ? 'Changing this code also updates existing prospects, campaigns, templates, and AI configuration.' : 'Generated automatically from the display label. You can edit it before saving.'}</small></div>
            <div className="al-field"><label>Brand</label><select value={newAudience.brand} onChange={(e) => setNewAudience({ ...newAudience, brand: e.target.value })}><option value="">Select brand</option>{newAudience.brand && !brandOptions.includes(newAudience.brand) && <option value={newAudience.brand}>{newAudience.brand}</option>}{brandOptions.map((brandName) => <option key={brandName} value={brandName}>{brandName}</option>)}</select><small style={{ color: 'var(--al-muted)' }}>Loaded dynamically from Clients.</small></div>
            <div className="al-field"><label>Default channel</label><select value={newAudience.default_channel} onChange={(e) => { const defaultChannel = e.target.value; setNewAudience({ ...newAudience, default_channel: defaultChannel, system_columns: enforceChannelColumns(newAudience.system_columns, defaultChannel) }); }}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">Email + WhatsApp</option></select></div>
          </div>
          <div className="al-field">
            <label>Add or edit custom columns</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1.25fr 1.1fr 1fr auto auto', gap: 8, alignItems: 'center' }}>
              <input value={newField.label} placeholder="Column name: Number of beds" onChange={(e) => { const label = e.target.value; const generatedKey = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); setNewField({ ...newField, label, field_key: generatedKey }); }} />
              <input value={newField.field_key} readOnly title="Generated automatically from the column name. Existing prospect data is migrated when this key changes." placeholder="Key generated automatically" style={{ color: 'var(--al-muted)', cursor: 'default' }} />
              <input value={newField.sample_value} placeholder="Sample: 150" onChange={(e) => setNewField({ ...newField, sample_value: e.target.value })} />
              <select value={newField.data_type} onChange={(e) => setNewField({ ...newField, data_type: e.target.value })}>
                <option value="auto">Detect automatically</option><option value="text">Text</option><option value="integer">Whole number</option><option value="number">Number / decimal</option><option value="boolean">Yes / No</option><option value="date">Date</option>
              </select>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, textTransform: 'none', letterSpacing: 0 }}><input type="checkbox" checked={newField.required} onChange={(e) => setNewField({ ...newField, required: e.target.checked })} style={{ width: 'auto' }} /> Required</label>
              <button className="al-btn ghost sm" type="button" onClick={addCustomField}>{editingFieldKey ? 'Update field' : 'Add field'}</button>
            </div>
            <div className="al-note" style={{ marginTop: 14 }}><span>i</span><div><b>{newAudience.default_channel === 'both' ? 'Email + WhatsApp' : newAudience.default_channel === 'whatsapp' ? 'WhatsApp' : 'Email'} required system columns:</b> {[...requiredSystemKeys(newAudience.default_channel)].join(', ')}. These columns are automatically restored and cannot be removed. Custom columns such as <code>phone_number</code> do not replace the system <code>phone</code> column.</div></div>
            <div style={{ marginTop: 14 }}><div style={{ color: 'var(--al-muted)', fontSize: 10.5, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 1 }}>System columns</div><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(430px,1fr))', gap: 7 }}>{newAudience.system_columns.filter((column) => column.enabled).map((column) => <div key={column.key} style={{ display: 'grid', gridTemplateColumns: '115px minmax(120px,1fr) auto auto', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--al-line)', borderRadius: 7 }}><code>{column.key}</code><input aria-label={`${column.key} Excel header`} value={column.label} onChange={(event) => setNewAudience({ ...newAudience, system_columns: newAudience.system_columns.map((item) => item.key === column.key ? { ...item, label: event.target.value } : item) })} /><label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: 0, textTransform: 'none', letterSpacing: 0, whiteSpace: 'nowrap' }}><input type="checkbox" aria-label={`${column.key} required`} checked={Boolean(column.required)} onChange={(event) => setNewAudience({ ...newAudience, system_columns: newAudience.system_columns.map((item) => item.key === column.key ? { ...item, required: event.target.checked } : item) })} style={{ width: 'auto' }} /> Required</label><button type="button" className="al-btn ghost sm" style={{ color: '#EF9A9A' }} onClick={() => setNewAudience({ ...newAudience, system_columns: newAudience.system_columns.map((item) => item.key === column.key ? { ...item, enabled: false, required: false } : item) })}>Delete</button></div>)}</div>{newAudience.system_columns.some((column) => !column.enabled) && <div style={{ marginTop: 12, padding: 10, border: '1px dashed var(--al-line)', borderRadius: 8 }}><div style={{ color: 'var(--al-faint)', fontSize: 10, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 1 }}>Deleted system columns</div><div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>{newAudience.system_columns.filter((column) => !column.enabled).map((column) => <button key={column.key} type="button" className="al-btn ghost sm" onClick={() => setNewAudience({ ...newAudience, system_columns: newAudience.system_columns.map((item) => item.key === column.key ? { ...item, enabled: true } : item) })}>Restore {column.key}</button>)}</div></div>}</div>
            <div style={{ marginTop: 14 }}><div style={{ color: 'var(--al-muted)', fontSize: 10.5, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 1 }}>Custom columns</div>{newAudience.fields.length ? <div style={{ display: 'grid', gap: 7 }}>{newAudience.fields.map((field) => <div key={field.field_key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 10px', border: `1px solid ${editingFieldKey === field.field_key ? 'var(--al-gold)' : 'var(--al-line)'}`, borderRadius: 7 }}><code>{field.label || field.field_key} <span style={{ color: 'var(--al-faint)' }}>({field.field_key})</span>{field.required ? ' *' : ''} · {field.data_type === 'auto' ? 'automatic' : field.data_type}</code><span style={{ display: 'flex', gap: 6 }}><button className="al-btn ghost sm" type="button" onClick={() => editCustomField(field)}>Edit</button><button className="al-btn ghost sm" type="button" style={{ color: '#EF9A9A' }} onClick={() => removeCustomField(field.field_key)}>Remove</button></span></div>)}</div> : <div style={{ color: 'var(--al-faint)', fontSize: 12, padding: '10px 0' }}>No custom columns yet. Enter a column key, display name, sample value, and click Add field.</div>}</div>
            <div style={{ color: 'var(--al-muted)', fontSize: 11.5, marginTop: 8 }}>Every system column can be renamed or deleted. Deleted columns are removed from future Excel templates and can be restored before saving. Historical data is never erased. When business_name is omitted, import creates a display identity from name, email, phone, or the spreadsheet row number.</div>
          </div>
          <button className="al-btn" type="button" disabled={savingAudience || !newAudience.code || !newAudience.label} onClick={addAudience} style={{ marginTop: 12 }}>
            {savingAudience ? 'Saving…' : editingAudienceCode ? 'Save changes' : 'Save audience'}
          </button>
          <button className="al-btn ghost" type="button" disabled={savingAudience} onClick={() => { setShowAudienceForm(false); setEditingAudienceCode(''); }} style={{ marginTop: 12, marginLeft: 8 }}>Cancel</button>
        </div>
      )}

      {deletingAudience && <div role="dialog" aria-modal="true" style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 20 }} onClick={() => !savingAudience && setDeletingAudience(null)}><div onClick={(event) => event.stopPropagation()} style={{ width: 'min(480px,100%)', background: 'var(--al-panel2)', border: '1px solid rgba(239,154,154,.35)', borderRadius: 14, padding: 22 }}><div className="al-page-title" style={{ fontSize: 21 }}>Delete target audience?</div><p style={{ color: 'var(--al-muted)', lineHeight: 1.6 }}><b style={{ color: 'var(--al-ink)' }}>{deletingAudience.label}</b> and its custom-field/template configuration will be removed. Deletion is blocked while prospects or campaigns still use this audience.</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="al-btn ghost" disabled={savingAudience} onClick={() => setDeletingAudience(null)}>Cancel</button><button className="al-btn" disabled={savingAudience} style={{ background: '#C62828', color: '#fff' }} onClick={confirmDeleteAudience}>{savingAudience ? 'Deleting…' : 'Delete audience'}</button></div></div></div>}

      {/* Steps */}
      <div className="al-steps">
        <div className="al-step"><div className="n">01</div><p>We clean the rows and fix phone/email formats</p></div>
        <div className="al-step"><div className="n">02</div><p>Remove duplicates and anyone on the do-not-contact list</p></div>
        <div className="al-step"><div className="n">03</div><p>Pick email or WhatsApp per prospect automatically</p></div>
        <div className="al-step"><div className="n">04</div><p>Schedule the first message — the sequence begins</p></div>
      </div>

      <div className="al-note">
        ⚠️
        <div>
          <b>Cold outreach goes out by email.</b> WhatsApp is used only for contacts who opted in (QR code / click-to-WhatsApp / replied first).
          Cold sending never uses our main WhatsApp or @abmgroups.org.
        </div>
      </div>
    </div>
  );
};
