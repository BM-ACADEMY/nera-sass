import { useState, useEffect } from 'react';
import { Plus, RefreshCw, Smartphone, Link2, Trash2 } from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';
import { ClientModal } from '../components/ClientModal.jsx';
import { ClientDashboardModal } from '../components/ClientDashboardModal.jsx';
import { ClientsTable } from '../components/ClientsTable.jsx';
import toast from 'react-hot-toast';

const getDisplayNameStatus = phone => {
  const nextStatus = String(phone?.raw_data?.new_name_status || '').toUpperCase();
  if (nextStatus && nextStatus !== 'NONE') return nextStatus;
  return String(phone?.raw_data?.name_status || 'UNKNOWN').toUpperCase();
};

export const ClientsView = () => {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const [isDashboardOpen, setIsDashboardOpen] = useState(false);
  const [dashboardClient, setDashboardClient] = useState(null);
  const [metaInventory, setMetaInventory] = useState({ wabas: [], phone_numbers: [], templates: [], template_summary: [], last_sync: null });
  const [metaSyncing, setMetaSyncing] = useState(false);
  const [metaCacheDeleting, setMetaCacheDeleting] = useState(false);
  const [metaPhoneOnboarding, setMetaPhoneOnboarding] = useState(false);
  const [registrationPhone, setRegistrationPhone] = useState(null);
  const [registrationPin, setRegistrationPin] = useState('');
  const [registeringPhone, setRegisteringPhone] = useState(false);
  const [mapping, setMapping] = useState({});
  const [selectedWabaId, setSelectedWabaId] = useState('');
  const [metaResourceTab, setMetaResourceTab] = useState('phones');

  const fetchClients = async () => {
    setLoading(true);
    setError(null);
    try {
      const [data, metaData] = await Promise.all([
        api.getClients(),
        api.getMetaWhatsAppInventory().catch(() => ({ wabas: [], phone_numbers: [], template_summary: [], last_sync: null }))
      ]);
      setClients(data.clients || []);
      setMetaInventory(metaData);
      setSelectedWabaId(current => current && metaData.wabas?.some(waba => waba.waba_id === current) ? current : (metaData.wabas?.[0]?.waba_id || ''));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchClients();
  }, []);

  const displayClients = clients || [];
  const selectedWaba = metaInventory.wabas.find(waba => waba.waba_id === selectedWabaId);
  const filteredMetaNumbers = metaInventory.phone_numbers.filter(phone => phone.waba_id === selectedWabaId);
  const filteredMetaTemplates = (metaInventory.templates || []).filter(template => template.waba_id === selectedWabaId);
  const unassignedMetaNumbers = filteredMetaNumbers.filter(phone => !phone.client_id);
  const assignedMetaNumbers = filteredMetaNumbers.filter(phone => phone.client_id);

  const syncMeta = async () => {
    setMetaSyncing(true);
    try {
      const result = await api.syncMetaWhatsApp();
      toast.success(`Synced ${result.wabas} WABAs, ${result.phone_numbers} numbers and ${result.templates} templates`);
      await fetchClients();
    } catch (err) { toast.error(err.message); }
    finally { setMetaSyncing(false); }
  };

  const deleteSelectedMetaCache = async () => {
    if (!selectedWaba) return;
    const confirmed = window.confirm(
      `Delete only the cached LeadOS inventory for ${selectedWaba.name} (${selectedWaba.waba_id})?\n\nThis does not delete anything from Meta. If the WABA still exists in Meta, it will return on the next sync.`
    );
    if (!confirmed) return;
    setMetaCacheDeleting(true);
    try {
      await api.deleteMetaWhatsAppCache(selectedWaba.waba_id);
      toast.success(`Deleted cached inventory for ${selectedWaba.name}`);
      await fetchClients();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setMetaCacheDeleting(false);
    }
  };

  const addPhoneToSelectedWaba = () => {
    if (!selectedWaba) return toast.error('Select a WABA first');
    if (!selectedWaba.business_id) {
      return toast.error('This WABA has no Business Portfolio ID. Run a full Meta sync first.');
    }
    const url = new URL('https://business.facebook.com/wa/manage/phone-numbers/');
    url.searchParams.set('business_id', selectedWaba.business_id);
    url.searchParams.set('waba_id', selectedWaba.waba_id);
    const width = 900;
    const height = 820;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const metaWindow = window.open(
      url.toString(),
      'leados-meta-add-phone',
      `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`
    );
    if (!metaWindow) return toast.error('Allow popups for LeadOS, then try again');
    metaWindow.focus();
    setMetaPhoneOnboarding(true);
    const targetWabaId = selectedWaba.waba_id;
    const existingPhoneIds = new Set(
      metaInventory.phone_numbers
        .filter(phone => phone.waba_id === targetWabaId)
        .map(phone => String(phone.phone_number_id))
    );
    const toastId = toast.loading(`Complete the phone setup and OTP under ${selectedWaba.name}. LeadOS will sync automatically when Meta closes.`);
    const openedAt = Date.now();
    const popupWatcher = window.setInterval(async () => {
      if (!metaWindow.closed && Date.now() - openedAt < 30 * 60 * 1000) return;
      window.clearInterval(popupWatcher);
      setMetaPhoneOnboarding(false);
      if (!metaWindow.closed) {
        toast.error('Meta setup monitoring expired. Close the popup and use Sync Meta Now.', { id: toastId });
        return;
      }
      setMetaSyncing(true);
      try {
        await api.syncMetaWhatsApp();
        const refreshed = await api.getMetaWhatsAppInventory();
        setMetaInventory(refreshed);
        const addedPhones = refreshed.phone_numbers.filter(phone =>
          phone.waba_id === targetWabaId && !existingPhoneIds.has(String(phone.phone_number_id))
        );
        if (addedPhones.length) {
          setSelectedWabaId(targetWabaId);
          setMetaResourceTab('phones');
          setRegistrationPhone(addedPhones[0]);
          setRegistrationPin('');
          toast.success('Phone verified in Meta. Complete Cloud API registration in LeadOS.', { id: toastId });
        } else {
          toast('Meta closed, but no new phone was found. Complete OTP before closing, or retry.', { id: toastId });
        }
        await fetchClients();
      } catch (error) {
        toast.error(error.message || 'Meta sync failed after phone setup', { id: toastId });
      } finally {
        setMetaSyncing(false);
      }
    }, 1000);
  };

  const registerPhoneWithMeta = async () => {
    if (!registrationPhone) return;
    if (!/^\d{6}$/.test(registrationPin)) return toast.error('Enter a valid 6-digit PIN');
    setRegisteringPhone(true);
    const toastId = toast.loading('Registering phone with WhatsApp Cloud API...');
    try {
      await api.registerMetaWhatsAppPhone(registrationPhone.phone_number_id, registrationPin);
      setRegistrationPin('');
      setRegistrationPhone(null);
      toast.success('Phone registered and app subscribed to WABA events', { id: toastId });
      await fetchClients();
    } catch (error) {
      toast.error(error.message || 'Phone registration failed', { id: toastId });
    } finally {
      setRegisteringPhone(false);
    }
  };

  const openMetaDisplayNameEditor = phone => {
    const waba = metaInventory.wabas.find(item => item.waba_id === phone.waba_id);
    if (!waba?.business_id) return toast.error('Run a full Meta sync before editing the display name');
    const url = new URL('https://business.facebook.com/wa/manage/phone-numbers/');
    url.searchParams.set('business_id', waba.business_id);
    url.searchParams.set('waba_id', phone.waba_id);
    url.searchParams.set('phone_number_id', phone.phone_number_id);
    const width = 900;
    const height = 780;
    const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
    const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
    const popup = window.open(url.toString(), 'leados-meta-display-name', `popup=yes,width=${width},height=${height},left=${Math.round(left)},top=${Math.round(top)},resizable=yes,scrollbars=yes`);
    if (!popup) return toast.error('Allow popups for LeadOS, then try again');
    popup.focus();
    toast('Select the phone in Meta, click its rejected display name, submit the corrected name, then close the popup and sync.');
  };

  const mapPhone = async (phoneId) => {
    const clientId = mapping[phoneId];
    if (!clientId) return toast.error('Select a brand first');
    try { await api.mapMetaPhoneNumber(phoneId, clientId); toast.success('Meta number mapped'); await fetchClients(); }
    catch (err) { toast.error(err.message); }
  };

  const activeClients = displayClients.filter(c => c.status === 'active' || c.status === 'Live');
  
  const totalLeads = displayClients.reduce((a, b) => a + parseInt(b.lead_count || b.leads || 0), 0);
  const totalConverted = displayClients.reduce((a, b) => a + parseInt(b.converted_count || b.conv || 0), 0);
  const avgConv = totalLeads > 0 ? Math.round((totalConverted / totalLeads) * 100) + '%' : '0%';
  
  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%' }}>
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 22 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 21, fontWeight: 800, color: C.text }}>Client Management</h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>External businesses using LeadOS via BM TechX {loading && '(loading...)'}</p>
        </div>
        <button onClick={() => { setSelectedClient(null); setIsModalOpen(true); }} style={{ background: C.accent, border: 'none', color: '#fff', padding: '8px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}><Plus size={12} />Onboard Client</button>
      </div>
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 22 }}>
        {[
          ['Active', activeClients.length.toString(), C.green],
          ['Total Leads Managed', totalLeads.toString(), C.blue],
          ['Avg Conversion', avgConv, C.purple]
        ].map(([l, v, col]) => (
          <div key={l} style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 11, padding: '14px 18px', flex: 1 }}>
            <p style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 5 }}>{l}</p>
            <p style={{ fontSize: 20, fontWeight: 700, color: col, fontFamily: "'Syne',sans-serif" }}>{v}</p>
          </div>
        ))}
      </div>
      <div style={{ background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 20, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div>
            <h2 style={{ color: C.text, fontSize: 15, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={16} color={C.green} />Meta WhatsApp Inventory</h2>
            <p style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>{metaInventory.wabas.length} WABAs · {metaInventory.phone_numbers.length} phone numbers · automatic sync every 15 minutes</p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {selectedWaba && <button onClick={addPhoneToSelectedWaba} disabled={metaCacheDeleting || metaSyncing || metaPhoneOnboarding} title={`Add a phone number under WABA ${selectedWaba.waba_id}`} style={{ background: C.green + '16', border: '1px solid ' + C.green, color: C.green, borderRadius: 7, padding: '7px 11px', display: 'flex', gap: 6, alignItems: 'center', cursor: metaPhoneOnboarding ? 'wait' : 'pointer', opacity: metaPhoneOnboarding ? .65 : 1, fontSize: 11, lineHeight: 1.2, fontWeight: 600 }}><Plus size={12} />{metaPhoneOnboarding ? 'Waiting for Meta...' : 'Add phone to selected WABA'}</button>}
            {selectedWaba && <button onClick={deleteSelectedMetaCache} disabled={metaCacheDeleting || metaSyncing} title="Delete only this WABA's cached LeadOS inventory" style={{ background: C.red + '16', border: '1px solid ' + C.red, color: C.red, borderRadius: 7, padding: '7px 11px', display: 'flex', gap: 6, alignItems: 'center', cursor: metaCacheDeleting ? 'wait' : 'pointer', fontSize: 11, lineHeight: 1.2, fontWeight: 600 }}><Trash2 size={12} />{metaCacheDeleting ? 'Deleting cache...' : 'Delete selected cache'}</button>}
            <button onClick={syncMeta} disabled={metaSyncing || metaCacheDeleting} style={{ background: C.surface, border: '1px solid ' + C.border, color: C.text, borderRadius: 7, padding: '7px 11px', display: 'flex', gap: 6, alignItems: 'center', cursor: metaSyncing ? 'wait' : 'pointer', fontSize: 11, lineHeight: 1.2, fontWeight: 600 }}><RefreshCw size={12} className={metaSyncing ? 'spin' : ''} />{metaSyncing ? 'Syncing...' : 'Sync Meta Now'}</button>
          </div>
        </div>
        {metaInventory.wabas.length > 0 && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{metaInventory.wabas.map(waba => {
          const templates = metaInventory.template_summary.find(item => item.waba_id === waba.waba_id);
          const active = selectedWabaId === waba.waba_id;
          return <button type="button" onClick={() => setSelectedWabaId(waba.waba_id)} key={waba.waba_id} style={{ background: active ? C.accent + '20' : C.surface, border: '1px solid ' + (active ? C.accent : C.border), borderRadius: 8, padding: '9px 12px', color: C.muted, fontSize: 10, cursor: 'pointer', textAlign: 'left' }}><strong style={{ color: active ? C.accent : C.text }}>{waba.name}</strong> · {waba.phone_count} numbers · {templates?.total || 0} templates<div style={{ fontSize: 8, marginTop: 3 }}>{waba.ownership_type} · {waba.waba_id}</div></button>;
        })}</div>}
        {selectedWaba && <div style={{ background: C.bg, border: '1px solid ' + C.border, borderRadius: 10, padding: 14, marginBottom: 14 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: 12 }}>
            {[['WABA Name', selectedWaba.name], ['WABA ID', selectedWaba.waba_id], ['Ownership', selectedWaba.ownership_type], ['Currency', selectedWaba.currency || 'Not available'], ['Timezone ID', selectedWaba.timezone_id || 'Not available'], ['Template Namespace', selectedWaba.template_namespace || 'Not available'], ['Last Synced', selectedWaba.last_synced_at ? new Date(selectedWaba.last_synced_at).toLocaleString() : 'Never']].map(([label, value]) => <div key={label}><div style={{ color: C.muted, fontSize: 8, textTransform: 'uppercase', marginBottom: 3 }}>{label}</div><div style={{ color: C.text, fontSize: 10, wordBreak: 'break-all' }}>{value}</div></div>)}
          </div>
        </div>}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid ' + C.border, marginBottom: 14 }}>
          {[['phones', `Phone Numbers (${filteredMetaNumbers.length})`], ['templates', `Templates (${filteredMetaTemplates.length})`]].map(([key, label]) => <button type="button" key={key} onClick={() => setMetaResourceTab(key)} style={{ background: 'transparent', border: 'none', borderBottom: metaResourceTab === key ? '2px solid ' + C.accent : '2px solid transparent', color: metaResourceTab === key ? C.accent : C.muted, padding: '9px 4px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>{label}</button>)}
        </div>
        {metaResourceTab === 'phones' && <>
        <h3 style={{ color: C.text, fontSize: 12, marginBottom: 10 }}>Unassigned Meta Numbers ({unassignedMetaNumbers.length})</h3>
        {unassignedMetaNumbers.length === 0 ? <p style={{ color: C.muted, fontSize: 11 }}>No unassigned Meta phone numbers.</p> : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{unassignedMetaNumbers.map(phone => (
          <div key={phone.phone_number_id} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px,1fr) minmax(180px,1fr) auto auto auto', gap: 8, alignItems: 'center', background: C.surface, borderRadius: 9, padding: 10 }} className="grid-responsive">
            <div style={{ display: 'flex', gap: 9, alignItems: 'center' }}>{phone.profile_picture_url ? <img src={phone.profile_picture_url} alt="WhatsApp profile" style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover', border: '1px solid ' + C.border }} /> : <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.card, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.accent, fontSize: 11, fontWeight: 800 }}>{phone.verified_name?.[0] || '?'}</div>}<div><div style={{ color: C.text, fontSize: 12, fontWeight: 700 }}>{phone.display_phone_number || 'Unknown number'}</div><div style={{ color: C.muted, fontSize: 9 }}>{phone.verified_name || 'No display name'} · {phone.waba_name}</div><div style={{ color: C.muted, fontSize: 8, marginTop: 3 }}>Phone ID: {phone.phone_number_id}</div></div></div>
            <div style={{ color: C.muted, fontSize: 10 }}>{phone.connection_status || phone.verification_status || 'Unknown'} · Quality: {phone.quality_rating || 'Unknown'}<small style={{ display: 'block', marginTop: 3 }}>Platform: {phone.platform_type || 'Unknown'} · Verified: {phone.verification_status || 'Unknown'}</small><small style={{ display: 'block', marginTop: 3, color: ['DECLINED','REJECTED'].includes(getDisplayNameStatus(phone)) ? C.red : C.muted }}>Display name: {getDisplayNameStatus(phone)}</small></div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {String(phone.connection_status || '').toUpperCase() !== 'CONNECTED'
                ? <button type="button" onClick={() => { setRegistrationPhone(phone); setRegistrationPin(''); }} title="Register this number with WhatsApp Cloud API" style={{ background: C.green + '18', color: C.green, border: '1px solid ' + C.green, borderRadius: 7, padding: '7px 10px', fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>Register API</button>
                : <span style={{ color: C.green, fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>API registered</span>}
              {['DECLINED','REJECTED'].includes(getDisplayNameStatus(phone)) && <button type="button" onClick={() => openMetaDisplayNameEditor(phone)} style={{ background: C.red + '16', color: C.red, border: '1px solid ' + C.red, borderRadius: 7, padding: '6px 9px', fontSize: 9, fontWeight: 700, whiteSpace: 'nowrap' }}>Edit display name</button>}
            </div>
            <select value={mapping[phone.phone_number_id] || ''} onChange={e => setMapping({...mapping, [phone.phone_number_id]: e.target.value})} style={{ background: C.bg, border: '1px solid ' + C.border, color: C.text, borderRadius: 7, padding: '6px 8px', fontSize: 11, lineHeight: 1.3, minHeight: 32 }}><option value="" style={{ fontSize: 11 }}>Map to brand...</option>{clients.map(client => <option key={client.id} value={client.id} style={{ fontSize: 11 }}>{client.name}</option>)}</select>
            <button onClick={() => mapPhone(phone.phone_number_id)} title="Map selected brand" style={{ background: C.accent + '20', color: C.accent, border: '1px solid ' + C.accentDim, borderRadius: 7, padding: 7 }}><Link2 size={13} /></button>
          </div>
        ))}</div>}
        {assignedMetaNumbers.length > 0 && <div style={{ marginTop: 16 }}><h3 style={{ color: C.text, fontSize: 12, marginBottom: 10 }}>Mapped Meta Numbers ({assignedMetaNumbers.length})</h3><div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{assignedMetaNumbers.map(phone => <div key={phone.phone_number_id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, background: C.surface, borderRadius: 8, padding: 10, color: C.muted, fontSize: 10 }}><span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{phone.profile_picture_url && <img src={phone.profile_picture_url} alt="" style={{ width: 30, height: 30, borderRadius: '50%', objectFit: 'cover' }} />}<span><strong style={{ color: C.text }}>{phone.display_phone_number}</strong><small style={{ display: 'block', marginTop: 3 }}>ID: {phone.phone_number_id}</small></span></span><span>{phone.client_name} · {phone.verified_name || 'No verified name'}<small style={{ display: 'block', marginTop: 3 }}>Platform: {phone.platform_type || 'Unknown'}</small></span><span style={{ textAlign: 'right' }}>{phone.connection_status || phone.verification_status || 'Unknown'} · Quality: {phone.quality_rating || 'Unknown'}</span></div>)}</div></div>}
        </>}
        {metaResourceTab === 'templates' && <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse' }}><thead><tr>{['Template Name', 'Language', 'Category', 'Status', 'Template ID', 'Last Synced'].map(label => <th key={label} style={{ color: C.muted, fontSize: 9, textAlign: 'left', padding: 10, borderBottom: '1px solid ' + C.border }}>{label}</th>)}</tr></thead><tbody>{filteredMetaTemplates.map(template => <tr key={template.template_id}><td style={{ color: C.text, fontSize: 11, fontWeight: 700, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.name}</td><td style={{ color: C.muted, fontSize: 10, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.language}</td><td style={{ color: C.muted, fontSize: 10, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.category}</td><td style={{ color: template.status === 'APPROVED' ? C.green : template.status === 'REJECTED' ? C.red : C.accent, fontSize: 10, fontWeight: 700, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.status}</td><td style={{ color: C.muted, fontSize: 9, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.template_id}</td><td style={{ color: C.muted, fontSize: 9, padding: 10, borderBottom: '1px solid ' + C.border }}>{template.last_synced_at ? new Date(template.last_synced_at).toLocaleString() : '-'}</td></tr>)}</tbody></table>{filteredMetaTemplates.length === 0 && <p style={{ color: C.muted, fontSize: 11, padding: 16, textAlign: 'center' }}>No templates found for this WABA.</p>}</div>}
      </div>
      <ClientsTable clients={displayClients} onDashboard={cl => { setDashboardClient(cl); setIsDashboardOpen(true); }} onManage={cl => { setSelectedClient(cl); setIsModalOpen(true); }} />
      {false && <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {displayClients.map((cl) => {
          const leads = cl.lead_count ?? cl.leads ?? 0;
          const converted = cl.converted_count ?? cl.conv ?? 0;
          return (
            <div key={cl.id} style={{ background: C.card, border: '1px solid ' + (cl.status === 'active' ? C.border : C.dim), borderRadius: 14, padding: 20, opacity: cl.status === 'inactive' ? 0.65 : 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: C.accent + '20', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15, fontWeight: 800, color: C.accent }}>{cl.name[0]}</div>
                  <div>
                    <p style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{cl.name}</p>
                    <p style={{ fontSize: 10, color: C.muted }}>{cl.type || 'Business'} - {new Date(cl.joined_at || cl.created_at || Date.now()).toLocaleDateString()}</p>
                  </div>
                </div>
                <span style={{ background: cl.status === 'active' ? '#0a2018' : '#1a1a1a', color: cl.status === 'active' ? C.green : C.muted, padding: '3px 9px', borderRadius: 12, fontSize: 10, fontWeight: 600 }}>{cl.status === 'active' ? 'Active' : 'Inactive'}</span>
              </div>
              <div style={{ display: 'flex', gap: 11, marginBottom: 14 }}>
                {[['Leads', leads, C.blue], ['Converted', converted, C.green], ['Conversion', leads > 0 ? Math.round((converted / leads) * 100) + '%' : '0%', C.purple]].map(([l, v, col]) => (
                  <div key={l} style={{ flex: 1, background: C.surface, borderRadius: 7, padding: '9px 11px', textAlign: 'center' }}>
                    <p style={{ fontSize: 16, fontWeight: 700, color: col, fontFamily: "'Syne',sans-serif" }}>{v}</p>
                    <p style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{l}</p>
                  </div>
                ))}
              </div>
              <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.surface, borderRadius: 7, padding: '8px 11px' }}>
                <span style={{ color: C.muted, fontSize: 10 }}>WhatsApp</span>
                <span style={{ color: cl.whatsapp_status === 'verified' ? C.green : cl.whatsapp_status === 'verification_failed' ? C.red : C.muted, fontSize: 10, fontWeight: 700 }}>
                  {cl.whatsapp_status === 'verified' ? 'Verified · Enabled' : cl.whatsapp_status === 'verification_pending' ? 'Verification Pending' : cl.whatsapp_status === 'verification_failed' ? 'Verification Failed' : 'Not Configured'}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 7 }}>
                <button onClick={() => { setDashboardClient(cl); setIsDashboardOpen(true); }} style={{ flex: 1, background: 'transparent', border: '1px solid ' + C.border, borderRadius: 7, color: C.text, padding: '6px', fontSize: 11, fontWeight: 600 }}>Dashboard</button>
                <button onClick={() => { setSelectedClient(cl); setIsModalOpen(true); }} style={{ flex: 1, background: C.accent + '20', border: '1px solid ' + C.accentDim, borderRadius: 7, color: C.accent, padding: '6px', fontSize: 11, fontWeight: 600 }}>Manage</button>
              </div>
            </div>
          );
        })}
      </div>}
      {registrationPhone && <div style={{ position: 'fixed', inset: 0, zIndex: 10050, background: 'rgba(0,0,0,.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <div style={{ width: '100%', maxWidth: 440, background: C.card, border: '1px solid ' + C.border, borderRadius: 14, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,.55)' }}>
          <h3 style={{ color: C.text, fontSize: 17, marginBottom: 6 }}>Register phone with Cloud API</h3>
          <p style={{ color: C.muted, fontSize: 11, lineHeight: 1.6, marginBottom: 18 }}>Meta verified <strong style={{ color: C.text }}>{registrationPhone.display_phone_number || registrationPhone.phone_number_id}</strong>. For a first registration, choose a new 6-digit PIN. If Meta already configured two-step verification for this number, enter its existing PIN. LeadOS sends it directly to Meta and never stores it.</p>
          <label style={{ display: 'block', color: C.muted, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>6-digit PIN</label>
          <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={registrationPin} onChange={event => setRegistrationPin(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="••••••" style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: '1px solid ' + C.border, borderRadius: 8, padding: '11px 13px', color: C.text, fontSize: 18, letterSpacing: 8, textAlign: 'center', outline: 'none' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
            <button type="button" disabled={registeringPhone} onClick={() => { setRegistrationPhone(null); setRegistrationPin(''); }} style={{ background: 'transparent', border: '1px solid ' + C.border, color: C.muted, borderRadius: 8, padding: '9px 15px', cursor: 'pointer' }}>Later</button>
            <button type="button" disabled={registeringPhone || registrationPin.length !== 6} onClick={registerPhoneWithMeta} style={{ background: C.green, border: 0, color: '#06120d', borderRadius: 8, padding: '9px 15px', fontWeight: 800, cursor: registeringPhone ? 'wait' : 'pointer', opacity: registrationPin.length === 6 ? 1 : .55 }}>{registeringPhone ? 'Registering...' : 'Register phone'}</button>
          </div>
        </div>
      </div>}
      {isModalOpen && (
        <ClientModal
          client={selectedClient}
          onClose={() => setIsModalOpen(false)}
          onUpdate={fetchClients}
        />
      )}
      {isDashboardOpen && (
        <ClientDashboardModal
          client={dashboardClient}
          onClose={() => setIsDashboardOpen(false)}
        />
      )}
    </div>
  );
};
