import { useState, useEffect } from 'react';
import { Plus, Upload, Send, Clock, Trash2, Download } from 'lucide-react';
import toast from 'react-hot-toast';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

const getTemplateVariables = (value) => [...new Set(
  [...String(value || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]))
)].sort((a, b) => a - b);

const getCampaignTemplateError = (template) => {
  if (!template) return '';
  const bodyVariables = getTemplateVariables(template.body);
  const headerVariables = getTemplateVariables(template.header);
  if (bodyVariables.some((value, index) => value !== index + 1)) {
    return 'Body variables must be consecutive and start at {{1}}.';
  }
  if (headerVariables.some((value, index) => value !== index + 1)) return 'Header variables must be consecutive and start at {{1}}.';
  return '';
};

const createDefaultParameterMappings = (template) => ({
  body: Object.fromEntries(getTemplateVariables(template?.body).map((number, index) => [
    String(number), {
      source: template?.parameter_definitions?.body?.[String(number)]?.default_source || (index === 0 ? 'recipient_name' : 'custom'),
      value: '', section: 'body', number
    }
  ])),
  header: Object.fromEntries(getTemplateVariables(template?.header).map((number) => [
    String(number), { source: 'custom', value: '', section: 'header', number }
  ]))
});

const formatCampaignDateTime = (value) => {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString([], {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  });
};

export const CampaignsView = () => {
  const [tab, setTab] = useState('list');
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(false);

  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [targetStatus, setTargetStatus] = useState('new');
  const [sendType, setSendType] = useState('now');
  const [scheduledAt, setScheduledAt] = useState('');
  const [clients, setClients] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [templateParameters, setTemplateParameters] = useState({ body: {}, header: {} });
  const [submitting, setSubmitting] = useState(false);

  // Custom CSV Upload state
  const [importFile, setImportFile] = useState(null);

  // Report state
  const [reportModal, setReportModal] = useState(null);
  const [campaignLogs, setCampaignLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [reportFilter, setReportFilter] = useState('all');

  // Delete state
  const [deleteModal, setDeleteModal] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Live tracking state
  const [isLiveTracking, setIsLiveTracking] = useState(false);

  const fetchCampaigns = async () => {
    setLoading(true);
    try {
      const data = await api.getCampaigns();
      setCampaigns(data.campaigns || []);
    } catch (err) {
      console.error('Error fetching campaigns:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchFormMetadata = async () => {
    try {
      const clientsData = await api.getClients();
      const templatesData = await api.getTemplates();
      setClients(clientsData.clients || []);
      setTemplates(templatesData.templates || []);
    } catch (err) {
      console.error('Error fetching metadata:', err.message);
    }
  };

  useEffect(() => {
    fetchCampaigns();
    fetchFormMetadata();
  }, []);

  // Live tracking: poll logs when campaign is running
  useEffect(() => {
    let interval;

    if (isLiveTracking && reportModal && (reportModal.status === 'running' || reportModal.status === 'scheduled')) {
      // Fetch latest campaign status first
      const fetchWithStatusUpdate = async () => {
        try {
          const data = await api.getCampaigns();
          const updatedCampaign = data.campaigns?.find(c => c.id === reportModal.id);

          if (updatedCampaign) {
            // Update the reportModal with latest status
            setReportModal(prev => ({ ...prev, ...updatedCampaign }));

            // If completed or failed, stop live tracking
            if (updatedCampaign.status === 'completed' || updatedCampaign.status === 'failed') {
              setIsLiveTracking(false);
              return;
            }
          }

          // Fetch logs
          const res = await api.getCampaignLogs(reportModal.id);
          setCampaignLogs(res.logs || []);
        } catch (err) {
          console.error('Live tracking error:', err.message);
        }
      };

      // Initial fetch
      fetchWithStatusUpdate();

      // Poll every 3 seconds
      interval = setInterval(fetchWithStatusUpdate, 3000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isLiveTracking, reportModal?.id]);

  const handleDownloadTemplate = () => {
    const link = document.createElement('a');
    link.href = templateId
      ? `${api.baseUrl}/api/templates/${encodeURIComponent(templateId)}/campaign-sheet?mappings=${encodeURIComponent(JSON.stringify(templateParameters))}`
      : `${api.baseUrl}/api/leads/template`;
    link.download = templateId ? 'template_campaign_recipients.xlsx' : 'leados_campaign_template.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const handleCreateCampaign = async (e) => {
    e.preventDefault();
    if (!name || !clientId || !templateId) return toast.error('Please fill required fields');
    const selectedTemplate = templates.find((template) => String(template.id) === String(templateId));
    const templateError = getCampaignTemplateError(selectedTemplate);
    if (templateError) return toast.error(templateError);
    for (const section of ['header', 'body']) {
      for (const number of getTemplateVariables(selectedTemplate?.[section])) {
        const mapping = templateParameters[section]?.[String(number)];
        if (!mapping || (mapping.source === 'custom' && !mapping.value?.trim())) {
          return toast.error(`Please configure ${section} parameter {{${number}}}`);
        }
      }
    }
    
    setSubmitting(true);
    try {
      let finalTargetStatus = targetStatus;

      // 1. Handle Custom CSV Upload
      if (targetStatus === 'custom_csv') {
        if (!importFile) {
          setSubmitting(false);
          return toast.error('Please upload an excel file');
        }
        const batchId = `csv_${Date.now()}`;
        const formData = new FormData();
        formData.append('client_id', clientId);
        formData.append('template_id', templateId);
        formData.append('file', importFile);
        formData.append('force_source', batchId);
        formData.append('template_parameters', JSON.stringify(templateParameters));
        
        const importRes = await api.importLeads(formData);
        if (!importRes.imported) {
          throw new Error(`No valid contacts found in the Excel file${importRes.failed ? ` (${importRes.failed} invalid row${importRes.failed === 1 ? '' : 's'})` : ''}`);
        }
        toast.success(
          `Audience ready: ${importRes.inserted || 0} new, ${importRes.existing || 0} existing`
          + (importRes.duplicate_rows ? `, ${importRes.duplicate_rows} duplicate row${importRes.duplicate_rows === 1 ? '' : 's'} skipped` : '')
          + (importRes.failed ? `, ${importRes.failed} invalid row${importRes.failed === 1 ? '' : 's'} skipped` : '')
        );
        
        finalTargetStatus = batchId;
      }

      // 2. Create the Campaign
      const finalScheduledAt = sendType === 'now' ? '' : new Date(scheduledAt).toISOString();
      const res = await api.createCampaign({
        name, client_id: clientId, template_id: templateId,
        target_status: finalTargetStatus, scheduled_at: finalScheduledAt || null,
        send_immediately: sendType === 'now', template_parameters: templateParameters
      });

      toast.success('Campaign created! ' + res.campaign.name);
      setTab('list');
      fetchCampaigns();
    } catch (err) {
      toast.error('Failed to launch campaign: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };



  const handleViewReport = async (c) => {
    setReportModal(c);
    setReportFilter('all');
    setLoadingLogs(true);

    // Enable live tracking if campaign is running or scheduled (not yet started)
    const shouldTrack = c.status === 'running' || c.status === 'scheduled';
    setIsLiveTracking(shouldTrack);

    try {
      const res = await api.getCampaignLogs(c.id);
      setCampaignLogs(res.logs || []);
    } catch (err) {
      toast.error('Failed to load logs: ' + err.message);
    } finally {
      setLoadingLogs(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteConfirmText !== 'delete-my-campaign') return;
    setDeleting(true);
    try {
      await api.deleteCampaign(deleteModal.id);
      toast.success('Campaign deleted successfully');
      setDeleteModal(null);
      setDeleteConfirmText('');
      fetchCampaigns();
    } catch (err) {
      toast.error('Failed to delete campaign: ' + err.message);
    } finally {
      setDeleting(false);
    }
  };

  const displayCampaigns = campaigns || [];
  const statC = { completed: { tc: C.green, bg: '#0a2018' }, running: { tc: C.accent, bg: '#2d1a0a' }, scheduled: { tc: C.blue, bg: '#0f1e38' } };

  const totalDelivered = displayCampaigns.reduce((a, b) => a + parseInt(b.delivered_count || b.delivered || 0), 0);
  const totalRead = displayCampaigns.reduce((a, b) => a + parseInt(b.read_count || b.read || 0), 0);
  const avgRead = totalDelivered > 0 ? Math.round((totalRead / totalDelivered) * 100) + '%' : '0%';

  const successLogs = campaignLogs.filter(l => l.status !== 'failed');
  const failedLogs = campaignLogs.filter(l => l.status === 'failed');
  const filteredLogs = reportFilter === 'success' ? successLogs : reportFilter === 'failed' ? failedLogs : campaignLogs;

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>Bulk Campaigns</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>Send bulk WhatsApp messages using approved templates {loading && '(loading...)'}</p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={() => setTab('create')} style={{ background: C.accent, border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Plus size={12} />New Campaign</button>
        </div>
      </div>
      <div style={{ display: 'flex', background: C.card, border: '1px solid ' + C.border, borderRadius: 9, overflow: 'hidden', marginBottom: 18, width: 'fit-content' }}>
        {['list', 'create'].map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '7px 18px', fontSize: 12, fontWeight: 600, border: 'none', background: tab === t ? C.accent : 'transparent', color: tab === t ? '#fff' : C.muted, textTransform: 'capitalize' }}>{t === 'list' ? 'Campaign List' : 'Create Campaign'}</button>
        ))}
      </div>
      {tab === 'list' ? (
        <>
          <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
            {[['Total', displayCampaigns.length.toString(), C.accent], ['Running', displayCampaigns.filter(c => c.status === 'running').length.toString(), C.green], ['Total Sent', displayCampaigns.reduce((a, b) => a + parseInt(b.sent_count || b.sent || 0), 0).toString(), C.blue], ['Avg Read', avgRead, C.purple]].map(([l, v, col]) => (
              <div key={l} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 11, padding: '14px 18px', flex: 1 }}>
                <p style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{l}</p>
                <p style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: "'Syne',sans-serif" }}>{v}</p>
              </div>
            ))}
          </div>
          <div className="table-responsive" style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid ' + C.border }}>
                  {['Campaign', 'Brand', 'Template', 'Sent', 'Delivered', 'Read', 'Replied', 'Status', 'Date & Time', 'Actions'].map((h) => (
                    <th key={h} style={{ padding: '11px 14px', fontSize: 9, color: C.muted, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayCampaigns.map((c) => {
                  const s = statC[c.status] || statC.completed;
                  return (
                    <tr key={c.id} style={{ borderBottom: '1px solid ' + C.border }}>
                      <td style={{ padding: '13px 14px', fontSize: 12, fontWeight: 600, color: C.text }}>{c.name}</td>
                      <td style={{ padding: '13px 14px', fontSize: 11, color: C.muted }}>{c.brand_name || c.brand || 'All Brands'}</td>
                      <td style={{ padding: '13px 14px', fontSize: 11, color: C.text }}>{c.template_name || 'Template unavailable'}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.text }}>{c.sent_count ?? c.sent ?? 0}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.green }}>{c.delivered_count ?? c.delivered ?? 0}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.blue }}>{c.read_count ?? c.read ?? 0}</td>
                      <td style={{ padding: '13px 14px', fontSize: 12, color: C.accent }}>{c.replied_count ?? c.replied ?? 0}</td>
                      <td style={{ padding: '13px 14px' }}><span style={{ background: s.bg, color: s.tc, padding: '3px 9px', borderRadius: 12, fontSize: 11, fontWeight: 600, textTransform: 'capitalize' }}>{c.status}</span></td>
                      <td style={{ padding: '13px 14px', fontSize: 11, color: C.dim, whiteSpace: 'nowrap' }}>
                        <div style={{ color: C.text }}>{formatCampaignDateTime(c.scheduled_at || c.created_at || c.date)}</div>
                        <div style={{ marginTop: 3, fontSize: 9, color: c.scheduled_at ? C.blue : C.green, fontWeight: 700, textTransform: 'uppercase' }}>
                          {c.scheduled_at ? 'Scheduled' : 'Sent immediately'}
                        </div>
                      </td>
                      <td style={{ padding: '13px 14px' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <button onClick={() => handleViewReport(c)} style={{ background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 5, color: C.text, padding: '5px 10px', fontSize: 11, cursor: 'pointer', transition: 'all 0.2s' }}>View Report</button>
                          {(c.status === 'failed' || c.status === 'scheduled') && (
                            <button onClick={async () => { await api.retryCampaign(c.id); fetchCampaigns(); toast.success('Campaign retry started'); }} style={{ background: 'transparent', border: 'none', color: C.accent, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s', marginRight: 4 }} title="Retry Campaign"><span style={{ fontSize: 14, fontWeight: 600 }}>↻</span></button>
                          )}
                          <button onClick={() => setDeleteModal(c)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = C.red} onMouseLeave={(e) => e.currentTarget.style.color = C.muted} title="Delete Campaign"><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <form onSubmit={handleCreateCampaign} className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 22 }}>
            <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 18 }}>Campaign Setup</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Campaign Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Academy June Batch" style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Select Brand</label>
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }}>
                <option value="">Select Brand</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Target Audience Status</label>
              <select value={targetStatus} onChange={(e) => setTargetStatus(e.target.value)} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }}>
                <option value="new">New leads</option>
                <option value="warm">Warm leads</option>
                <option value="cold">Cold leads</option>
                <option value="hot">Hot leads</option>
                <option value="all">All leads</option>
                <option value="custom_csv">Upload Custom List</option>
              </select>
            </div>
            {targetStatus === 'custom_csv' && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                  <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Upload Target List</label>
                  <button type="button" onClick={handleDownloadTemplate} style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: 10, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Download size={12} /> {templateId ? 'Download Sheet for Selected Template' : 'Download Basic Template'}
                  </button>
                </div>
                <div style={{ position: 'relative', border: `1.5px dashed ${importFile ? C.green : C.border}`, background: C.card, borderRadius: 10, padding: '24px 20px', textAlign: 'center', transition: 'all 0.2s', marginTop: 8 }}>
                  <input type="file" accept=".xlsx" onChange={(e) => setImportFile(e.target.files[0])} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0, cursor: 'pointer' }} />
                  <Upload size={24} color={importFile ? C.green : C.muted} style={{ margin: '0 auto 10px' }} />
                  <p style={{ fontSize: 13, color: importFile ? C.text : C.muted, fontWeight: 600, marginBottom: 4 }}>
                    {importFile ? importFile.name : 'Click to select .xlsx template'}
                  </p>
                </div>
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
                  <p style={{ fontSize: 11, color: C.dim }}>Only .xlsx is supported to prevent number corruption</p>
                </div>
              </div>
            )}
          </div>
          <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 22 }}>
            <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 18 }}>Message & Schedule</h3>
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 5, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Select Approved Template</label>
              <select value={templateId} onChange={(e) => {
                const nextId = e.target.value;
                const template = templates.find((item) => String(item.id) === String(nextId));
                setTemplateId(nextId);
                setTemplateParameters(createDefaultParameterMappings(template));
              }} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none' }}>
                <option value="">Select Template</option>
                {templates
                  .filter((t) => t.status === 'approved' || t.status === 'active')
                  .filter((t) => !t.template_scope || t.template_scope === 'leados' || t.template_scope === 'shared')
                  .filter((t) => !clientId || t.client_id === parseInt(clientId) || t.client_id === null)
                  .map((t) => {
                    const templateError = getCampaignTemplateError(t);
                    return <option key={t.id} value={t.id} disabled={Boolean(templateError)}>{t.name}{templateError ? ' — needs parameter setup' : ''}</option>;
                  })}
              </select>
              {templateId && getCampaignTemplateError(templates.find((template) => String(template.id) === String(templateId))) && (
                <p style={{ color: C.red, fontSize: 11, marginTop: 6, lineHeight: 1.4 }}>
                  {getCampaignTemplateError(templates.find((template) => String(template.id) === String(templateId)))}
                </p>
              )}
            </div>
            {templateId && ['header', 'body'].map((section) => {
              const selectedTemplate = templates.find((template) => String(template.id) === String(templateId));
              const variables = getTemplateVariables(selectedTemplate?.[section]);
              if (!variables.length) return null;
              return (
                <div key={section} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 12, marginBottom: 14 }}>
                  <p style={{ fontSize: 10, color: C.text, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{section} parameters</p>
                  <p style={{ fontSize: 10, color: C.muted, marginBottom: 10 }}>Map every variable to recipient or campaign data.</p>
                  {variables.map((number) => {
                    const mapping = templateParameters[section]?.[String(number)] || { source: 'custom', value: '', section, number };
                    const updateMapping = (next) => setTemplateParameters((current) => ({
                      ...current,
                      [section]: { ...current[section], [String(number)]: { ...mapping, ...next } }
                    }));
                    return (
                      <div key={number} style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, .9fr) minmax(130px, 1fr) minmax(140px, 1.4fr)', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span style={{ color: C.accent, fontSize: 11, fontWeight: 700 }}>
                          {`{{${number}}}`}
                          <small style={{ display: 'block', color: C.muted, fontSize: 9, fontWeight: 500, marginTop: 2 }}>{selectedTemplate?.parameter_definitions?.[section]?.[String(number)]?.label || `Parameter ${number}`}</small>
                        </span>
                        <select value={mapping.source} onChange={(e) => updateMapping({ source: e.target.value, value: e.target.value === 'custom' ? mapping.value : '' })} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 6, color: C.text, padding: '7px 8px', fontSize: 11 }}>
                          <option value="recipient_name">Recipient name</option>
                          <option value="recipient_phone">Recipient phone</option>
                          <option value="recipient_email">Recipient email</option>
                          <option value="lead_status">Lead status</option>
                          <option value="lead_source">Lead source</option>
                          <option value="lead_interest">Lead interest</option>
                          <option value="lead_score">Lead score</option>
                          <option value="campaign_name">Campaign name</option>
                          <option value="brand_name">Brand name</option>
                          <option value="excel_parameter" disabled={targetStatus !== 'custom_csv'}>Excel: this parameter column</option>
                          <option value="custom">Custom value</option>
                        </select>
                        {mapping.source === 'custom' ? (
                          <input value={mapping.value || ''} onChange={(e) => updateMapping({ value: e.target.value })} placeholder={`Value for {{${number}}}`} style={{ background: C.card, border: `1px solid ${mapping.value?.trim() ? C.border : C.red}`, borderRadius: 6, color: C.text, padding: '7px 8px', fontSize: 11, outline: 'none' }} />
                        ) : (
                          <span style={{ color: C.muted, fontSize: 10 }}>Filled automatically</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })}
            <div style={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, padding: 13, marginBottom: 14 }}>
              <p style={{ fontSize: 9, color: C.muted, marginBottom: 7, letterSpacing: 0.8 }}>PREVIEW</p>
              <div style={{ background: C.accent + '15', border: '1px solid ' + C.accentDim, borderRadius: 9, padding: 11 }}>
                <p style={{ fontSize: 12, color: C.text, lineHeight: 1.7 }}>
                  {templateId ? (templates.find(t => t.id === parseInt(templateId))?.body || 'No template preview available') : 'Please select a template to see details.'}
                </p>
              </div>
            </div>
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 8, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase' }}>Delivery Method</label>
              <div style={{ width: '100%', maxWidth: 340, display: 'flex', background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                <button type="button" onClick={() => setSendType('now')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', fontSize: 12, fontWeight: 600, border: 'none', background: sendType === 'now' ? C.accent : 'transparent', color: sendType === 'now' ? '#fff' : C.muted, cursor: 'pointer', transition: 'all 0.2s' }}>
                  <Send size={14} /> Send Now
                </button>
                <button type="button" onClick={() => setSendType('later')} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '10px 16px', fontSize: 12, fontWeight: 600, border: 'none', background: sendType === 'later' ? C.accent : 'transparent', color: sendType === 'later' ? '#fff' : C.muted, cursor: 'pointer', transition: 'all 0.2s' }}>
                  <Clock size={14} /> Schedule Later
                </button>
              </div>
              
              {sendType === 'later' && (
                <div style={{ marginTop: 12, animation: 'fadeIn 0.2s ease-out' }}>
                  <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} required={sendType === 'later'} style={{ width: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '9px 11px', fontSize: 12, outline: 'none', colorScheme: 'dark' }} />
                </div>
              )}
            </div>
            <button type="submit" disabled={submitting} style={{ width: '100%', background: sendType === 'now' ? C.green : C.accent, border: 'none', borderRadius: 9, padding: 13, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              {submitting ? 'Processing...' : sendType === 'now' ? <><Send size={16} /> Launch Immediately</> : <><Clock size={16} /> Schedule Campaign</>}
            </button>
          </div>
        </form>
      )}

      {reportModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, width: '100%', maxWidth: 680, maxHeight: '80vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: C.text }}>Campaign Live Status</h3>
                {isLiveTracking && (reportModal.status === 'running' || reportModal.status === 'scheduled') && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6, background: C.green + '20', color: C.green, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                    <span style={{ width: 6, height: 6, background: C.green, borderRadius: '50%', animation: 'pulse 1.5s infinite' }}></span>
                    Live
                  </span>
                )}
              </div>
              <button onClick={() => { setReportModal(null); setIsLiveTracking(false); }} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 24, overflowY: 'auto', flex: 1 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, marginBottom: 18 }}>
                {[
                  ['Campaign', reportModal.name],
                  ['Brand', reportModal.brand_name || reportModal.brand || 'All Brands'],
                  ['Template', reportModal.template_name || 'Template unavailable'],
                  ['Audience', reportModal.target_status || 'All leads'],
                  ['Created', formatCampaignDateTime(reportModal.created_at)],
                  [reportModal.scheduled_at ? 'Scheduled for' : 'Delivery', reportModal.scheduled_at ? formatCampaignDateTime(reportModal.scheduled_at) : `Immediate · ${formatCampaignDateTime(reportModal.created_at)}`]
                ].map(([label, value]) => (
                  <div key={label} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', minWidth: 0 }}>
                    <div style={{ color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
                    <div style={{ color: C.text, fontSize: 11, fontWeight: 600, wordBreak: 'break-word' }}>{value}</div>
                  </div>
                ))}
              </div>

              {!loadingLogs && reportModal.status !== 'scheduled' && reportModal.status !== 'running' && campaignLogs.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ background: '#0a2018', color: C.green, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>✓ {successLogs.length} Success</span>
                    <span style={{ background: '#331111', color: C.red, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>✕ {failedLogs.length} Failed</span>
                  </div>
                  <div style={{ display: 'flex', background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, overflow: 'hidden' }}>
                    {[['all', `All (${campaignLogs.length})`], ['success', `Success (${successLogs.length})`], ['failed', `Failed (${failedLogs.length})`]].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setReportFilter(key)}
                        style={{ padding: '6px 12px', fontSize: 11, fontWeight: 600, border: 'none', background: reportFilter === key ? C.accent : 'transparent', color: reportFilter === key ? '#fff' : C.muted, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {loadingLogs ? (
                <p style={{ color: C.muted, fontSize: 13 }}>Loading logs...</p>
              ) : reportModal.status === 'scheduled' && reportModal.scheduled_at ? (
                <div style={{ padding: 24, textAlign: 'center', background: C.surface, borderRadius: 10, border: `1px dashed ${C.border}` }}>
                  <Clock size={32} color={C.blue} style={{ margin: '0 auto 12px' }} />
                  <p style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Campaign Scheduled</p>
                  <p style={{ color: C.muted, fontSize: 13 }}>It will automatically start running on <strong style={{ color: C.blue }}>{new Date(reportModal.scheduled_at).toLocaleString()}</strong></p>
                </div>
              ) : reportModal.status === 'running' || (reportModal.status === 'scheduled' && !reportModal.scheduled_at) ? (
                <div style={{ padding: 24, textAlign: 'center', background: C.surface, borderRadius: 10, border: `1px dashed ${C.border}` }}>
                  <Send size={32} color={C.green} style={{ margin: '0 auto 12px', animation: 'pulse 1.5s infinite' }} />
                  <p style={{ color: C.text, fontSize: 14, fontWeight: 600, marginBottom: 4 }}>Campaign is Running</p>
                  <p style={{ color: C.muted, fontSize: 13 }}>Messages are currently being sent out...</p>
                </div>
              ) : campaignLogs.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13 }}>
                  {reportModal.status === 'failed'
                    ? `No eligible recipients found for this campaign. Target: ${reportModal.target_status || 'all'}. Please check the uploaded phone numbers and try again.`
                    : 'No delivery logs are available yet. The campaign may still be starting.'}
                </p>
              ) : filteredLogs.length === 0 ? (
                <p style={{ color: C.muted, fontSize: 13 }}>No {reportFilter} recipients for this campaign.</p>
              ) : (
                <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead style={{ background: C.surface }}>
                      <tr>
                        <th style={{ width: '22%', padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Name</th>
                        <th style={{ width: '20%', padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Phone</th>
                        <th style={{ width: '43%', padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Status / Reason</th>
                        <th style={{ width: '15%', padding: '10px 14px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 600, borderBottom: `1px solid ${C.border}` }}>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredLogs.map(log => (
                        <tr key={log.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: C.text, wordBreak: 'break-word' }}>{log.name || 'Unknown'}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12, color: C.dim, wordBreak: 'break-word' }}>+{log.phone}</td>
                          <td style={{ padding: '10px 14px', fontSize: 12 }}>
                            <span style={{
                              color: log.status === 'failed' ? C.red : log.status === 'read' ? C.green : log.status === 'replied' ? C.purple : C.accent,
                              fontSize: 11, fontWeight: 700, textTransform: 'uppercase'
                            }}>
                              {log.status === 'failed' ? '✕ FAILED' : log.status}
                            </span>
                            {log.error_message && (
                              <div style={{ color: C.red, fontSize: 11, marginTop: 4, whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: 1.4 }}>
                                {log.error_message}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: 11, color: C.dim }}>
                            {new Date(log.sent_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {isLiveTracking && (
                  <button
                    onClick={() => setIsLiveTracking(false)}
                    style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.muted, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Stop Live
                  </button>
                )}
              </div>
              <button onClick={() => { setReportModal(null); setIsLiveTracking(false); }} style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.text, padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {deleteModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
          <div style={{ background: C.card, border: `1px solid ${C.red}`, borderRadius: 14, width: '100%', maxWidth: 400, overflow: 'hidden', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ padding: '16px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#331111' }}>
              <h3 style={{ fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 700, color: C.red }}>Delete Campaign</h3>
              <button onClick={() => { setDeleteModal(null); setDeleteConfirmText(''); }} style={{ background: 'transparent', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ padding: 24 }}>
              <p style={{ fontSize: 13, color: C.text, marginBottom: 12, lineHeight: 1.5 }}>
                Are you sure you want to delete the campaign <strong style={{ color: C.red }}>{deleteModal.name}</strong>?
              </p>
              <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>
                This will permanently delete the campaign and all its delivery logs. This action cannot be undone.
              </p>
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: 'block', fontSize: 11, color: C.muted, marginBottom: 8, fontWeight: 600, textTransform: 'uppercase' }}>
                  Type <span style={{ color: C.text }}>delete-my-campaign</span> to confirm
                </label>
                <input 
                  value={deleteConfirmText} 
                  onChange={(e) => setDeleteConfirmText(e.target.value)} 
                  placeholder="delete-my-campaign" 
                  style={{ width: '100%', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, color: C.text, padding: '10px', fontSize: 13, outline: 'none' }} 
                />
              </div>
              <div style={{ display: 'flex', gap: 12 }}>
                <button onClick={() => { setDeleteModal(null); setDeleteConfirmText(''); }} style={{ flex: 1, background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleConfirmDelete} disabled={deleteConfirmText !== 'delete-my-campaign' || deleting} style={{ flex: 1, background: C.red, border: 'none', color: '#fff', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: deleteConfirmText !== 'delete-my-campaign' || deleting ? 'not-allowed' : 'pointer', opacity: deleteConfirmText !== 'delete-my-campaign' || deleting ? 0.5 : 1, transition: 'all 0.2s' }}>
                  {deleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
