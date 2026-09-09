import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Calendar, ChevronLeft, ChevronRight, Download, Filter, Mail, MailCheck, Paperclip, RefreshCw, Search, Send, Sparkles, UserRound } from 'lucide-react';
import { api } from '../../services/api.js';
import { DatePicker } from './DatePicker.jsx';
import './alliance.css';

const EMPTY_FILTERS = { search: '', campaign: '', audience: '', reply_status: '', date_from: '', date_to: '' };
const formatDate = (value) => value ? new Date(value).toLocaleString() : '—';
const formatShort = (value) => value ? new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const LeadProfile = () => {
  const navigate = useNavigate();
  const { prospectId } = useParams();
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [options, setOptions] = useState({ campaigns: [], audiences: [], statuses: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [sync, setSync] = useState(null);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState({});
  const [busy, setBusy] = useState('');
  const limit = 10;

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAllianceEmailReplies({ ...filters, page, limit });
      setConversations(data.conversations || []); setTotal(data.total || 0); setSync(data.sync || null); setOptions(data.filters || {});
    } catch (error) { toast.error(error.message || 'Failed to load conversations'); }
    finally { setLoading(false); }
  }, [filters, page]);

  const loadConversation = useCallback(async () => {
    if (!prospectId) return;
    setLoading(true);
    try {
      const data = await api.getAllianceEmailConversation(prospectId);
      setConversation(data);
      setDrafts(Object.fromEntries((data.messages || []).filter((item) => item.reply_id).map((item) => [item.reply_id, item.ai_draft || ''])));
    } catch (error) { toast.error(error.message || 'Failed to load conversation'); }
    finally { setLoading(false); }
  }, [prospectId]);

  useEffect(() => {
    if (prospectId) loadConversation();
    else { const timer = window.setTimeout(loadList, 250); return () => window.clearTimeout(timer); }
  }, [prospectId, loadConversation, loadList]);

  const updateFilter = (key, value) => { setFilters((current) => ({ ...current, [key]: value })); setPage(1); };
  const pages = Math.max(1, Math.ceil(total / limit));
  const hasFilters = Object.values(filters).some(Boolean);

  const suggest = async (message) => {
    setBusy(`suggest-${message.reply_id}`);
    try {
      const result = await api.suggestAllianceEmailReply(message.reply_id);
      setDrafts((current) => ({ ...current, [message.reply_id]: result.suggestion.ai_draft || '' }));
      toast.success('AI suggestion generated'); await loadConversation();
    } catch (error) { toast.error(error.message || 'AI suggestion failed'); }
    finally { setBusy(''); }
  };
  const sendReply = async (message) => {
    const body = String(drafts[message.reply_id] || '').trim();
    if (!body) return toast.error('Review or enter a reply before sending');
    setBusy(`send-${message.reply_id}`);
    try { const result = await api.sendAllianceEmailReply(message.reply_id, body); toast.success(result.message); await loadConversation(); }
    catch (error) { toast.error(error.message || 'Failed to send reply'); }
    finally { setBusy(''); }
  };
  const downloadAttachment = async (attachment) => {
    try {
      const response = await fetch(`${api.baseUrl}/api/alliance/reply-attachments/${attachment.id}`, { headers: { Authorization: `Bearer ${localStorage.getItem('leados_token') || ''}` } });
      if (!response.ok) throw new Error('Attachment download failed');
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href = url; link.download = attachment.filename; link.click(); URL.revokeObjectURL(url);
    } catch (error) { toast.error(error.message); }
  };

  if (prospectId) return <ConversationDetail data={conversation} loading={loading} drafts={drafts} setDrafts={setDrafts} busy={busy} onBack={() => navigate('/alliance/replies')} onRefresh={loadConversation} onSuggest={suggest} onSend={sendReply} onDownload={downloadAttachment} />;

  return (
    <div className="al-wrap al-replies-page">
      <div className="al-replies-header"><div><div className="al-eyebrow">AllianceOS · Email conversations</div><div className="al-page-title">Replies</div><p className="al-page-desc">Review lead conversations, manage AI-assisted replies, and monitor follow-up status.</p></div><button className="al-btn ghost" onClick={loadList}><RefreshCw size={15} /> Refresh</button></div>
      <div className={`al-note ${sync?.last_error ? '' : 'success'} al-sync-note`}><MailCheck size={18} /><div><b>Zoho Inbox:</b> {sync?.last_error || (sync?.last_success_at ? `Last checked ${formatDate(sync.last_success_at)}` : 'Waiting for mailbox sync')}</div></div>

      <section className="al-conv-filters">
        <div className="al-search-wide"><Search size={17} /><input value={filters.search} onChange={(e) => updateFilter('search', e.target.value)} placeholder="Search lead name, phone number, or email address…" /></div>
        <div className="al-conv-filter-grid"><label><span>Campaign</span><select value={filters.campaign} onChange={(e) => updateFilter('campaign', e.target.value)}><option value="">All campaigns</option>{options.campaigns?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>Audience</span><select value={filters.audience} onChange={(e) => updateFilter('audience', e.target.value)}><option value="">All audiences</option>{options.audiences?.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label><label><span>Reply status</span><select value={filters.reply_status} onChange={(e) => updateFilter('reply_status', e.target.value)}><option value="">All statuses</option>{options.statuses?.map((item) => <option key={item} value={item}>{item.replaceAll('_', ' ')}</option>)}</select></label><label><span>From</span><DatePicker value={filters.date_from} max={filters.date_to} onChange={(value) => updateFilter('date_from', value)} /></label><label><span>To</span><DatePicker value={filters.date_to} min={filters.date_from} onChange={(value) => updateFilter('date_to', value)} /></label>{hasFilters && <button className="al-clear-filter" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>Clear filters</button>}</div>
      </section>

      <section className="al-conv-list">
        <div className="al-conv-list-head"><div><b>Lead conversations</b><span>{total} lead{total === 1 ? '' : 's'}</span></div><span><Filter size={14} /> One row per lead</span></div>
        <div className="al-conv-table-wrap"><table className="al-conv-table"><thead><tr><th>Lead</th><th>Contact</th><th>Last email sent</th><th>Last reply received</th><th>Status</th><th>Last activity</th><th /></tr></thead><tbody>{loading ? <tr><td colSpan="7" className="al-empty">Loading conversations…</td></tr> : conversations.map((item) => <tr key={item.prospect_id} onClick={() => navigate(`/alliance/replies/${item.prospect_id}`)}><td><div className="al-conv-person"><span>{(item.name || item.business_name || '?')[0].toUpperCase()}</span><div><b>{item.name || 'Unnamed contact'}</b><small>{item.business_name}</small></div></div></td><td><b>{item.email || '—'}</b><small>{item.phone || 'No phone number'}</small></td><td>{formatDate(item.last_email_sent)}</td><td>{formatDate(item.last_reply_received)}</td><td><span className={`al-conv-pill ${item.ai_intent === 'interested' ? 'green' : ''}`}>{item.ai_intent || item.reply_status || item.lead_status}</span></td><td>{formatDate(item.last_activity)}</td><td><ChevronRight size={17} /></td></tr>)}{!loading && !conversations.length && <tr><td colSpan="7" className="al-empty">No lead conversations match these filters.</td></tr>}</tbody></table></div>
        <div className="al-conv-pagination"><span>Showing {total ? (page - 1) * limit + 1 : 0}–{Math.min(page * limit, total)} of {total}</span><div><button disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={16} /> Previous</button><span>Page {page} of {pages}</span><button disabled={page >= pages} onClick={() => setPage(page + 1)}>Next <ChevronRight size={16} /></button></div></div>
      </section>
    </div>
  );
};

const ConversationDetail = ({ data, loading, drafts, setDrafts, busy, onBack, onRefresh, onSuggest, onSend, onDownload }) => {
  const messages = useMemo(() => data?.messages || [], [data]);
  if (loading && !data) return <div className="al-wrap"><div className="al-empty">Loading conversation…</div></div>;
  const lead = data?.prospect || {};
  return <div className="al-wrap al-thread-page"><div className="al-thread-top"><button className="al-thread-back" onClick={onBack}><ArrowLeft size={17} /> All conversations</button><button className="al-btn ghost sm" onClick={onRefresh}><RefreshCw size={14} /> Refresh</button></div><header className="al-thread-lead"><div className="al-thread-avatar">{(lead.name || lead.business_name || '?')[0]?.toUpperCase()}</div><div><h1>{lead.name || 'Unnamed contact'}</h1><p>{lead.business_name} · {lead.audience_label || lead.audience}</p><div><span><Mail size={13} /> {lead.email || '—'}</span><span><UserRound size={13} /> {lead.phone || 'No phone'}</span></div></div><span className="al-conv-pill green">{lead.status}</span></header><div className="al-thread-summary"><span><b>{messages.filter((m) => m.direction === 'outbound').length}</b> sent</span><span><b>{messages.filter((m) => m.direction === 'inbound').length}</b> received</span><span><b>{messages.at(-1) ? formatDate(messages.at(-1).occurred_at) : '—'}</b> last activity</span></div><main className="al-thread"><div className="al-thread-line" />{messages.map((message, index) => <article key={`${message.message_type}-${message.id}-${index}`} className={`al-thread-message ${message.direction}`}><div className="al-thread-dot">{message.direction === 'inbound' ? <UserRound size={14} /> : <Send size={13} />}</div><div className="al-thread-bubble"><div className="al-thread-meta"><div><b>{message.direction === 'inbound' ? lead.name || lead.email : message.message_type === 'approved_reply' ? 'Human-approved reply' : 'Alliance campaign'}</b><span>{message.direction === 'inbound' ? 'Recipient' : message.campaign_name || 'ABM Groups'}</span></div><time><Calendar size={12} /> {formatDate(message.occurred_at)}</time></div><h3>{message.subject || '(No subject)'}</h3><div className="al-thread-body">{message.body || 'No readable message body.'}</div>{message.attachments?.length > 0 && <div className="al-thread-attachments"><b><Paperclip size={13} /> Attachments</b>{message.attachments.map((file) => <button key={file.id} onClick={() => onDownload(file)}><Paperclip size={14} /><span>{file.filename}<small>{Math.ceil(Number(file.size_bytes || 0) / 1024)} KB</small></span><Download size={14} /></button>)}</div>}<div className="al-thread-events"><span className="active">{message.direction === 'inbound' ? 'Received' : 'Sent'}</span>{['delivered','opened','clicked'].map((event) => <span key={event} className={message.events?.includes(event) ? 'active' : ''}>{event}</span>)}</div>{message.direction === 'inbound' && message.reply_id && message.status !== 'sent' && <div className="al-thread-ai"><div><Sparkles size={15} /><b>AI suggested response</b><span>{message.ai_intent || 'analysing'}</span></div><textarea value={drafts[message.reply_id] || ''} onChange={(e) => setDrafts((current) => ({ ...current, [message.reply_id]: e.target.value }))} placeholder="Generate or write a response for review…" /><footer><button className="al-btn ghost sm" disabled={busy === `suggest-${message.reply_id}`} onClick={() => onSuggest(message)}><Sparkles size={14} /> {busy === `suggest-${message.reply_id}` ? 'Generating…' : drafts[message.reply_id] ? 'Regenerate' : 'Generate suggestion'}</button><button className="al-btn sm" disabled={busy === `send-${message.reply_id}` || !String(drafts[message.reply_id] || '').trim()} onClick={() => onSend(message)}><Send size={14} /> {busy === `send-${message.reply_id}` ? 'Sending…' : 'Approve & send'}</button></footer></div>}</div></article>)}{!messages.length && <div className="al-empty">No email history is available for this lead.</div>}</main></div>;
};
