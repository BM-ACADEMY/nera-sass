import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer
} from 'recharts';
import {
  AlertCircle, ArrowRight, X, MessageSquare, Phone,
  FileText, Activity, Plus, CreditCard, ChevronRight, RefreshCw, Flame, Bot, ClipboardList, Users, CheckCircle, IndianRupee, Inbox
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Select, Radio, Button } from 'antd';
import { C } from '../constants/theme.js';
import { ScoreBar } from '../components/ui.jsx';
import { useLeads, useLead } from '../hooks/useLeads.js';
import { useAuth } from '../hooks/useAuth.js';
import { api } from '../services/api.js';
import NoticesBox from '../components/NoticesBox.jsx';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { attentionCards, formatRupees, fullRupees, greeting, isStaffRole, sourceRows } from '../utils/dashboard.js';

const SOURCE_COLORS = [C.blue, C.green, C.purple, '#f59e0b', C.pink, '#0891b2', C.muted];
const RANGE_LABEL = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };
const ATTENTION_ICONS = { unanswered: MessageSquare, hot: Flame, handovers: Bot, overdue: ClipboardList };
const ATTENTION_REFRESH_MS = 60 * 1000;

const sectionTitle = 'text-[13px] font-semibold uppercase tracking-wide text-slate-700';

// One plain number card (app card style: white, border, small shadow).
const StatCard = ({ icon: Icon, label, value, sub, title, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title}
      className={cn('flex min-w-0 flex-col items-start gap-1 rounded-xl border border-border bg-card p-4 text-left shadow-xs', onClick && 'cursor-pointer transition-colors hover:bg-slate-50')}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Icon size={14} /> {label}</span>
      <span className="text-2xl leading-tight font-bold text-slate-900">{value}</span>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </Tag>
  );
};

const EmptyChart = ({ children }) => (
  <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-1 text-center text-[13px] text-muted-foreground">
    <Inbox size={20} className="text-slate-300" />
    {children}
  </div>
);

export const Dashboard = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const staff = isStaffRole(user?.role);

  // Filters & State
  const [timeRange, setTimeRange] = useState('30d');
  const [selectedBrand, setSelectedBrand] = useState('all');
  const [stats, setStats] = useState(null);
  const [overview, setOverview] = useState(null);
  const [attention, setAttention] = useState(null);
  const [attentionError, setAttentionError] = useState(false);
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

  // Brands for the filter (once)
  useEffect(() => {
    api.getClients().then((res) => setClients(res.clients || [])).catch(() => setClients([]));
  }, []);

  // Range numbers: summary (leads, revenue, charts) + overview (converted, sources)
  useEffect(() => {
    let cancelled = false;
    const fetchDashboardData = async () => {
      setLoading(true);
      const brand = selectedBrand !== 'all' ? selectedBrand : undefined;
      const [statsRes, overviewRes] = await Promise.allSettled([
        api.getDashboardStats({ range: timeRange, client_id: brand }),
        api.getDashboardOverview({ range: timeRange, client_id: brand }),
      ]);
      if (cancelled) return;
      setStats(statsRes.status === 'fulfilled' ? statsRes.value : null);
      setOverview(overviewRes.status === 'fulfilled' ? overviewRes.value : null);
      if (statsRes.status === 'rejected' || overviewRes.status === 'rejected') toast.error('Some dashboard numbers could not be loaded');
      setLoading(false);
    };
    fetchDashboardData();
    return () => { cancelled = true; };
  }, [timeRange, selectedBrand, refreshTrigger]);

  // Needs attention now: on load, on refresh and every minute.
  const loadAttention = useCallback(async () => {
    try {
      setAttention(await api.getDashboardAttention());
      setAttentionError(false);
    } catch {
      setAttentionError(true);
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(loadAttention, 0);
    const timer = setInterval(loadAttention, ATTENTION_REFRESH_MS);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [loadAttention, refreshTrigger]);

  // Recent payments (workspace revenue: not shown to agents)
  useEffect(() => {
    if (staff) return;
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
  }, [refreshTrigger, staff]);

  const weeklyData = (stats?.weekly || []).map((w) => ({ day: w.day, Leads: parseInt(w.leads || 0), Converted: parseInt(w.converted || 0) }));
  const hasLeadsInRange = weeklyData.some((d) => d.Leads > 0 || d.Converted > 0);
  const sources = sourceRows(overview?.sources).map((s, i) => ({ ...s, color: SOURCE_COLORS[i % SOURCE_COLORS.length] }));
  const revenueTrend = stats?.revenue_trend || [];
  const hasRevenue = revenueTrend.some((r) => Number(r.r) > 0);

  const funnelTotal = parseInt(stats?.funnel?.total || 0);
  const pct = (n) => (funnelTotal ? Math.round((parseInt(n || 0) / funnelTotal) * 100) : 0);
  const funnelData = stats?.funnel ? [
    { label: 'All leads', count: funnelTotal, color: C.blue, percent: 100 },
    { label: 'Contacted', count: parseInt(stats.funnel.contacted || 0), color: C.purple, percent: pct(stats.funnel.contacted) },
    { label: 'Qualified (score 40+)', count: parseInt(stats.funnel.qualified || 0), color: C.pink, percent: pct(stats.funnel.qualified) },
    { label: 'Hot', count: parseInt(stats.funnel.hot || 0), color: C.red, percent: pct(stats.funnel.hot) },
    { label: 'Converted', count: parseInt(stats.funnel.converted || 0), color: C.green, percent: pct(stats.funnel.converted) },
  ] : [];

  // Filter payments by selected brand client-side (backend returns all payments)
  const filteredPayments = payments.filter(p => {
    if (selectedBrand === 'all') return true;
    const client = clients.find(c => String(c.id) === selectedBrand);
    return p.lead_name && p.brand_name === client?.name;
  }).slice(0, 5);

  const cards = attentionCards(attention);
  const show = (value) => (loading ? '…' : value ?? '—');
  const myDay = attention?.my_day;
  const leadsDelta = stats ? Number(stats.leads_today || 0) - Number(stats.leads_yesterday || 0) : 0;

  return (
    <div className="p-4 md:p-6" style={{ overflowY: 'auto', height: '100%', background: C.bg, position: 'relative' }}>
      <NoticesBox />

      <style>{`
        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        .slide-drawer { animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
        .drawer-overlay { animation: fadeIn 0.2s ease-out forwards; }
        .dashboard-card {
          background: ${C.card};
          border: 1px solid ${C.border};
          border-radius: 12px;
          padding: 18px;
          min-width: 0;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        .interactive-row { transition: background 0.15s ease; cursor: pointer; }
        .interactive-row:hover { background: ${C.bg} !important; }
      `}</style>

      {/* --- HEADER: greeting (My day for agents) + filters --- */}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">
            {greeting()}, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
          {staff && (
            <div className="mt-3">
              <div className="mb-1.5 text-xs font-semibold text-slate-700">My day</div>
              <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                {[
                  { label: 'My open leads', value: myDay?.open_leads, onClick: () => navigate('/leads') },
                  { label: 'My replies today', value: myDay?.replies_today },
                  { label: 'My tasks due today', value: myDay?.tasks_due_today, onClick: () => navigate('/sales-tasks?due=today') },
                ].map((item) => {
                  const Tag = item.onClick ? 'button' : 'div';
                  return (
                    <Tag key={item.label} type={item.onClick ? 'button' : undefined} onClick={item.onClick}
                      className={cn('flex flex-col items-start rounded-lg border border-border bg-card px-3 py-2 text-left shadow-xs sm:min-w-32', item.onClick && 'cursor-pointer hover:bg-slate-50')}>
                      <span className="text-lg leading-tight font-bold text-slate-900">{attention ? item.value ?? 0 : '…'}</span>
                      <span className="text-xs text-muted-foreground">{item.label}</span>
                    </Tag>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={selectedBrand}
            onChange={(val) => setSelectedBrand(val)}
            style={{ width: 150 }}
            aria-label="Brand"
            options={[
              { value: 'all', label: 'All brands' },
              ...clients.map(c => ({ value: String(c.id), label: c.name }))
            ]}
          />
          <Radio.Group value={timeRange} onChange={e => setTimeRange(e.target.value)} optionType="button" buttonStyle="solid">
            <Radio.Button value="7d">7D</Radio.Button>
            <Radio.Button value="30d">30D</Radio.Button>
            <Radio.Button value="90d">90D</Radio.Button>
          </Radio.Group>
          <Button
            icon={<RefreshCw size={14} />}
            aria-label="Refresh"
            onClick={() => {
              setRefreshTrigger(prev => prev + 1);
              refetchHotLeads();
            }}
            title="Refresh"
          />
        </div>
      </div>

      {/* --- NEEDS ATTENTION NOW --- */}
      <section className="mb-5" aria-labelledby="attention-title">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="attention-title" className={sectionTitle}>Needs attention now</h2>
          <span className="text-xs text-muted-foreground">
            {attention?.scope === 'mine' ? 'Yours and unassigned, all brands' : 'All brands'}
          </span>
        </div>
        {attentionError && !attention ? (
          <Card className="flex-row items-center justify-between gap-3 px-4 py-3 text-sm">
            <span className="text-muted-foreground">Could not load what needs attention.</span>
            <Button size="small" onClick={loadAttention}>Try again</Button>
          </Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(cards.length ? cards : [{ key: 'unanswered' }, { key: 'hot' }, { key: 'handovers' }, { key: 'overdue' }]).map((card) => {
              const Icon = ATTENTION_ICONS[card.key];
              const urgent = card.count > 0;
              return (
                <button key={card.key} type="button" disabled={!attention}
                  onClick={() => navigate(card.to, card.state ? { state: card.state } : undefined)}
                  className={cn('group flex min-w-0 cursor-pointer flex-col items-start gap-1 rounded-xl border bg-card p-3 text-left shadow-xs transition-colors hover:bg-slate-50 sm:p-4',
                    urgent ? 'border-red-200' : 'border-border')}>
                  <span className="flex w-full items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Icon size={14} className={urgent ? 'text-red-500' : 'text-slate-400'} />
                    <span className="min-w-0 flex-1">{card.label || '…'}</span>
                  </span>
                  <span className={cn('text-2xl leading-tight font-bold', urgent ? 'text-red-600' : 'text-slate-400')}>
                    {attention ? card.count : '…'}
                  </span>
                  <span className="text-xs text-muted-foreground">{card.hint || ' '}</span>
                  {urgent && (
                    <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-blue-600 group-hover:underline">
                      {card.action} <ArrowRight size={12} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* --- KEY NUMBERS --- */}
      <section className={cn('mb-5 grid grid-cols-2 gap-3', staff ? 'lg:grid-cols-3' : 'lg:grid-cols-4')} aria-label="Key numbers">
        <StatCard icon={Users} label="Leads today" value={show(stats?.leads_today)}
          sub={stats ? `${leadsDelta >= 0 ? '+' : ''}${leadsDelta} vs yesterday` : null} />
        <StatCard icon={MessageSquare} label="Replies pending" value={attention ? attention.unanswered?.count ?? 0 : '…'}
          sub={`Waiting over ${attention?.unanswered?.after_minutes || 15} min`} onClick={() => navigate('/inbox', attention?.unanswered?.oldest_lead_id != null ? { state: { leadId: attention.unanswered.oldest_lead_id } } : undefined)} />
        <StatCard icon={CheckCircle} label="Converted" value={show(overview?.converted)} sub={RANGE_LABEL[timeRange]} />
        {!staff && (
          <StatCard icon={IndianRupee} label="Revenue this month" value={loading ? '…' : formatRupees(stats?.revenue_month)}
            title={stats ? fullRupees(stats.revenue_month) : undefined} sub="Captured payments" />
        )}
      </section>

      {/* --- ROW 1: LEADS CHART + SOURCES --- */}
      <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h3 className={sectionTitle}>New leads & conversions</h3>
            <span className="rounded bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{RANGE_LABEL[timeRange]}</span>
          </div>
          <div style={{ flex: 1, minHeight: 200 }}>
            {loading ? (
              <EmptyChart>Loading…</EmptyChart>
            ) : hasLeadsInRange ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={weeklyData} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="leadsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.accent} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="convGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.green} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={C.green} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="day" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={12} />
                  <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 12, color: C.text }}
                    labelStyle={{ color: C.muted, fontWeight: 600, marginBottom: 4 }}
                  />
                  <Area type="monotone" dataKey="Leads" stroke={C.accent} strokeWidth={2} fill="url(#leadsGrad)" />
                  <Area type="monotone" dataKey="Converted" stroke={C.green} strokeWidth={2} fill="url(#convGrad)" />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>No leads yet in this period</EmptyChart>
            )}
          </div>
        </div>

        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 280 }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className={sectionTitle}>Where leads came from</h3>
            {overview?.total_leads > 0 && <span className="text-xs text-muted-foreground">{overview.total_leads} leads</span>}
          </div>
          {loading ? (
            <EmptyChart>Loading…</EmptyChart>
          ) : sources.length > 0 ? (
            <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row lg:flex-col xl:flex-row">
              <div className="h-[140px] w-[140px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={sources} dataKey="count" nameKey="label" cx="50%" cy="50%" innerRadius={44} outerRadius={64} paddingAngle={sources.length > 1 ? 2 : 0}>
                      {sources.map((s) => <Cell key={s.kind} fill={s.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, name) => [`${v} lead${v === 1 ? '' : 's'}`, name]} contentStyle={{ background: C.surface, border: '1px solid ' + C.border, fontSize: 12, color: C.text }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="w-full min-w-0 space-y-2">
                {sources.map((s) => (
                  <li key={s.kind} className="flex items-center gap-2 text-[13px]">
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: s.color }} />
                    <span className="min-w-0 flex-1 text-slate-700">{s.label}</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{s.count}</span>
                    <span className="w-10 text-right text-muted-foreground tabular-nums">{s.percent}%</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <EmptyChart>No leads yet in this period</EmptyChart>
          )}
        </div>
      </div>

      {/* --- ROW 2: REVENUE (not for agents) + FUNNEL --- */}
      <div className={cn('mb-4 grid grid-cols-1 gap-4', !staff && 'lg:grid-cols-2')}>
        {!staff && (
          <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 250 }}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className={sectionTitle}>Revenue</h3>
              <span className="text-xs text-muted-foreground">Captured payments, last 6 months</span>
            </div>
            <div style={{ flex: 1, minHeight: 160 }}>
              {loading ? (
                <EmptyChart>Loading…</EmptyChart>
              ) : hasRevenue ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={revenueTrend} barSize={22} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
                    <XAxis dataKey="m" tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatRupees} tick={{ fill: C.muted, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(v) => [fullRupees(v), 'Revenue']}
                      contentStyle={{ background: C.surface, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 12, color: C.text }}
                    />
                    <Bar dataKey="r" fill={C.blue} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <EmptyChart>No payments captured yet</EmptyChart>
              )}
            </div>
          </div>
        )}

        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column', minHeight: 250 }}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className={sectionTitle}>Pipeline</h3>
            <span className="text-xs text-muted-foreground">All leads, current status</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1, justifyContent: 'center' }}>
            {loading ? (
              <EmptyChart>Loading…</EmptyChart>
            ) : funnelTotal > 0 ? (
              funnelData.map((f) => (
                <div key={f.label}>
                  <div className="mb-1 flex justify-between gap-2 text-xs">
                    <span className="font-medium text-slate-600">{f.label}</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{f.count} <span className="font-normal text-muted-foreground">({f.percent}%)</span></span>
                  </div>
                  <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${f.percent}%`, background: f.color, borderRadius: 3, transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              ))
            ) : (
              <EmptyChart>No leads yet</EmptyChart>
            )}
          </div>
        </div>
      </div>

      {/* --- ROW 3: RECENT PAYMENTS (not for agents) + HOT LEADS --- */}
      <div className={cn('mb-4 grid grid-cols-1 gap-4', !staff && 'lg:grid-cols-[1.2fr_0.8fr]')}>
        {!staff && (
          <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className={sectionTitle}>Recent payments</h3>
              <CreditCard size={15} color={C.muted} />
            </div>
            <div style={{ flex: 1, overflowX: 'auto' }}>
              {paymentsLoading ? (
                <div style={{ padding: 30, textAlign: 'center', color: C.muted, fontSize: 12 }}>Loading payments…</div>
              ) : filteredPayments.length > 0 ? (
                <table style={{ width: '100%', minWidth: 420, borderCollapse: 'collapse', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${C.border}`, fontSize: 10, fontWeight: 600, color: C.muted, textTransform: 'uppercase' }}>
                      <th style={{ padding: '8px 10px' }}>Lead</th>
                      <th style={{ padding: '8px 10px' }}>Details</th>
                      <th style={{ padding: '8px 10px', textAlign: 'right' }}>Amount</th>
                      <th style={{ padding: '8px 10px', textAlign: 'center' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((p) => (
                      <tr key={p.id} className="interactive-row" style={{ borderBottom: `1px solid ${C.border}`, fontSize: 12, color: C.text }} onClick={() => setSelectedLeadId(p.lead_id)}>
                        <td style={{ padding: '10px 10px', fontWeight: 600 }}>{p.lead_name || 'N/A'}</td>
                        <td style={{ padding: '10px 10px', color: C.muted, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description || 'Service Payment'}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'right', fontWeight: 700, color: C.green }}>{fullRupees(p.amount)}</td>
                        <td style={{ padding: '10px 10px', textAlign: 'center' }}>
                          <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize',
                            p.status === 'captured' ? 'bg-green-50 text-green-700' : p.status === 'pending' ? 'bg-amber-50 text-amber-700' : 'bg-red-50 text-red-700')}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <EmptyChart>No payments yet</EmptyChart>
              )}
            </div>
          </div>
        )}

        <div className="dashboard-card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="mb-3 flex items-center gap-1.5">
            <AlertCircle size={15} color={C.red} />
            <h3 className={sectionTitle}>Hot leads</h3>
            <span className="ml-auto rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-700">{hotLeads.length}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, overflowY: 'auto', maxHeight: 280 }}>
            {hotLeads.length > 0 ? (
              hotLeads.slice(0, 5).map((l) => (
                <div key={l.id} onClick={() => setSelectedLeadId(l.id)} className="interactive-row"
                  style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: `${C.red}15`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: C.red, flexShrink: 0 }}>
                    {l.name ? l.name[0].toUpperCase() : 'L'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</p>
                    <p style={{ fontSize: 11, color: C.muted }}>{l.brand_name || 'No brand'}</p>
                  </div>
                  <ScoreBar score={l.score || 0} />
                  <ChevronRight size={14} color={C.muted} />
                </div>
              ))
            ) : (
              <EmptyChart>No hot leads right now</EmptyChart>
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
                <h3 style={{ fontSize: 16, fontWeight: 800, color: C.text, fontFamily: "'Inter', sans-serif" }}>{lead.name}</h3>
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
