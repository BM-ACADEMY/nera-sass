import React, { useState, useEffect, useCallback } from 'react';
import SopModal from '../../components/common/SopModal.jsx';
import { C } from '../../constants/theme.js';
import { ShieldAlert, Loader2, AlertTriangle, TrendingDown, ArrowDownRight, Activity, Clock, CheckCircle, History, ChevronDown, ChevronUp, X } from 'lucide-react';
import { api } from '../../services/api.js';
import { useClient } from '../../contexts/ClientContext.jsx';
import toast from 'react-hot-toast';

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', color: '#ef4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.25)' },
  warning:  { label: 'Warning',  color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.25)' },
  info:     { label: 'Info',     color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.25)' },
};

export default function RankDropAlert() {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [filterTab, setFilterTab] = useState('all'); // all | critical | warning | info
  const [acknowledgeModal, setAcknowledgeModal] = useState(null); // alert obj
  const [noteText, setNoteText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const { activeClient } = useClient();
  const [rankDomain, setRankDomain] = useState('');
  const [rankKeywords, setRankKeywords] = useState('');
  const [rankChecking, setRankChecking] = useState(false);
  const [rankResult, setRankResult] = useState(null);

  useEffect(() => {
    const website = activeClient?.website_url || activeClient?.website || activeClient?.domain || '';
    setRankDomain(String(website).replace(/^https?:\/\//, '').replace(/\/$/, ''));
    setRankResult(null);
  }, [activeClient]);

  const checkDomainRank = async (event) => {
    event?.preventDefault();
    if (!rankDomain.trim()) return toast.error('Enter a domain name');
    setRankChecking(true); setRankResult(null);
    try {
      const keywordList = rankKeywords.split(/[,\n]/).map(k => k.trim()).filter(Boolean).slice(0, 5);
      setRankResult(await api.post('/thedal/rankdropalert/check-rank', { domain: rankDomain.trim(), keywords: keywordList, trackingClientId: activeClient?.gmb_client_id || null, thedalClientId: activeClient?.id || null }));
    }
    catch (error) { toast.error(error.message || 'Rank check failed'); }
    finally { setRankChecking(false); }
  };

  const fetchAlerts = useCallback(async () => {
    if (!activeClient) return;
    setLoading(true);
    try {
      const clientParam = encodeURIComponent(activeClient.business_name || activeClient.client_name);
      const trackingClientId = activeClient.gmb_client_id || '';
      const res = await api.get(`/thedal/rankdropalert?client=${clientParam}&client_id=${activeClient.id}&tracking_client_id=${trackingClientId}`);
      if (res) setData(res);
    } catch (err) {
      console.error('Failed to load alerts', err);
    } finally {
      setLoading(false);
    }
  }, [activeClient]);

  useEffect(() => {
    fetchAlerts();
    setShowHistory(false);
    setFilterTab('all');
  }, [fetchAlerts]);

  const fetchHistory = async () => {
    if (!activeClient) return;
    setHistoryLoading(true);
    try {
      const clientParam = encodeURIComponent(activeClient.business_name || activeClient.client_name);
      const res = await api.get(`/thedal/rankdropalert/history?client=${clientParam}`);
      if (res) setHistory(res.history || []);
    } catch (err) {
      console.error('Failed to load history', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleHistory = () => {
    const next = !showHistory;
    setShowHistory(next);
    if (next && history.length === 0) fetchHistory();
  };

  const openAcknowledgeModal = (alert) => {
    setAcknowledgeModal(alert);
    setNoteText('');
  };

  const handleConfirmAcknowledge = async () => {
    if (!acknowledgeModal) return;
    setIsSaving(true);
    try {
      await api.put(`/thedal/rankdropalert/${acknowledgeModal.id}/acknowledge`, { note: noteText });
      toast.success('Alert acknowledged and saved!');
      setAcknowledgeModal(null);
      setNoteText('');
      fetchAlerts(); // Refresh active alerts
    } catch (err) {
      toast.error('Failed to acknowledge. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!activeClient) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.bg, color: C.muted }}>
        <ShieldAlert size={48} style={{ opacity: 0.2, marginBottom: 16 }} />
        <p>Please select a client from the sidebar to view Rank Drop Alerts.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', background: C.bg }}>
        <Loader2 size={32} color={C.accent} className="spin" />
      </div>
    );
  }

  const summary = data?.summary || { total_alerts: 0, critical_drops: 0, total_traffic_risk: 0 };
  const allAlerts = data?.alerts || [];
  const tracking = data?.tracking;
  const trackingGuidance = !activeClient.gmb_client_id
    ? 'Keyword Tracking is not mapped to this client. Map a GMB client first.'
    : tracking?.tracked_keywords === 0
      ? 'No tracked keywords found. Add keywords in Keyword Tracking first.'
      : tracking?.comparable_keywords === 0
        ? 'Rank monitoring needs two checks. Refresh the tracked keywords again later to create a comparison.'
        : null;
  const filteredAlerts = filterTab === 'all' ? allAlerts : allAlerts.filter(a => a.severity === filterTab);

  const tabs = [
    { key: 'all',      label: 'All Alerts',  count: allAlerts.length },
    { key: 'critical', label: '🔴 Critical',  count: allAlerts.filter(a => a.severity === 'critical').length },
    { key: 'warning',  label: '🟡 Warning',   count: allAlerts.filter(a => a.severity === 'warning').length },
    { key: 'info',     label: '🔵 Info',      count: allAlerts.filter(a => a.severity === 'info').length },
  ];

  return (
    <div style={{ padding: 30, color: C.text, height: '100%', overflowY: 'auto', background: C.bg }}>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 30 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', margin: 0, fontFamily: "'Syne', sans-serif" }}>Rank Drop Alert</h1><SopModal /></div>
          <p style={{ color: C.muted, fontSize: 14, marginTop: 4 }}>
            Monitoring search ranking fluctuations for <strong style={{ color: '#fff' }}>{activeClient.business_name || activeClient.client_name}</strong>.
          </p>
        </div>
        <button
          onClick={toggleHistory}
          style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${C.border}`, padding: '8px 14px', borderRadius: 8, color: C.muted, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
        >
          <History size={14} />
          Alert History
          {showHistory ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      <form onSubmit={checkDomainRank} style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, padding: 18, marginBottom: 24, boxShadow: 'inset 3px 0 0 rgba(249,115,22,.85)' }}>
        <div style={{ marginBottom: 13 }}><h3 style={{ margin: 0, color: C.text, fontSize: 15, fontWeight: 700 }}>Domain Rank Drop Check</h3><p style={{ margin: '5px 0 0', color: C.muted, fontSize: 12, lineHeight: 1.5 }}>Leave keywords blank to compare positions already tracked for a CRM client. Or type up to 5 keywords to live-check <strong>any</strong> domain — including ones with no Keyword Tracking record — and we'll save each check so the next one can detect a drop.</p></div>
        <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 1fr) auto', gap: 10 }}>
          <div>
            <label htmlFor="rank-drop-domain" style={{ display: 'block', color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 5 }}>Website domain</label>
            <input id="rank-drop-domain" value={rankDomain} onChange={event => setRankDomain(event.target.value)} placeholder="e.g. bmtechx.in" style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 13px', fontSize: 13, lineHeight: '20px', outline: 'none' }} />
          </div>
          <button type="submit" disabled={rankChecking} style={{ alignSelf: 'end', minHeight: 42, background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', border: 0, borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 700, cursor: rankChecking ? 'wait' : 'pointer', opacity: rankChecking ? 0.7 : 1 }}>{rankChecking ? 'Checking...' : 'Check domain'}</button>
        </div>
        <div style={{ marginTop: 10 }}>
          <label htmlFor="rank-drop-keywords" style={{ display: 'block', color: C.muted, fontSize: 9, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 5 }}>Keywords to check (optional, comma separated, up to 5)</label>
          <input id="rank-drop-keywords" value={rankKeywords} onChange={event => setRankKeywords(event.target.value)} placeholder="e.g. best exporters directory, b2b marketplace india" style={{ width: '100%', boxSizing: 'border-box', background: '#0f172a', color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 13px', fontSize: 13, lineHeight: '20px', outline: 'none' }} />
        </div>
        {rankResult && <div style={{ marginTop: 14 }}>
          {rankResult.mappingCorrected && <div style={{ padding: '10px 12px', marginBottom: 10, borderRadius: 8, background: 'rgba(59,130,246,.08)', border: '1px solid rgba(59,130,246,.3)', color: '#93c5fd', fontSize: 12 }}>Using the selected client's mapped domain <b>{rankResult.domain}</b>. You entered {rankResult.requestedDomain}.</div>}

          {rankResult.mode === 'live-check' && rankResult.results?.length > 0 && <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
            {rankResult.results.map(r => <div key={r.keyword} style={{ padding: 14, borderRadius: 9, background: 'rgba(255,255,255,0.03)', border: `1px solid ${C.border}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: 13 }}>{r.keyword}</span>
                <span style={{ color: C.muted, fontSize: 12 }}>
                  {r.isNew
                    ? <>Live position now: <b style={{ color: '#fff' }}>{r.found ? `#${r.newRank}` : 'not in top 100'}</b> <span style={{ opacity: 0.7 }}>(first check — saved for next time)</span></>
                    : <>Position: <b style={{ color: '#fff' }}>{r.oldRank ? `#${r.oldRank}` : 'not in top 100'}</b> {'→'} <b style={{ color: r.hasDrop ? '#f87171' : '#4ade80' }}>{r.found ? `#${r.newRank}` : 'not in top 100'}</b></>}
                </span>
              </div>
              {(r.rankReasons?.length > 0 || r.rankSuggestions?.length > 0) && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 12 }}>
                <div><b style={{ color: '#fbbf24', fontSize: 12 }}>Why it's at this position</b><ul style={{ color: C.muted, margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>{r.rankReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
                <div><b style={{ color: '#60a5fa', fontSize: 12 }}>How to move toward #1-2</b><ol style={{ color: C.muted, margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>{r.rankSuggestions.map(suggestion => <li key={suggestion}>{suggestion}</li>)}</ol></div>
              </div>}
            </div>)}
          </div>}

          {rankResult.trackedKeywords === 0 ? <div style={{ padding: 14, borderRadius: 9, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)' }}><b style={{ color: '#fbbf24' }}>{rankResult.noMatchingClient ? 'No matching client for this domain' : rankResult.setupRequired ? 'Keyword Tracking setup required' : 'No tracked keywords found'}</b><div style={{ color: C.muted, marginTop: 5 }}>{rankResult.setupMessage || 'Add keywords for this domain in Keyword Tracking, run the first rank check, then run another check later to create a comparison.'}</div></div>
            : rankResult.comparableKeywords === 0 ? <div style={{ padding: 14, borderRadius: 9, background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.3)' }}><b style={{ color: '#fbbf24' }}>First check recorded</b><div style={{ color: C.muted, marginTop: 5 }}>{rankResult.mode === 'live-check' ? `Saved the current live position for ${rankResult.trackedKeywords} keyword(s) above. Run this same domain + keyword(s) again later (after real ranking movement) to see a drop here.` : `${rankResult.trackedKeywords} keyword(s) are tracked, but each keyword needs a previous and current position. Refresh Keyword Tracking again later.`}</div></div>
              : !rankResult.hasDrop ? <div style={{ padding: 14, borderRadius: 9, background: 'rgba(34,197,94,.08)', border: '1px solid rgba(34,197,94,.3)' }}><b style={{ color: '#4ade80', fontSize: 17 }}>No rank drop detected</b><div style={{ color: C.muted, marginTop: 5 }}>Compared {rankResult.comparableKeywords} keyword(s) for {rankResult.domain}. All are stable or improved since the previous check.</div></div>
                : <div style={{ display: 'grid', gap: 12 }}>
                  <div style={{ padding: 14, borderRadius: 9, background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.3)' }}><b style={{ color: '#f87171', fontSize: 17 }}>{rankResult.drops.length} rank drop(s) detected</b><div style={{ color: C.muted, marginTop: 5 }}>Compared {rankResult.comparableKeywords} tracked keyword(s) for {rankResult.domain}. Review the affected keywords below.</div></div>
                  {rankResult.drops.map(drop => <div key={drop.keyword} style={{ background: C.bg, border: `1px solid ${SEVERITY_CONFIG[drop.severity]?.border || C.border}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}><b style={{ color: '#fff' }}>{drop.keyword}</b><span style={{ color: SEVERITY_CONFIG[drop.severity]?.color || '#f59e0b', fontWeight: 700 }}>Position {drop.oldRank ?? 'N/A'} to {drop.found === false ? 'not in top 100' : drop.newRank} (down {drop.dropAmount})</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18, marginTop: 12 }}>
                      <div><b style={{ color: '#fbbf24', fontSize: 12 }}>Possible reasons (not confirmed by Google)</b><ul style={{ color: C.muted, margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>{drop.possibleReasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>
                      <div><b style={{ color: '#60a5fa', fontSize: 12 }}>Recommended solution</b><ol style={{ color: C.muted, margin: '7px 0 0', paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>{drop.solutions.map(solution => <li key={solution}>{solution}</li>)}</ol></div>
                    </div>
                    {drop.lastChecked && <div style={{ color: C.muted, fontSize: 11, marginTop: 9 }}>Last rank check: {new Date(drop.lastChecked).toLocaleString()}</div>}
                  </div>)}
                </div>}
          <div style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Analysis checked {new Date(rankResult.checkedAt).toLocaleString()}. A drop is detected only when the current numeric position is worse than the previous position.</div>
        </div>}
      </form>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 28 }}>
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'rgba(234,179,8,0.1)', padding: 9, borderRadius: 10 }}>
              <TrendingDown size={18} color="#eab308" />
            </div>
            <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>Total Keywords Dropped</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: '#fff' }}>{summary.total_alerts}</div>
        </div>

        <div style={{ background: summary.critical_drops > 0 ? 'rgba(239,68,68,0.06)' : C.surface, border: `1px solid ${summary.critical_drops > 0 ? 'rgba(239,68,68,0.3)' : C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'rgba(239,68,68,0.1)', padding: 9, borderRadius: 10 }}>
              <AlertTriangle size={18} color="#ef4444" />
            </div>
            <span style={{ color: summary.critical_drops > 0 ? '#fca5a5' : C.muted, fontSize: 13, fontWeight: 600 }}>Critical Drops (Off Page 1)</span>
          </div>
          <div style={{ fontSize: 34, fontWeight: 800, color: summary.critical_drops > 0 ? '#ef4444' : '#fff' }}>{summary.critical_drops}</div>
        </div>

        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 22 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ background: 'rgba(59,130,246,0.1)', padding: 9, borderRadius: 10 }}>
              <Activity size={18} color="#3b82f6" />
            </div>
            <span style={{ color: C.muted, fontSize: 13, fontWeight: 600 }}>Est. Traffic at Risk</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 800, color: '#fff' }}>{(Number(summary.total_traffic_risk) || 0).toLocaleString()}</span>
            <span style={{ color: C.muted, fontSize: 13, fontWeight: 600, marginBottom: 5 }}>visits/mo</span>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilterTab(tab.key)}
            style={{
              background: filterTab === tab.key ? C.accent : 'transparent',
              border: `1px solid ${filterTab === tab.key ? C.accent : C.border}`,
              color: filterTab === tab.key ? '#fff' : C.muted,
              padding: '7px 14px',
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
            <span style={{ background: filterTab === tab.key ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.08)', padding: '1px 7px', borderRadius: 20, fontSize: 11 }}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Active Alerts Table */}
      <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, marginBottom: 28, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.15)' }}>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>SEVERITY</th>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>KEYWORD / URL</th>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>RANK CHANGE</th>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>SEARCH VOL</th>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>TRAFFIC RISK</th>
              <th style={{ padding: '14px 20px', color: C.muted, fontSize: 12, fontWeight: 700, textAlign: 'right' }}>ACTION</th>
            </tr>
          </thead>
          <tbody>
            {filteredAlerts.length > 0 ? filteredAlerts.map((alert) => {
              const sev = SEVERITY_CONFIG[alert.severity] || SEVERITY_CONFIG.info;
              return (
                <tr key={alert.id} style={{ borderBottom: `1px solid ${C.border}55` }}>
                  <td style={{ padding: '18px 20px' }}>
                    <span style={{ background: sev.bg, border: `1px solid ${sev.border}`, color: sev.color, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {sev.label}
                    </span>
                  </td>

                  <td style={{ padding: '18px 20px' }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>{alert.keyword}</div>
                    <div style={{ fontSize: 12, color: C.accent, marginTop: 3 }}>{activeClient.domain}{alert.url}</div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={11} />
                      {new Date(alert.date_detected).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </div>
                  </td>

                  <td style={{ padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ background: 'rgba(255,255,255,0.06)', border: `1px solid ${C.border}`, padding: '5px 10px', borderRadius: 8, fontSize: 15, fontWeight: 700, color: C.muted }}>
                        #{alert.old_rank}
                      </div>
                      <ArrowDownRight size={16} color="#ef4444" />
                      <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', padding: '5px 10px', borderRadius: 8, fontSize: 15, fontWeight: 800, color: '#fca5a5' }}>
                        #{alert.new_rank}
                      </div>
                      <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>▼ {alert.drop_amount}</span>
                    </div>
                  </td>

                  <td style={{ padding: '18px 20px', fontSize: 14, color: '#e2e8f0', fontWeight: 500 }}>
                    {(Number(alert.search_volume) || 0).toLocaleString()}
                  </td>

                  <td style={{ padding: '18px 20px' }}>
                    <div style={{ fontSize: 15, fontWeight: 700, color: alert.severity === 'critical' ? '#fca5a5' : '#e2e8f0' }}>
                      ~{(Number(alert.traffic_risk) || 0).toLocaleString()}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted }}>lost visits</div>
                  </td>

                  <td style={{ padding: '18px 20px', textAlign: 'right' }}>
                    <button
                      onClick={() => openAcknowledgeModal(alert)}
                      style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.accent, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                      onMouseOver={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
                      onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <CheckCircle size={14} /> Acknowledge
                    </button>
                  </td>
                </tr>
              );
            }) : (
              <tr>
                <td colSpan={6} style={{ padding: '50px 20px', textAlign: 'center', color: C.muted }}>
                  <ShieldAlert size={32} style={{ marginBottom: 12, opacity: 0.2, display: 'block', margin: '0 auto 12px' }} />
                  {filterTab === 'all' ? (trackingGuidance || 'No rank drops detected. Looking good! 🎉') : `No ${filterTab} alerts at the moment.`}
                  {filterTab === 'all' && tracking && <div style={{ fontSize: 12, marginTop: 8 }}>Tracking {tracking.tracked_keywords} keywords · {tracking.comparable_keywords} have two rank checks.</div>}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Alert History Section */}
      {showHistory && (
        <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={16} color={C.muted} />
            <span style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>Acknowledged Alert History</span>
          </div>
          {historyLoading ? (
            <div style={{ padding: 40, textAlign: 'center' }}><Loader2 size={24} color={C.accent} className="spin" /></div>
          ) : history.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.border}`, background: 'rgba(0,0,0,0.1)' }}>
                  <th style={{ padding: '12px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>KEYWORD</th>
                  <th style={{ padding: '12px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>RANK CHANGE</th>
                  <th style={{ padding: '12px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>NOTE</th>
                  <th style={{ padding: '12px 20px', color: C.muted, fontSize: 12, fontWeight: 700 }}>ACKNOWLEDGED</th>
                </tr>
              </thead>
              <tbody>
                {history.map(h => {
                  const sev = SEVERITY_CONFIG[h.severity] || SEVERITY_CONFIG.info;
                  return (
                    <tr key={h.id} style={{ borderBottom: `1px solid ${C.border}33`, opacity: 0.7 }}>
                      <td style={{ padding: '14px 20px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{h.keyword}</div>
                        <span style={{ background: sev.bg, color: sev.color, padding: '2px 7px', borderRadius: 12, fontSize: 10, fontWeight: 700 }}>{sev.label}</span>
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: '#fca5a5', fontWeight: 600 }}>
                        #{h.old_rank} ➔ #{h.new_rank} (▼{h.drop_amount})
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 13, color: C.muted, fontStyle: h.note ? 'normal' : 'italic' }}>
                        {h.note || 'No note added'}
                      </td>
                      <td style={{ padding: '14px 20px', fontSize: 12, color: C.muted }}>
                        {h.acknowledged_at ? new Date(h.acknowledged_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 40, textAlign: 'center', color: C.muted }}>No acknowledged alerts yet.</div>
          )}
        </div>
      )}

      {/* Acknowledge Modal */}
      {acknowledgeModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: C.surface, width: 480, borderRadius: 16, overflow: 'hidden', boxShadow: '0 25px 60px rgba(0,0,0,0.5)', border: `1px solid ${C.border}` }}>
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <CheckCircle size={18} color={C.accent} />
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#fff' }}>Acknowledge Alert</h3>
              </div>
              <button onClick={() => setAcknowledgeModal(null)} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', padding: 0 }}>
                <X size={18} />
              </button>
            </div>

            <div style={{ padding: 24 }}>
              <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 16, marginBottom: 20, border: `1px solid ${C.border}` }}>
                <div style={{ fontSize: 13, color: C.muted, marginBottom: 4 }}>ALERT</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#fff' }}>{acknowledgeModal.keyword}</div>
                <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600, marginTop: 4 }}>
                  Rank #{acknowledgeModal.old_rank} ➔ #{acknowledgeModal.new_rank} (▼{acknowledgeModal.drop_amount} positions)
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 13, color: C.muted, fontWeight: 600, marginBottom: 8 }}>
                  ADD A NOTE <span style={{ fontWeight: 400, fontStyle: 'italic' }}>(optional)</span>
                </label>
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value.slice(0, 1000))}
                  placeholder="e.g. Google algo update — building links to recover. Monitoring weekly."
                  rows={4}
                  maxLength={1000}
                  style={{ width: '100%', background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}`, borderRadius: 8, color: '#fff', padding: 12, fontSize: 14, resize: 'vertical', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: 11, color: C.muted, marginTop: 4, textAlign: 'right' }}>{noteText.length} / 1000 characters</div>
              </div>
            </div>

            <div style={{ padding: '16px 24px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'flex-end', gap: 12, background: 'rgba(0,0,0,0.15)' }}>
              <button onClick={() => setAcknowledgeModal(null)} style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.text, padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
              <button
                onClick={handleConfirmAcknowledge}
                disabled={isSaving}
                style={{ background: C.accent, border: 'none', color: '#fff', padding: '9px 20px', borderRadius: 8, fontSize: 13, fontWeight: 700, cursor: isSaving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, opacity: isSaving ? 0.7 : 1 }}
              >
                {isSaving ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                {isSaving ? 'Saving...' : 'Confirm & Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
