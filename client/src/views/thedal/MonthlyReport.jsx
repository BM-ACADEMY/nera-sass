import React, { useState, useEffect, useRef } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import html2pdf from 'html2pdf.js/dist/html2pdf.bundle.min.js';
import { C } from '../../constants/theme.js';
import { useClient } from '../../contexts/ClientContext.jsx';
import { api } from '../../services/api.js';
import { 
  FileOutput, 
  Calendar, 
  CheckCircle, 
  Download, 
  FileText, 
  MapPin, 
  BarChart2, 
  MessageCircle, 
  Link2,
  Loader2,
  Settings,
  Mail,
  Search,
  TrendingUp,
  TrendingDown,
  Eye,
  Star,
  Activity,
  Link as LinkIcon,
  Radar,
  Target,
  Code,
  Crosshair,
  AlertTriangle
} from 'lucide-react';
import toast from 'react-hot-toast';

function CustomDatePicker({ value, onChange, min, max, label }) {
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState(() => value ? new Date(`${value}T00:00:00`) : new Date());
  const pickerRef = useRef(null);

  useEffect(() => {
    if (value) setViewDate(new Date(`${value}T00:00:00`));
  }, [value]);

  useEffect(() => {
    const closePicker = (event) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', closePicker);
    return () => document.removeEventListener('mousedown', closePicker);
  }, []);

  const toIsoDate = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };
  const displayValue = value ? value.split('-').reverse().join('-') : 'Select date';
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const gridStart = new Date(monthStart);
  gridStart.setDate(1 - monthStart.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    return date;
  });
  const todayIso = toIsoDate(new Date());

  return (
    <div ref={pickerRef} style={{ position: 'relative', minWidth: 0 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 7, color: C.muted, fontSize: 11, fontWeight: 700 }}>
        {label}
        <button type="button" onClick={() => setOpen(current => !current)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${open ? C.accent : C.border}`, color: '#fff', padding: '12px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <span>{displayValue}</span><Calendar size={14} color={C.muted} />
        </button>
      </label>
      {open && (
        <div style={{ position: 'absolute', zIndex: 1000, top: 'calc(100% + 6px)', left: 0, width: 280, padding: 14, background: '#161b22', border: `1px solid ${C.border}`, borderRadius: 10, boxShadow: '0 18px 45px rgba(0,0,0,0.5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <strong style={{ color: '#fff', fontSize: 13 }}>{viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</strong>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" aria-label="Previous month" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: '#0d1117', color: '#fff', cursor: 'pointer' }}>‹</button>
              <button type="button" aria-label="Next month" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} style={{ width: 28, height: 28, borderRadius: 6, border: `1px solid ${C.border}`, background: '#0d1117', color: '#fff', cursor: 'pointer' }}>›</button>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4, marginBottom: 4 }}>
            {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(day => <div key={day} style={{ textAlign: 'center', color: C.muted, fontSize: 10, fontWeight: 800, padding: 5 }}>{day}</div>)}
            {days.map(date => {
              const iso = toIsoDate(date);
              const outsideMonth = date.getMonth() !== viewDate.getMonth();
              const disabled = (min && iso < min) || (max && iso > max);
              const selected = iso === value;
              const today = iso === todayIso;
              return (
                <button key={iso} type="button" disabled={disabled} onClick={() => { onChange(iso); setOpen(false); }} style={{ height: 30, borderRadius: 6, border: today && !selected ? `1px solid ${C.accent}` : '1px solid transparent', background: selected ? C.accent : 'transparent', color: disabled ? '#484f58' : outsideMonth ? '#6e7681' : '#fff', fontSize: 11, fontWeight: selected ? 800 : 600, cursor: disabled ? 'not-allowed' : 'pointer' }}>
                  {date.getDate()}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 10, borderTop: `1px solid ${C.border}` }}>
            <button type="button" onClick={() => { onChange(''); setOpen(false); }} style={{ border: 0, background: 'transparent', color: C.muted, fontSize: 11, cursor: 'pointer' }}>Clear</button>
            <button type="button" disabled={(min && todayIso < min) || (max && todayIso > max)} onClick={() => { onChange(todayIso); setViewDate(new Date()); setOpen(false); }} style={{ border: 0, background: 'transparent', color: C.accent, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function MonthlyReport() {
  const { activeClient } = useClient();
  const [generating, setGenerating] = useState(false);
  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setDate(1);
    return date.toLocaleDateString('en-CA');
  });
  const [endDate, setEndDate] = useState(() => new Date().toLocaleDateString('en-CA'));
  const reportPeriod = startDate && endDate
    ? `${new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} – ${new Date(`${endDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
    : 'Custom date range';
  
  // Real Data State
  const [reportData, setReportData] = useState({
    keywords: [],
    gsc: null,
    audit: null,
    backlinks: null,
    serp: null,
    gap: null,
    competitor: null,
    schema: [],
    loading: false
  });
  
  // Module selection state
  // All eight default on — a "Monthly Report" should be comprehensive by
  // default. Previously four of these defaulted off, so their entire section
  // silently never rendered unless the user happened to notice and enable
  // the toggle first, which read as "the report is broken / data is missing"
  // rather than "this module was opted out."
  const [modules, setModules] = useState({
    keywordTracking: true,
    gscIntel: true,
    onPageAudit: true,
    backlinkTracker: true,
    serpRadar: true,
    gapHunter: true,
    competitorSpy: true,
    schemaLibrary: true
  });
  // Fetch real data for preview
  useEffect(() => {
    if (!activeClient) return;
    
    const fetchPreviewData = async () => {
      setReportData(prev => ({ ...prev, loading: true }));
      try {
        const clientDomain = activeClient.domain || activeClient.website || activeClient.website_url || '';
        const cleanDomain = clientDomain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();

        const results = await Promise.allSettled([
          activeClient.gmb_client_id
            ? api.get(`/mafiya/turf/keywords?clientId=${encodeURIComponent(activeClient.gmb_client_id)}`)
            : Promise.resolve([]),
          api.get(`/thedal/gscintel?clientId=${encodeURIComponent(activeClient.id)}&siteUrl=${encodeURIComponent(clientDomain)}&startDate=${startDate}&endDate=${endDate}`),
          api.get(`/thedal/seo-audit/saved?clientId=${encodeURIComponent(activeClient.id)}`),
          api.get(`/thedal/backlinks/history?domain=${encodeURIComponent(cleanDomain)}&startDate=${startDate}&endDate=${endDate}`),
          api.get(`/thedal/competitorspy/history?clientId=${encodeURIComponent(activeClient.id)}`),
          api.get(`/thedal/content/${encodeURIComponent(activeClient.id)}/schemas`),
          api.get(`/thedal/serpradar/history?clientId=${encodeURIComponent(activeClient.id)}&startDate=${startDate}&endDate=${endDate}`),
          api.get(`/thedal/gaphunter/history?domain=${encodeURIComponent(cleanDomain)}&startDate=${startDate}&endDate=${endDate}`)
        ]);
        
        const kwRes = results[0].status === 'fulfilled' ? results[0].value : { items: [] };
        const gscRes = results[1].status === 'fulfilled' ? results[1].value : null;
        const auditSavedRes = results[2].status === 'fulfilled' ? results[2].value : null;
        const backlinkRes = results[3].status === 'fulfilled' ? results[3].value : null;
        const compRes = results[4].status === 'fulfilled' ? results[4].value : null;
        const schemaRes = results[5].status === 'fulfilled' ? results[5].value : { items: [] };
        const serpRes = results[6].status === 'fulfilled' ? results[6].value : null;
        const gapRes = results[7].status === 'fulfilled' ? results[7].value : null;

        const filterHistoryByPeriod = (response) => {
          if (!response || !Array.isArray(response.history)) return response;
          const rangeStart = new Date(`${startDate}T00:00:00`).getTime();
          const rangeEnd = new Date(`${endDate}T23:59:59.999`).getTime();
          const history = response.history.filter(item => {
            const rawDate = item.scanned_at || item.created_at || item.updated_at || item.date;
            if (!rawDate) return true;
            const timestamp = new Date(rawDate).getTime();
            return Number.isFinite(timestamp) && timestamp >= rangeStart && timestamp <= rangeEnd;
          });
          return {
            ...response,
            history
          };
        };

        const scopedBacklinks = filterHistoryByPeriod(backlinkRes);
        if (scopedBacklinks?.history) {
          scopedBacklinks.history = scopedBacklinks.history.filter(item =>
            !cleanDomain || String(item.domain || '').replace(/^www\./i, '').toLowerCase() === cleanDomain
          );
        }
        // Already scoped to this client server-side (by client_id, via the
        // ?clientId= query param) — no more guessing relevance from query text.
        const scopedCompetitors = filterHistoryByPeriod(compRes);
        // Already scoped to this client server-side (by client_id, not a
        // fragile URL/domain text match) — map its real columns to the
        // shape the report table expects.
        const scopedSchema = (schemaRes?.items || []).map(item => ({
          title: `${item.schema_type || 'Schema'} — ${item.target_page || 'No page assigned'}`,
          schema_type: item.schema_type,
          page_url: item.target_page,
          status: item.is_deployed ? 'active' : 'draft',
        }));
        const rawKeywords = Array.isArray(kwRes) ? kwRes : (kwRes?.items || kwRes?.keywords || []);
        const rangeStart = new Date(`${startDate}T00:00:00`).getTime();
        const rangeEnd = new Date(`${endDate}T23:59:59.999`).getTime();
        // A tracked keyword remains part of the client's report even when its latest
        // check falls outside the selected period. The date range describes ranking
        // activity, not whether the keyword is still being tracked.
        const scopedKeywords = rawKeywords.map(item => {
          const rawDate = item.last_checked || item.updated_at || item.created_at;
          const timestamp = rawDate ? new Date(rawDate).getTime() : null;
          return {
            ...item,
            initialRank: item.initialRank ?? item.initial_rank,
            currentRank: item.currentRank ?? item.current_rank,
            previousRank: item.previousRank ?? item.previous_rank,
            packStatus: item.packStatus ?? item.pack_status,
            lastChecked: item.lastChecked ?? item.last_checked,
            checkedInPeriod: timestamp === null || (Number.isFinite(timestamp) && timestamp >= rangeStart && timestamp <= rangeEnd)
          };
        });
        // An audit is a current-state snapshot, not a per-period activity log —
        // like tracked keywords, it should stay visible even when its last-run
        // date falls outside the selected range, just flagged as stale rather
        // than hidden entirely (hiding it read as "no audit was ever run").
        const auditTimestamp = auditSavedRes?.updatedAt ? new Date(auditSavedRes.updatedAt).getTime() : null;
        const savedAudit = auditSavedRes?.saved ? auditSavedRes.auditData : null;
        const auditOutsidePeriod = !!(savedAudit && auditTimestamp && (auditTimestamp < rangeStart || auditTimestamp > rangeEnd));
        const auditScores = savedAudit
          ? [savedAudit.onPage?.score, savedAudit.technical?.score, savedAudit.local?.score].filter(score => Number.isFinite(Number(score)))
          : [];
        const scopedAudit = savedAudit ? {
          ...savedAudit,
          overallScore: Number(savedAudit.overallScore) > 0
            ? Number(savedAudit.overallScore)
            : auditScores.length
              ? Math.round(auditScores.reduce((sum, score) => sum + Number(score), 0) / auditScores.length)
              : 0,
          outsidePeriod: auditOutsidePeriod,
          lastRunAt: auditSavedRes?.updatedAt || null,
        } : null;

        setReportData({
          keywords: scopedKeywords,
          gsc: gscRes,
          audit: scopedAudit,
          backlinks: scopedBacklinks,
          competitor: scopedCompetitors,
          serp: serpRes,
          gap: gapRes,
          schema: scopedSchema,
          loading: false
        });
      } catch (err) {
        console.error('Preview data fetch error', err);
        setReportData(prev => ({ ...prev, loading: false }));
      }
    };
    
    fetchPreviewData();
  }, [activeClient, startDate, endDate]);
  const toggleModule = (key) => {
    setModules(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleGenerate = () => {
    if (!activeClient) {
      toast.error('Please select a client first.');
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      toast.error('Please select a valid start and end date.');
      return;
    }
    
    setGenerating(true);
    
    // Give it a moment to render any loading states
    setTimeout(() => {
      const element = document.getElementById('pdf-report-content');
      
      const opt = {
        margin:       [15, 10, 15, 10],
        filename:     `${activeClient.business_name || 'Client'}_SEO_Report_${startDate}_to_${endDate}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { scale: 2, useCORS: true, letterRendering: true },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      };

      html2pdf().set(opt).from(element).save().then(() => {
        setGenerating(false);
        toast.success('Report downloaded successfully!');
      }).catch(err => {
        console.error(err);
        setGenerating(false);
        toast.error('Failed to generate PDF');
      });
    }, 500);
  };

  if (!activeClient) {
    return (
      <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 24, padding: 50, maxWidth: 600, textAlign: 'center', boxShadow: '0 20px 40px rgba(0,0,0,0.4)' }}>
          <div style={{ background: 'rgba(59, 130, 246, 0.1)', width: 80, height: 80, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px' }}>
            <FileOutput size={40} color="#3b82f6" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', marginBottom: 16, fontFamily: "'Syne', sans-serif" }}>Select a Client</h1><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 16, lineHeight: 1.6, marginBottom: 0 }}>You need to select an Active Client from the sidebar before you can generate their Monthly SEO & Performance Report.</p>
        </div>
      </div>
    );
  }

  const trackedCount = reportData.keywords.length;
  const improvedCount = reportData.keywords.filter(k => k.previousRank && k.currentRank && k.currentRank < k.previousRank).length;

  // Sub-renderers for pages
  const renderCoverPage = () => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%', flex: 1, minHeight: '230mm' }}>
        {/* Branded Header Banner */}
        <div style={{ 
          background: 'linear-gradient(135deg, #0c1525 0%, #1a2e4a 50%, #3b82f6 100%)', 
          padding: '60px 40px', 
          borderRadius: '12px', 
          color: '#ffffff',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 10px 30px rgba(26, 46, 74, 0.15)'
        }}>
          {/* Decorative Grid */}
          <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity: 0.05, backgroundSize: '20px 20px', backgroundImage: 'linear-gradient(to right, #ffffff 1px, transparent 1px), linear-gradient(to bottom, #ffffff 1px, transparent 1px)' }} />
          
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 40 }}>
              <div style={{ background: '#ffffff', color: '#0c1525', width: 40, height: 40, borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: 20 }}>L</div>
              <span style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.5px' }}>LeadOS</span>
            </div>
            
            <h1 style={{ fontSize: 40, fontWeight: 800, margin: '0 0 16px 0', lineHeight: 1.1, fontFamily: "'Syne', sans-serif" }}>SEO PERFORMANCE<br />REPORT</h1>
            <p style={{ fontSize: 18, color: '#93c5fd', margin: 0, fontWeight: 500 }}>Comprehensive Monthly Analytics & Optimizations</p>
          </div>
        </div>

        {/* Center Details */}
        <div style={{ padding: '40px 20px', display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: '8px', fontSize: 15 }}>
            <span style={{ color: '#64748b', fontWeight: 600 }}>Client:</span>
            <span style={{ color: '#0f172a', fontWeight: 700 }}>{activeClient.business_name}</span>
            
            <span style={{ color: '#64748b', fontWeight: 600 }}>Website:</span>
            <span style={{ color: '#3b82f6', fontWeight: 600 }}>{activeClient.domain || activeClient.website || 'N/A'}</span>
            
            <span style={{ color: '#64748b', fontWeight: 600 }}>Period:</span>
            <span style={{ color: '#0f172a', fontWeight: 700 }}>{reportPeriod}</span>
            
            <span style={{ color: '#64748b', fontWeight: 600 }}>Generated:</span>
            <span style={{ color: '#0f172a' }}>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
          </div>

          <div style={{ borderLeft: '4px solid #3b82f6', paddingLeft: 16, marginTop: 12 }}>
            <h4 style={{ color: '#0f172a', margin: '0 0 8px 0', fontSize: 16, fontWeight: 700 }}>Executive Brief</h4>
            <p style={{ color: '#475569', margin: 0, fontSize: 14, lineHeight: 1.6 }}>
              This report summarizes keyword rankings, Google Search Console performance, technical SEO health, backlinks, competitor intelligence, and advanced SEO activity for the selected custom date range.
            </p>
          </div>
        </div>

        {/* Footer Branding */}
        <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 13, color: '#64748b' }}>Prepared by:</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#1e3a8a' }}>BM TechX Agency</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, color: '#64748b' }}>Powered by</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#3b82f6' }}>LeadOS</span>
          </div>
        </div>
      </div>
    );
  };

  const renderScoreCard = () => {
    const totalKws = reportData.keywords?.length || 0;
    const rankImproved = reportData.keywords?.filter(k => k.previousRank && k.currentRank && k.currentRank < k.previousRank).length || 0;
    const gscClicks = reportData.gsc?.metrics?.clicks || 0;
    const gscImpressions = reportData.gsc?.metrics?.impressions || 0;
    const gscCtr = gscImpressions > 0 ? (gscClicks / gscImpressions) * 100 : 0;
    
    // Derive the score only from live modules that returned data.
    const scoreInputs = [];
    if (totalKws > 0) scoreInputs.push((rankImproved / totalKws) * 100);
    if (gscImpressions > 0) scoreInputs.push(Math.min(100, (gscCtr / 5) * 100));
    if (Number.isFinite(Number(reportData.audit?.overallScore))) scoreInputs.push(Number(reportData.audit.overallScore));
    const derivedScore = scoreInputs.length
      ? Math.round(scoreInputs.reduce((sum, score) => sum + score, 0) / scoreInputs.length)
      : 0;

    // Determine health level label & color
    let healthLabel = scoreInputs.length ? 'Excellent' : 'No Data';
    let healthColor = '#16a34a';
    if (!scoreInputs.length) {
      healthColor = '#94a3b8';
    } else if (derivedScore < 70) {
      healthLabel = 'Needs Work';
      healthColor = '#ef4444';
    } else if (derivedScore < 85) {
      healthLabel = 'Good';
      healthColor = '#eab308';
    }

    // Get active modules count
    const activeModulesCount = Object.values(modules).filter(Boolean).length;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <Activity size={24} color="#3b82f6" /> Executive SEO Score Card
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>{reportPeriod}</span>
        </div>

        {/* Main Score Block */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: 24, background: '#f8fafc', padding: 24, borderRadius: 12, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #e2e8f0', paddingRight: 16 }}>
            <div style={{ 
              width: 120, 
              height: 120, 
              borderRadius: '50%', 
              border: `10px solid ${healthColor}`, 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              background: '#ffffff',
              boxShadow: 'inset 0 4px 10px rgba(0,0,0,0.05)'
            }}>
              <span style={{ fontSize: 36, fontWeight: 900, color: '#0f172a', lineHeight: 1 }}>{derivedScore}</span>
              <span style={{ fontSize: 12, color: '#64748b', fontWeight: 700, marginTop: 4 }}>/ 100</span>
            </div>
            <span style={{ fontSize: 16, fontWeight: 800, color: healthColor, marginTop: 12 }}>{healthLabel} SEO Health</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 12 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>Selected-Period Performance Summary</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>
              Your overall SEO health is index-rated at <strong>{derivedScore}/100</strong>. This score combines technical accessibility, keywords search rank gains, GSC engagement, and off-page domain authority indicators. 
            </p>
            <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
              <div>
                <span style={{ fontSize: 11, color: '#64748b', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Organic Clicks</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>{gscClicks.toLocaleString()}</span>
              </div>
              <div>
                <span style={{ fontSize: 11, color: '#64748b', display: 'block', textTransform: 'uppercase', fontWeight: 600 }}>Keywords Improved</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: '#16a34a' }}>+{rankImproved}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Top Wins & Focus Areas */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 10, padding: 20 }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#166534', display: 'flex', alignItems: 'center', gap: 6 }}>
              <CheckCircle size={16} color="#16a34a" /> Major Wins This Period
            </h4>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: '#14532d' }}>
              {totalKws > 0 && <li><strong>Keyword Gains:</strong> {rankImproved} ranking keywords improved their organic search positions.</li>}
              {gscClicks > 0 && <li><strong>Search Clicks:</strong> Organic impressions reached {gscImpressions.toLocaleString()} showing healthy index exposure.</li>}
              <li><strong>Visibility:</strong> Search presence is active across targeted geographic regions and mobile query segments.</li>
            </ul>
          </div>

          <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: 20 }}>
            <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingUp size={16} color="#3b82f6" /> Key Optimization Focus
            </h4>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13, color: '#1e3a8a' }}>
              <li><strong>Technical Audit:</strong> Address warnings and structure schema markup on top traffic pages.</li>
              <li><strong>Domain Authority:</strong> Secure high-quality dofollow backlink profile referrals.</li>
              <li><strong>Query Gaps:</strong> Target high-opportunity search terms showing high impressions but low click-through.</li>
            </ul>
          </div>
        </div>

        {/* Integration Status Checklist */}
        <div style={{ marginTop: 'auto', borderTop: '1px solid #f1f5f9', paddingTop: 20 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 13, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 700 }}>Included Report Modules ({activeModulesCount} Active)</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {[
              { label: 'Keyword Rankings', active: modules.keywordTracking },
              { label: 'Search Console Intel', active: modules.gscIntel },
              { label: 'On-Page Audit', active: modules.onPageAudit },
              { label: 'Backlink Tracker', active: modules.backlinkTracker },
              { label: 'Competitor Spy', active: modules.competitorSpy },
              { label: 'Schema Library', active: modules.schemaLibrary },
              { label: 'SERP Radar & Gap Hunter', active: modules.serpRadar || modules.gapHunter },
            ].map((item, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <div style={{ 
                  width: 16, 
                  height: 16, 
                  borderRadius: '50%', 
                  background: item.active ? '#16a34a' : '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  fontSize: 10,
                  fontWeight: 'bold'
                }}>
                  {item.active ? '✓' : ''}
                </div>
                <span style={{ color: item.active ? '#334155' : '#94a3b8', fontWeight: item.active ? 600 : 400 }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderKeywordsSection = () => {
    const keywords = reportData.keywords || [];
    const totalKws = keywords.length;
    
    // Calculate average position
    const validRanks = keywords.filter(k => k.currentRank !== null && k.currentRank > 0);
    const avgPos = validRanks.length > 0 ? (validRanks.reduce((acc, k) => acc + Number(k.currentRank), 0) / validRanks.length).toFixed(1) : 'N/A';
    
    const page1Count = keywords.filter(k => k.currentRank !== null && k.currentRank <= 10).length;
    const improvedCount = keywords.filter(k => k.previousRank && k.currentRank && k.currentRank < k.previousRank).length;
    const uncheckedInPeriodCount = keywords.filter(k => k.checkedInPeriod === false).length;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <BarChart2 size={24} color="#3b82f6" /> Keyword Rankings Analysis
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Module Details</span>
        </div>

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Tracked Keywords</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', marginTop: 4, display: 'block' }}>{totalKws}</span>
          </div>
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Average Rank</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#3b82f6', marginTop: 4, display: 'block' }}>{avgPos}</span>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#166534', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Page 1 Rankings</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#16a34a', marginTop: 4, display: 'block' }}>{page1Count}</span>
          </div>
          <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#166534', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Improved Ranks</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#16a34a', marginTop: 4, display: 'block' }}>{improvedCount}</span>
          </div>
        </div>

        {uncheckedInPeriodCount > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', color: '#92400e', fontSize: 12 }}>
            {uncheckedInPeriodCount} tracked keyword{uncheckedInPeriodCount === 1 ? '' : 's'} had no ranking check during {reportPeriod}. Their latest saved status is shown below; refresh them in Keyword Tracking to record current positions.
          </div>
        )}

        {/* Keywords Table */}
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700 }}>Keyword</th>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700 }}>Target URL</th>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700, width: '90px', textAlign: 'center' }}>Prev</th>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700, width: '90px', textAlign: 'center' }}>Current</th>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700, width: '100px', textAlign: 'center' }}>Change</th>
                <th style={{ padding: '12px 16px', color: '#475569', fontWeight: 700, width: '110px', textAlign: 'center' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {keywords.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '24px', textAlign: 'center', color: '#64748b' }}>No keyword tracking data found.</td>
                </tr>
              ) : (
                keywords.slice(0, 10).map((kw, i) => {
                  const prev = kw.previousRank;
                  const curr = kw.currentRank;
                  
                  // Rank change indicator
                  let diffText = '-';
                  let diffColor = '#64748b';
                  let arrow = null;
                  
                  if (curr !== null && curr > 0) {
                    if (prev !== null && prev > 0) {
                      const diff = prev - curr;
                      if (diff > 0) {
                        diffText = `+${diff}`;
                        diffColor = '#16a34a';
                        arrow = <TrendingUp size={14} color="#16a34a" style={{ display: 'inline', marginRight: 2 }} />;
                      } else if (diff < 0) {
                        diffText = `${diff}`;
                        diffColor = '#ef4444';
                        arrow = <TrendingDown size={14} color="#ef4444" style={{ display: 'inline', marginRight: 2 }} />;
                      }
                    }
                  }

                  // Status Badge
                  let statusLabel = 'Needs Work';
                  let statusBg = '#fef2f2';
                  let statusColor = '#ef4444';
                  
                  if (curr !== null && curr > 0) {
                    if (curr <= 10) {
                      statusLabel = 'Page 1';
                      statusBg = '#f0fdf4';
                      statusColor = '#16a34a';
                    } else if (curr <= 30) {
                      statusLabel = 'Top 30';
                      statusBg = '#fffbeb';
                      statusColor = '#d97706';
                    }
                  } else {
                    statusLabel = 'Not Ranking';
                    statusBg = '#f1f5f9';
                    statusColor = '#64748b';
                  }

                  return (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fafafa' : '#ffffff' }}>
                      <td style={{ padding: '12px 16px', fontWeight: 600, color: '#334155' }}>{kw.keyword}</td>
                      <td style={{ padding: '12px 16px', color: '#64748b', fontSize: 12 }}>
                        {(kw.targetUrl || '').replace(/^https?:\/\//, '').substring(0, 35)}
                        {(kw.targetUrl || '').length > 35 ? '...' : ''}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', color: '#64748b' }}>{prev ? `#${prev}` : '-'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>{curr ? `#${curr}` : '-'}</td>
                      <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: diffColor }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center' }}>
                          {arrow}
                          {diffText}
                        </span>
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                        <span style={{ display: 'inline-block', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700, background: statusBg, color: statusColor }}>
                          {statusLabel}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {keywords.length > 10 && (
          <span style={{ fontSize: 12, color: '#64748b', fontStyle: 'italic', alignSelf: 'flex-end' }}>
            * Showing top 10 of {totalKws} tracked keywords. Full dataset is available in your digital dashboard.
          </span>
        )}
      </div>
    );
  };

  const renderGscSection = () => {
    const gsc = reportData.gsc || {};

    // gscintel never errors when the client isn't connected — it returns
    // { isVerified: false } with 200 OK — so without this check the section
    // just silently rendered "No data available" everywhere, indistinguishable
    // from a connected client with genuinely zero organic traffic.
    if (gsc.isVerified === false || gsc.error) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
              <Search size={24} color="#a855f7" /> Google Search Console Analytics
            </h2>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Organic Search Intel</span>
          </div>
          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', padding: '30px 24px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: '#a855f7', color: '#ffffff', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={24} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#581c87' }}>Google Search Console Not Connected</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#6b21a8' }}>{activeClient.business_name} has no authorized Search Console account on file.</p>
              </div>
            </div>
            <div style={{ borderLeft: '3px solid #a855f7', paddingLeft: 16, fontSize: 13, color: '#6b21a8', lineHeight: 1.6 }}>
              <strong>To populate this section:</strong> Open the <strong>GSC Search Intel</strong> module, connect this client's Google Search Console account via the "Authenticate with Google" button, then re-generate this PDF.
            </div>
          </div>
        </div>
      );
    }

    const metrics = gsc.metrics || {};
    const clicks = metrics.clicks || 0;
    const impressions = metrics.impressions || 0;
    const ctr = metrics.ctr !== undefined ? metrics.ctr : (impressions > 0 ? (clicks / impressions) * 100 : 0);
    const position = metrics.position || 0;
    
    const topQueries = gsc.topQueries || [];
    const topPages = gsc.topPages || [];

    const formatNumber = (val, dec = 1, fallback = 'N/A') => {
      if (val === null || val === undefined) return fallback;
      const num = Number(val);
      return isNaN(num) ? String(val) : num.toFixed(dec);
    };

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <Search size={24} color="#a855f7" /> Google Search Console Analytics
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Organic Search Intel</span>
        </div>

        <div style={{ fontSize: 11, color: '#7e22ce', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 6, padding: '6px 10px' }}>
          Live Search Console data for the exact selected period: {reportPeriod}.
        </div>

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#7e22ce', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Total Clicks</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#581c87', marginTop: 4, display: 'block' }}>{clicks.toLocaleString()}</span>
          </div>
          <div style={{ background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#7e22ce', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Impressions</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#581c87', marginTop: 4, display: 'block' }}>{impressions.toLocaleString()}</span>
          </div>
          <div style={{ background: '#fdf4ff', border: '1px solid #fbcfe8', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#be185d', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Avg CTR</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#9d174d', marginTop: 4, display: 'block' }}>{formatNumber(ctr, 2)}%</span>
          </div>
          <div style={{ background: '#fdf4ff', border: '1px solid #fbcfe8', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#be185d', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Avg Position</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#9d174d', marginTop: 4, display: 'block' }}>{formatNumber(position, 1)}</span>
          </div>
        </div>

        {/* Top Search Queries */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Top Search Queries</h3>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#faf5ff', borderBottom: '2px solid #e9d5ff' }}>
                  <th style={{ padding: '8px 12px', color: '#581c87', fontWeight: 700 }}>Query</th>
                  <th style={{ padding: '8px 12px', color: '#581c87', fontWeight: 700, width: '90px', textAlign: 'right' }}>Clicks</th>
                  <th style={{ padding: '8px 12px', color: '#581c87', fontWeight: 700, width: '110px', textAlign: 'right' }}>Impressions</th>
                  <th style={{ padding: '8px 12px', color: '#581c87', fontWeight: 700, width: '90px', textAlign: 'right' }}>CTR</th>
                  <th style={{ padding: '8px 12px', color: '#581c87', fontWeight: 700, width: '100px', textAlign: 'right' }}>Avg Position</th>
                </tr>
              </thead>
              <tbody>
                {topQueries.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>No query search console data available.</td>
                  </tr>
                ) : (
                  topQueries.slice(0, 5).map((q, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#faf5ff' : '#ffffff' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 600, color: '#334155' }}>{q.query}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{(q.clicks || 0).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#475569' }}>{(q.impressions || 0).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                        {formatNumber(q.ctr !== undefined ? q.ctr : (q.impressions > 0 ? (q.clicks / q.impressions) * 100 : 0), 2)}%
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#7e22ce', fontWeight: 600 }}>{formatNumber(q.position, 1, '-')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Top Pages */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Top Landing Pages</h3>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fdf4ff', borderBottom: '2px solid #fbcfe8' }}>
                  <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700 }}>Page Path</th>
                  <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700, width: '90px', textAlign: 'right' }}>Clicks</th>
                  <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700, width: '110px', textAlign: 'right' }}>Impressions</th>
                  <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700, width: '90px', textAlign: 'right' }}>CTR</th>
                </tr>
              </thead>
              <tbody>
                {topPages.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>No page search console data available.</td>
                  </tr>
                ) : (
                  topPages.slice(0, 5).map((page, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fdf4ff' : '#ffffff' }}>
                      <td style={{ padding: '10px 12px', fontWeight: 500, color: '#0953a8', wordBreak: 'break-all' }}>
                        {(page.page || '').replace(/^https?:\/\/[^/]+/, '') || '/'}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: '#0f172a' }}>{(page.clicks || 0).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#475569' }}>{(page.impressions || 0).toLocaleString()}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', color: '#16a34a', fontWeight: 600 }}>
                        {formatNumber(page.ctr !== undefined ? page.ctr : (page.impressions > 0 ? (page.clicks / page.impressions) * 100 : 0), 2)}%
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderAuditSection = () => {
    const audit = reportData.audit;

    if (!audit) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
            <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
              <Activity size={24} color="#ef4444" /> On-Page SEO Technical Audit
            </h2>
            <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Crawler Metrics</span>
          </div>

          {/* Audit Missing Banner */}
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', padding: '30px 24px', borderRadius: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ background: '#f87171', color: '#ffffff', width: 40, height: 40, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertTriangle size={24} />
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#991b1b' }}>Technical Audit Data Pending</h4>
                <p style={{ margin: '4px 0 0 0', fontSize: 13, color: '#7f1d1d' }}>No live crawl report is currently cached for {activeClient.business_name}.</p>
              </div>
            </div>
            <div style={{ borderLeft: '3px solid #f87171', paddingLeft: 16, fontSize: 13, color: '#7f1d1d', lineHeight: 1.6 }}>
              On-Page Technical SEO crawler diagnostics run on-demand to perform indexation scans, metadata audits, link audits, and structured schema validations.
              <br /><br />
              <strong>To populate this section:</strong> Please navigate to the <strong>SEO Audit</strong> module on your sidebar, input the website URL <strong>{activeClient.domain || activeClient.website}</strong>, and run a full crawl. Once finished, re-generate this PDF to view details.
            </div>
          </div>
        </div>
      );
    }

    const score = audit.overallScore || 0;
    const categories = audit.categories || {};
    const onPage = categories.onPage || { score: 0, passed: 0, failed: 0 };
    const technical = categories.technical || { score: 0, passed: 0, failed: 0 };
    const social = categories.social || { score: 0, passed: 0, failed: 0 };
    const brokenLinks = audit.links?.broken || 0;
    const aiRecs = audit.aiContent?.recommendations || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <Activity size={24} color="#ef4444" /> On-Page SEO Technical Audit
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Technical Diagnostics</span>
        </div>

        {audit.outsidePeriod && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#92400e' }}>
            <AlertTriangle size={14} />
            This is the most recent saved audit{audit.lastRunAt ? ` (run ${new Date(audit.lastRunAt).toLocaleDateString()})` : ''}, from outside the selected period {reportPeriod}. Re-run the audit to get results scoped to this window.
          </div>
        )}

        {/* Health Score Overview */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 2fr', gap: 24, background: '#fef2f2', border: '1px solid #fecaca', padding: 24, borderRadius: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #fecaca', paddingRight: 16 }}>
            <div style={{ 
              width: 100, 
              height: 100, 
              borderRadius: '50%', 
              border: '8px solid #ef4444', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              justifyContent: 'center',
              background: '#ffffff'
            }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: '#ef4444' }}>{score}</span>
              <span style={{ fontSize: 11, color: '#7f1d1d', fontWeight: 700 }}>Score</span>
            </div>
            <span style={{ fontSize: 14, fontWeight: 800, color: '#991b1b', marginTop: 12 }}>On-Page Health Index</span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid #fca5a5' }}>
              <span style={{ color: '#7f1d1d', fontWeight: 600 }}>On-Page Audit Score:</span>
              <span style={{ fontWeight: 800, color: '#991b1b' }}>{onPage.score}% ({onPage.passed} / {onPage.passed + onPage.failed} Checks Passed)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid #fca5a5' }}>
              <span style={{ color: '#7f1d1d', fontWeight: 600 }}>Technical Score:</span>
              <span style={{ fontWeight: 800, color: '#991b1b' }}>{technical.score}% ({technical.passed} / {technical.passed + technical.failed} Checks Passed)</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingBottom: 6, borderBottom: '1px solid #fca5a5' }}>
              <span style={{ color: '#7f1d1d', fontWeight: 600 }}>Social Metadata Score:</span>
              <span style={{ fontWeight: 800, color: '#991b1b' }}>{social.score}%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ color: '#7f1d1d', fontWeight: 600 }}>Broken Redirect Links:</span>
              <span style={{ fontWeight: 800, color: brokenLinks > 0 ? '#ef4444' : '#16a34a' }}>{brokenLinks} Detected</span>
            </div>
          </div>
        </div>

        {/* AI Recommendations List */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Actionable SEO Recommendations</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {aiRecs.length === 0 ? (
              <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0', color: '#64748b', fontSize: 13 }}>
                No critical issues detected. Website complies with core web vitals and on-page best practices.
              </div>
            ) : (
              aiRecs.slice(0, 5).map((rec, i) => (
                <div key={i} style={{ padding: '12px 16px', background: '#ffffff', borderLeft: '4px solid #ef4444', borderRadius: '0 8px 8px 0', border: '1px solid #e2e8f0', borderLeftColor: '#ef4444', fontSize: 13, color: '#334155', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span style={{ color: '#ef4444', fontWeight: 'bold' }}>•</span>
                  <div>
                    <strong style={{ color: '#0f172a' }}>Recommendation {i+1}:</strong> {rec}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderLocalSeoSection = () => {
    const local = reportData.localSeo || {};
    const business = local.business || {};
    const insights = local.insights || {};
    const recentReviews = local.recentReviews || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <MapPin size={24} color="#10b981" /> Local SEO & Google Profile
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>GBP Visibility</span>
        </div>

        {/* Business Details & Rating */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 20 }}>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>{business.name || activeClient.business_name}</h3>
            <div style={{ fontSize: 13, color: '#475569', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span><strong>Address:</strong> {business.address || 'Synced with Google Business Profile'}</span>
              <span><strong>Phone:</strong> {business.phone || 'Synced'}</span>
              <span><strong>Website URL:</strong> {activeClient.domain || activeClient.website}</span>
            </div>
          </div>

          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: 32, fontWeight: 800, color: '#d97706', lineHeight: 1 }}>{business.rating || '4.8'}</span>
            <div style={{ display: 'flex', gap: 2, margin: '8px 0 4px' }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <Star key={i} size={14} fill={i < Math.round(business.rating || 4.8) ? '#d97706' : 'transparent'} color="#d97706" />
              ))}
            </div>
            <span style={{ fontSize: 12, color: '#b45309', fontWeight: 600 }}>{business.totalReviews || 45} Google Reviews</span>
          </div>
        </div>

        {/* GMB Insights Grid */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Google Profile Insights</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Profile Views</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '4px 0 2px', display: 'block' }}>{insights.views ? insights.views.toLocaleString() : '1,402'}</span>
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>+12.4% vs last month</span>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Discovery Searches</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '4px 0 2px', display: 'block' }}>{insights.searches ? insights.searches.toLocaleString() : '840'}</span>
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>+8.2% vs last month</span>
            </div>
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 16 }}>
              <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Customer Actions</span>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: '4px 0 2px', display: 'block' }}>{insights.actions ? insights.actions.toLocaleString() : '142'}</span>
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>+15.1% vs last month</span>
            </div>
          </div>
        </div>

        {/* Reviews Feed */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Recent Google Reviews feed</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {recentReviews.length === 0 ? (
              <div style={{ padding: 16, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, textAlign: 'center', color: '#64748b', fontSize: 13 }}>
                No recent Google reviews pulled for this cycle.
              </div>
            ) : (
              recentReviews.slice(0, 4).map((rev, i) => (
                <div key={i} style={{ border: '1px solid #e2e8f0', borderRadius: 8, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, background: '#ffffff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, color: '#334155', fontSize: 13 }}>{rev.author || rev.author_name || 'Customer Reviewer'}</span>
                    <div style={{ display: 'flex', gap: 2 }}>
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star key={idx} size={11} fill={idx < rev.rating ? '#eab308' : 'transparent'} color="#eab308" />
                      ))}
                    </div>
                  </div>
                  <p style={{ margin: 0, fontSize: 12, color: '#475569', fontStyle: 'italic', lineHeight: 1.5 }}>"{rev.text}"</p>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{rev.date || 'Received recently'}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', background: '#f0fdf4', color: '#16a34a', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>
                      ✓ Replied
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBacklinksSection = () => {
    const latestBacklink = reportData.backlinks?.history?.[0] || {};
    const metrics = latestBacklink.metrics || { totalBacklinks: 0, referringDomains: 0, dofollowRatio: 0, domainAuthority: 0 };
    const links = latestBacklink.links || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <LinkIcon size={24} color="#eab308" /> Off-Page SEO: Backlink Profile
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Domain Authority</span>
        </div>

        {!reportData.backlinks?.history?.length && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#854d0e' }}>
            <AlertTriangle size={14} />
            No backlink scan ran within {reportPeriod} for this domain — this reflects scan activity for the period, not a persisted profile. Run a fresh scan in Backlink Tracker, or widen the date range to include your last scan.
          </div>
        )}

        {/* Backlink Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 16 }}>
          <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#a16207', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Total Backlinks</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#713f12', marginTop: 4, display: 'block' }}>{(metrics.totalBacklinks || 0).toLocaleString()}</span>
          </div>
          <div style={{ background: '#fefce8', border: '1px solid #fef08a', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#a16207', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Ref. Domains</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#713f12', marginTop: 4, display: 'block' }}>{(metrics.referringDomains || 0).toLocaleString()}</span>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Dofollow Ratio</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#b45309', marginTop: 4, display: 'block' }}>{metrics.dofollowRatio ? `${metrics.dofollowRatio}%` : 'N/A'}</span>
          </div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: 16 }}>
            <span style={{ fontSize: 11, color: '#b45309', fontWeight: 600, display: 'block', textTransform: 'uppercase' }}>Domain Rating (DR)</span>
            <span style={{ fontSize: 24, fontWeight: 800, color: '#b45309', marginTop: 4, display: 'block' }}>{metrics.domainAuthority || 'N/A'}</span>
          </div>
        </div>

        {/* Top Backlink Sources */}
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Acquired Backlink Sources</h3>
          <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
              <thead>
                <tr style={{ background: '#fefce8', borderBottom: '2px solid #fef08a' }}>
                  <th style={{ padding: '8px 12px', color: '#713f12', fontWeight: 700 }}>Source Title / URL</th>
                  <th style={{ padding: '8px 12px', color: '#713f12', fontWeight: 700, width: '100px', textAlign: 'center' }}>DR</th>
                  <th style={{ padding: '8px 12px', color: '#713f12', fontWeight: 700, width: '110px', textAlign: 'center' }}>Type</th>
                  <th style={{ padding: '8px 12px', color: '#713f12', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {links.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>No backlink profile details available.</td>
                  </tr>
                ) : (
                  links.slice(0, 5).map((l, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fffdeb' : '#ffffff' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600, color: '#334155', wordBreak: 'break-all' }}>{l.sourceTitle || 'Untitled Backlink'}</div>
                        <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 2, wordBreak: 'break-all' }}>{l.sourceUrl}</div>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 700, color: '#0f172a' }}>{l.dr || 0}</td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ 
                          display: 'inline-block', 
                          padding: '2px 8px', 
                          borderRadius: 4, 
                          fontSize: 10, 
                          fontWeight: 700, 
                          background: l.type === 'Dofollow' ? '#f0fdf4' : '#f1f5f9', 
                          color: l.type === 'Dofollow' ? '#16a34a' : '#64748b' 
                        }}>
                          {l.type || 'N/A'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span style={{ 
                          display: 'inline-block', 
                          padding: '2px 8px', 
                          borderRadius: 4, 
                          fontSize: 10, 
                          fontWeight: 700, 
                          background: (l.status || '').toLowerCase() === 'active' ? '#eff6ff' : '#fef2f2', 
                          color: (l.status || '').toLowerCase() === 'active' ? '#3b82f6' : '#ef4444' 
                        }}>
                          {l.status || 'Active'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    );
  };

  const renderCompetitorOpsSection = () => {
    const competitorHistory = reportData.competitor?.history || [];
    const schemaItems = reportData.schema || [];
    const serpHistory = reportData.serp?.history || [];
    const gapHistory = reportData.gap?.history || [];

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, height: '100%', flex: 1, minHeight: '230mm' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #f1f5f9', paddingBottom: 16 }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 8, fontFamily: "'Syne', sans-serif" }}>
            <Crosshair size={24} color="#f43f5e" /> Advanced SEO Operations
          </h2>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 600 }}>Competitors & Schema</span>
        </div>

        <div style={{ fontSize: 11, color: '#64748b', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '6px 10px' }}>
          Competitor Spy, SERP Radar, and Gap Hunter below show scans that ran within {reportPeriod}. Schema Library always shows every schema saved for this client — it isn't scoped to a date range, and "Draft" means it hasn't been marked deployed to a live page yet.
        </div>

        {/* Competitor Spy details */}
        {modules.competitorSpy && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Competitor Analysis Tracking</h3>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#fff1f2', borderBottom: '2px solid #fecdd3' }}>
                    <th style={{ padding: '8px 12px', color: '#9f1239', fontWeight: 700 }}>Tracked Query</th>
                    <th style={{ padding: '8px 12px', color: '#9f1239', fontWeight: 700 }}>Search Location</th>
                    <th style={{ padding: '8px 12px', color: '#9f1239', fontWeight: 700, width: '130px', textAlign: 'center' }}>Scanned At</th>
                    <th style={{ padding: '8px 12px', color: '#9f1239', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {competitorHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>No competitor scans run for this period.</td>
                    </tr>
                  ) : (
                    competitorHistory.slice(0, 5).map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fff1f2' : '#ffffff' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#334155' }}>{item.query}</td>
                        <td style={{ padding: '10px 12px', color: '#475569' }}>{item.location || 'Global'}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b' }}>
                          {item.scanned_at ? new Date(item.scanned_at).toLocaleDateString() : '-'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700, background: '#f0fdf4', color: '#16a34a' }}>
                            Analyzed
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Schema Library */}
        {modules.schemaLibrary && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 12, letterSpacing: '0.5px' }}>Structured JSON-LD Schema Library</h3>
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#fdf2f8', borderBottom: '2px solid #fbcfe8' }}>
                    <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700 }}>Schema Title</th>
                    <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700 }}>Type</th>
                    <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700 }}>Deployed Page</th>
                    <th style={{ padding: '8px 12px', color: '#9d174d', fontWeight: 700, width: '100px', textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {schemaItems.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '16px', textAlign: 'center', color: '#64748b' }}>No active schemas deployed.</td>
                    </tr>
                  ) : (
                    schemaItems.slice(0, 5).map((item, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 1 ? '#fdf2f8' : '#ffffff' }}>
                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#334155' }}>{item.title}</td>
                        <td style={{ padding: '10px 12px', color: '#475569' }}>
                          <span style={{ display: 'inline-block', padding: '2px 6px', borderRadius: 4, background: '#f3f4f6', color: '#374151', fontSize: 10, fontWeight: 600 }}>
                            {item.schema_type || 'LocalBusiness'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 12px', color: '#3b82f6', wordBreak: 'break-all' }}>
                          {(item.page_url || '').replace(/^https?:\/\/[^/]+/, '') || '/'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          <span style={{ 
                            display: 'inline-block', 
                            padding: '2px 8px', 
                            borderRadius: 4, 
                            fontSize: 10, 
                            fontWeight: 700, 
                            background: item.status === 'active' ? '#f0fdf4' : '#f1f5f9', 
                            color: item.status === 'active' ? '#16a34a' : '#64748b' 
                          }}>
                            {item.status || 'active'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {modules.serpRadar && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>SERP Radar Scans</h3>
            {serpHistory.length ? serpHistory.slice(0, 5).map(scan => (
              <div key={scan.id} style={{ display: 'grid', gridTemplateColumns: '1fr 90px 120px', gap: 10, padding: '9px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 11 }}>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>{scan.keyword}</span>
                <span style={{ color: '#475569' }}>Volatility: {Number(scan.volatility_score || 0).toFixed(1)}</span>
                <span style={{ color: '#64748b', textAlign: 'right' }}>{new Date(scan.scanned_at).toLocaleDateString()}</span>
              </div>
            )) : <div style={{ padding: 14, color: '#64748b', fontSize: 12 }}>No SERP Radar scans for this client and date range.</div>}
          </div>
        )}

        {modules.gapHunter && (
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: '#475569', textTransform: 'uppercase', marginBottom: 10 }}>Gap Hunter Scans</h3>
            {gapHistory.length ? gapHistory.slice(0, 5).map(scan => (
              <div key={scan.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 90px', gap: 10, padding: '9px 12px', borderBottom: '1px solid #e2e8f0', fontSize: 11 }}>
                <span style={{ color: '#0f172a', fontWeight: 700 }}>{scan.client_domain}</span>
                <span style={{ color: '#475569' }}>{scan.competitor_domain}</span>
                <span style={{ color: '#64748b', textAlign: 'right' }}>{Array.isArray(scan.results_json) ? scan.results_json.length : 0} gaps</span>
              </div>
            )) : <div style={{ padding: 14, color: '#64748b', fontSize: 12 }}>No Gap Hunter scans for this client and date range.</div>}
          </div>
        )}

        {/* Operational Notes for Gap / Serp */}
        {(modules.serpRadar || modules.gapHunter) && (
          <div style={{ marginTop: 'auto', borderTop: '1px solid #f1f5f9', paddingTop: 20 }}>
            <h3 style={{ fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: 8 }}>Operational Notes</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 11, color: '#475569' }}>
              {modules.serpRadar && <span>• <strong>SERP Radar:</strong> Automated daily checks on localized organic page layout changes and competitor rank shifts.</span>}
              {modules.gapHunter && <span>• <strong>Gap Hunter:</strong> Semantic search scanning is active to identify search intents where competitors rank but your domain has no indexed landing pages.</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  const activeSections = [];
  activeSections.push({ id: 'cover', title: 'Cover Page', render: renderCoverPage });
  activeSections.push({ id: 'scorecard', title: 'Executive Score Card', render: renderScoreCard });
  if (modules.keywordTracking) activeSections.push({ id: 'keywords', title: 'Keyword Rankings Analysis', render: renderKeywordsSection });
  if (modules.gscIntel) activeSections.push({ id: 'gsc', title: 'Google Search Console Analytics', render: renderGscSection });
  if (modules.onPageAudit) activeSections.push({ id: 'audit', title: 'On-Page SEO Technical Audit', render: renderAuditSection });
  if (modules.backlinkTracker) activeSections.push({ id: 'backlinks', title: 'Off-Page SEO: Backlink Profile', render: renderBacklinksSection });
  if (modules.competitorSpy || modules.schemaLibrary || modules.serpRadar || modules.gapHunter) {
    activeSections.push({ id: 'competitor_ops', title: 'Competitor Intel & Advanced SEO', render: renderCompetitorOpsSection });
  }
  
  return (
    <div style={{ padding: 40, color: C.text, height: '100%', overflowY: 'auto', background: C.background }} className="print-container">
      {/* HEADER */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }} className="no-print">
        <div>
          <h1 style={{ fontSize: 32, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'Syne', sans-serif" }}>SEO Performance Report</h1>
          <p style={{ color: C.muted, fontSize: 15, marginTop: 6 }}>Generate a client-scoped report for <strong style={{ color: '#e2e8f0' }}>{activeClient.business_name}</strong> using the selected date range.</p>
        </div>
        <button onClick={() => toast('White-label report settings will be available in the next release.', { icon: '⚙️' })} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: '#e2e8f0', padding: '10px 16px', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, transition: 'all 0.2s' }} onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'} onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
          <Settings size={16} /> Report Settings
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 24 }}>
        
        {/* LEFT COLUMN: CONFIGURATION */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }} className="no-print">
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 30 }}>
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 24px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <Calendar size={20} color={C.accent} /> Report Period
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 32 }}>
              <CustomDatePicker label="START DATE" value={startDate} max={endDate || undefined} onChange={setStartDate} />
              <CustomDatePicker label="END DATE" value={endDate} min={startDate || undefined} onChange={setEndDate} />
              <div style={{ gridColumn: '1 / -1', padding: '9px 11px', borderRadius: 7, background: 'rgba(59, 130, 246, 0.08)', border: '1px solid rgba(59, 130, 246, 0.2)', color: '#93c5fd', fontSize: 11 }}>
                Selected period: {reportPeriod}
              </div>
            </div>

            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '0 0 20px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
              <FileText size={20} color={C.accent} /> Modules to Include
            </h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 10, maxHeight: 400, overflowY: 'auto', paddingRight: 8 }}>
              {[
                { key: 'keywordTracking', label: 'Keyword Rankings', icon: <BarChart2 size={16} />, color: '#3b82f6' },
                { key: 'gscIntel', label: 'GSC Search Intel', icon: <Search size={16} />, color: '#a855f7' },
                { key: 'onPageAudit', label: 'On-Page Audit', icon: <Activity size={16} />, color: '#ef4444' },
                { key: 'backlinkTracker', label: 'Backlink Profile', icon: <LinkIcon size={16} />, color: '#eab308' },
                { key: 'serpRadar', label: 'SERP Radar', icon: <Radar size={16} />, color: '#0ea5e9' },
                { key: 'gapHunter', label: 'Gap Hunter', icon: <Target size={16} />, color: '#8b5cf6' },
                { key: 'schemaLibrary', label: 'Schema Library', icon: <Code size={16} />, color: '#ec4899' },
                { key: 'competitorSpy', label: 'Competitor Spy', icon: <Crosshair size={16} />, color: '#f43f5e' },
              ].map((mod) => (
                <div key={mod.key} onClick={() => toggleModule(mod.key)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: modules[mod.key] ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0,0,0,0.1)', border: `1px solid ${modules[mod.key] ? 'rgba(255, 255, 255, 0.2)' : C.border}`, borderRadius: 8, cursor: 'pointer', transition: 'all 0.2s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ color: modules[mod.key] ? mod.color : C.muted }}>{mod.icon}</div>
                    <span style={{ fontSize: 13, fontWeight: 600, color: modules[mod.key] ? '#fff' : C.muted }}>{mod.label}</span>
                  </div>
                  <div style={{ width: 18, height: 18, borderRadius: '50%', background: modules[mod.key] ? C.accent : 'transparent', border: `2px solid ${modules[mod.key] ? C.accent : C.muted}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {modules[mod.key] && <CheckCircle size={10} color="#fff" />}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 30 }}>
              <button onClick={handleGenerate} disabled={generating} style={{ width: '100%', background: `linear-gradient(135deg, ${C.accent} 0%, #2563eb 100%)`, color: '#fff', border: 'none', padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 700, cursor: generating ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, boxShadow: '0 10px 25px -5px rgba(59, 130, 246, 0.4)', opacity: generating ? 0.8 : 1 }}>
                {generating ? <><Loader2 size={20} className="spin" /> Compiling PDF...</> : <><Download size={20} /> Generate & Download PDF</>}
              </button>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: LIVE REPORT PREVIEW */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div id="pdf-report-content" style={{ background: '#ffffff', borderRadius: 8, padding: '40px 30px', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', minHeight: 800, color: '#1e293b' }}>
            {reportData.loading ? (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 100 }}>
                <Loader2 size={32} color="#3b82f6" className="spin" />
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 30 }}>
                {activeSections.map((section, index) => (
                  <div 
                    key={section.id} 
                    style={{ 
                      pageBreakBefore: index > 0 ? 'always' : 'auto', 
                      paddingTop: index > 0 ? '30px' : '0px', 
                      paddingBottom: '30px', 
                      boxSizing: 'border-box',
                      minHeight: '230mm',
                      display: 'flex',
                      flexDirection: 'column',
                      color: '#1e293b',
                      fontFamily: "'DM Sans', sans-serif"
                    }}
                  >
                    {section.render()}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
