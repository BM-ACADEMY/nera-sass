import React, { useCallback, useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';

const PAGE_SIZE = 25;
const STATUS_CLASS = { pending: 'new', in_process: 'seq', interested: 'int', scheduled: 'seq', processing: 'seq', paused: 'rep', sent: 'int', failed: 'rep', cancelled: 'rep', stopped: 'rep', completed: 'int', in_sequence: 'seq' };
const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-IN') : '—';

export const EmailCampaignDetail = ({ campaignId, onClose }) => {
  const [campaign, setCampaign] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [touchStats, setTouchStats] = useState([]);
  const [recipients, setRecipients] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300); return () => clearTimeout(timer); }, [search]);
  useEffect(() => { setPage(1); }, [status, debouncedSearch]);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAllianceEmailCampaignDetail(campaignId, { status, search: debouncedSearch, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
      setCampaign(data.campaign); setTemplates(data.templates || []); setTouchStats(data.touch_stats || []);
      setRecipients(data.recipients || []); setTotal(data.total || 0);
    } catch (error) { toast.error(error.message || 'Failed to load email campaign detail'); }
    finally { setLoading(false); }
  }, [campaignId, status, debouncedSearch, page]);
  useEffect(() => {
    load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => { const close = (event) => { if (event.key === 'Escape') onClose(); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [onClose]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <div className="al-wa-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <div className="al-wa-detail" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><b>{campaign?.name || 'Email campaign'}</b><small>{campaign?.audience_label || campaign?.audience} · {campaign?.sender_email || 'No sender'} · Created {formatDateTime(campaign?.created_at)}</small><small>{campaign?.scheduled_at ? `Scheduled ${formatDateTime(campaign.scheduled_at)}` : `Status: ${campaign?.status || '—'}`}</small></div><button type="button" className="al-wa-detail-close" onClick={onClose} aria-label="Close campaign detail"><X size={18} /></button></header>
      {campaign && <div className="al-wa-detail-stats"><div><b>{campaign.prospects}</b><span>Recipients</span></div><div><b>{campaign.sent}</b><span>Sent emails</span></div><div><b>{campaign.replied}</b><span>Replied leads</span></div><div><b>{campaign.processing || 0}</b><span>Processing</span></div><div><b>{campaign.failed}</b><span>Failed</span></div><div><b>{campaign.cancelled || 0}</b><span>Cancelled</span></div><div><b>{templates.length}</b><span>Touches</span></div></div>}
      {!!touchStats.length && <div className="al-wa-detail-note">{touchStats.map((item) => `Touch ${item.touch_no}: ${item.sent} sent · ${item.pending} pending · ${item.processing} processing · ${item.failed} failed · ${item.cancelled} cancelled`).join('   |   ')}</div>}
      {campaign?.latest_touch_error && <div className="al-wa-detail-note">Latest email issue: {campaign.latest_touch_error}</div>}
      <div className="al-wa-detail-filters"><div className="al-input-icon"><Search size={15}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, business, or email" /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{['pending','in_process','interested','converted','closed','not_interested','unsubscribed','completed'].map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select><span>{total} lead{total === 1 ? '' : 's'}</span></div>
      <div className="al-wa-detail-table-wrap"><table className="al-table"><thead><tr><th>Lead</th><th>Email</th><th>Status</th><th>Progress</th><th>Sent</th><th>Replies</th><th>Next touch</th><th>Error</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={8} className="al-empty">Loading recipients…</td></tr> : recipients.map((recipient) => <tr key={recipient.id}><td><b>{recipient.name || recipient.business_name}</b><small>{recipient.business_name}</small></td><td>{recipient.email || '—'}</td><td><span className={`al-st ${STATUS_CLASS[recipient.delivery_status] || 'new'}`}><span className="d" />{recipient.delivery_status}</span></td><td>Touch {recipient.current_touch || 0} / {templates.length}</td><td>{recipient.sent_count || 0}<small>{formatDateTime(recipient.last_sent_at)}</small></td><td>{recipient.reply_count || 0}</td><td>{formatDateTime(recipient.next_touch_at)}</td><td>{recipient.error_message || '—'}</td></tr>)}
        {!loading && !recipients.length && <tr><td colSpan={8} className="al-empty">No leads match this filter.</td></tr>}
      </tbody></table></div>
      <footer className="al-wa-detail-pagination"><span>Page {page} of {pages}</span><div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Previous</button><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>Next</button></div></footer>
    </div>
  </div>;
};
