import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  Users, Target, CheckCircle, BarChart2, AlertCircle, DollarSign,
  TrendingUp, TrendingDown, Clock, ArrowRight, X, MessageSquare, Phone,
  FileText, ExternalLink, Activity, Plus, CreditCard, Send, Award, ChevronRight
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { C } from '../constants/theme.js';
import { Badge, ScoreBar } from '../components/ui.jsx';
import { useLeads, useLead } from '../hooks/useLeads.js';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../services/api.js';

// --- Sparkline Component for Stats Cards ---
const MiniSparkline = ({ data, strokeColor }) => {
  if (!data || data.length === 0) return null;
  return (
    <ResponsiveContainer width={70} height={28}>
      <LineChart data={data}>
        <Line type="monotone" dataKey="v" stroke={strokeColor} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
};

export const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Filters & State
  const [timeRange, setTimeRange] = useState('30d');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [stats, setStats] = useState(null);
  const [salesOsStats, setSalesOsStats] = useState(null);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Payments & Leads
  const [payments, setPayments] = useState([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [selectedLeadId, setSelectedLeadId] = useState(null);

  // Hot Leads Hook (always fetch live hot leads for current user/filters)
  const { leads: hotLeads, refetch: refetchHotLeads } = useLeads({
    status: 'hot',
    brand: selectedBrand !== 'all' ? clients.find(c => String(c.id) === selectedBrand)?.name : undefined
  });

  // Fetch Dashboard Stats & Clients
  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        const [statsRes, clientsRes, salesOsRes] = await Promise.all([
          api.getDashboardStats({
            range: timeRange,
            client_id: selectedBrand !== 'all' ? selectedBrand : undefined
          }),
          api.getClients(),
          api.getSalesOSReports()
        ]);
        setStats(statsRes);
        setClients(clientsRes.clients || []);
        setSalesOsStats(salesOsRes);
      } catch (err) {
        console.error('Error fetching dashboard report stats:', err);
        toast.error('Failed to load dashboard report statistics');
      } finally {
        setLoading(false);
      }
    };
    fetchDashboardData();
  }, [timeRange, selectedBrand, refreshTrigger]);

  // Fetch Payments
  useEffect(() => {
    const fetchPaymentsData = async () => {
      setPaymentsLoading(true);
      try {
        const res = await api.getPayments();
        setPayments(res.payments || []);
      } catch (err) {
        console.error('Error fetching recent payments:', err);
      } finally {
        setPaymentsLoading(false);
      }
    };
    fetchPaymentsData();
  }, [refreshTrigger]);

  // Calculations for KPI Card Trends
  const leadsChange = stats?.leads_yesterday ? Math.round(((stats.leads_today - stats.leads_yesterday) / stats.leads_yesterday) * 100) : 0;
  const convertedChange = stats?.converted_yesterday ? Math.round(((stats.converted_today - stats.converted_yesterday) / stats.converted_yesterday) * 100) : 0;
  const revenueChange = stats?.revenue_last_month ? Math.round(((stats.revenue_month - stats.revenue_last_month) / stats.revenue_last_month) * 100) : 0;

  const formatRevenueValue = (val) => {
    if (val === undefined || val === null) return '₹0';
    if (val >= 100000) return '₹' + (val / 100000).toFixed(1) + 'L';
    if (val >= 1000) return '₹' + (val / 1000).toFixed(0) + 'K';
    return '₹' + val;
  };

  const leadsConversionRate = stats?.funnel?.total
    ? Math.round((parseInt(stats.funnel.converted || 0) / parseInt(stats.funnel.total)) * 100)
    : 0;

  // Process data for Weekly Leads AreaChart
  const weeklyData = stats?.weekly && stats.weekly.length > 0
    ? stats.weekly.map((w) => ({
        day: w.day,
        Leads: parseInt(w.leads || 0),
        Converted: parseInt(w.converted || 0)
      }))
    : [];

  // Generate sparkline values for widgets
  const leadsSparkline = weeklyData.map(d => ({ v: d.Leads }));
  const convertedSparkline = weeklyData.map(d => ({ v: d.Converted }));

  // Process data for Donut PieChart
  const totalSourcesCount = stats?.sources ? stats.sources.reduce((sum, s) => sum + parseInt(s.count || 0), 0) : 0;
  const SOURCE_COLORS = [C.accent, C.blue, C.purple, C.pink, C.green, C.muted];
  const sourceData = stats?.sources && stats.sources.length > 0
    ? stats.sources.map((s, i) => ({
        name: s.source || 'Manual',
        value: parseInt(s.count || 0),
        percentage: totalSourcesCount > 0 ? Math.round((parseInt(s.count || 0) / totalSourcesCount) * 100) : 0,
        color: SOURCE_COLORS[i % SOURCE_COLORS.length]
      }))
    : [];

  // Funnel steps data
  const funnelData = stats?.funnel
    ? [
        { label: "Total Traffic", count: parseInt(stats.funnel.total || 0), color: C.blue, percent: 100 },
        { label: "Contacted Leads", count: parseInt(stats.funnel.contacted || 0), color: C.purple, percent: stats.funnel.total ? Math.round((stats.funnel.contacted / stats.funnel.total) * 100) : 0 },
        { label: "Qualified Leads (Score >= 40)", count: parseInt(stats.funnel.qualified || 0), color: C.pink, percent: stats.funnel.total ? Math.round((stats.funnel.qualified / stats.funnel.total) * 100) : 0 },
        { label: "Hot Stage", count: parseInt(stats.funnel.hot || 0), color: C.red, percent: stats.funnel.total ? Math.round((stats.funnel.hot / stats.funnel.total) * 100) : 0 },
        { label: "Converted Client", count: parseInt(stats.funnel.converted || 0), color: C.green, percent: stats.funnel.total ? Math.round((stats.funnel.converted / stats.funnel.total) * 100) : 0 }
      ]
    : [];

  // Filter payments by selected brand client-side (backend returns all payments)
  const filteredPayments = payments.filter(p => {
    if (selectedBrand === 'all') return true;
    const client = clients.find(c => String(c.id) === selectedBrand);
    // Find matching lead to check brand
    return p.lead_name && p.brand_name === client?.name;
  }).slice(0, 5);

  return (
    <div className="p-mobile" style={{ padding: 26, overflowY: 'auto', height: '100%', background: C.bg, position: 'relative' }}>
      
      {/* Dynamic Keyframes and Custom styles */}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .slide-drawer {
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
        .drawer-overlay {
          animation: fadeIn 0.2s ease-out forwards;
        }
        .dashboard-card {
          background: ${C.card};
          border: 1px solid ${C.border};
          border-radius: 16px;
          padding: 22px;
          transition: all 0.25s ease;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
        }
        .dashboard-card:hover {
          border-color: ${C.border}bb;
          transform: translateY(-2px);
          box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.3);
        }
        .kpi-card {
          position: relative;
          overflow: hidden;
        }
        .kpi-card::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 3px;
          background: transparent;
          transition: background 0.25s ease;
        }
        .kpi-card.leads::before { background: linear-gradient(90deg, ${C.accent}, ${C.purple}); }
        .kpi-card.hot::before { background: linear-gradient(90deg, ${C.red}, ${C.pink}); }
        .kpi-card.converted::before { background: linear-gradient(90deg, ${C.green}, ${C.blue}); }
        .kpi-card.revenue::before { background: linear-gradient(90deg, ${C.blue}, ${C.purple}); }
        
        .interactive-row {
          transition: background 0.15s ease;
          cursor: pointer;
        }
        .interactive-row:hover {
          background: ${C.surface}bb !important;
        }
        .filter-btn {
          background: transparent;
          color: ${C.muted};
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          transition: all 0.2s ease;
        }
        .filter-btn.active {
          background: ${C.card};
          color: ${C.text};
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        }
        .custom-select {
          background: ${C.surface};
          border: 1px solid ${C.border};
          color: ${C.text};
          padding: 8px 14px;
          border-radius: 9px;
          font-size: 12px;
          outline: none;
          cursor: pointer;
          font-weight: 600;
          transition: border-color 0.2s ease;
        }
        .custom-select:focus {
          border-color: ${C.accent};
        }
      `}</style>

      {/* --- HEADER CONTROLS --- */}
      <div className="flex-col-mobile" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 26 }}>
        <div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: C.text, display: 'flex', alignItems: 'center', gap: 8 }}>
            Good morning, {user?.name?.split(' ')[0] || 'User'}
            <Activity size={18} color={C.accent} style={{ animation: 'pulse 2s infinite' }} />
          </h1>
          <p style={{ color: C.muted, fontSize: 12, marginTop: 3 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} · LeadOS Core Operations Center
          </p>
        </div>

        {/* Global Dashboard Filters */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, alignSelf: 'stretch', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          
          {/* Brand/Client Selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Brand</span>
            <select
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
              className="custom-select"
            >
              <option value="all">All Brands</option>
              {clients.map(client => (
                <option key={client.id} value={client.id}>{client.name}</option>
              ))}
            </select>
          </div>

          {/* Time range switcher */}
          <div style={{ display: 'flex', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 3 }}>
            {[
              { id: '7d', label: '7D' },
              { id: '30d', label: '30D' },
              { id: '90d', label: '90D' }
            ].map(btn => (
              <button
                key={btn.id}
                onClick={() => setTimeRange(btn.id)}
                className={`filter-btn ${timeRange === btn.id ? 'active' : ''}`}
              >
                {btn.label}
              </button>
            ))}
          </div>

          {/* Manual Refresh Trigger */}
          <button
            onClick={() => {
              setRefreshTrigger(prev => prev + 1);
              refetchHotLeads();
              toast.success('Metrics updated');
            }}
            style={{
              background: C.surface,
              border: `1px solid ${C.border}`,
              color: C.text,
              padding: '9px 12px',
              borderRadius: 9,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.2s ease'
            }}
            title="Refresh statistics"
          >
            <Clock size={14} />
          </button>
        </div>
      </div>

      {/* --- SALESOS LIVE METRICS --- */}
      {salesOsStats && (
        <div style={{ background: `linear-gradient(to right, ${C.card}, ${C.bg})`, border: `1px solid ${C.border}`, borderRadius: 16, padding: '16px 24px', marginBottom: 24, display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(59, 130, 246, 0.1)', border: '1px solid rgba(59, 130, 246, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <TrendingUp size={24} color={C.blue} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>Today's Revenue</p>
              <h3 style={{ margin: '4px 0 0 0', fontSize: 24, fontWeight: 800, color: C.text }}>{formatRevenueValue(salesOsStats.revenueToday)}</h3>
            </div>
          </div>
          
          <div style={{ width: 1, height: 40, background: C.border, opacity: 0.5 }} className="hide-mobile"></div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(168, 85, 247, 0.1)', border: '1px solid rgba(168, 85, 247, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={24} color={C.purple} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>Pending Follow-ups</p>
              <h3 style={{ margin: '4px 0 0 0', fontSize: 24, fontWeight: 800, color: C.text }}>{salesOsStats.pendingFollowups}</h3>
            </div>
          </div>

          <div style={{ width: 1, height: 40, background: C.border, opacity: 0.5 }} className="hide-mobile"></div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <AlertCircle size={24} color={C.red} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>SLA Breaches</p>
              <h3 style={{ margin: '4px 0 0 0', fontSize: 24, fontWeight: 800, color: C.text }}>{salesOsStats.slaBreaches}</h3>
            </div>
          </div>

          <div style={{ width: 1, height: 40, background: C.border, opacity: 0.5 }} className="hide-mobile"></div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 200 }}>
            <div style={{ width: 48, height: 48, borderRadius: 12, background: 'rgba(34, 197, 94, 0.1)', border: '1px solid rgba(34, 197, 94, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Activity size={24} color={C.green} />
            </div>
            <div>
              <p style={{ margin: 0, fontSize: 13, color: C.muted, fontWeight: 600, textTransform: 'uppercase' }}>AI Confidence (Avg)</p>
              <h3 style={{ margin: '4px 0 0 0', fontSize: 24, fontWeight: 800, color: C.text }}>{Math.round(salesOsStats.aiPerformance)}%</h3>
            </div>
          </div>
        </div>
      )}

      {/* --- STAT CARDS GRID --- */}
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
        
        {/* Total Leads Card */}
        <div className="dashboard-card kpi-card leads" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 120 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Leads Today</span>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '6px 0 2px 0', fontFamily: "'Syne', sans-serif" }}>
                {loading ? '...' : stats?.leads_today}
              </h2>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: `${C.accent}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={16} color={C.accent} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
              {leadsChange >= 0 ? (
                <span style={{ color: C.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingUp size={12} />+{leadsChange}%</span>
              ) : (
                <span style={{ color: C.red, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingDown size={12} />{leadsChange}%</span>
              )}
              <span style={{ color: C.muted }}>vs yesterday</span>
            </span>
            <MiniSparkline data={leadsSparkline} strokeColor={C.accent} />
          </div>
        </div>

        {/* Hot Pipeline Card */}
        <div className="dashboard-card kpi-card hot" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 120 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Hot Pipelines</span>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '6px 0 2px 0', fontFamily: "'Syne', sans-serif" }}>
                {loading ? '...' : stats?.hot_leads}
              </h2>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: `${C.red}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Target size={16} color={C.red} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 11, color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: C.red }} />
              Ready for conversion
            </span>
            <div style={{ padding: '2px 8px', borderRadius: 20, background: `${C.red}15`, fontSize: 10, color: C.red, fontWeight: 700 }}>Action Required</div>
          </div>
        </div>

        {/* Converted Leads Card */}
        <div className="dashboard-card kpi-card converted" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 120 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Converted Today</span>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '6px 0 2px 0', fontFamily: "'Syne', sans-serif" }}>
                {loading ? '...' : stats?.converted_today}
              </h2>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: `${C.green}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <CheckCircle size={16} color={C.green} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
              {convertedChange >= 0 ? (
                <span style={{ color: C.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingUp size={12} />+{convertedChange}%</span>
              ) : (
                <span style={{ color: C.red, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingDown size={12} />{convertedChange}%</span>
              )}
              <span style={{ color: C.muted }}>vs yesterday</span>
            </span>
            <span style={{ fontSize: 10, color: C.green, fontWeight: 700, background: `${C.green}15`, padding: '2px 6px', borderRadius: 4 }}>
              {leadsConversionRate}% CR
            </span>
          </div>
        </div>

        {/* Revenue Card */}
        <div className="dashboard-card kpi-card revenue" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 120 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.8px' }}>Revenue MTD</span>
              <h2 style={{ fontSize: 28, fontWeight: 800, color: C.text, margin: '6px 0 2px 0', fontFamily: "'Syne', sans-serif" }}>
                {loading ? '...' : formatRevenueValue(stats?.revenue_month)}
              </h2>
            </div>
            <div style={{ width: 34, height: 34, borderRadius: 8, background: `${C.blue}15`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <DollarSign size={16} color={C.blue} />
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 12 }}>
            <span style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
              {revenueChange >= 0 ? (
                <span style={{ color: C.green, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingUp size={12} />+{revenueChange}%</span>
              ) : (
                <span style={{ color: C.red, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}><TrendingDown size={12} />{revenueChange}%</span>
              )}
              <span style={{ color: C.muted }}>vs last month</span>
            </span>
            <div style={{ fontSize: 10, color: C.blue, fontWeight: 700 }}>Captured</div>
          </div>
        </div>
      </div>

      {/* --- ROW 1: PRIMARY CHARTS GRID --- */}
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 16, marginBottom: 16 }}>
        
        {/* Leads & Conversions AreaChart */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Lead Acquisition & Conversions</h3>
            <span style={{ fontSize: 10, color: C.accent, fontWeight: 700, background: `${C.accent}15`, padding: '3px 8px', borderRadius: 4 }}>
              Active Timeline: {timeRange.toUpperCase()}
            </span>
          </div>

          <div style={{ flex: 1, minHeight: 200 }}>
            {loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
                Loading Chart...
              </div>
            ) : weeklyData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.accent} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.25} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11, color: C.text }}
                    labelStyle={{ color: C.muted, fontWeight: 700, marginBottom: 4 }}
                  />
                  <Area type="monotone" dataKey="Leads" stroke={C.accent} strokeWidth={2} fill="url(#leadsGrad)" />
                  <Area type="monotone" dataKey="Converted" stroke={C.green} strokeWidth={2} fill="url(#convGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
                No lead acquisition records found in this range.
              </div>
            )}
          </div>
        </div>

        {/* Ingestion Sources PieChart */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 14 }}>Traffic Channels</h3>
          
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 140 }}>
            {loading ? (
              <span style={{ fontSize: 12, color: C.muted }}>Loading...</span>
            ) : sourceData.length > 0 ? (
              <ResponsiveContainer width="100%" height={150}>
                <PieChart>
                  <Pie
                    data={sourceData}
                    cx="50%"
                    cy="50%"
                    innerRadius={46}
                    outerRadius={62}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {sourceData.map((s, idx) => (
                      <Cell key={idx} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v) => `${v} leads`} contentStyle={{ background: C.surface, border: '1px solid ' + C.border, fontSize: 11, color: C.text }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <span style={{ fontSize: 11, color: C.muted }}>No traffic source details</span>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, borderTop: `1px solid ${C.border}`, paddingTop: 12, marginTop: 8 }}>
            {sourceData.map((s, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                <div style={{ width: 7, height: 7, borderRadius: '50%', background: s.color }} />
                <span style={{ color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 70 }} title={s.name}>{s.name}</span>
                <span style={{ color: C.muted, fontWeight: 700 }}>{s.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* --- ROW 2: SECONDARY CHARTS GRID --- */}
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        
        {/* Revenue trend line/bar */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 250 }}>
          <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 16 }}>Revenue Performance</h3>
          
          <div style={{ flex: 1, minHeight: 160 }}>
            {loading ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
                Loading...
              </div>
            ) : stats?.revenue_trend && stats.revenue_trend.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.revenue_trend} barSize={22}>
                  <XAxis dataKey="m" tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                  <YAxis tickFormatter={(v) => "₹" + (v / 1000) + "K"} tick={{ fill: C.muted, fontSize: 9 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={v => "₹" + v.toLocaleString()}
                    contentStyle={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 11, color: C.text }}
                  />
                  <Bar dataKey="r" fill={C.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
                No captured payments recorded.
              </div>
            )}
          </div>
        </div>

        {/* Funnel Dropoff Breakdown */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 250 }}>
          <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Pipeline Drop-off Funnel</h3>
          
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
            {loading ? (
              <span style={{ fontSize: 12, color: C.muted, textAlign: 'center' }}>Loading funnel...</span>
            ) : funnelData.length > 0 ? (
              funnelData.map((f, i) => (
                <div key={i} style={{ marginBottom: 2 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3, fontSize: 10 }}>
                    <span style={{ color: C.muted, fontWeight: 600 }}>{f.label}</span>
                    <span style={{ color: C.text, fontWeight: 700 }}>{f.count} <span style={{ color: f.color, fontSize: 9 }}>({f.percent}%)</span></span>
                  </div>
                  <div style={{ height: 5, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${f.percent}%`, background: f.color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))
            ) : (
              <span style={{ fontSize: 11, color: C.muted, textAlign: 'center' }}>No leads matching parameters.</span>
            )}
          </div>
        </div>
      </div>

      {/* --- ROW 3: DETAILED OPERATIONS GRID --- */}
      <div className="grid-responsive" style={{ display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 16, marginBottom: 16 }}>
        
        {/* Recent Transactions List */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recent Captured Payments</h3>
            <CreditCard size={15} color={C.muted} />
          </div>

          <div className="table-responsive" style={{ flex: 1 }}>
            {paymentsLoading ? (
              <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading payments...</div>
            ) : filteredPayments.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${C.border}`, fontSize: 9, fontWeight: 700, color: C.muted, textTransform: 'uppercase' }}>
                    <th style={{ padding: '8px 10px' }}>Lead</th>
                    <th style={{ padding: '8px 10px' }}>Details</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPayments.map((p) => (
                    <tr
                      key={p.id}
                      className="interactive-row"
                      style={{ borderBottom: `1px solid ${C.border}`, fontSize: 11, color: C.text }}
                      onClick={() => setSelectedLeadId(p.lead_id)}
                    >
                      <td style={{ padding: '10px 10px', fontWeight: 600 }}>{p.lead_name || 'N/A'}</td>
                      <td style={{ padding: '10px 10px', color: C.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || 'Service Payment'}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: C.green }}>₹{p.amount?.toLocaleString()}</td>
                      <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                        <span style={{
                          background: p.status === 'captured' ? '#0a2018' : p.status === 'pending' ? '#2d1f0a' : '#2d1010',
                          color: p.status === 'captured' ? C.green : p.status === 'pending' ? C.accent : C.red,
                          padding: '2px 8px', borderRadius: 12, fontSize: 9, fontWeight: 700, textTransform: 'capitalize'
                        }}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '40px 10px', textAlign: 'center', color: C.muted, fontSize: 11 }}>
                No recent payment transactions recorded.
              </div>
            )}
          </div>
        </div>

        {/* Hot Leads list */}
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
            <AlertCircle size={15} color={C.red} />
            <h3 style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: C.text, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Hot Pipelines</h3>
            <span style={{ marginLeft: 'auto', background: `${C.red}15`, color: C.red, padding: '2px 8px', borderRadius: 12, fontSize: 9, fontWeight: 700 }}>
              {hotLeads.length} Urgent
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, overflowY: 'auto', maxHeight: 260 }}>
            {hotLeads.length > 0 ? (
              hotLeads.slice(0, 5).map((l) => (
                <div
                  key={l.id}
                  onClick={() => setSelectedLeadId(l.id)}
                  style={{
                    background: C.surface,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '9px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    cursor: 'pointer',
                    transition: 'all 0.2s ease'
                  }}
                  className="interactive-row"
                >
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%',
                    background: `${C.red}15`, display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: C.red
                  }}>
                    {l.name ? l.name[0].toUpperCase() : 'L'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</p>
                    <p style={{ fontSize: 10, color: C.muted }}>{l.brand_name || 'Individual'}</p>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                    <ScoreBar score={l.score || 0} />
                    <span style={{ fontSize: 9, color: C.muted }}>Score</span>
                  </div>
                  <ChevronRight size={14} color={C.muted} />
                </div>
              ))
            ) : (
              <div style={{ padding: '40px 10px', textAlign: 'center', color: C.muted, fontSize: 11 }}>
                No hot leads requiring follow-up. Good job!
              </div>
            )}
          </div>
        </div>
      </div>

      {/* --- LEAD DETAILS SLIDING DRAWER --- */}
      {selectedLeadId && (
        <LeadActionsDrawer
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onUpdate={() => {
            setRefreshTrigger(prev => prev + 1);
            refetchHotLeads();
          }}
          navigate={navigate}
        />
      )}
    </div>
  );
};

// --- SLIDE-IN ACTION DRAWER COMPONENT ---
const LeadActionsDrawer = ({ leadId, onClose, onUpdate, navigate }) => {
  const { lead, conversations, loading, refetch } = useLead(leadId);
  const [notesText, setNotesText] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedScore, setSelectedScore] = useState(0);
  const [savingNotes, setSavingNotes] = useState(false);

  // Payment Link generator state
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDesc, setPaymentDesc] = useState('');
  const [generatedLink, setGeneratedLink] = useState('');
  const [generatingLink, setGeneratingLink] = useState(false);

  useEffect(() => {
    if (lead) {
      setNotesText(lead.notes || '');
      setSelectedStatus(lead.status || '');
      setSelectedScore(lead.score || 0);
      setGeneratedLink('');
    }
  }, [lead]);

  // Handle Note Save
  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      await api.updateLead(leadId, { notes: notesText });
      toast.success('Notes saved successfully');
      refetch();
      onUpdate();
    } catch (err) {
      console.error('Failed to save notes:', err);
      toast.error('Failed to save notes');
    } finally {
      setSavingNotes(false);
    }
  };

  // Handle Status Update
  const handleStatusChange = async (newStatus) => {
    setSelectedStatus(newStatus);
    try {
      await api.updateLead(leadId, { status: newStatus });
      toast.success(`Status updated to ${newStatus}`);
      refetch();
      onUpdate();
    } catch (err) {
      console.error('Failed to change status:', err);
      toast.error('Failed to update status');
    }
  };

  // Handle Score Update
  const handleScoreChange = async (newScore) => {
    setSelectedScore(newScore);
    try {
      await api.updateLead(leadId, { score: parseInt(newScore) });
      toast.success(`Lead score updated: ${newScore}`);
      refetch();
      onUpdate();
    } catch (err) {
      console.error('Failed to update score:', err);
    }
  };

  // Create Payment Link
  const handleCreatePayment = async (e) => {
    e.preventDefault();
    if (!paymentAmount || isNaN(paymentAmount)) {
      return toast.error('Please enter a valid amount');
    }
    setGeneratingLink(true);
    try {
      const res = await api.createPaymentLink(leadId, parseFloat(paymentAmount), paymentDesc || 'Service Fee');
      if (res && res.link) {
        setGeneratedLink(res.link);
        toast.success('Payment link generated!');
        onUpdate();
      } else {
        throw new Error('Link missing in API response');
      }
    } catch (err) {
      console.error('Payment generation error:', err);
      toast.error('Failed to generate payment link');
    } finally {
      setGeneratingLink(false);
    }
  };

  return (
    <>
      {/* Dark semi-transparent overlay */}
      <div
        className="drawer-overlay"
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(5, 8, 15, 0.65)',
          backdropFilter: 'blur(3px)',
          zIndex: 1000
        }}
      />

      {/* Drawer content */}
      <div
        className="slide-drawer"
        style={{
          position: 'fixed',
          right: 0,
          top: 0,
          bottom: 0,
          width: 420,
          maxWidth: '90%',
          background: C.surface,
          borderLeft: `1px solid ${C.border}`,
          zIndex: 1001,
          boxShadow: '-10px 0 30px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {loading ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: C.muted, gap: 10 }}>
            <Activity size={24} className="animate-spin" style={{ animation: 'spin 1.5s linear infinite' }} />
            <span style={{ fontSize: 12 }}>Loading details...</span>
          </div>
        ) : lead ? (
          <>
            {/* Drawer Header */}
            <div style={{ padding: '20px 24px', borderBottom: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.card }}>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, fontFamily: "'Syne', sans-serif" }}>{lead.name}</h3>
                <span style={{ fontSize: 10, color: C.muted }}>Brand: {lead.brand_name || 'Individual'}</span>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer',
                  padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Drawer Body */}
            <div style={{ padding: 24, flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
              
              {/* Contact Information */}
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Quick details</h4>
                <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.muted }}>Phone:</span>
                    <span style={{ color: C.text, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={11} /> {lead.phone}
                    </span>
                  </div>
                  {lead.email && (
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: C.muted }}>Email:</span>
                      <span style={{ color: C.text, fontWeight: 600 }}>{lead.email}</span>
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.muted }}>Interest:</span>
                    <span style={{ color: C.text, fontWeight: 600 }}>{lead.interest || 'N/A'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: C.muted }}>Score:</span>
                    <ScoreBar score={selectedScore} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ color: C.muted }}>Status:</span>
                    <select
                      value={selectedStatus}
                      onChange={(e) => handleStatusChange(e.target.value)}
                      style={{
                        background: C.surface, border: `1px solid ${C.border}`, color: C.text,
                        fontSize: 11, fontWeight: 600, padding: '4px 8px', borderRadius: 6, outline: 'none'
                      }}
                    >
                      <option value="new">New</option>
                      <option value="warm">Warm</option>
                      <option value="hot">Hot</option>
                      <option value="cold">Cold</option>
                      <option value="converted">Converted</option>
                      <option value="lost">Lost</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Adjust Score Slider */}
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Update Score</h4>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={selectedScore}
                    onChange={(e) => setSelectedScore(e.target.value)}
                    onMouseUp={(e) => handleScoreChange(e.target.value)}
                    onTouchEnd={(e) => handleScoreChange(e.target.value)}
                    style={{ flex: 1, accentColor: C.accent, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 12, fontWeight: 700, color: selectedScore >= 80 ? C.green : selectedScore >= 55 ? C.accent : C.blue, minWidth: 26, textAlign: 'right' }}>
                    {selectedScore}
                  </span>
                </div>
              </div>

              {/* Notes Editor */}
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Internal Notes</h4>
                <textarea
                  value={notesText}
                  onChange={(e) => setNotesText(e.target.value)}
                  placeholder="Type important updates, lead background or conversion summary..."
                  style={{
                    width: '100%', height: 90, background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 10, padding: 12, color: C.text, fontSize: 12, outline: 'none', resize: 'none',
                    lineHeight: '140%'
                  }}
                />
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  style={{
                    marginTop: 8, background: C.accent, border: 'none', color: '#fff',
                    padding: '8px 16px', borderRadius: 8, fontSize: 11, fontWeight: 600,
                    display: 'flex', alignItems: 'center', gap: 6, float: 'right',
                    cursor: savingNotes ? 'not-allowed' : 'pointer'
                  }}
                >
                  <FileText size={12} />
                  {savingNotes ? 'Saving...' : 'Save Notes'}
                </button>
                <div style={{ clear: 'both' }} />
              </div>

              {/* Quick Actions (WhatsApp & CRM) */}
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Quick Communication</h4>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    onClick={() => navigate('/inbox', { state: { leadId: leadId } })}
                    style={{
                      flex: 1, background: `${C.accent}15`, border: `1px solid ${C.accent}40`,
                      color: C.accent, padding: '10px 14px', borderRadius: 9, fontSize: 12,
                      fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                      cursor: 'pointer'
                    }}
                  >
                    <MessageSquare size={14} />
                    Open WhatsApp
                  </button>
                </div>
              </div>

              {/* Create Payment Link Form */}
              <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
                  <CreditCard size={13} />
                  Generate Payment Link
                </h4>
                
                {generatedLink ? (
                  <div style={{ background: '#0a2018', border: `1px solid ${C.green}40`, borderRadius: 10, padding: 12 }}>
                    <p style={{ fontSize: 11, color: C.green, fontWeight: 600, marginBottom: 6 }}>Link generated successfully!</p>
                    <input
                      type="text"
                      readOnly
                      value={generatedLink}
                      onClick={(e) => {
                        e.target.select();
                        navigator.clipboard.writeText(generatedLink);
                        toast.success('Copied link to clipboard');
                      }}
                      style={{
                        width: '100%', background: C.surface, border: `1px solid ${C.border}`,
                        color: C.text, padding: '6px 10px', borderRadius: 6, fontSize: 10, outline: 'none',
                        cursor: 'copy'
                      }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
                      <span style={{ fontSize: 9, color: C.muted }}>Click input to copy</span>
                      <button
                        onClick={() => setGeneratedLink('')}
                        style={{ background: 'transparent', border: 'none', color: C.accent, fontSize: 10, fontWeight: 600 }}
                      >
                        Generate New
                      </button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleCreatePayment} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <input
                          type="number"
                          placeholder="Amount (₹)"
                          value={paymentAmount}
                          onChange={(e) => setPaymentAmount(e.target.value)}
                          required
                          style={{
                            width: '100%', background: C.card, border: `1px solid ${C.border}`,
                            color: C.text, padding: '8px 12px', borderRadius: 8, fontSize: 11, outline: 'none'
                          }}
                        />
                      </div>
                      <div style={{ flex: 1.5 }}>
                        <input
                          type="text"
                          placeholder="Description (e.g. Admission Fee)"
                          value={paymentDesc}
                          onChange={(e) => setPaymentDesc(e.target.value)}
                          style={{
                            width: '100%', background: C.card, border: `1px solid ${C.border}`,
                            color: C.text, padding: '8px 12px', borderRadius: 8, fontSize: 11, outline: 'none'
                          }}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={generatingLink}
                      style={{
                        background: `linear-gradient(135deg, ${C.accent}, #ea580c)`,
                        border: 'none', color: '#fff', padding: '9px 14px', borderRadius: 9,
                        fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        cursor: generatingLink ? 'not-allowed' : 'pointer'
                      }}
                    >
                      <Plus size={13} />
                      {generatingLink ? 'Generating...' : 'Create Link'}
                    </button>
                  </form>
                )}
              </div>

              {/* Recent WhatsApp Message Preview */}
              {conversations && conversations.length > 0 && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 18, marginBottom: 10 }}>
                  <h4 style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Last Message</h4>
                  <div style={{
                    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12,
                    display: 'flex', flexDirection: 'column', gap: 4
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: C.muted }}>
                      <span style={{ fontWeight: 700, color: conversations[conversations.length - 1].direction === 'inbound' ? C.accent : C.blue }}>
                        {conversations[conversations.length - 1].direction === 'inbound' ? 'Customer' : 'Agent'}
                      </span>
                      <span>{new Date(conversations[conversations.length - 1].timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p style={{ fontSize: 11, color: C.text, lineHeight: '140%', whiteSpace: 'pre-wrap' }}>
                      {conversations[conversations.length - 1].content}
                    </p>
                  </div>
                </div>
              )}

            </div>
          </>
        ) : (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
            Lead records not found
          </div>
        )}
      </div>
    </>
  );
};
