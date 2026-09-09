import React, { useEffect, useMemo, useState, useRef } from 'react';
import toast from 'react-hot-toast';
import { api, allianceInboxApi } from '../../services/api.js';
import { DatePicker } from './DatePicker.jsx';
import { ScoreBar } from '../../components/ui.jsx';
import { Tag, Plus, X } from 'lucide-react';
import './alliance.css';

const PAGE_SIZE = 10;
const statusMap = {
  interested: { label: 'Interested', cls: 'int' },
  not_interested: { label: 'Not Interested', cls: 'rep' },
  pending: { label: 'Pending', cls: 'seq' },
  in_process: { label: 'In Process', cls: 'seq' },
  converted: { label: 'Converted', cls: 'int' },
  replied: { label: 'Replied', cls: 'rep' },
  in_sequence: { label: 'In sequence', cls: 'seq' },
  new: { label: 'New', cls: 'new' },
};

const emptyEdit = {
  name: '', business_name: '', email: '', phone: '', audience: '', industry: '',
  location: '', source: '', channel: 'email', consent: false, consent_source: '',
};

const emptyCreate = { ...emptyEdit, audience: '', custom_fields: {} };

export const LeadList = () => {
  const [prospects, setProspects] = useState([]);
  const [audiences, setAudiences] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [audienceFilter, setAudienceFilter] = useState('');
  const [campaignFilter, setCampaignFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [availableTags, setAvailableTags] = useState([]);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState(emptyEdit);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [confirmingRepair, setConfirmingRepair] = useState(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => { setPage(1); }, [status, audienceFilter, campaignFilter, tagFilter, debouncedSearch, dateFrom, dateTo]);

  const loadProspects = async () => {
    setLoading(true);
    setError('');
    setSelectedIds(new Set());
    try {
      const data = await api.getAllianceProspects({
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        status: status === 'all' ? '' : status,
        audience: audienceFilter,
        campaign_name: campaignFilter,
        tag: tagFilter,
        search: debouncedSearch,
        dateFrom,
        dateTo,
      });
      setProspects(data.prospects || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message || 'Failed to load imported leads');
    } finally { setLoading(false); }
  };

  useEffect(() => { loadProspects(); }, [page, status, audienceFilter, campaignFilter, tagFilter, debouncedSearch, dateFrom, dateTo]);
  useEffect(() => {
    Promise.all([api.getAllianceAudiences(), api.getAllianceCampaigns({ limit: 5000 }), allianceInboxApi.getTags()])
      .then(([audienceData, campaignData, tagsData]) => {
        setAudiences(audienceData.audiences || []);
        setCampaigns(campaignData.campaigns || []);
        setAvailableTags(tagsData || []);
      }).catch(() => {});
  }, []);

  const audienceLabel = (code) => audiences.find((item) => item.code === code)?.label || code;
  const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: '2-digit' });
  };
  const selectedAudience = audiences.find((item) => item.code === createForm.audience);
  const filterCampaigns = [...new Map(
    (audienceFilter ? campaigns.filter((item) => item.audience === audienceFilter) : campaigns)
      .map((item) => [item.name, item])
  ).values()];
  const dynamicFields = useMemo(() => {
    const applicableAudiences = audienceFilter ? audiences.filter((item) => item.code === audienceFilter) : audiences;
    const fields = new Map();
    applicableAudiences.forEach((item) => (item.fields || []).forEach((field) => {
      if (!fields.has(field.field_key)) fields.set(field.field_key, field);
    }));
    return [...fields.values()];
  }, [audiences, audienceFilter]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const usesEmail = (channel) => channel === 'email' || channel === 'both';
  const usesWhatsApp = (channel) => channel === 'whatsapp' || channel === 'both';

  const openEdit = (prospect) => {
    setEditing(prospect);
    setEditForm({
      name: prospect.name || '', business_name: prospect.business_name || '', email: prospect.email || '',
      phone: prospect.phone || '', audience: prospect.audience || '', industry: prospect.industry || '',
      location: prospect.location || '', source: prospect.source || '', channel: prospect.channel || 'email',
      consent: Boolean(prospect.consent), consent_source: prospect.consent_source || '',
    });
  };

  const selectCreateAudience = (audience) => {
    const config = audiences.find((item) => item.code === audience);
    setCreateForm({ ...emptyCreate, audience, channel: config?.default_channel || 'email' });
  };

  const saveCreate = async (event) => {
    event.preventDefault();
    if (usesWhatsApp(createForm.channel) && (!createForm.consent || !createForm.consent_source.trim())) {
      toast.error('Select WhatsApp consent = Yes and enter where consent was collected.');
      return;
    }
    setSaving(true);
    try {
      await api.createAllianceProspect(createForm);
      toast.success('Prospect added');
      setCreating(false);
      setCreateForm(emptyCreate);
      if (page === 1) await loadProspects();
      else setPage(1);
    } catch (err) { toast.error(err.message || 'Failed to add prospect'); }
    finally { setSaving(false); }
  };

  const saveEdit = async (event) => {
    event.preventDefault();
    if (usesWhatsApp(editForm.channel) && (!editForm.consent || !editForm.consent_source.trim())) {
      toast.error('Select WhatsApp consent = Yes and enter where consent was collected.');
      return;
    }
    setSaving(true);
    try {
      await api.updateAllianceProspect(editing.id, editForm);
      toast.success('Prospect updated');
      setEditing(null);
      await loadProspects();
    } catch (err) { toast.error(err.message || 'Failed to update prospect'); }
    finally { setSaving(false); }
  };

  const deleteProspect = async (prospect) => {
    setDeleting(prospect.id);
    try {
      await api.deleteAllianceProspect(prospect.id);
      toast.success('Prospect deleted');
      setDeleteCandidate(null);
      const nextTotal = Math.max(0, total - 1);
      const nextLastPage = Math.max(1, Math.ceil(nextTotal / PAGE_SIZE));
      if (page > nextLastPage) setPage(nextLastPage);
      else await loadProspects();
    } catch (err) { toast.error(err.message || 'Failed to delete prospect'); }
    finally { setDeleting(null); }
  };

  const repairImportedNames = async () => {
    setRepairing(true);
    try {
      const result = await api.repairAllianceProspectNames();
      toast.success(result.message);
      setConfirmingRepair(false);
      await loadProspects();
    } catch (err) {
      toast.error(err.message || 'Failed to repair imported names');
    } finally {
      setRepairing(false);
    }
  };
  const handleBulkDelete = async () => {
    if (!selectedIds.size) return;
    setBulkDeleting(true);
    try {
      await api.bulkDeleteAllianceProspects(Array.from(selectedIds));
      toast.success(`${selectedIds.size} prospects deleted`);
      setSelectedIds(new Set());
      await loadProspects();
    } catch (err) {
      toast.error(err.message || 'Failed to delete prospects');
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelection = (id) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === prospects.length && prospects.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(prospects.map((p) => p.id)));
    }
  };

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Imported Leads</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <div className="al-page-title">Prospects</div>
        <div style={{ display: 'flex', gap: 8 }}><button className="al-btn ghost" type="button" onClick={() => api.exportAllianceProspects({ status: status === 'all' ? '' : status, audience: audienceFilter, campaign_name: campaignFilter, tag: tagFilter, search: debouncedSearch, dateFrom, dateTo })}>Export</button><button className="al-btn ghost" type="button" onClick={() => setConfirmingRepair(true)}>Repair imported names</button><button className="al-btn" type="button" onClick={() => { setCreateForm(emptyCreate); setCreating(true); }}>+ Add prospect</button></div>
      </div>
      <p className="al-page-desc">Review, edit, and remove imported prospect records. Showing 10 records per page.</p>

      <div className="al-fields" style={{ alignItems: 'flex-end' }}>
        <div className="al-field" style={{ flex: 2 }}><label>Search</label><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search business, contact, or email" /></div>
        <div className="al-field"><label>Audience</label><select value={audienceFilter} onChange={(event) => { setAudienceFilter(event.target.value); setCampaignFilter(''); }}><option value="">All audiences</option>{audiences.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></div>
        <div className="al-field"><label>Campaign</label><select value={campaignFilter} onChange={(event) => setCampaignFilter(event.target.value)}><option value="">All campaigns</option>{filterCampaigns.map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></div>
        <div className="al-field"><label>Tag</label><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">All tags</option>{availableTags.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div className="al-field"><label>Status</label><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All statuses</option><option value="new">New</option><option value="pending">Pending</option><option value="in_process">In Process</option><option value="interested">Interested</option><option value="not_interested">Not Interested</option><option value="converted">Converted</option></select></div>
        <div className="al-field"><label>From date</label><DatePicker value={dateFrom} max={dateTo} onChange={setDateFrom} /></div>
        <div className="al-field"><label>To date</label><DatePicker value={dateTo} min={dateFrom} onChange={setDateTo} /></div>
        {(dateFrom || dateTo) && <button type="button" className="al-btn ghost sm" style={{ marginBottom: 1 }} onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear dates</button>}
        <div style={{ color: 'var(--al-muted)', fontSize: 12, paddingBottom: 11 }}>{total.toLocaleString('en-IN')} records</div>
      </div>

      <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, overflowX: 'auto' }}>
        {selectedIds.size > 0 && (
          <div style={{ padding: '12px 24px', background: 'rgba(239, 154, 154, 0.1)', borderBottom: '1px solid var(--al-line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14 }}>{selectedIds.size} prospect{selectedIds.size > 1 ? 's' : ''} selected</span>
            <button className="al-btn sm" disabled={bulkDeleting} onClick={handleBulkDelete} style={{ background: '#EF9A9A', color: '#fff', border: 'none' }}>{bulkDeleting ? 'Deleting…' : 'Delete selected'}</button>
          </div>
        )}
        {error ? <p style={{ padding: 24, color: '#EF9A9A' }}>{error}</p> : loading ? <p style={{ padding: 24, color: 'var(--al-muted)' }}>Loading imported leads…</p> : (
          <table className="al-table" style={{ minWidth: 1750 + dynamicFields.length * 150, whiteSpace: 'nowrap' }}>
            <thead><tr><th style={{ width: 40 }}><input type="checkbox" checked={prospects.length > 0 && selectedIds.size === prospects.length} onChange={toggleAll} /></th><th>Business / Contact</th><th>Tags</th><th>Email</th><th>Phone</th><th>AI Score</th><th>Audience</th><th>Industry / Location</th><th>Source</th>{dynamicFields.map((field) => <th key={field.field_key}>{field.label || field.field_key.replaceAll('_', ' ')}</th>)}<th>Channel</th><th>Consent</th><th>Campaign</th><th>Status</th><th>Date added</th><th>Actions</th></tr></thead>
            <tbody>
              {prospects.map((prospect) => (
                <tr key={prospect.id}>
                  <td><input type="checkbox" checked={selectedIds.has(prospect.id)} onChange={() => toggleSelection(prospect.id)} /></td>
                  <td>
                    {prospect.business_name} <span style={{ color: 'var(--al-muted)' }}>· {prospect.name || 'No contact name'}</span>
                  </td>
                  <td>
                    {prospect.tags && prospect.tags.length > 0 ? (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {prospect.tags.map(tag => (
                          <span key={tag.id} style={{ fontSize: 10, fontWeight: 600, color: tag.color, background: tag.color + '22', border: '1px solid ' + tag.color + '44', padding: '2px 6px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                            <Tag size={10} /> {tag.name}
                          </span>
                        ))}
                      </div>
                    ) : <span style={{ color: 'var(--al-muted)' }}>—</span>}
                  </td>
                  <td>{prospect.email || '—'}</td><td>{prospect.phone || '—'}</td>
                  <td><ScoreBar score={Number(prospect.ai_score) || 10} /></td>
                  <td><span className={`al-tag ${prospect.audience}`}>{audienceLabel(prospect.audience)}</span></td>
                  <td>{prospect.industry || '—'} <span style={{ color: 'var(--al-muted)' }}>· {prospect.location || '—'}</span></td>
                  <td>{prospect.source || '—'}</td>
                  {dynamicFields.map((field) => <td key={field.field_key}>{String(prospect.custom_fields?.[field.field_key] ?? '') || '—'}</td>)}
                  <td><div style={{ display: 'flex', gap: 5 }}>{usesEmail(prospect.channel) && <span className="al-tag email">email</span>}{usesWhatsApp(prospect.channel) && <span className="al-tag wa">whatsapp</span>}</div></td>
                  <td>{usesWhatsApp(prospect.channel) ? (prospect.consent ? `Yes · ${prospect.consent_source || 'recorded'}` : 'No') : 'Not required'}</td>
                  <td>{prospect.campaign_name || '—'}</td>
                  <td><span className={`al-st ${statusMap[prospect.status]?.cls || 'new'}`}><span className="d" />{statusMap[prospect.status]?.label || prospect.status}</span></td>
                  <td>{formatDate(prospect.created_at)}</td>
                  <td><div style={{ display: 'flex', gap: 6 }}><button className="al-btn ghost sm" onClick={() => openEdit(prospect)}>Edit</button><button className="al-btn ghost sm" disabled={deleting === prospect.id} onClick={() => setDeleteCandidate(prospect)} style={{ color: '#EF9A9A' }}>{deleting === prospect.id ? 'Deleting…' : 'Delete'}</button></div></td>
                </tr>
              ))}
              {!prospects.length && <tr><td colSpan={14 + dynamicFields.length} style={{ textAlign: 'center', padding: 32, color: 'var(--al-muted)' }}>No imported leads found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 14 }}>
        <span style={{ color: 'var(--al-muted)', fontSize: 12 }}>Page {page} of {totalPages} · Records {(page - 1) * PAGE_SIZE + (prospects.length ? 1 : 0)}–{Math.min(page * PAGE_SIZE, total)}</span>
        <div style={{ display: 'flex', gap: 8 }}><button className="al-btn ghost sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button className="al-btn ghost sm" disabled={page >= totalPages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div>
      </div>

      {editing && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !saving && setEditing(null)}>
          <form onSubmit={saveEdit} onClick={(event) => event.stopPropagation()} style={{ width: 'min(760px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 14, padding: 22 }}>
            <div className="al-page-title" style={{ fontSize: 21 }}>Edit prospect</div>
            <div className="al-fields"><div className="al-field"><label>Business name</label><input required value={editForm.business_name} onChange={(e) => setEditForm({ ...editForm, business_name: e.target.value })} /></div><div className="al-field"><label>Contact name</label><input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div></div>
            <div className="al-fields">
               <div className="al-field" style={{ width: '100%' }}>
                  <label>Tags</label>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {(editing.tags || []).map(tag => (
                      <span key={tag.id} style={{ fontSize: 11, fontWeight: 600, color: tag.color, background: tag.color + '22', border: '1px solid ' + tag.color + '44', padding: '2px 8px', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Tag size={10} /> {tag.name}
                        <X size={12} style={{ cursor: 'pointer', opacity: 0.7, marginLeft: 2 }} onClick={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          try {
                            await api.removeProspectTag(editing.id, tag.id);
                            setEditing({ ...editing, tags: editing.tags.filter(t => t.id !== tag.id) });
                            loadProspects();
                          } catch(err) { console.error(err); }
                        }} />
                      </span>
                    ))}
                    {(editing.tags || []).length === 0 && <span style={{ color: 'var(--al-muted)', fontSize: 12, fontStyle: 'italic' }}>No tags assigned</span>}
                  </div>
                  <select onChange={async (e) => {
                    const tagId = e.target.value;
                    if (!tagId) return;
                    e.target.value = '';
                    const tag = availableTags.find(t => t.id === Number(tagId));
                    if (!tag || (editing.tags || []).find(t => t.id === tag.id)) return;
                    try {
                      await api.assignProspectTag(editing.id, tag.id);
                      setEditing({ ...editing, tags: [...(editing.tags || []), tag] });
                      loadProspects();
                    } catch(err) { console.error(err); }
                  }} style={{ width: 'max-content', padding: '4px 8px', fontSize: 12 }}>
                    <option value="">+ Assign tag...</option>
                    {availableTags.filter(t => !(editing.tags || []).find(et => et.id === t.id)).map(tag => (
                      <option key={tag.id} value={tag.id}>{tag.name}</option>
                    ))}
                  </select>
               </div>
            </div>
            <div className="al-fields"><div className="al-field"><label>Email {usesEmail(editForm.channel) ? '*' : ''}</label><input required={usesEmail(editForm.channel)} type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div><div className="al-field"><label>Phone {usesWhatsApp(editForm.channel) ? '*' : ''}</label><input required={usesWhatsApp(editForm.channel)} value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div></div>
            <div className="al-fields"><div className="al-field"><label>Audience</label><select value={editForm.audience} disabled title="Audience cannot be changed after import">{audiences.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select><div style={{ color: 'var(--al-muted)', fontSize: 11, marginTop: 5 }}>Audience is fixed after import.</div></div><div className="al-field"><label>Channel</label><select value={editForm.channel} onChange={(e) => setEditForm({ ...editForm, channel: e.target.value })}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">Email + WhatsApp</option></select></div></div>
            <div className="al-fields"><div className="al-field"><label>Industry</label><input value={editForm.industry} onChange={(e) => setEditForm({ ...editForm, industry: e.target.value })} /></div><div className="al-field"><label>Location</label><input value={editForm.location} onChange={(e) => setEditForm({ ...editForm, location: e.target.value })} /></div><div className="al-field"><label>Source</label><input value={editForm.source} onChange={(e) => setEditForm({ ...editForm, source: e.target.value })} /></div></div>
            {usesWhatsApp(editForm.channel) && <><div className="al-fields"><div className="al-field"><label>WhatsApp consent *</label><select required value={editForm.consent ? 'yes' : 'no'} onChange={(e) => setEditForm({ ...editForm, consent: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select></div><div className="al-field"><label>Consent source *</label><input required value={editForm.consent_source} placeholder="Example: website_form, college_visit" onChange={(e) => setEditForm({ ...editForm, consent_source: e.target.value })} /></div></div>{!editForm.consent && <div style={{ color: '#EF9A9A', fontSize: 12, marginTop: 6 }}>WhatsApp cannot be enabled until the lead has explicitly consented. A phone number alone is not consent.</div>}</>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}><button type="button" className="al-btn ghost" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="submit" className="al-btn" disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button></div>
          </form>
        </div>
      )}

      {creating && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !saving && setCreating(false)}>
          <form onSubmit={saveCreate} onClick={(event) => event.stopPropagation()} style={{ position: 'relative', width: 'min(820px, 100%)', maxHeight: '90vh', overflowY: 'auto', background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 14, padding: 22 }}>
            <button type="button" aria-label="Close add prospect" title="Close" disabled={saving} onClick={() => setCreating(false)} style={{ position: 'absolute', top: 14, right: 16, width: 34, height: 34, borderRadius: 8, border: '1px solid var(--al-line)', background: 'transparent', color: 'var(--al-muted)', fontSize: 23, lineHeight: 1, cursor: saving ? 'not-allowed' : 'pointer' }}>×</button>
            <div className="al-page-title" style={{ fontSize: 21 }}>Add prospect</div>
            <p style={{ color: 'var(--al-muted)', fontSize: 12.5, margin: '5px 0 16px' }}>Select an audience first. The fields for that audience will then be enabled.</p>
            <div className="al-field">
              <label>Audience *</label>
              <select required value={createForm.audience} onChange={(e) => selectCreateAudience(e.target.value)}>
                <option value="">Select audience</option>
                {audiences.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
              </select>
            </div>

            {selectedAudience && <>
              <div className="al-fields"><div className="al-field"><label>Business name *</label><input required value={createForm.business_name} onChange={(e) => setCreateForm({ ...createForm, business_name: e.target.value })} /></div><div className="al-field"><label>Contact name</label><input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })} /></div></div>
              <div className="al-fields"><div className="al-field"><label>Email {usesEmail(createForm.channel) ? '*' : ''}</label><input required={usesEmail(createForm.channel)} type="email" value={createForm.email} onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })} /></div><div className="al-field"><label>Phone {usesWhatsApp(createForm.channel) ? '*' : ''}</label><input required={usesWhatsApp(createForm.channel)} value={createForm.phone} placeholder="919876543210" onChange={(e) => setCreateForm({ ...createForm, phone: e.target.value })} /></div></div>
              <div className="al-fields"><div className="al-field"><label>Channel *</label><select value={createForm.channel} onChange={(e) => { const channel = e.target.value; setCreateForm({ ...createForm, channel, consent: usesWhatsApp(channel) ? createForm.consent : false, consent_source: usesWhatsApp(channel) ? createForm.consent_source : '' }); }}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="both">Email + WhatsApp</option></select></div><div className="al-field"><label>Industry</label><input value={createForm.industry} onChange={(e) => setCreateForm({ ...createForm, industry: e.target.value })} /></div><div className="al-field"><label>Location</label><input value={createForm.location} onChange={(e) => setCreateForm({ ...createForm, location: e.target.value })} /></div></div>
              <div className="al-field"><label>Source</label><input value={createForm.source} placeholder="manual_entry" onChange={(e) => setCreateForm({ ...createForm, source: e.target.value })} /></div>
              {usesWhatsApp(createForm.channel) && <div className="al-fields"><div className="al-field"><label>WhatsApp consent *</label><select required value={createForm.consent ? 'yes' : ''} onChange={(e) => setCreateForm({ ...createForm, consent: e.target.value === 'yes' })}><option value="">Select consent</option><option value="yes">Yes</option></select></div><div className="al-field"><label>Consent source *</label><input required value={createForm.consent_source} placeholder="click_to_whatsapp" onChange={(e) => setCreateForm({ ...createForm, consent_source: e.target.value })} /></div></div>}
              {!!selectedAudience.fields?.length && <div style={{ borderTop: '1px solid var(--al-line)', marginTop: 18, paddingTop: 16 }}><div style={{ color: 'var(--al-gold)', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>AUDIENCE FIELDS</div><div className="al-fields">{selectedAudience.fields.map((field) => <div className="al-field" key={field.field_key}><label>{field.label || field.field_key.replace(/_/g, ' ')} {field.required ? '*' : ''}</label><input required={field.required} type={field.data_type === 'number' || field.data_type === 'integer' ? 'number' : field.data_type === 'date' ? 'date' : 'text'} step={field.data_type === 'number' ? 'any' : undefined} placeholder={field.sample_value ? `Example: ${field.sample_value}` : ''} value={createForm.custom_fields[field.field_key] ?? ''} onChange={(e) => setCreateForm({ ...createForm, custom_fields: { ...createForm.custom_fields, [field.field_key]: e.target.value } })} /></div>)}</div></div>}
            </>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}><button type="button" className="al-btn ghost" disabled={saving} onClick={() => setCreating(false)}>Cancel</button><button type="submit" className="al-btn" disabled={saving || !selectedAudience}>{saving ? 'Adding…' : 'Add prospect'}</button></div>
          </form>
        </div>
      )}

      {deleteCandidate && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !deleting && setDeleteCandidate(null)}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(460px, 100%)', background: 'var(--al-panel2)', border: '1px solid rgba(239,154,154,.35)', borderRadius: 14, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,.45)' }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, display: 'grid', placeItems: 'center', background: 'rgba(239,154,154,.12)', color: '#EF9A9A', fontSize: 22, marginBottom: 16 }}>!</div>
            <div className="al-page-title" style={{ fontSize: 21, marginBottom: 8 }}>Delete prospect?</div>
            <p style={{ color: 'var(--al-muted)', fontSize: 13, lineHeight: 1.6, margin: 0 }}>
              <b style={{ color: 'var(--al-ink)' }}>{deleteCandidate.business_name}</b> will be permanently removed along with its scheduled AllianceOS touches and replies.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button className="al-btn ghost" type="button" disabled={Boolean(deleting)} onClick={() => setDeleteCandidate(null)}>Cancel</button>
              <button className="al-btn" type="button" disabled={Boolean(deleting)} onClick={() => deleteProspect(deleteCandidate)} style={{ background: '#C62828', color: '#fff' }}>
                {deleting ? 'Deleting…' : 'Delete prospect'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmingRepair && (
        <div role="dialog" aria-modal="true" aria-labelledby="repair-names-title" style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => !repairing && setConfirmingRepair(false)}>
          <div onClick={(event) => event.stopPropagation()} style={{ width: 'min(510px, 100%)', background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 14, padding: 24, boxShadow: '0 24px 70px rgba(0,0,0,.45)' }}>
            <div id="repair-names-title" className="al-page-title" style={{ fontSize: 21, marginBottom: 8 }}>Repair imported names?</div>
            <p style={{ color: 'var(--al-muted)', fontSize: 13, lineHeight: 1.65, margin: 0 }}>This scans all prospects and updates only confidently detected character-encoding corruption. Contact names and business names are preserved as separate fields, even when their values are identical. Email addresses, phone numbers, campaign membership, and correctly encoded names are not changed.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 22 }}>
              <button className="al-btn ghost" type="button" disabled={repairing} onClick={() => setConfirmingRepair(false)}>Cancel</button>
              <button className="al-btn" type="button" disabled={repairing} onClick={repairImportedNames}>{repairing ? 'Repairing…' : 'Repair names'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
