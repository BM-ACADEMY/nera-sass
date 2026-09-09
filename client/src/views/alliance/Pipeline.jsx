import React, { useEffect, useState } from 'react';
import { RefreshCw, AlertTriangle, ShieldCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/api.js';
import './alliance.css';

const maskPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return 'Phone number unavailable';
  return `${digits.slice(0, 2)} ${digits.slice(2, 4)}${'x'.repeat(Math.max(digits.length - 6, 3))}${digits.slice(-2)}`;
};
const statusForNumber = (item) => {
  if (!item.quality_monitored || !item.quality_rating) return { key:'unknown', label:'Not monitored' };
  if (item.quality_rating === 'red') return { key:'r', label:'Red' };
  if (item.quality_rating === 'yellow') return { key:'y', label:'Yellow' };
  if (item.status !== 'active') return { key:'y', label:item.status };
  return { key:'g', label:'Green' };
};
const statusForDomain = (item) => {
  const reputation = String(item.reputation || 'unknown').toLowerCase();
  if (item.status === 'paused' || ['bad','poor'].includes(reputation)) return { key:'r', label:item.status === 'paused' ? 'Paused' : item.reputation };
  if (item.status !== 'active') return { key:'unknown', label:item.status };
  if (['good','high','healthy'].includes(reputation)) return { key:'g', label:item.reputation };
  if (item.imap_last_success_at) return { key:'partial', label:'Partially monitored' };
  return { key:'unknown', label:'Monitoring unavailable' };
};

const HealthCard = ({ title, subtitle, status, sent, cap, footerLabel, footerValue, metrics }) => {
  const percent = cap > 0 ? Math.min(Math.round((sent / cap) * 100), 100) : 0;
  return <div className="al-ncard"><div className="al-ncard-top"><div className="al-ncard-name">{title}<span>{subtitle}</span></div><span className={`al-lamp ${status.key}`}><span className="d" />{status.label}</span></div><div className="al-meter"><div className="al-meter-lab">Today's sends <b>{sent} / {cap > 0 ? cap : 'Not set'}</b></div><div className="al-bar"><i className={status.key === 'r' ? 'r' : status.key === 'y' ? 'y' : 'g'} style={{width:`${percent}%`}} /></div></div>{metrics?.length > 0 && <div className="al-health-card-metrics">{metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b className={metric.tone || ''}>{metric.value}</b></div>)}</div>}<div className="al-warm"><span>{footerLabel}</span><b>{footerValue}</b></div></div>;
};

export const Pipeline = () => {
  const [data, setData] = useState({ numbers:[], domains:[], issues:[] });
  const [loading, setLoading] = useState(true);
  const load = async () => { setLoading(true); try { setData(await api.getAllianceNumberHealth()); } catch(error) { toast.error(error.message || 'Failed to load sender health'); } finally { setLoading(false); } };
  useEffect(() => { load(); const interval=setInterval(load,60000); return () => clearInterval(interval); }, []);
  const senders = [
    ...data.numbers.map((item) => ({ id:`wa-${item.id}`, title:item.label, subtitle:`${maskPhone(item.phone_number)} · WhatsApp`, status:statusForNumber(item), sent:Number(item.sent_today)||0, cap:Number(item.daily_cap)||0, footerLabel:item.paused_until ? 'Paused until' : item.cap_configured ? 'Warm-up' : 'Safety configuration', footerValue:item.paused_until ? new Date(item.paused_until).toLocaleString() : item.cap_configured ? `Week ${item.warmup_stage}` : 'Daily cap not set' })),
    ...data.domains.map((item) => ({ id:`email-${item.id}`, title:item.inbox_email, subtitle:`Email · ${item.provider || 'Provider not set'}`, status:statusForDomain(item), sent:Number(item.sent_today)||0, cap:Number(item.daily_cap)||0, metrics:[{label:'SMTP failures',value:Number(item.failed_today)||0,tone:Number(item.failed_today)>0?'bad':''},{label:'Replies',value:Number(item.replies_today)||0},{label:'Bounce notices',value:Number(item.bounce_notices_today)||0,tone:Number(item.bounce_notices_today)>0?'bad':''},{label:'IMAP sync',value:item.imap_last_success_at?new Date(item.imap_last_success_at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}):'Never',tone:item.imap_last_error?'bad':''}], footerLabel:item.imap_last_error?'IMAP error':'Mailbox monitoring', footerValue:item.imap_last_error || (item.imap_last_success_at ? `Last checked ${new Date(item.imap_last_success_at).toLocaleString()}` : 'No successful IMAP sync yet') })),
  ];
  return <div className="al-wrap"><div className="al-eyebrow">AllianceOS · Screen 3 · Safety Panel</div><div className="al-health-title"><div><div className="al-page-title">Number &amp; domain health</div><p className="al-page-desc">Live sending usage and configured safety state for AllianceOS WhatsApp numbers and email inboxes.</p></div><button className="al-btn ghost sm" onClick={load} disabled={loading}><RefreshCw size={15} className={loading ? 'al-spin' : ''} /> Refresh</button></div>
    {loading && !senders.length ? <div className="al-brain-empty">Loading sender health...</div> : !senders.length ? <div className="al-brain-empty">No WhatsApp numbers or email senders are configured.</div> : <div className="al-pool">{senders.map((item) => <HealthCard key={item.id} {...item} />)}</div>}
    <div className={`al-health-summary ${data.issues.length ? 'warning' : 'success'}`}>{data.issues.length ? <AlertTriangle size={19} /> : <ShieldCheck size={19} />}<div><b>{data.issues.length ? `${data.issues.length} sender issue${data.issues.length === 1 ? '' : 's'} need attention` : 'No configured sender issues detected'}</b>{data.issues.length ? data.issues.map((issue,index) => <span key={index}>{issue.message}</span>) : <span>Usage is within configured limits. Provider quality is shown only when monitoring data is available.</span>}</div></div>
    <div className="al-health-rules"><h2>Safety rules</h2>{['LeadOS inbound numbers must never be used for cold outreach.','WhatsApp campaigns require recorded consent and Meta-approved templates.','Cold email must use a separate authenticated sending domain.','Daily caps are enforced by campaign workers.','Sending stops for replies, suppression, unsubscribe, and terminal lead statuses.','Unknown provider health is not treated as healthy; configure monitoring before scaling volume.'].map((rule,index) => <div key={rule}><span>{String(index+1).padStart(2,'0')}</span>{rule}</div>)}</div>
  </div>;
};
