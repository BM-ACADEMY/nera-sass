import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Search } from 'lucide-react';
import { api } from '../../services/api.js';
import { C } from '../../constants/theme.js';
import toast from 'react-hot-toast';

export const GSC_SECTIONS = ['overview', 'performance', 'inspection', 'indexing', 'sitemaps', 'experience', 'links', 'insights', 'security', 'settings'];

const SECTION_SOPS = {
  overview: { what: 'A single health summary for the selected website.', use: 'Use it for the daily check before opening detailed reports.', does: 'Summarises search clicks, indexing access, site experience and current SEO opportunities.', steps: ['Confirm the selected website.', 'Click Sync performance.', 'Review warnings and recommendations.', 'Open the affected report for investigation.'] },
  performance: { what: 'Google organic-search traffic and ranking analytics.', use: 'Use it to understand how people find the website and where traffic can improve.', does: 'Shows clicks, impressions, CTR, position, queries, pages, countries, devices and search appearance.', steps: ['Choose property, search type and date range.', 'Apply device, country or regex filters if needed.', 'Compare the trend with the previous period.', 'Export rows or send valuable keywords to tracking.'] },
  inspection: { what: 'Google index status for individual website URLs.', use: 'Use it when a page is missing, outdated or ranking incorrectly.', does: 'Reports coverage, last crawl, robots/noindex state, canonicals, sitemap sources, referring URLs and enhancement verdicts.', steps: ['Enter a complete URL belonging to the selected property.', 'Click Inspect and review the verdict.', 'Correct robots, noindex, canonical or fetch problems.', 'Use the batch queue for up to 20 known URLs and retain results in history.'] },
  indexing: { what: 'A working inventory of URLs known through submitted sitemaps.', use: 'Use it to find pages that should be checked for indexing problems.', does: 'Downloads safe same-property sitemap URLs and prepares them for batch URL Inspection.', steps: ['Select or enter a sitemap.', 'Click Discover URLs.', 'Review the discovered inventory.', 'Send the first 20 URLs to the inspection queue and group results by coverage reason.'] },
  sitemaps: { what: 'Management for sitemaps submitted to Google Search Console.', use: 'Use it whenever pages are added, removed or sitemap errors appear.', does: 'Lists sitemap status, errors, warnings and submitted/indexed totals; authorised users can submit or remove sitemaps.', steps: ['Confirm the property.', 'Review errors and warnings.', 'Submit the HTTPS sitemap URL when required.', 'Remove only obsolete or incorrect submissions.'] },
  experience: { what: 'Mobile, desktop and technical page-experience diagnostics.', use: 'Use it to improve speed, usability and technical trust signals.', does: 'Runs PageSpeed/Lighthouse checks for LCP, CLS and INP where available, plus HTTPS, certificate, redirects, canonical and robots checks.', steps: ['Run the mobile and desktop audit.', 'Prioritise failing Core Web Vitals.', 'Check HTTPS, redirect and canonical consistency.', 'Retest after website changes.'] },
  links: { what: 'External link intelligence from the configured SEO data provider.', use: 'Use it to monitor authority, referring websites and suspicious or lost backlinks.', does: 'Scans backlink totals, referring domains and available source-link details. This is not Google’s private Links report.', steps: ['Click Scan backlinks.', 'Review referring domains and source pages.', 'Investigate irrelevant or suspicious links.', 'Compare later scans for gained or lost links.'] },
  insights: { what: 'Actionable opportunities derived from GSC performance data.', use: 'Use it to decide which SEO work should be handled first.', does: 'Identifies page-two rankings, high-impression/low-CTR queries and visible pages receiving no clicks.', steps: ['Sync fresh Performance data.', 'Start with high-impression opportunities.', 'Improve titles/content for low CTR.', 'Track selected keywords and review results next period.'] },
  security: { what: 'Access point for Google-only security and policy reports.', use: 'Use it when traffic disappears, warnings appear or the website may be compromised.', does: 'Links to authoritative Manual Actions, Security Issues and Removals reports because Google does not expose them through the API.', steps: ['Open each official report using the connected Google account.', 'Record any detected issue.', 'Fix affected pages or security problems.', 'Submit the appropriate review inside Search Console.'] },
  settings: { what: 'Google connection and Search Console property access.', use: 'Use it to confirm which account is connected and which properties it can read or manage.', does: 'Shows the connected email when authorised, lists property permission levels and provides reconnection.', steps: ['Confirm the connected email.', 'Refresh available properties.', 'Verify the required property and permission level.', 'Reconnect when changing accounts or expanding OAuth permissions.'] }
};

export function GscSectionNav({ active, onChange }) {
  return (
    <>
      <style>{`.p-mobile:has(.gsc-section-nav){font-size:13px}.p-mobile:has(.gsc-section-nav) h1{font-size:30px!important;line-height:1.1}.p-mobile:has(.gsc-section-nav) h2{font-size:18px!important}.p-mobile:has(.gsc-section-nav) p,.p-mobile:has(.gsc-section-nav) li{font-size:12px}.p-mobile:has(.gsc-section-nav) button,.p-mobile:has(.gsc-section-nav) input,.p-mobile:has(.gsc-section-nav) select{font-size:12px!important}`}</style>
      <div className="gsc-section-nav" style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}>
        {GSC_SECTIONS.map(section => (
          <button key={section} onClick={() => onChange(section)} style={{ border: `1px solid ${active === section ? '#3b82f6' : C.border}`, background: active === section ? 'rgba(59,130,246,.18)' : C.surface, color: active === section ? '#93c5fd' : C.muted, padding: '7px 10px', borderRadius: 7, textTransform: 'capitalize', cursor: 'pointer', fontWeight: 600, fontSize: 12 }}>
            {section === 'overview' ? 'SEO Coach' : section === 'performance' ? 'Advanced Performance' : section === 'inspection' ? 'URL Inspection' : section}
          </button>
        ))}
      </div>
      <SectionSop section={active} />
    </>
  );
}

const Card = ({ title, children }) => <section style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 18 }}><h3 style={{ margin: '0 0 13px', color: '#fff', fontSize: 15 }}>{title}</h3>{children}</section>;
const Notice = ({ children }) => <div style={{ padding: 14, borderRadius: 8, border: '1px solid rgba(245,158,11,.3)', background: 'rgba(245,158,11,.08)', color: '#fbbf24', lineHeight: 1.55 }}><AlertCircle size={16} style={{ verticalAlign: 'middle', marginRight: 8 }} />{children}</div>;
const Field = props => <input {...props} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, border: `1px solid ${C.border}`, color: '#fff', borderRadius: 8, padding: '11px 13px', ...(props.style || {}) }} />;
const Button = ({ children, ...props }) => <button {...props} style={{ background: '#2563eb', color: '#fff', border: 0, borderRadius: 7, padding: '9px 13px', fontWeight: 700, fontSize: 12, cursor: 'pointer', ...(props.style || {}) }}>{children}</button>;

function SectionSop({ section }) {
  const [open, setOpen] = useState(true);
  const sop = SECTION_SOPS[section];
  if (!sop) return null;
  return <div style={{ background: 'rgba(59,130,246,.06)', border: '1px solid rgba(59,130,246,.22)', borderRadius: 10, marginBottom: 16, overflow: 'hidden' }}>
    <button onClick={() => setOpen(value => !value)} style={{ width: '100%', padding: '11px 14px', border: 0, background: 'transparent', color: '#93c5fd', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>Page SOP — {section === 'inspection' ? 'URL Inspection' : section.charAt(0).toUpperCase() + section.slice(1)} <span style={{ float: 'right' }}>{open ? '−' : '+'}</span></button>
    {open && <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12, fontSize: 12, lineHeight: 1.5 }}>
      <div><b style={{ color: '#fff' }}>What is this page?</b><div style={{ color: C.muted, marginTop: 4 }}>{sop.what}</div></div>
      <div><b style={{ color: '#fff' }}>Why do we use it?</b><div style={{ color: C.muted, marginTop: 4 }}>{sop.use}</div></div>
      <div><b style={{ color: '#fff' }}>What does it do?</b><div style={{ color: C.muted, marginTop: 4 }}>{sop.does}</div></div>
      <div><b style={{ color: '#fff' }}>Team procedure</b><ol style={{ color: C.muted, margin: '4px 0 0', paddingLeft: 18 }}>{sop.steps.map(step => <li key={step}>{step}</li>)}</ol></div>
    </div>}
  </div>;
}

function BacklinkResults({ data }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  useEffect(() => { setPage(1); }, [data]);
  if (!data) return null;
  const rows = data.links || [];
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const visibleRows = rows.slice(start, start + pageSize);
  return <div style={{ marginTop: 18 }}>
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 14 }}>
      <div><b style={{ color: '#fff', fontSize: 22 }}>{data.metrics?.totalBacklinks || 0}</b><div style={{ color: C.muted, fontSize: 11 }}>Backlinks</div></div>
      <div><b style={{ color: '#fff', fontSize: 22 }}>{data.metrics?.referringDomains || 0}</b><div style={{ color: C.muted, fontSize: 11 }}>Referring domains</div></div>
      <div><b style={{ color: '#fff', fontSize: 22 }}>{data.metrics?.domainAuthority ?? 'N/A'}</b><div style={{ color: C.muted, fontSize: 11 }}>Authority</div></div>
      <div><b style={{ color: '#fff', fontSize: 14 }}>{data.metrics?.provider || 'Unknown'}</b><div style={{ color: C.muted, fontSize: 11 }}>Data provider</div></div>
    </div>
    {rows.length === 0 ? <p style={{ color: C.muted }}>The provider returned summary metrics but no individual backlink rows.</p> : <div style={{ overflowX: 'auto', border: `1px solid ${C.border}`, borderRadius: 8 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1050 }}>
        <thead><tr style={{ background: C.bg, color: C.muted, textAlign: 'left' }}><th style={{ padding: 10 }}>Source page</th><th style={{ padding: 10 }}>Target</th><th style={{ padding: 10 }}>Anchor</th><th style={{ padding: 10 }}>Type</th><th style={{ padding: 10 }}>DR / UR</th><th style={{ padding: 10 }}>Status</th><th style={{ padding: 10 }}>First seen</th></tr></thead>
        <tbody>{visibleRows.map((link, index) => <tr key={link.id || start + index} style={{ borderTop: `1px solid ${C.border}` }}>
          <td style={{ padding: 10, maxWidth: 280 }}><a href={link.sourceUrl} target="_blank" rel="noreferrer" style={{ color: '#60a5fa', overflowWrap: 'anywhere' }}>{link.sourceTitle || link.sourceDomain || link.sourceUrl || 'Unknown source'}</a><div style={{ color: C.muted, fontSize: 11, marginTop: 3 }}>{link.sourceDomain || ''}</div></td>
          <td style={{ padding: 10, maxWidth: 220, overflowWrap: 'anywhere', color: C.muted }}>{link.targetUrl || 'Unknown'}</td>
          <td style={{ padding: 10, maxWidth: 210, overflowWrap: 'anywhere' }}>{link.anchorText || 'No anchor text'}</td>
          <td style={{ padding: 10 }}>{link.type || 'Unknown'}</td>
          <td style={{ padding: 10 }}>{link.dr ?? '—'} / {link.ur ?? '—'}</td>
          <td style={{ padding: 10, color: link.status === 'Lost' ? '#f87171' : '#4ade80' }}>{link.status || 'Unknown'}</td>
          <td style={{ padding: 10, color: C.muted }}>{link.firstSeen || 'Unknown'}</td>
        </tr>)}</tbody>
      </table>
      <div style={{ padding: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderTop: `1px solid ${C.border}` }}>
        <span style={{ color: C.muted, fontSize: 11 }}>Showing {rows.length ? start + 1 : 0}–{Math.min(start + pageSize, rows.length)} of {rows.length} returned links</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <select value={pageSize} onChange={event => { setPageSize(+event.target.value); setPage(1); }} style={{ background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px' }}><option value={10}>10 rows</option><option value={25}>25 rows</option><option value={50}>50 rows</option></select>
          <button disabled={safePage === 1} onClick={() => setPage(1)} style={{ background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', opacity: safePage === 1 ? .4 : 1 }}>First</button>
          <button disabled={safePage === 1} onClick={() => setPage(value => Math.max(1, value - 1))} style={{ background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', opacity: safePage === 1 ? .4 : 1 }}>Previous</button>
          <span style={{ color: C.muted, fontSize: 11 }}>Page {safePage} of {totalPages}</span>
          <button disabled={safePage === totalPages} onClick={() => setPage(value => Math.min(totalPages, value + 1))} style={{ background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', opacity: safePage === totalPages ? .4 : 1 }}>Next</button>
          <button disabled={safePage === totalPages} onClick={() => setPage(totalPages)} style={{ background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', opacity: safePage === totalPages ? .4 : 1 }}>Last</button>
        </div>
      </div>
      {rows.length < (data.metrics?.totalBacklinks || 0) && <div style={{ padding: '0 10px 10px', color: '#fbbf24', fontSize: 11 }}>The provider reported {data.metrics.totalBacklinks} total backlinks but returned {rows.length} detailed rows in this scan. Pagination can display only rows supplied by the provider.</div>}
    </div>}
  </div>;
}

function SeoActionCard({ item, task, onCreateTask, onComplete }) {
  const [open, setOpen] = useState(false);
  const colors = { today: '#ef4444', week: '#f59e0b', later: '#3b82f6', monitor: '#64748b' };
  return <div style={{ border: `1px solid ${C.border}`, borderLeft: `4px solid ${colors[item.priority]}`, borderRadius: 9, padding: 15, background: C.surface }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'flex-start' }}>
      <div><div style={{ color: colors[item.priority], fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{item.priorityLabel}</div><h3 style={{ color: '#fff', fontSize: 15, margin: '5px 0' }}>{item.title}</h3><p style={{ color: C.muted, margin: 0 }}>{item.summary}</p></div>
      <div style={{ minWidth: 125, textAlign: 'right', color: C.muted, fontSize: 11 }}>{item.difficulty} · {item.time}</div>
    </div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 10, marginTop: 13 }}>
      <div style={{ background: C.bg, borderRadius: 7, padding: 10 }}><b style={{ color: '#fff', fontSize: 11 }}>What happened?</b><div style={{ color: C.muted, marginTop: 4 }}>{item.happened}</div></div>
      <div style={{ background: C.bg, borderRadius: 7, padding: 10 }}><b style={{ color: '#fff', fontSize: 11 }}>Why it matters</b><div style={{ color: C.muted, marginTop: 4 }}>{item.impact}</div></div>
      <div style={{ background: C.bg, borderRadius: 7, padding: 10 }}><b style={{ color: '#fff', fontSize: 11 }}>Recommended solution</b><div style={{ color: C.muted, marginTop: 4 }}>{item.solution}</div></div>
    </div>
    {open && <div style={{ marginTop: 12, padding: 12, borderRadius: 8, background: 'rgba(59,130,246,.06)' }}><b style={{ color: '#93c5fd' }}>Follow these steps</b><ol style={{ color: C.muted, paddingLeft: 20, lineHeight: 1.7 }}>{item.steps.map(step => <li key={step}>{step}</li>)}</ol><div style={{ color: C.muted, fontSize: 11 }}><b>Evidence:</b> {item.evidence}</div></div>}
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}><Button onClick={() => setOpen(value => !value)}>{open ? 'Hide guide' : 'Show me how'}</Button>{!task && <Button onClick={() => onCreateTask(item)} style={{ background: '#7c3aed' }}>Create SEO task</Button>}{task && task.status !== 'completed' && <Button onClick={() => onComplete(task.id)} style={{ background: '#059669' }}>Mark completed</Button>}{task?.status === 'completed' && <span style={{ color: '#4ade80', padding: '8px 0' }}>✓ Completed — review in 14 days</span>}</div>
  </div>;
}

function SeoCoach({ domain, data, recommendations, tasks, onCreateTask, onComplete, onOpenReport, onSync }) {
  const metrics = data?.metrics || {};
  const urgent = recommendations.filter(item => item.priority === 'today').length;
  const score = Math.max(35, Math.min(96, 82 - urgent * 12 - recommendations.filter(item => item.priority === 'week').length * 4 + (metrics.trends?.clicks > 0 ? 4 : 0)));
  return <div style={{ display: 'grid', gap: 16 }}>
    <Card title="Your website today"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: 12 }}><div><b style={{ color: score >= 80 ? '#4ade80' : score >= 60 ? '#fbbf24' : '#f87171', fontSize: 30 }}>{score}/100</b><div style={{ color: C.muted }}>SEO health · {score >= 80 ? 'Good' : score >= 60 ? 'Needs attention' : 'Action required'}</div></div><div><b style={{ color: '#fff', fontSize: 22 }}>{metrics.clicks || 0}</b><div style={{ color: C.muted }}>Search clicks</div></div><div><b style={{ color: metrics.trends?.clicks >= 0 ? '#4ade80' : '#f87171', fontSize: 22 }}>{metrics.trends?.clicks || 0}%</b><div style={{ color: C.muted }}>Compared with previous period</div></div><div><b style={{ color: '#fff', fontSize: 22 }}>{recommendations.length}</b><div style={{ color: C.muted }}>Recommended actions</div></div></div><div style={{ marginTop: 14, display: 'flex', gap: 8 }}><Button onClick={onSync}>Check latest data</Button><Button onClick={() => onOpenReport('performance')} style={{ background: C.bg, border: `1px solid ${C.border}` }}>View advanced report</Button></div></Card>
    <Card title="What should I work on next?"><p style={{ color: C.muted }}>Work from the top. Each recommendation explains the evidence and gives beginner-friendly steps.</p><div style={{ display: 'grid', gap: 12 }}>{recommendations.map(item => <SeoActionCard key={item.id} item={item} task={tasks.find(task => task.recommendationId === item.id)} onCreateTask={onCreateTask} onComplete={onComplete} />)}</div></Card>
    <Card title="My SEO tasks">{tasks.length === 0 ? <p style={{ color: C.muted }}>No tasks created yet. Choose “Create SEO task” from a recommendation.</p> : tasks.map(task => <div key={task.id} style={{ padding: 10, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}><span>{task.title}</span><span style={{ color: task.status === 'completed' ? '#4ade80' : '#fbbf24' }}>{task.status === 'completed' ? 'Completed' : 'To do'}</span></div>)}</Card>
  </div>;
}

export default function GscWorkspace({ active, onChange, siteUrl, domain, performanceData, onSync }) {
  const [loading, setLoading] = useState(false);
  const [properties, setProperties] = useState([]);
  const [status, setStatus] = useState(null);
  const [inspectionUrl, setInspectionUrl] = useState(`https://${domain || ''}/`);
  const [inspection, setInspection] = useState(null);
  const [sitemaps, setSitemaps] = useState([]);
  const [feedpath, setFeedpath] = useState(`https://${domain || ''}/sitemap.xml`);
  const [experience, setExperience] = useState(null);
  const [desktopExperience, setDesktopExperience] = useState(null);
  const [technical, setTechnical] = useState(null);
  const [links, setLinks] = useState(null);
  const [inspectionHistory, setInspectionHistory] = useState([]);
  const [knownUrls, setKnownUrls] = useState([]);
  const [queueText, setQueueText] = useState('');
  const [queueResults, setQueueResults] = useState([]);
  const [seoTasks, setSeoTasks] = useState(() => {
    try { return JSON.parse(localStorage.getItem('gsc_seo_tasks') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    setInspectionUrl(`https://${domain || ''}/`);
    setFeedpath(`https://${domain || ''}/sitemap.xml`);
  }, [domain]);

  const loadProperties = async () => {
    setLoading(true);
    try {
      const [propertyResult, statusResult] = await Promise.all([api.get('/thedal/gscintel/properties'), api.get('/thedal/gscintel/status')]);
      setProperties(propertyResult.properties || []);
      setStatus(statusResult);
    } catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const loadSitemaps = async () => {
    setLoading(true);
    try { const result = await api.get(`/thedal/gscintel/sitemaps?siteUrl=${encodeURIComponent(siteUrl)}`); setSitemaps(result.sitemaps || []); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  useEffect(() => {
    if (active === 'settings') loadProperties();
    if ((active === 'sitemaps' || active === 'indexing') && siteUrl) loadSitemaps();
  }, [active, siteUrl]);

  const inspect = async () => {
    setLoading(true); setInspection(null);
    try { setInspection(await api.post('/thedal/gscintel/inspect', { siteUrl, inspectionUrl })); await loadInspectionHistory(); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const loadInspectionHistory = async () => {
    try { const result = await api.get(`/thedal/gscintel/inspect/history?siteUrl=${encodeURIComponent(siteUrl)}`); setInspectionHistory(result.history || []); }
    catch (e) { toast.error(e.message); }
  };

  const inspectQueue = async () => {
    const urls = queueText.split(/\r?\n|,/).map(value => value.trim()).filter(Boolean).slice(0, 20);
    if (!urls.length) return toast.error('Enter at least one URL');
    setLoading(true);
    try { const result = await api.post('/thedal/gscintel/inspect/queue', { siteUrl, urls }); setQueueResults(result.results || []); await loadInspectionHistory(); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const discoverUrls = async path => {
    setLoading(true);
    try { const result = await api.get(`/thedal/gscintel/sitemap-urls?siteUrl=${encodeURIComponent(siteUrl)}&feedpath=${encodeURIComponent(path || feedpath)}`); setKnownUrls(result.urls || []); setQueueText((result.urls || []).slice(0, 20).join('\n')); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const submitSitemap = async () => {
    setLoading(true);
    try { await api.post('/thedal/gscintel/sitemaps', { siteUrl, feedpath }); toast.success('Sitemap submitted'); await loadSitemaps(); }
    catch (e) { toast.error(`${e.message}. Reconnect Google if this connection only has read permission.`); } finally { setLoading(false); }
  };

  const deleteSitemap = async path => {
    setLoading(true);
    try { await api.delete(`/thedal/gscintel/sitemaps?siteUrl=${encodeURIComponent(siteUrl)}&feedpath=${encodeURIComponent(path)}`); toast.success('Sitemap removed'); await loadSitemaps(); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const loadExperience = async () => {
    setLoading(true);
    try {
      const [mobile, desktop, audit] = await Promise.all([
        api.get(`/mafiya/turf/pagespeed?url=${encodeURIComponent(`https://${domain}`)}&strategy=mobile`),
        api.get(`/mafiya/turf/pagespeed?url=${encodeURIComponent(`https://${domain}`)}&strategy=desktop`),
        api.get(`/thedal/gscintel/technical-audit?url=${encodeURIComponent(`https://${domain}`)}`)
      ]);
      setExperience(mobile); setDesktopExperience(desktop); setTechnical(audit);
    }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const exportCsv = (rows, filename) => {
    if (!rows?.length) return toast.error('No data to export');
    const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    const csv = [columns.join(','), ...rows.map(row => columns.map(key => `"${String(row[key] ?? '').replaceAll('"', '""')}"`).join(','))].join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); link.download = filename; link.click(); URL.revokeObjectURL(link.href);
  };

  const loadLinks = async () => {
    setLoading(true);
    try { setLinks(await api.post('/thedal/backlinks/scan', { domain })); }
    catch (e) { toast.error(e.message); } finally { setLoading(false); }
  };

  const insights = useMemo(() => {
    const queries = performanceData?.queries || [];
    const pages = performanceData?.pages || [];
    return {
      quickWins: queries.filter(q => +q.position >= 8 && +q.position <= 20 && +q.impressions >= 10).slice(0, 10),
      lowCtr: queries.filter(q => +q.impressions >= 20 && +q.ctr < 2).slice(0, 10),
      pagesWithoutClicks: pages.filter(p => +p.impressions > 0 && +p.clicks === 0).slice(0, 10)
    };
  }, [performanceData]);

  const coachRecommendations = useMemo(() => {
    const metrics = performanceData?.metrics || {};
    const items = [];
    if ((metrics.trends?.clicks || 0) < -10) items.push({ id: 'traffic-drop', priority: 'today', priorityLabel: 'Fix today', title: 'Your Google search traffic has dropped', summary: `Clicks decreased ${Math.abs(metrics.trends.clicks)}% compared with the previous period.`, happened: 'Fewer people reached the website from Google Search.', impact: 'A sustained drop can reduce enquiries and sales.', solution: 'Find the pages and queries with the largest losses before changing content.', difficulty: 'Easy', time: '20 min', evidence: `${metrics.clicks || 0} clicks; ${metrics.trends.clicks}% period change.`, steps: ['Open Performance.', 'Sort pages by clicks and compare the affected period.', 'Identify the page and query with the biggest decline.', 'Check that page in URL Inspection.', 'Create a focused content or technical task based on the evidence.'] });
    insights.lowCtr.slice(0, 3).forEach((query, index) => items.push({ id: `ctr-${query.query}`, priority: index === 0 ? 'week' : 'later', priorityLabel: index === 0 ? 'Fix this week' : 'Improve later', title: `More people see “${query.query}” than click it`, summary: `${query.impressions} impressions produced a ${query.ctr}% click-through rate.`, happened: 'The result appears in Google, but searchers often choose another result.', impact: 'Improving the title and description may earn more traffic without needing a higher ranking.', solution: 'Make the page title specific, useful and aligned with this search intent.', difficulty: 'Easy', time: '30 min', evidence: `${query.impressions} impressions, ${query.clicks} clicks, ${query.ctr}% CTR, position ${query.position}.`, steps: ['Open Performance → Top Pages and identify the page ranking for this query.', 'Read the current title and description.', `Include the intent behind “${query.query}” naturally in the title.`, 'Explain a clear benefit in the description.', 'Publish the change and review CTR after 14 days.'] }));
    insights.quickWins.slice(0, 3).forEach((query, index) => items.push({ id: `rank-${query.query}`, priority: index === 0 ? 'week' : 'later', priorityLabel: index === 0 ? 'Fix this week' : 'Improve later', title: `Move “${query.query}” closer to page one`, summary: `This query currently averages position ${query.position}.`, happened: 'Google already considers the website relevant, but it is not consistently visible near the top.', impact: 'A small ranking improvement can meaningfully increase clicks.', solution: 'Strengthen the matching page and add relevant internal links.', difficulty: 'Medium', time: '60 min', evidence: `${query.impressions} impressions, position ${query.position}.`, steps: ['Identify the ranking page in Performance.', 'Confirm the page fully answers the search intent.', 'Add one useful section or FAQ that is currently missing.', 'Link to it from two relevant pages using descriptive anchor text.', 'Check indexing and review its position after 14–28 days.'] }));
    insights.pagesWithoutClicks.slice(0, 2).forEach(page => items.push({ id: `page-${page.page}`, priority: 'later', priorityLabel: 'Improve later', title: 'This visible page receives no search clicks', summary: page.page, happened: `Google showed this page ${page.impressions} times without a click.`, impact: 'The page is visible but is not attracting visitors.', solution: 'Check query relevance, title clarity and whether another page better matches the same intent.', difficulty: 'Medium', time: '45 min', evidence: `${page.impressions} impressions, 0 clicks, position ${page.position}.`, steps: ['Open the page and confirm its primary topic.', 'Find its queries in Performance.', 'Rewrite the title to accurately match the strongest query.', 'Check for another page competing for the same topic.', 'Review results after 14 days.'] }));
    if (!items.length) items.push({ id: 'monitor', priority: 'monitor', priorityLabel: 'Monitor', title: 'No urgent SEO problem detected', summary: 'The loaded GSC data does not show a major issue right now.', happened: 'Search performance appears stable for the selected period.', impact: 'No immediate change is required.', solution: 'Continue monitoring and inspect new or updated pages.', difficulty: 'Easy', time: '5 min', evidence: `${metrics.clicks || 0} clicks in the selected period.`, steps: ['Sync performance weekly.', 'Inspect important new pages.', 'Review sitemap warnings.', 'Create a task only when evidence shows a problem or opportunity.'] });
    return items.slice(0, 8);
  }, [performanceData, insights]);

  const saveTasks = next => { setSeoTasks(next); localStorage.setItem('gsc_seo_tasks', JSON.stringify(next)); };
  const createSeoTask = item => {
    if (seoTasks.some(task => task.recommendationId === item.id)) return toast.error('This SEO task already exists');
    saveTasks([...seoTasks, { id: Date.now(), recommendationId: item.id, domain, title: item.title, priority: item.priority, status: 'todo', createdAt: new Date().toISOString() }]);
    toast.success('SEO task created');
  };
  const completeSeoTask = id => { saveTasks(seoTasks.map(task => task.id === id ? { ...task, status: 'completed', completedAt: new Date().toISOString(), reviewAt: new Date(Date.now() + 14 * 86400000).toISOString() } : task)); toast.success('Task completed. Results will be reviewed after 14 days.'); };

  const reconnect = async () => {
    await api.delete('/thedal/gscintel/connection?clientId=default');
    window.location.href = `${import.meta.env.VITE_API_URL || 'http://localhost:3600'}/api/thedal/gscintel/auth/google?clientId=default`;
  };

  const render = () => {
    if (active === 'overview') return <SeoCoach domain={domain} data={performanceData} recommendations={coachRecommendations} tasks={seoTasks.filter(task => task.domain === domain)} onCreateTask={createSeoTask} onComplete={completeSeoTask} onOpenReport={onChange} onSync={onSync} />;

    if (active === 'links') return <Card title="Links intelligence"><Notice>Google does not expose its Search Console Links report through an API. Results here come from the configured backlink provider.</Notice><Button onClick={loadLinks} style={{ marginTop: 18 }}>Scan backlinks</Button><BacklinkResults data={links} /></Card>;

    if (active === 'indexing') return <div style={{ display: 'grid', gap: 16 }}><Card title="Known URLs from sitemaps"><Notice>The complete Google Page Indexing report has no API. Discover sitemap URLs here, then inspect up to 20 at a time for authoritative coverage reasons.</Notice><div style={{ display: 'flex', gap: 10, marginTop: 16 }}><Field value={feedpath} onChange={e => setFeedpath(e.target.value)} /><Button onClick={() => discoverUrls(feedpath)}>Discover URLs</Button></div>{knownUrls.length > 0 && <><p>{knownUrls.length} URLs found.</p><Button onClick={() => onChange('inspection')}>Send first 20 to inspection queue</Button><div style={{ maxHeight: 320, overflow: 'auto', marginTop: 12 }}>{knownUrls.map(url => <div key={url} style={{ padding: 9, borderTop: `1px solid ${C.border}`, overflowWrap: 'anywhere' }}>{url}</div>)}</div></>}</Card><Card title="Sitemap sources">{sitemaps.map(map => <div key={map.path} style={{ padding: 10, borderTop: `1px solid ${C.border}` }}><button onClick={() => discoverUrls(map.path)} style={{ color: '#60a5fa', background: 'none', border: 0 }}>{map.path}</button></div>)}</Card></div>;

    if (active === 'overview') return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 16 }}>
      <Card title="Search performance"><b style={{ fontSize: 28 }}>{performanceData?.metrics?.clicks || 0}</b><p style={{ color: C.muted }}>Clicks in selected period</p><Button onClick={() => onChange('performance')}>Open performance</Button></Card>
      <Card title="Indexing"><p style={{ color: C.muted }}>Inspect URLs and review sitemap discovery.</p><Button onClick={() => onChange('indexing')}>Open indexing</Button></Card>
      <Card title="Experience"><p style={{ color: C.muted }}>Run PageSpeed and Core Web Vitals diagnostics.</p><Button onClick={() => onChange('experience')}>Check experience</Button></Card>
      <Card title="Recommendations"><p style={{ color: C.muted }}>{insights.quickWins.length} ranking opportunities identified from official performance data.</p><Button onClick={() => onChange('insights')}>View insights</Button></Card>
    </div>;

    if (active === 'inspection') return <div style={{ display: 'grid', gap: 16 }}>
      <Card title="URL Inspection"><Notice>This returns the URL version currently stored in Google's index. Google's live test and Request Indexing action are not exposed by the API.</Notice><div style={{ display: 'flex', gap: 10, marginTop: 18 }}><Field value={inspectionUrl} onChange={e => setInspectionUrl(e.target.value)} /><Button onClick={inspect}><Search size={15} /> Inspect</Button></div>{inspection && <><div style={{ marginTop: 20, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(210px,1fr))', gap: 12 }}>{Object.entries({ Verdict: inspection.indexStatusResult?.verdict, Coverage: inspection.indexStatusResult?.coverageState, 'Last crawl': inspection.indexStatusResult?.lastCrawlTime, 'Google canonical': inspection.indexStatusResult?.googleCanonical, 'User canonical': inspection.indexStatusResult?.userCanonical, Robots: inspection.indexStatusResult?.robotsTxtState, Noindex: inspection.indexStatusResult?.indexingState, Fetch: inspection.indexStatusResult?.pageFetchState, Mobile: inspection.mobileUsabilityResult?.verdict, 'Rich results': inspection.richResultsResult?.verdict }).map(([k,v]) => <div key={k} style={{ padding: 13, background: C.bg, borderRadius: 8 }}><small style={{ color: C.muted }}>{k}</small><div style={{ color: '#fff', marginTop: 5, overflowWrap: 'anywhere' }}>{v || 'Not available'}</div></div>)}</div><p><b>Sitemaps:</b> {inspection.indexStatusResult?.sitemap?.join(', ') || 'None reported'}</p><p><b>Referring URLs:</b> {inspection.indexStatusResult?.referringUrls?.join(', ') || 'None reported'}</p></>}</Card>
      <Card title="Batch inspection queue"><textarea value={queueText} onChange={e => setQueueText(e.target.value)} placeholder="One URL per line (maximum 20)" rows={6} style={{ width: '100%', boxSizing: 'border-box', background: C.bg, color: '#fff', border: `1px solid ${C.border}`, borderRadius: 8, padding: 12 }} /><Button onClick={inspectQueue} style={{ marginTop: 10 }}>Inspect queue</Button>{queueResults.map((item, i) => <div key={i} style={{ padding: 10, borderTop: `1px solid ${C.border}` }}>{item.inspectionUrl} — {item.indexStatusResult?.verdict || item.error}</div>)}</Card>
      <Card title="Inspection history"><Button onClick={loadInspectionHistory}>Refresh history</Button>{inspectionHistory.map((item, i) => <div key={i} style={{ padding: 10, borderTop: `1px solid ${C.border}` }}><b>{item.inspectionUrl}</b><span style={{ color: C.muted, marginLeft: 10 }}>{item.indexStatusResult?.coverageState || item.indexStatusResult?.verdict} · {new Date(item.inspectedAt).toLocaleString()}</span></div>)}</Card>
    </div>;

    if (active === 'sitemaps' || active === 'indexing') return <div style={{ display: 'grid', gap: 16 }}><Card title={active === 'sitemaps' ? 'Sitemaps' : 'Known indexing sources'}>{active === 'indexing' && <Notice>The complete Google Page Indexing report has no API. This view uses sitemap discovery totals; inspect individual URLs for authoritative indexed status.</Notice>}<div style={{ display: 'flex', gap: 10, margin: '18px 0' }}><Field value={feedpath} onChange={e => setFeedpath(e.target.value)} /><Button onClick={submitSitemap}>Submit</Button></div>{sitemaps.length === 0 ? <p style={{ color: C.muted }}>No submitted sitemaps returned for this property.</p> : sitemaps.map(map => <div key={map.path} style={{ padding: 14, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 12 }}><div><b style={{ color: '#fff' }}>{map.path}</b><div style={{ color: C.muted, marginTop: 6 }}>{map.errors || 0} errors · {map.warnings || 0} warnings · {map.contents?.reduce((n,c) => n + (+c.submitted || 0), 0) || 0} submitted · {map.contents?.reduce((n,c) => n + (+c.indexed || 0), 0) || 0} indexed</div></div><button onClick={() => deleteSitemap(map.path)} style={{ color: '#f87171', background: 'transparent', border: 0, cursor: 'pointer' }}>Remove</button></div>)}</Card></div>;

    if (active === 'experience') return <div style={{ display: 'grid', gap: 16 }}><Card title="Experience & Core Web Vitals"><Notice>This uses PageSpeed/Lighthouse field and lab diagnostics, not Google's private GSC URL-group report.</Notice><Button onClick={loadExperience} style={{ marginTop: 18 }}>Run mobile + desktop audits</Button>{experience && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, marginTop: 18 }}>{Object.entries({ 'Mobile score': `${experience.performance}/100`, 'Desktop score': `${desktopExperience?.performance ?? '—'}/100`, LCP: experience.largestContentfulPaint, CLS: experience.cumulativeLayoutShift, INP: experience.interactionToNextPaint, 'Desktop LCP': desktopExperience?.largestContentfulPaint }).map(([k,v]) => <div key={k} style={{ padding: 16, background: C.bg, borderRadius: 8 }}><small style={{ color: C.muted }}>{k}</small><div style={{ fontSize: 20, color: '#fff', marginTop: 5 }}>{v || 'N/A'}</div></div>)}</div>}</Card>{technical && <Card title="HTTPS & technical checks"><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(190px,1fr))', gap: 12 }}>{Object.entries({ Status: technical.status, HTTPS: technical.https ? 'Yes' : 'No', 'Certificate valid': technical.certificateValid ? 'Yes' : 'No', Redirected: technical.redirected ? 'Yes' : 'No', 'Final URL': technical.finalUrl, Canonical: technical.canonical, Robots: technical.robots }).map(([k,v]) => <div key={k} style={{ padding: 13, background: C.bg, borderRadius: 8, overflowWrap: 'anywhere' }}><small style={{ color: C.muted }}>{k}</small><div>{v ?? 'Not found'}</div></div>)}</div></Card>}</div>;

    if (active === 'links') return <Card title="Links intelligence"><Notice>Google does not expose its Search Console Links report through an API. Results here come from the configured backlink provider.</Notice><Button onClick={loadLinks} style={{ marginTop: 18 }}>Scan backlinks</Button>{links && <div style={{ marginTop: 18 }}><b style={{ color: '#fff', fontSize: 24 }}>{links.metrics?.totalBacklinks || 0}</b><span style={{ color: C.muted }}> backlinks · {links.metrics?.referringDomains || 0} referring domains</span>{(links.links || []).slice(0, 20).map((link, i) => <div key={i} style={{ padding: 11, borderTop: `1px solid ${C.border}`, overflowWrap: 'anywhere' }}>{link.source_url || link.url || link.domain}</div>)}</div>}</Card>;

    if (active === 'insights') return <div style={{ display: 'grid', gap: 16 }}>{[['Quick ranking wins', insights.quickWins], ['High impressions, low CTR', insights.lowCtr], ['Pages without clicks', insights.pagesWithoutClicks]].map(([title, rows]) => <Card key={title} title={title}>{rows.length ? rows.map((row,i) => <div key={i} style={{ padding: 10, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', gap: 12 }}><span>{row.query || row.page}</span><span style={{ color: C.muted }}>{row.impressions} imp · {row.position} pos · {row.ctr}% CTR</span></div>) : <p style={{ color: C.muted }}>No matching opportunities in the loaded period.</p>}</Card>)}</div>;

    if (active === 'security') return <Card title="Security & manual actions"><Notice>Google does not provide Manual Actions, Security Issues or Removals through the Search Console API. Open the official reports to view authoritative status.</Notice><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 18 }}><a href="https://search.google.com/search-console/manual-actions" target="_blank" rel="noreferrer"><Button>Manual actions <ExternalLink size={14} /></Button></a><a href="https://search.google.com/search-console/security-issues" target="_blank" rel="noreferrer"><Button>Security issues <ExternalLink size={14} /></Button></a><a href="https://search.google.com/search-console/removals" target="_blank" rel="noreferrer"><Button>Removals <ExternalLink size={14} /></Button></a></div></Card>;

    if (active === 'settings') return <div style={{ display: 'grid', gap: 16 }}><Card title="Google connection"><p><CheckCircle2 size={16} color="#22c55e" /> Connected as <b>{status?.connectedEmail || 'Email unavailable — reconnect to capture it'}</b></p><Button onClick={reconnect}>Reconnect Google account</Button></Card><Card title="Available GSC properties"><Button onClick={loadProperties}><RefreshCw size={14} /> Refresh</Button>{properties.map(p => <div key={p.siteUrl} style={{ padding: 12, borderTop: `1px solid ${C.border}` }}><b>{p.siteUrl}</b><span style={{ color: C.muted, marginLeft: 10 }}>{p.permissionLevel}</span></div>)}</Card></div>;
    return null;
  };

  return <div className="p-mobile" style={{ padding: 26, color: C.text, height: '100%', overflowY: 'auto', background: C.bg }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}><div><h1 style={{ margin: 0, color: '#e2e8f0' }}>GSC Intel</h1><p style={{ color: C.muted }}>Search Console workspace for {domain}</p></div><Button onClick={onSync}><RefreshCw size={15} /> Sync performance</Button></div><GscSectionNav active={active} onChange={onChange} />{loading && <div style={{ marginBottom: 12 }}><Loader2 className="spin" size={18} /> Loading Google data…</div>}{render()}</div>;
}
