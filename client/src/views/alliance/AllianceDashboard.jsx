import React, { useCallback, useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../services/api.js';
import './alliance.css';

const AUDIENCE_COLORS = ['#E4C15A', '#B79BF5', '#8FB2F2', '#5FD69A', '#F29B8F', '#7DD3FC'];
const number = (value) => Number(value) || 0;

const OperationsSnapshot = ({ data = {} }) => (
  <div className="al-card" style={{ marginBottom: 20 }}>
    <div className="al-card-title">Operations snapshot</div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
      {[
        ['Total prospects', data.total_prospects], ['Added this week', data.prospects_added],
        ['Active campaigns', data.active_campaigns], ['Failed messages', data.failed_messages], ['Suppressed', data.suppressed],
      ].map(([label, value]) => <div key={label} style={{ padding: 14, border: '1px solid var(--al-line)', borderRadius: 9 }}>
        <div style={{ color: 'var(--al-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '.7px' }}>{label}</div>
        <div style={{ color: label === 'Failed messages' && number(value) ? '#EF9A9A' : 'var(--al-ink)', fontSize: 24, fontWeight: 700, marginTop: 5 }}>{number(value).toLocaleString()}</div>
      </div>)}
    </div>
  </div>
);

const DailyActivity = ({ rows = [] }) => {
  const chartRows = rows.map((row) => ({
    ...row,
    label: new Date(`${String(row.day).slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' }),
    sent: number(row.sent),
    replies: number(row.replies),
  }));
  return <div className="al-card" style={{ marginBottom: 20 }}>
    <div className="al-card-title">Daily activity</div>
    {chartRows.length ? <div style={{ width: '100%', height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartRows} margin={{ top: 12, right: 18, left: 0, bottom: 2 }} barGap={4} barCategoryGap="35%">
          <CartesianGrid stroke="rgba(112,139,178,.16)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="label" tick={{ fill: '#708BB2', fontSize: 11 }} axisLine={{ stroke: 'rgba(112,139,178,.25)' }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: '#708BB2', fontSize: 11 }} axisLine={false} tickLine={false} width={38} />
          <Tooltip cursor={{ fill: 'rgba(112,139,178,.08)' }} contentStyle={{ background: '#101E35', border: '1px solid rgba(112,139,178,.3)', borderRadius: 8, color: '#EAF1FF' }} />
          <Legend wrapperStyle={{ color: '#8FA7CA', fontSize: 11, paddingTop: 8 }} />
          <Bar dataKey="sent" name="Sent" fill="#D6AA17" radius={[4, 4, 0, 0]} maxBarSize={34} />
          <Bar dataKey="replies" name="Replies" fill="#5FD69A" radius={[4, 4, 0, 0]} maxBarSize={34} />
        </BarChart>
      </ResponsiveContainer>
    </div> : <div style={{ color: 'var(--al-faint)', fontSize: 12 }}>No activity recorded this week.</div>}
  </div>;
};

const CampaignAnalysis = ({ statuses = [], campaigns = [] }) => {
  const statusTotal = statuses.reduce((sum, row) => sum + number(row.count), 0);
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,.7fr) minmax(500px,2fr)', gap: 14, marginTop: 20, overflowX: 'auto' }}>
    <div className="al-card">
      <div className="al-card-title">Campaign health</div>
      {statuses.map((item) => <div key={item.status} style={{ marginBottom: 13 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--al-muted)', fontSize: 12, marginBottom: 5 }}><span style={{ textTransform: 'capitalize' }}>{item.status}</span><b style={{ color: 'var(--al-ink)' }}>{number(item.count)}</b></div>
        <div className="al-bar" style={{ height: 7 }}><i style={{ width: `${statusTotal ? (number(item.count) / statusTotal) * 100 : 0}%` }} /></div>
      </div>)}
      {!statuses.length && <div style={{ color: 'var(--al-faint)', fontSize: 12 }}>No campaigns created yet.</div>}
    </div>
    <div className="al-card" style={{ overflowX: 'auto' }}>
      <div className="al-card-title">Recent campaign performance</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 650, fontSize: 12 }}>
        <thead><tr style={{ color: 'var(--al-faint)', textAlign: 'left' }}>{['Campaign', 'Status', 'Prospects', 'Sent', 'Replies', 'Interested', 'Reply rate'].map((heading) => <th key={heading} style={{ padding: '9px 8px', borderBottom: '1px solid var(--al-line)', fontWeight: 500 }}>{heading}</th>)}</tr></thead>
        <tbody>{campaigns.map((campaign) => <tr key={campaign.row_id || campaign.id} style={{ color: 'var(--al-muted)' }}>
          <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--al-line)', color: 'var(--al-ink)', fontWeight: 600 }}>{campaign.name}<div style={{ color: 'var(--al-faint)', fontSize: 10 }}>{campaign.audience} / {campaign.channel}</div></td>
          {[campaign.status, campaign.prospects, campaign.sent, campaign.replies, campaign.interested].map((value, index) => <td key={index} style={{ padding: '11px 8px', borderBottom: '1px solid var(--al-line)', textTransform: index === 0 ? 'capitalize' : 'none' }}>{index ? number(value) : value}</td>)}
          <td style={{ padding: '11px 8px', borderBottom: '1px solid var(--al-line)', color: 'var(--al-gold2)' }}>{number(campaign.sent) ? Math.round((number(campaign.replies) / number(campaign.sent)) * 1000) / 10 : 0}%</td>
        </tr>)}</tbody>
      </table>
      {!campaigns.length && <div style={{ color: 'var(--al-faint)', fontSize: 12, paddingTop: 10 }}>No campaign performance data available.</div>}
    </div>
  </div>;
};

export const AllianceDashboard = () => {
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAnalytics = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setAnalytics(await api.getAllianceAnalytics());
    } catch (requestError) {
      setError(requestError.message || 'Failed to load analytics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAnalytics();
    const refreshTimer = window.setInterval(loadAnalytics, 30000);
    return () => window.clearInterval(refreshTimer);
  }, [loadAnalytics]);

  const stats = analytics?.stats || {};
  const funnelData = analytics?.funnel || {};
  const contacted = number(funnelData.contacted);
  const funnel = [
    { label: 'Prospects contacted', value: contacted },
    { label: 'Delivered', value: number(funnelData.delivered) },
    { label: 'Replied', value: number(funnelData.replied) },
    { label: 'Interested', value: number(funnelData.interested) },
    { label: 'Closed', value: number(funnelData.closed) },
  ].map((item) => ({ ...item, pct: contacted ? Math.min(100, (item.value / contacted) * 100) : 0 }));

  const sentChange = stats.messages_change_pct;
  const statCards = [
    {
      k: number(stats.messages_sent), label: 'Messages sent', cls: '',
      trend: sentChange == null ? 'No previous-week baseline' : `${sentChange >= 0 ? '↑' : '↓'} ${Math.abs(sentChange)}% vs last week`,
    },
    { k: number(stats.replies), label: 'Replies', trend: `${number(stats.reply_rate)}% reply rate`, cls: 'gold' },
    { k: number(stats.interested), label: 'Interested', trend: `${number(stats.interested_today)} new today`, cls: 'green' },
    { k: number(stats.closed), label: 'Closed', trend: 'Converted or closed this week', cls: 'blue' },
  ];

  return (
    <div className="al-wrap">
      <div className="al-eyebrow">AllianceOS · Analytics</div>
      <div className="al-page-title">This week</div>
      <p className="al-page-desc">
        Live campaign activity from Monday to today.
        {analytics?.generated_at && <span> Updated {new Date(analytics.generated_at).toLocaleTimeString()}.</span>}
      </p>

      {error && (
        <div className="al-card" role="alert" style={{ marginBottom: 20, borderColor: 'rgba(239,154,154,.45)' }}>
          <span style={{ color: '#EF9A9A' }}>{error}</span>
          <button type="button" className="al-btn ghost sm" onClick={loadAnalytics} style={{ marginLeft: 12 }}>Retry</button>
        </div>
      )}

      {loading && !analytics ? (
        <div className="al-card" style={{ color: 'var(--al-muted)' }}>Loading live analytics…</div>
      ) : analytics && (
        <>
          <div className="al-stats">
            {statCards.map((stat) => (
              <div className="al-stat" key={stat.label}>
                <div className={`al-stat-k ${stat.cls}`}>{stat.k.toLocaleString()}</div>
                <div className="al-stat-l">{stat.label}</div>
                <div className="al-stat-t">{stat.trend}</div>
              </div>
            ))}
          </div>

          <OperationsSnapshot data={analytics.operations} />
          <DailyActivity rows={analytics.daily_activity} />

          <div className="al-card" style={{ marginBottom: 20 }}>
            <div className="al-card-title">Conversion funnel</div>
            <div className="al-funnel">
              {funnel.map((item) => (
                <div className="al-frow" key={item.label}>
                  <span className="fl">{item.label}</span>
                  <span className="fbar"><i style={{ width: `${item.pct}%` }} /></span>
                  <span className="fv">{item.value.toLocaleString()}</span>
                </div>
              ))}
            </div>
            {!contacted && <div style={{ marginTop: 12, color: 'var(--al-faint)', fontSize: 12 }}>No prospects have been contacted this week.</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: 14 }}>
            <div className="al-card">
              <div className="al-card-title">By channel</div>
              {(analytics.channels || []).map((channel) => (
                <div key={channel.channel} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                    <span style={{ color: 'var(--al-ink)', textTransform: 'capitalize' }}>{channel.channel}</span>
                    <span style={{ fontFamily: "'IBM Plex Mono',monospace", color: 'var(--al-gold2)' }}>{number(channel.reply_rate)}% reply</span>
                  </div>
                  <div className="al-bar" style={{ height: 9 }}><i className="g" style={{ width: `${Math.min(100, number(channel.reply_rate) * 4)}%` }} /></div>
                  <div style={{ fontSize: 11, color: 'var(--al-faint)', marginTop: 5 }}>{number(channel.sent).toLocaleString()} sent · {number(channel.replied).toLocaleString()} replied</div>
                </div>
              ))}
            </div>

            <div className="al-card">
              <div className="al-card-title">By audience</div>
              {(analytics.audiences || []).map((audience, index) => (
                <div key={audience.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 0', borderTop: '1px solid var(--al-line)', fontSize: 13 }}>
                  <span style={{ color: 'var(--al-muted)' }}>{audience.label}</span>
                  <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontWeight: 600, color: AUDIENCE_COLORS[index % AUDIENCE_COLORS.length] }}>{number(audience.interested)} interested</span>
                </div>
              ))}
              {!analytics.audiences?.length && <div style={{ color: 'var(--al-faint)', fontSize: 12 }}>No active audiences configured.</div>}
            </div>
          </div>
          <CampaignAnalysis statuses={analytics.campaign_statuses} campaigns={analytics.recent_campaigns} />
        </>
      )}
    </div>
  );
};
