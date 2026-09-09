import { useState, useEffect } from 'react';
import html2pdf from 'html2pdf.js';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts';
import { 
  Download, TrendingUp, TrendingDown, Users, DollarSign, Flame, 
  Award, BarChart3, Layers, Briefcase, Calendar, ChevronRight, Activity, Globe
} from 'lucide-react';
import { C } from '../constants/theme.js';
import { api } from '../services/api.js';

export const ReportsView = () => {
  const [stats, setStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'funnel' | 'brands'
  const [timeRange, setTimeRange] = useState('30d'); // '7d' | '30d' | '90d' | '12m'
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [appliedRange, setAppliedRange] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [statsRes, clientsRes] = await Promise.all([
          api.getDashboardStats(appliedRange ? { range: 'custom', from: appliedRange.from, to: appliedRange.to } : { range: timeRange }),
          api.getClients()
        ]);
        setStats(statsRes);
        setClients(statsRes.brands || clientsRes.clients || []);
      } catch (err) {
        console.error('Error fetching reports data', err);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [timeRange, appliedRange]);

  const applyCustomRange = () => {
    if (!fromDate || !toDate) return;
    if (fromDate > toDate) return;
    setAppliedRange({ from: fromDate, to: toDate });
    setTimeRange('custom');
  };

  const resetCustomRange = () => {
    setFromDate('');
    setToDate('');
    setAppliedRange(null);
    setTimeRange('30d');
  };

  const handleExport = () => {
    setExporting(true);
    setExportProgress(15);
    const interval = setInterval(() => {
      setExportProgress(prev => {
        if (prev >= 90) {
          clearInterval(interval);
          return 90;
        }
        return prev + 25;
      });
    }, 150);

    setTimeout(() => {
      const element = document.getElementById('reports-content-to-export');
      const opt = {
        margin:       10,
        filename:     `LeadOS-Reports-Analytics-${appliedRange ? `${appliedRange.from}-to-${appliedRange.to}` : timeRange}.pdf`,
        image:        { type: 'jpeg', quality: 0.98 },
        html2canvas:  { 
          scale: 2, 
          useCORS: true, 
          backgroundColor: '#060c17',
          logging: false
        },
        jsPDF:        { unit: 'mm', format: 'a3', orientation: 'landscape' }
      };

      html2pdf()
        .set(opt)
        .from(element)
        .save()
        .then(() => {
          setExportProgress(100);
          setTimeout(() => {
            setExporting(false);
          }, 400);
        })
        .catch(err => {
          console.error('Direct PDF export failed', err);
          setExporting(false);
        });
    }, 1000);
  };

  const getPercentageChange = (curr, prev) => {
    if (!prev || prev === 0) return { val: 0, isPositive: true };
    const diff = ((curr - prev) / prev) * 100;
    return { val: Math.abs(Math.round(diff)), isPositive: diff >= 0 };
  };

  // Process data for charts
  const weeklyData = stats?.weekly?.map(d => ({ 
    d: d.day, 
    leads: parseInt(d.leads), 
    converted: parseInt(d.converted) 
  })) || [];

  const maxLeads = Math.max(...clients.map(c => parseInt(c.lead_count || 0)), 1);
  const colors = [C.accent, C.blue, C.purple, C.green, C.red, C.pink];

  // Lead Sources formatted for Recharts Pie Chart
  const pieData = stats?.sources?.map((s, idx) => ({
    name: s.source || 'Other',
    value: parseInt(s.count || 0),
    color: colors[idx % colors.length]
  })) || [];

  // Funnel steps data
  const funnelData = stats?.funnel ? [
    { name: 'Total Leads', count: parseInt(stats.funnel.total || 0), percent: 100, color: C.blue },
    { name: 'Contacted', count: parseInt(stats.funnel.contacted || 0), percent: Math.round((stats.funnel.contacted / stats.funnel.total) * 100) || 0, color: C.purple },
    { name: 'Qualified (>=40 Score)', count: parseInt(stats.funnel.qualified || 0), percent: Math.round((stats.funnel.qualified / stats.funnel.total) * 100) || 0, color: C.pink },
    { name: 'Hot Stage', count: parseInt(stats.funnel.hot || 0), percent: Math.round((stats.funnel.hot / stats.funnel.total) * 100) || 0, color: C.red },
    { name: 'Converted', count: parseInt(stats.funnel.converted || 0), percent: Math.round((stats.funnel.converted / stats.funnel.total) * 100) || 0, color: C.green }
  ] : [];

  const leadIngestPercentage = getPercentageChange(stats?.leads_today, stats?.leads_yesterday);
  const revenuePercentage = getPercentageChange(stats?.revenue_month, stats?.revenue_last_month);
  const conversionPercentage = getPercentageChange(stats?.converted_today, stats?.converted_yesterday);

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%', background: C.bg }}>
      
      {/* Export Loader Modal */}
      {exporting && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(6,12,23,0.85)', backdropFilter: 'blur(8px)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 10000
        }}>
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, padding: 40, borderRadius: 16, width: 320, textAlign: 'center' }}>
            <Activity className="animate-spin" size={32} color={C.accent} style={{ margin: '0 auto 16px auto', animation: 'spin 1.5s linear infinite' }} />
            <h3 style={{ fontSize: 16, fontWeight: 700, color: C.text, marginBottom: 8 }}>Generating Report</h3>
            <p style={{ fontSize: 12, color: C.muted, marginBottom: 20 }}>Gathering statistics & building charts...</p>
            <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${exportProgress}%`, background: C.accent, transition: 'width 0.3s ease' }} />
            </div>
          </div>
        </div>
      )}

      {/* Report Content Wrapper */}
      <div id="reports-content-to-export" style={{ background: C.bg, padding: '4px 10px', borderRadius: 12 }}>
        {/* Top Header */}
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <BarChart3 size={20} color={C.accent} />
            <h1 style={{ fontFamily: "'Syne',sans-serif", fontSize: 24, fontWeight: 800, color: C.text, letterSpacing: '-0.5px' }}>Reports & Analytics</h1>
          </div>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>
            Advanced analytical dashboard for brand conversion, scoring & revenue mapping.
          </p>
          {appliedRange && <p style={{ color: C.accent, fontSize: 10, marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}><Calendar size={11} />Custom range: {new Date(`${appliedRange.from}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })} – {new Date(`${appliedRange.to}T00:00:00`).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</p>}
        </div>
        
        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, padding: 2 }}>
            {[
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: '90d', label: '90D' }
            ].map(btn => (
              <button
                key={btn.id}
                onClick={() => { setTimeRange(btn.id); setAppliedRange(null); }}
                style={{
                  background: !appliedRange && timeRange === btn.id ? C.card : 'transparent',
                  color: !appliedRange && timeRange === btn.id ? C.text : C.muted,
                  border: 'none', padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  transition: 'all 0.2s ease'
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 7, padding: '7px 9px', background: C.surface, border: `1px solid ${appliedRange ? C.accent : C.border}`, borderRadius: 9, flexWrap: 'wrap' }}>
            {[['From Date', fromDate, setFromDate], ['To Date', toDate, setToDate]].map(([label, value, setter]) => (
              <label key={label} style={{ display: 'flex', flexDirection: 'column', gap: 3, color: C.muted, fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: .5 }}>
                {label}
                <input type="date" value={value} max={label === 'From Date' ? toDate || undefined : undefined} min={label === 'To Date' ? fromDate || undefined : undefined} onChange={e => setter(e.target.value)} style={{ colorScheme: 'dark', background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '5px 7px', fontSize: 10, outline: 'none', fontFamily: 'inherit' }} />
              </label>
            ))}
            <button onClick={applyCustomRange} disabled={!fromDate || !toDate || fromDate > toDate} style={{ background: C.accent, color: '#fff', border: 0, borderRadius: 6, padding: '7px 10px', fontSize: 9, fontWeight: 700, cursor: 'pointer', opacity: !fromDate || !toDate || fromDate > toDate ? .45 : 1 }}>Apply</button>
            <button onClick={resetCustomRange} style={{ background: 'transparent', color: C.muted, border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 9px', fontSize: 9, fontWeight: 600, cursor: 'pointer' }}>Reset</button>
          </div>
          
          <button 
            onClick={handleExport}
            style={{ 
              background: `linear-gradient(135deg, ${C.accent}, #ea580c)`, 
              border: 'none', color: '#fff', padding: '9px 16px', borderRadius: 8, 
              fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 4px 12px rgba(249,115,22,0.2)', transition: 'transform 0.2s ease'
            }}
          >
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>

      {/* KPI Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 24 }}>
        
        {/* Leads Ingested */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, background: `${C.blue}15`, padding: 8, borderRadius: 8 }}>
            <Users size={16} color={C.blue} />
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{appliedRange ? 'Leads in Range' : 'Leads Today'}</p>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 4px 0', fontFamily: "'Syne',sans-serif" }}>
            {loading ? '-' : stats?.leads_today}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            {leadIngestPercentage.isPositive ? (
              <span style={{ color: C.green, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingUp size={12} style={{ marginRight: 2 }} />+{leadIngestPercentage.val}%</span>
            ) : (
              <span style={{ color: C.red, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingDown size={12} style={{ marginRight: 2 }} />-{leadIngestPercentage.val}%</span>
            )}
            <span style={{ color: C.muted }}>vs {appliedRange ? 'previous period' : 'yesterday'} ({stats?.leads_yesterday})</span>
          </div>
        </div>

        {/* Revenue Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, background: `${C.green}15`, padding: 8, borderRadius: 8 }}>
            <DollarSign size={16} color={C.green} />
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{appliedRange ? 'Revenue in Range' : 'Monthly Revenue'}</p>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 4px 0', fontFamily: "'Syne',sans-serif" }}>
            {loading ? '-' : `₹${Math.round(stats?.revenue_month || 0).toLocaleString()}`}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            {revenuePercentage.isPositive ? (
              <span style={{ color: C.green, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingUp size={12} style={{ marginRight: 2 }} />+{revenuePercentage.val}%</span>
            ) : (
              <span style={{ color: C.red, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingDown size={12} style={{ marginRight: 2 }} />-{revenuePercentage.val}%</span>
            )}
            <span style={{ color: C.muted }}>vs {appliedRange ? 'previous period' : 'last month'}</span>
          </div>
        </div>

        {/* Hot Leads Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, background: `${C.accent}15`, padding: 8, borderRadius: 8 }}>
            <Flame size={16} color={C.accent} />
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hot Pipelines</p>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 4px 0', fontFamily: "'Syne',sans-serif" }}>
            {loading ? '-' : stats?.hot_leads}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <span style={{ color: C.accent, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><Award size={12} style={{ marginRight: 2 }} />Hot Stage</span>
            <span style={{ color: C.muted }}>Ready for conversions</span>
          </div>
        </div>

        {/* Converted Card */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, position: 'relative', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', top: 18, right: 18, background: `${C.purple}15`, padding: 8, borderRadius: 8 }}>
            <Award size={16} color={C.purple} />
          </div>
          <p style={{ fontSize: 11, fontWeight: 600, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{appliedRange ? 'Conversions in Range' : 'Conversions Today'}</p>
          <h2 style={{ fontSize: 26, fontWeight: 800, color: C.text, margin: '8px 0 4px 0', fontFamily: "'Syne',sans-serif" }}>
            {loading ? '-' : stats?.converted_today}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            {conversionPercentage.isPositive ? (
              <span style={{ color: C.green, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingUp size={12} style={{ marginRight: 2 }} />+{conversionPercentage.val}%</span>
            ) : (
              <span style={{ color: C.red, display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}><TrendingDown size={12} style={{ marginRight: 2 }} />-{conversionPercentage.val}%</span>
            )}
            <span style={{ color: C.muted }}>vs {appliedRange ? 'previous period' : 'yesterday'} ({stats?.converted_yesterday})</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${C.border}`, gap: 20, marginBottom: 20 }}>
        {[
          { id: 'overview', label: 'Performance Overview', icon: <Briefcase size={14} /> },
          { id: 'funnel', label: 'Funnel & Lead Channels', icon: <Layers size={14} /> },
          { id: 'brands', label: 'Brand Analytics', icon: <Globe size={14} /> }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: 'transparent', border: 'none',
              borderBottom: activeTab === tab.id ? `2px solid ${C.accent}` : '2px solid transparent',
              color: activeTab === tab.id ? C.text : C.muted,
              padding: '10px 4px', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6,
              transition: 'all 0.2s ease', cursor: 'pointer'
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Tab Content */}
      {loading ? (
        <div style={{ height: 350, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>
          <Activity className="animate-spin" size={24} color={C.accent} style={{ animation: 'spin 1.5s linear infinite' }} />
        </div>
      ) : (
        <>
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {/* Row 1: Weekly Volume & Revenue Growth */}
              <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                {/* Weekly Lead Volume */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Weekly Lead Traffic</h3>
                    <span style={{ fontSize: 10, color: C.accent, fontWeight: 600, background: `${C.accent}15`, padding: '3px 8px', borderRadius: 4 }}>Last 7 Days</span>
                  </div>
                  
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={weeklyData} barSize={16}>
                      <XAxis dataKey="d" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.text }} />
                      <Bar dataKey="leads" name="Incoming Leads" fill={C.accent} radius={[3, 3, 0, 0]} />
                      <Bar dataKey="converted" name="Converted Leads" fill={C.green} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                {/* Revenue Growth Trend */}
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Revenue Trend</h3>
                    <span style={{ fontSize: 10, color: C.blue, fontWeight: 600, background: `${C.blue}15`, padding: '3px 8px', borderRadius: 4 }}>Last 6 Months</span>
                  </div>
                  
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={stats?.revenue_trend || []}>
                      <XAxis dataKey="m" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => "₹" + (v / 1000) + "k"} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                      <Tooltip formatter={(v) => "₹" + v.toLocaleString()} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 11, color: C.text }} />
                      <Line type="monotone" dataKey="r" stroke={C.blue} strokeWidth={3} dot={{ fill: C.blue, strokeWidth: 2, r: 4 }} activeDot={{ r: 6 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Quick Brand Ranking Table */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 16 }}>Top Brands Breakdown</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {clients.slice(0, 4).map((c, i) => {
                    const lCount = parseInt(c.lead_count || 0);
                    const convCount = parseInt(c.converted_count || 0);
                    const percent = Math.round((lCount / maxLeads) * 100) || 0;
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, width: 20 }}>#{i+1}</span>
                        <div style={{ width: 120 }}><p style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{c.name}</p></div>
                        <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${percent}%`, background: colors[i % colors.length], borderRadius: 3 }} />
                        </div>
                        <div style={{ width: 80, textAlign: 'right', fontSize: 11, color: C.muted }}>
                          <span style={{ color: C.text, fontWeight: 600 }}>{lCount}</span> leads
                        </div>
                        <div style={{ width: 60, textAlign: 'right', fontSize: 11, color: C.green, fontWeight: 600 }}>
                          {convCount} conv
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'funnel' && (
            <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16 }}>
              {/* Left Funnel Card */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 18 }}>Lead Ingestion Funnel</h3>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {funnelData.map((step, idx) => (
                    <div key={step.name} style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <div style={{ width: 120, fontSize: 11, fontWeight: 600, color: C.muted }}>{step.name}</div>
                      <div style={{ flex: 1, position: 'relative', height: 32, background: C.surface, borderRadius: 6, overflow: 'hidden', border: `1px solid ${C.border}` }}>
                        {/* Progress fill */}
                        <div style={{ height: '100%', width: `${step.percent}%`, background: `linear-gradient(90deg, ${step.color}25, ${step.color}60)`, borderRadius: '5px 0 0 5px' }} />
                        {/* Labels inside bar */}
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 12px', fontSize: 11 }}>
                          <span style={{ color: C.text, fontWeight: 700 }}>{step.count}</span>
                          <span style={{ color: step.color, fontWeight: 700 }}>{step.percent}%</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 20, paddingTop: 16, fontSize: 11, color: C.muted }}>
                  🎯 Conversion Rate of contacted leads: <span style={{ color: C.green, fontWeight: 700 }}>
                    {stats?.funnel?.contacted ? Math.round((stats.funnel.converted / stats.funnel.contacted) * 100) : 0}%
                  </span>
                </div>
              </div>

              {/* Right Lead Channels Pie Card */}
              <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, display: 'flex', flexDirection: 'column' }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 12 }}>Ingestion Channels</h3>
                
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 180 }}>
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => `${value} leads`} contentStyle={{ background: C.surface, border: `1px solid ${C.border}`, fontSize: 11, color: C.text }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>

                {/* Legend Suffix */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10 }}>
                  {pieData.map((entry) => (
                    <div key={entry.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }} />
                      <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                      <span style={{ color: C.muted, fontWeight: 600 }}>({entry.value})</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'brands' && (
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Full Brand Performance Index</h3>
                <span style={{ fontSize: 11, color: C.muted }}>Sorted by total lead count</span>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {/* Header row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 10, borderBottom: `2px solid ${C.border}`, fontSize: 10, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>
                  <div style={{ width: 24, flexShrink: 0 }}>Rank</div>
                  <div style={{ width: 140 }}>Brand Name</div>
                  <div style={{ flex: 1 }}>Ingestion Rate</div>
                  <div style={{ width: 70, textAlign: 'right' }}>Total Leads</div>
                  <div style={{ width: 80, textAlign: 'right' }}>Conversion Rate</div>
                  <div style={{ width: 70, textAlign: 'right' }}>Converted</div>
                </div>

                {clients.length > 0 ? clients.map((c, i) => {
                  const leads = parseInt(c.lead_count || 0);
                  const conv = parseInt(c.converted_count || 0);
                  const convRate = leads > 0 ? Math.round((conv / leads) * 100) + '%' : '0%';
                  const col = colors[i % colors.length];
                  
                  return (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 0', borderBottom: `1px solid ${C.border}`, transition: 'background 0.2s ease' }} className="hover-highlight">
                      <div style={{ width: 24, fontSize: 12, fontWeight: 700, color: C.muted }}>#{i+1}</div>
                      <div style={{ width: 140, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: col }} />
                        <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>{c.name}</span>
                      </div>
                      <div style={{ flex: 1, height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${(leads / maxLeads) * 100}%`, background: col, borderRadius: 3 }} />
                      </div>
                      <div style={{ width: 70, textAlign: 'right', fontSize: 12, color: C.text, fontWeight: 600 }}>{leads}</div>
                      <div style={{ width: 80, textAlign: 'right', fontSize: 12, color: C.green, fontWeight: 600 }}>{convRate}</div>
                      <div style={{ width: 70, textAlign: 'right', fontSize: 12, color: C.accent, fontWeight: 700 }}>{conv}</div>
                    </div>
                  );
                }) : (
                  <div style={{ textAlign: 'center', padding: 30, color: C.muted }}>No brand statistics found.</div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      </div>

      {/* Embed simple inline print styles to hide sidebar when printing */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .p-mobile, .p-mobile * { visibility: visible; }
          .p-mobile { position: absolute; left: 0; top: 0; width: 100%; }
          button, .flex-col-mobile > div:last-child { display: none !important; }
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

    </div>
  );
};

