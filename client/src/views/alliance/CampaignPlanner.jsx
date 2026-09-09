import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import { api } from '../../services/api.js';
import { EmailCampaignDetail } from './EmailCampaignDetail.jsx';
import './alliance.css';

const TIERS = [250, 1000, 10000, 100000];
const STATUS_CLASS = { scheduled: 'seq', running: 'seq', paused: 'rep', completed: 'int', draft: 'new', ready: 'int' };
const PAGE_SIZE = 10;

export const CampaignPlanner = () => {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [page, setPage] = useState(1);
  const [totalCampaigns, setTotalCampaigns] = useState(0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [contacts, setContacts] = useState(5000);
  const [tier, setTier] = useState(1000);
  const [confirmingStop, setConfirmingStop] = useState(null);
  const [deletingCampaign, setDeletingCampaign] = useState(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [testEmail, setTestEmail] = useState('');
  const [testTouch, setTestTouch] = useState(1);
  const [detailCampaignId, setDetailCampaignId] = useState(null);

  const loadCampaigns = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getAllianceCampaigns({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      setCampaigns(result.campaigns || []);
      setTotalCampaigns(result.total || 0);
      if (page > 1 && !(result.campaigns || []).length && result.total > 0) setPage((current) => current - 1);
    } catch (error) {
      toast.error(error.message || 'Failed to load campaigns');
    } finally {
      setLoading(false);
    }
  }, [page]);

  const openCampaign = async (id) => {
    try {
      setSelected(await api.getAllianceCampaign(id));
    } catch (error) {
      toast.error(error.message || 'Failed to load campaign readiness');
    }
  };

  const changeStatus = async (campaign, action) => {
    setBusy(campaign.id);
    try {
      const result = action === 'start'
        ? await api.startAllianceCampaign(campaign.id)
        : await api.pauseAllianceCampaign(campaign.id);
      toast.success(result.message);
      await loadCampaigns();
      await openCampaign(campaign.id);
    } catch (error) {
      const readiness = error.response?.data?.readiness;
      if (readiness) setSelected(readiness);
      toast.error(error.message || `Failed to ${action} campaign`);
    } finally {
      setBusy(null);
    }
  };

  const stopCampaign = async () => {
    if (!confirmingStop) return;
    setBusy(confirmingStop.id);
    try {
      const result = await api.stopAllianceCampaign(confirmingStop.id);
      toast.success(result.message);
      setConfirmingStop(null);
      setSelected(null);
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || 'Failed to stop campaign');
    } finally {
      setBusy(null);
    }
  };

  const openDeleteCampaign = (campaign) => {
    if (['scheduled', 'running', 'paused'].includes(campaign.status)) {
      toast.error('Stop this campaign before deleting it permanently.');
      return;
    }
    setDeleteConfirmation('');
    setDeletingCampaign(campaign);
  };

  const deleteCampaign = async () => {
    if (!deletingCampaign || deleteConfirmation !== 'DELETE') return;
    setBusy(`delete-${deletingCampaign.id}`);
    try {
      const result = await api.deleteAllianceCampaign(deletingCampaign.id);
      toast.success(result.message);
      if (selected?.campaign?.id === deletingCampaign.id) setSelected(null);
      setDeletingCampaign(null);
      setDeleteConfirmation('');
      await loadCampaigns();
    } catch (error) {
      toast.error(error.message || 'Failed to delete campaign');
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    if (!selected?.campaign?.id) return;
    setBusy(`test-${selected.campaign.id}`);
    try {
      const result = await api.sendAllianceCampaignTest(selected.campaign.id, { email: testEmail, touch_no: testTouch });
      toast.success(result.message);
    } catch (error) {
      toast.error(error.message || 'Failed to send test email');
    } finally {
      setBusy(null);
    }
  };

  const retryFailed = async () => {
    if (!selected?.campaign?.id) return;
    setBusy(`retry-${selected.campaign.id}`);
    try {
      const result = await api.retryFailedAllianceCampaignEmails(selected.campaign.id);
      toast.success(result.message);
      await openCampaign(selected.campaign.id);
      await loadCampaigns();
    } catch (error) { toast.error(error.message || 'Failed to retry emails'); }
    finally { setBusy(null); }
  };

  useEffect(() => {
    loadCampaigns();
    const interval = window.setInterval(loadCampaigns, 10000);
    return () => window.clearInterval(interval);
  }, [loadCampaigns]);

  const days = tier ? Math.ceil(Math.max(0, contacts) / tier) : 0;
  const totalPages = Math.max(1, Math.ceil(totalCampaigns / PAGE_SIZE));
  const firstRecord = totalCampaigns ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastRecord = Math.min(page * PAGE_SIZE, totalCampaigns);

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Campaign Control</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div className="al-page-title">Campaigns</div>
        <button className="al-btn" onClick={() => navigate('/alliance/email-campaigns/new')}>+ New email campaign</button>
      </div>
      <p className="al-page-desc">Review campaign readiness, schedule the first touch, and pause outreach safely.</p>

      <div style={{ background: 'var(--al-panel2)', border: '1px solid var(--al-line)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        {loading ? <p style={{ padding: 24, color: 'var(--al-muted)' }}>Loading campaigns…</p> : (
          <table className="al-table">
            <thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Prospects</th><th>Sent</th><th>Replies</th><th>Actions</th></tr></thead>
            <tbody>
              {campaigns.map((campaign) => (
                <tr key={campaign.id}>
                  <td><div className="al-who">{campaign.name}<small>{new Date(campaign.created_at).toLocaleDateString()}</small></div></td>
                  <td><span className={`al-tag ${campaign.audience}`}>{campaign.audience}</span></td>
                  <td><span className={`al-st ${STATUS_CLASS[campaign.status] || 'new'}`}><span className="d" />{campaign.status}</span></td>
                  <td>{campaign.prospects}</td><td>{campaign.sent}</td><td>{campaign.replied}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="al-btn ghost sm" onClick={() => setDetailCampaignId(campaign.id)}>Details</button>
                      <button className="al-btn ghost sm" onClick={() => openCampaign(campaign.id)}>Readiness</button>
                      {campaign.status === 'running' ? (
                        <button className="al-btn ghost sm" disabled={busy === campaign.id} onClick={() => changeStatus(campaign, 'pause')}>Pause</button>
                      ) : ['draft', 'ready', 'paused', 'scheduled'].includes(campaign.status) ? (
                        <button className="al-btn sm" disabled={busy === campaign.id} onClick={() => changeStatus(campaign, 'start')}>{campaign.status === 'paused' ? 'Resume' : campaign.status === 'scheduled' ? 'Start now' : 'Start'}</button>
                      ) : null}
                      {['draft', 'ready', 'scheduled', 'running', 'paused'].includes(campaign.status) && <button className="al-btn ghost sm" disabled={busy === campaign.id} style={{ color: '#ff8f8f' }} onClick={() => setConfirmingStop(campaign)}>Stop</button>}
                      <button className="al-btn ghost sm" disabled={busy === `delete-${campaign.id}`} style={{ color: '#ff6b6b' }} title={['scheduled', 'running', 'paused'].includes(campaign.status) ? 'Stop the campaign before deleting it' : 'Delete campaign permanently'} onClick={() => openDeleteCampaign(campaign)}><Trash2 size={14} /> Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!campaigns.length && <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--al-muted)' }}>No campaigns yet. Upload a prospect list to create one.</td></tr>}
            </tbody>
          </table>
        )}
        {!loading && totalCampaigns > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 16px', borderTop: '1px solid var(--al-line)', color: 'var(--al-muted)', fontSize: 12 }}>
            <span>Showing {firstRecord}–{lastRecord} of {totalCampaigns} campaigns</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <span>Page {page} of {totalPages}</span>
              <button className="al-btn ghost sm" aria-label="Previous page" disabled={page <= 1 || loading} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={16} /></button>
              <button className="al-btn ghost sm" aria-label="Next page" disabled={page >= totalPages || loading} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={16} /></button>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className={`al-note ${selected.ready ? 'success' : ''}`} style={{ marginBottom: 20, alignItems: 'flex-start' }}>
          <span>{selected.ready ? '✓' : '!'}</span>
          <div>
            <b>{selected.campaign?.name}: {selected.ready ? 'Ready to start' : 'Not ready'}</b>
            <div style={{ marginTop: 5 }}>{selected.stats?.eligible || 0} eligible prospects · {selected.stats?.email || 0} email · {selected.stats?.whatsapp || 0} WhatsApp</div>
            {selected.blockers?.map((blocker) => <div key={blocker} style={{ marginTop: 4 }}>• {blocker}</div>)}
            {selected.failures?.map((failure) => <div key={failure.id} style={{ marginTop: 6, color: '#ff9b9b' }}>Email failed for {failure.email}: {failure.error_message}</div>)}
            {selected.failures?.length > 0 && <button className="al-btn sm" style={{ marginTop: 10 }} disabled={busy === `retry-${selected.campaign.id}`} onClick={retryFailed}>{busy === `retry-${selected.campaign.id}` ? 'Retrying...' : `Retry ${selected.failures.length} failed email${selected.failures.length === 1 ? '' : 's'}`}</button>}
            {selected.deliveries?.map((delivery) => (
              <div key={delivery.id} style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,.12)', fontSize: 12 }}>
                <b>Submitted to Zoho:</b> {delivery.email} · touch {delivery.touch_no}
                <div style={{ opacity: .8, marginTop: 3 }}>SMTP: {delivery.event_payload?.response || 'Accepted'} · ID: {delivery.provider_message_id || 'not returned'}</div>
                <div style={{ opacity: .7, marginTop: 3 }}>This confirms provider acceptance, not inbox delivery.</div>
              </div>
            ))}
            {selected.campaign?.channel === 'email' && (
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.15)' }}>
                <b>Send test email</b>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
                  <input type="email" value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="Your test email address" style={{ minWidth: 270, flex: 1, background: '#101c31', border: '1px solid #29405f', borderRadius: 7, color: '#fff', padding: '9px 11px' }} />
                  <select value={testTouch} onChange={(event) => setTestTouch(Number(event.target.value))} style={{ background: '#101c31', border: '1px solid #29405f', borderRadius: 7, color: '#fff', padding: '9px 11px' }}>{[1, 2, 3, 4].map((touch) => <option key={touch} value={touch}>Touch {touch}</option>)}</select>
                  <button className="al-btn sm" disabled={!testEmail || busy === `test-${selected.campaign.id}`} onClick={sendTest}>{busy === `test-${selected.campaign.id}` ? 'Sending…' : 'Send test'}</button>
                </div>
                <div style={{ marginTop: 6, opacity: .75, fontSize: 11 }}>Test emails do not change campaign totals, status, or follow-up schedules.</div>
              </div>
            )}
          </div>
        </div>
      )}

      {detailCampaignId && <EmailCampaignDetail campaignId={detailCampaignId} onClose={() => setDetailCampaignId(null)} />}

      {confirmingStop && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,8,18,.78)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ width: 'min(470px,100%)', background: '#13213a', border: '1px solid #334968', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>Stop campaign permanently?</div>
            <p style={{ color: '#a9b8d1', lineHeight: 1.6, margin: '10px 0 18px' }}>All unsent emails in <b style={{ color: '#fff' }}>{confirmingStop.name}</b> will be cancelled. Already-sent emails cannot be recalled.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}><button className="al-btn ghost" onClick={() => setConfirmingStop(null)}>Keep campaign</button><button className="al-btn" disabled={busy === confirmingStop.id} style={{ background: '#d84c4c', color: '#fff' }} onClick={stopCampaign}>{busy === confirmingStop.id ? 'Stopping…' : 'Stop permanently'}</button></div>
          </div>
        </div>
      )}

      {deletingCampaign && (
        <div role="dialog" aria-modal="true" aria-labelledby="delete-campaign-title" style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(2,8,18,.82)', display: 'grid', placeItems: 'center', padding: 20 }}>
          <div style={{ width: 'min(500px,100%)', background: '#13213a', border: '1px solid #63394a', borderRadius: 14, padding: 22, boxShadow: '0 20px 60px rgba(0,0,0,.5)' }}>
            <div id="delete-campaign-title" style={{ fontSize: 19, fontWeight: 700, color: '#fff' }}>Delete campaign permanently?</div>
            <p style={{ color: '#a9b8d1', lineHeight: 1.6, margin: '10px 0' }}>This permanently deletes <b style={{ color: '#fff' }}>{deletingCampaign.name}</b> and all of its enrollment, touch, delivery, and campaign-template records. Imported prospects remain available for other campaigns.</p>
            <label style={{ display: 'block', color: '#a9b8d1', fontSize: 12, marginBottom: 6 }}>Type <b style={{ color: '#fff' }}>DELETE</b> to confirm</label>
            <input autoFocus value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setDeletingCampaign(null); }} placeholder="DELETE" style={{ width: '100%', boxSizing: 'border-box', background: '#101c31', border: '1px solid #63394a', borderRadius: 7, color: '#fff', padding: '10px 11px', marginBottom: 18 }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 9 }}>
              <button className="al-btn ghost" onClick={() => setDeletingCampaign(null)}>Cancel</button>
              <button className="al-btn" disabled={deleteConfirmation !== 'DELETE' || busy === `delete-${deletingCampaign.id}`} style={{ background: '#d84c4c', color: '#fff' }} onClick={deleteCampaign}>{busy === `delete-${deletingCampaign.id}` ? 'Deleting…' : 'Delete permanently'}</button>
            </div>
          </div>
        </div>
      )}

      <div className="al-page-title" style={{ fontSize: 20 }}>WhatsApp capacity calculator</div>
      <div className="al-fields" style={{ marginTop: 14 }}>
        <div className="al-field"><label>Opted-in contacts</label><input type="number" min="0" value={contacts} onChange={(event) => setContacts(Number(event.target.value) || 0)} /></div>
        <div className="al-field"><label>Portfolio tier per 24 hours</label><select value={tier} onChange={(event) => setTier(Number(event.target.value))}>{TIERS.map((value) => <option key={value} value={value}>{value.toLocaleString('en-IN')}</option>)}</select></div>
        <div className="al-field"><label>Estimated duration</label><input value={`${days} ${days === 1 ? 'day' : 'days'}`} readOnly /></div>
      </div>
      <div className="al-note"><span>!</span><div><b>WhatsApp requires recorded opt-in.</b> This calculator does not make an uploaded phone list compliant.</div></div>
    </div>
  );
};
