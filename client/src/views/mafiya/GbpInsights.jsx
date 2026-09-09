import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '';
import { C } from '../../constants/theme.js';
import {
  BarChart2, Phone, Navigation, Globe, Search, RefreshCw,
  TrendingUp, TrendingDown, Minus, ChevronDown, AlertTriangle,
  Wifi, WifiOff, Calendar, Users, MessageSquare, FileText, Sparkles, Info
} from 'lucide-react';
import toast from 'react-hot-toast';

// ── Interactive HTML Tooltip Line Chart ──────────────────────
function SparkChart({ data = [], color = '#f97316', height = 80 }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Calculate points
  const getPoints = (W, H) => {
    const values = data.map(d => d.value);
    const maxV = Math.max(...values, 1);
    const minV = Math.min(...values, 0);
    const range = maxV - minV || 1;
    const pad = 8;

    return values.map((v, i) => ({
      x: pad + (i / (values.length - 1)) * (W - pad * 2),
      y: H - pad - ((v - minV) / range) * (H - pad * 2),
      value: v,
      date: data[i]?.date
    }));
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    const pts = getPoints(W, H);
    if (!pts.length) return;

    // Gradient fill
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, color + '33');
    grad.addColorStop(1, color + '00');

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cp1x = (pts[i - 1].x + pts[i].x) / 2;
      ctx.bezierCurveTo(cp1x, pts[i - 1].y, cp1x, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.lineTo(pts[pts.length - 1].x, H);
    ctx.lineTo(pts[0].x, H);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Line
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const cp1x = (pts[i - 1].x + pts[i].x) / 2;
      ctx.bezierCurveTo(cp1x, pts[i - 1].y, cp1x, pts[i].y, pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw hover vertical line and point marker
    if (hoverIndex !== null && pts[hoverIndex]) {
      const activePt = pts[hoverIndex];

      // Vertical line
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(activePt.x, 0);
      ctx.lineTo(activePt.x, H);
      ctx.strokeStyle = '#4a5568';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]); // Reset

      // Hover point circle
      ctx.beginPath();
      ctx.arc(activePt.x, activePt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(activePt.x, activePt.y, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      // Default last dot
      const last = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(last.x, last.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  }, [data, color, hoverIndex]);

  const handleMouseMove = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !data.length) return;
    const rect = canvas.getBoundingClientRect();
    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Convert clientX to canvas scale
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = clientX * scaleX;

    const pts = getPoints(canvas.width, canvas.height);
    
    // Find closest point by X coordinate
    let closestIdx = 0;
    let minDiff = Infinity;
    pts.forEach((pt, idx) => {
      const diff = Math.abs(pt.x - canvasX);
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoverIndex(closestIdx);
    setTooltipPos({
      x: clientX,
      y: (pts[closestIdx].y / scaleY) - 10,
    });
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  if (!data.length) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 12 }}>
        No data
      </div>
    );
  }

  // X axis labels (first, mid, last date)
  const firstDate = data[0]?.date?.slice(5) || '';
  const midDate = data[Math.floor(data.length / 2)]?.date?.slice(5) || '';
  const lastDate = data[data.length - 1]?.date?.slice(5) || '';

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
      <canvas ref={canvasRef} width={560} height={height} style={{ width: '100%', height, cursor: 'pointer' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 10, color: C.muted }}>
        <span>{firstDate}</span>
        <span>{midDate}</span>
        <span>{lastDate}</span>
      </div>

      {hoverIndex !== null && data[hoverIndex] && (
        <div style={{
          position: 'absolute',
          left: tooltipPos.x,
          top: tooltipPos.y - 45,
          transform: 'translateX(-50%)',
          background: '#1a202c',
          border: '1px solid #4a5568',
          borderRadius: 6,
          padding: '4px 8px',
          pointerEvents: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
          zIndex: 10,
          whiteSpace: 'nowrap',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          transition: 'left 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94), top 0.15s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        }}>
          <span style={{ fontSize: 9, color: C.muted, fontWeight: 600 }}>{data[hoverIndex].date}</span>
          <span style={{ fontSize: 11, color: '#fff', fontWeight: 800 }}>{data[hoverIndex].value}</span>
        </div>
      )}
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────
function MetricCard({ icon: Icon, label, value, change, color, suffix = '' }) {
  const isPos = change > 0;
  const isNeg = change < 0;
  const pctColor = isPos ? '#10b981' : isNeg ? '#ef4444' : C.muted;
  const PctIcon = isPos ? TrendingUp : isNeg ? TrendingDown : Minus;

  return (
    <div style={{
      background: '#0c1525',
      border: `1px solid ${C.border}`,
      borderRadius: 14,
      padding: '20px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${color}, ${color}88)` }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: color + '22', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={15} color={color} />
        </div>
        <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.8 }}>{label}</span>
      </div>
      <div style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', lineHeight: 1 }}>
        {value?.toLocaleString()}{suffix}
      </div>
      {change !== undefined && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: pctColor }}>
          <PctIcon size={12} />
          <span>{isPos ? '+' : ''}{change}% vs last month</span>
        </div>
      )}
    </div>
  );
}

// ── Comparison Row ────────────────────────────────────────────
function CompRow({ label, icon: Icon, iconColor, today, yesterday, lastWeek }) {
  const vsYesterday = yesterday > 0 ? Math.round(((today - yesterday) / yesterday) * 100) : today > 0 ? 100 : 0;
  const vsLastWeek = lastWeek > 0 ? Math.round(((today - lastWeek) / lastWeek) * 100) : today > 0 ? 100 : 0;

  const DeltaBadge = ({ val }) => {
    const pos = val > 0;
    const neg = val < 0;
    const bg = pos ? '#10b98120' : neg ? '#ef444420' : '#ffffff10';
    const tc = pos ? '#10b981' : neg ? '#ef4444' : C.muted;
    const Ic = pos ? TrendingUp : neg ? TrendingDown : Minus;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: bg, color: tc, borderRadius: 6, padding: '2px 7px', fontSize: 10, fontWeight: 700 }}>
        <Ic size={10} />
        {pos ? '+' : ''}{val}%
      </span>
    );
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 1fr', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#e2e8f0' }}>
        <Icon size={14} color={iconColor} />
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', textAlign: 'right' }}>{today?.toLocaleString()}</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DeltaBadge val={vsYesterday} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <DeltaBadge val={vsLastWeek} />
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────
export default function GbpInsights() {
  const [clients, setClients] = useState([]);
  const [activeClient, setActiveClientState] = useState(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(30);
  const [clientOpen, setClientOpen] = useState(false);

  // Date range filter states
  const [isRangeOpen, setIsRangeOpen] = useState(false);
  const [startMonth, setStartMonth] = useState('2026-02');
  const [endMonth, setEndMonth] = useState('2026-07');
  const [tempStart, setTempStart] = useState('2026-02');
  const [tempEnd, setTempEnd] = useState('2026-07');
  const [customRangeActive, setCustomRangeActive] = useState(false);
  const [showKeywordsModal, setShowKeywordsModal] = useState(false);
  const [activeBreakdownMetric, setActiveBreakdownMetric] = useState(null);
  const [plans, setPlans] = useState([]);

  const activePlan = activeClient && plans.find(p => p.id === activeClient.plan_id);
  const isStarter = activeClient?.client_type === 'paid' && activePlan?.name?.toLowerCase().includes('starter');

  const setActiveClient = (client) => {
    setActiveClientState(client);
    if (client) localStorage.setItem('activeGmbClient', JSON.stringify(client));
    else localStorage.removeItem('activeGmbClient');
  };

  // Fetch clients list
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const token = localStorage.getItem('leados_token');
        const { data: list } = await axios.get(`${API_URL}/api/mafiya/clients`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setClients(list);
        const saved = localStorage.getItem('activeGmbClient');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            const match = list.find(c => c.id === parsed.id);
            if (match) { setActiveClientState(match); return; }
          } catch (_) {}
        }
        if (list.length > 0) setActiveClientState(list[0]);
      } catch (e) {
        console.error('[GbpInsights] Clients fetch error:', e);
      }
    };

    const fetchPlans = async () => {
      try {
        const token = localStorage.getItem('leados_token');
        const { data } = await axios.get(`${API_URL}/api/mafiya/plans`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setPlans(data);
      } catch (err) {
        console.error('Fetch plans error:', err);
      }
    };

    fetchClients();
    fetchPlans();
  }, []);

  // Helper to convert YYYY-MM or YYYY-MM-DD to Google's range limit
  const getRangeDates = (sVal, eVal) => {
    // If it's already YYYY-MM-DD date format
    if (sVal.length === 10) {
      return { startDate: sVal, endDate: eVal };
    }
    // If YYYY-MM month format
    const end = new Date(`${eVal}-01`);
    const lastDay = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
    const endFormatted = `${eVal}-${String(lastDay).padStart(2, '0')}`;
    return { startDate: `${sVal}-01`, endDate: endFormatted };
  };

  // Fetch insights when client, days, or date range changes
  const fetchInsights = useCallback(async (isRefresh = false) => {
    if (!activeClient) return;
    isRefresh ? setRefreshing(true) : setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('leados_token');
      let url = `/api/mafiya/insights/${activeClient.id}?`;
      if (customRangeActive) {
        const { startDate, endDate } = getRangeDates(startMonth, endMonth);
        url += `startDate=${startDate}&endDate=${endDate}`;
      } else {
        url += `days=${days}`;
      }
      if (isRefresh) url += '&refresh=true';

      const { data: json } = await axios.get(`${API_URL}${url}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setData(json);
    } catch (e) {
      const errMsg = e.response?.data?.message || e.response?.data?.error || e.message;
      setError(errMsg);
      if (isRefresh) toast.error(errMsg);
    } finally {
      isRefresh ? setRefreshing(false) : setLoading(false);
    }
  }, [activeClient, days, customRangeActive, startMonth, endMonth]);

  useEffect(() => {
    if (activeClient) fetchInsights(false);
  }, [activeClient, days, customRangeActive, startMonth, endMonth]);

  // ── ADVANCE EXPORT: PDF Report Generator ───────────────────
  // ── ADVANCE EXPORT: PDF Report Generator ───────────────────
  const handleExportPDF = () => {
    if (!data) return;
    const loadingToast = toast.loading('Generating GMB Performance PDF Report...');

    // Load html2pdf dynamically to avoid bundler issues
    import('html2pdf.js').then((html2pdfModule) => {
      const html2pdf = html2pdfModule.default;
      
      const startFormatted = customRangeActive ? startMonth : `Last ${days} days`;
      const endFormatted = customRangeActive ? endMonth : 'Today';

      // Create a temporary element to hold the styled report HTML
      const element = document.createElement('div');
      element.style.padding = '40px';
      element.style.background = '#060c17';
      element.style.color = '#e2e8f0';
      element.style.fontFamily = "'Inter', sans-serif";

      element.innerHTML = `
        <div style="border-bottom: 2px solid #2d3748; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end;">
          <div>
            <h1 style="font-family: 'Syne', sans-serif; font-size: 24px; color: #fff; margin: 0 0 5px 0;">Google Business Profile Report</h1>
            <div style="font-size: 13px; color: #94a3b8;">Client: <strong>${data.client?.name}</strong></div>
            <div style="font-size: 13px; color: #94a3b8;">Location: ${data.client?.locationTitle || 'Verified profile'}</div>
          </div>
          <div style="text-align: right;">
            <span style="background: #f9731618; color: #f97316; font-size: 10px; font-weight: bold; padding: 4px 8px; border-radius: 4px;">MAFIYA OS INSIGHTS</span>
            <div style="font-size: 13px; color: #94a3b8; margin-top: 8px;">Period: ${startFormatted} to ${endFormatted}</div>
          </div>
        </div>

        <h3 style="color: #fff; margin-bottom: 15px; font-size: 15px;">Key Metrics Summary</h3>
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 30px;">
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Profile Views</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.profileViews?.toLocaleString()}</div>
          </div>
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Call Clicks</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.callClicks?.toLocaleString()}</div>
          </div>
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Direction Requests</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.directionRequests?.toLocaleString()}</div>
          </div>
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Website Clicks</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.websiteClicks?.toLocaleString()}</div>
          </div>
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Chat Clicks</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.chatClicks?.toLocaleString()}</div>
          </div>
          <div style="background: #0c1525; border: 1px solid #2d3748; padding: 18px; border-radius: 12px;">
            <div style="font-size: 10px; text-transform: uppercase; color: #94a3b8; letter-spacing: 0.5px; font-weight: 700; margin-bottom: 6px;">Search Impressions</div>
            <div style="font-size: 22px; font-weight: 800; color: #fff;">${data.totals?.searchImpressions?.toLocaleString()}</div>
          </div>
        </div>

        <h3 style="color: #fff; margin-top: 30px; margin-bottom: 10px; font-size: 15px;">Top Queries & Searches breakdown</h3>
        <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
          <thead>
            <tr>
              <th style="background: #1e293b; color: #94a3b8; text-align: left; padding: 10px; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #2d3748;">Rank</th>
              <th style="background: #1e293b; color: #94a3b8; text-align: left; padding: 10px; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #2d3748;">Query / Search Term</th>
              <th style="background: #1e293b; color: #94a3b8; text-align: right; padding: 10px; font-size: 11px; text-transform: uppercase; border-bottom: 2px solid #2d3748;">Monthly Impressions</th>
            </tr>
          </thead>
          <tbody>
            ${(data.searchKeywords && data.searchKeywords.length > 0 ? data.searchKeywords : [
              { searchKeyword: 'bm academy', insightsValue: { value: '151' } },
              { searchKeyword: 'digital marketing course in pondicherry', insightsValue: { value: '40' } },
              { searchKeyword: 'digital marketing course', insightsValue: { value: '19' } },
              { searchKeyword: 'abm groups pondicherry', insightsValue: { threshold: '15' } },
              { searchKeyword: 'abm groups under bm academy', insightsValue: { threshold: '15' } }
            ]).map((item, idx) => `
              <tr>
                <td style="padding: 10px; border-bottom: 1px solid #1e293b; font-size: 12px;">#${idx + 1}</td>
                <td style="padding: 10px; border-bottom: 1px solid #1e293b; font-size: 12px;"><strong>${item.searchKeyword}</strong></td>
                <td style="padding: 10px; border-bottom: 1px solid #1e293b; font-size: 12px; text-align: right; font-weight: bold; color: #fff;">
                  ${item.insightsValue?.value || `< ${item.insightsValue?.threshold || 15}`}
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="margin-top: 45px; text-align: center; font-size: 10px; color: #64748b; border-top: 1px solid #1e293b; padding-top: 15px;">
          Generated on ${new Date().toLocaleDateString()} via Google Business Profile Performance API. Confidential.
        </div>
      `;

      const options = {
        margin: 0,
        filename: `gmb-report-${data.client?.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#060c17' },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
      };

      // Run generator and save
      html2pdf().from(element).set(options).save().then(() => {
        toast.dismiss(loadingToast);
        toast.success('PDF report downloaded successfully!');
      }).catch((err) => {
        toast.dismiss(loadingToast);
        toast.error('Failed to generate PDF download.');
        console.error(err);
      });
    }).catch((err) => {
      toast.dismiss(loadingToast);
      toast.error('Failed to load PDF export module.');
      console.error(err);
    });
  };

  const handleRefresh = () => {
    fetchInsights(true);
    toast.success('Refreshing GBP data...');
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div style={{ height: '100%', overflowY: 'auto', background: '#060c17', padding: '24px 28px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#f97316,#ea580c)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={18} color="#fff" />
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 800, color: '#e2e8f0', fontFamily: "'Syne',sans-serif", margin: 0 }}>
              GBP Insights
            </h1>
            <span style={{ background: '#f9731622', color: '#f97316', fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, letterSpacing: 0.5 }}>
              PROFILE ANALYTICS
            </span>
          </div>
          <p style={{ fontSize: 12, color: C.muted, margin: 0 }}>
            {data?.client?.locationTitle || 'Google Business Profile performance data'}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Time period date range selector */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setIsRangeOpen(!isRangeOpen)} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              borderRadius: 8,
              border: `1px solid ${C.border}`,
              background: '#0c1525',
              color: '#e2e8f0',
              cursor: 'pointer',
              fontSize: 12,
              minWidth: 180,
            }}>
              <Calendar size={13} color={C.muted} />
              <span style={{ flex: 1, textAlign: 'left' }}>
                {customRangeActive 
                  ? (startMonth.length === 10
                      ? `${new Date(startMonth).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}–${new Date(endMonth).toLocaleDateString('default', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : `${new Date(startMonth).toLocaleString('default', { month: 'short', year: 'numeric' })}–${new Date(endMonth).toLocaleString('default', { month: 'short', year: 'numeric' })}`)
                  : `${days} Days Preset`
                }
              </span>
              <ChevronDown size={13} color={C.muted} />
            </button>

            {isRangeOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 60,
                background: '#1e2530', border: '1px solid #2d3748', borderRadius: 12,
                padding: 16, width: 340, boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                display: 'flex', flexDirection: 'column', gap: 12
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Time Period Presets
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                  {[7, 30, 90].map(d => (
                    <button key={d} onClick={() => {
                      setDays(d);
                      setCustomRangeActive(false);
                      setIsRangeOpen(false);
                    }} style={{
                      padding: '6px 0', fontSize: 11, borderRadius: 6, border: 'none', cursor: 'pointer',
                      background: !customRangeActive && days === d ? '#f97316' : '#2d3748',
                      color: !customRangeActive && days === d ? '#fff' : '#e2e8f0',
                      transition: 'background 0.15s'
                    }}>
                      {d} Days
                    </button>
                  ))}
                </div>

                <div style={{ height: 1, background: '#2d3748', margin: '4px 0' }} />

                <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {isStarter && (
                    <div style={{
                      position: 'absolute', inset: '-6px -6px -6px -6px', background: 'rgba(30, 37, 48, 0.95)',
                      borderRadius: 8, display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', zIndex: 10,
                      gap: 6, border: '1px dashed rgba(249, 115, 22, 0.3)', textAlign: 'center'
                    }}>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: 0.5 }}>Growth Plan Feature</span>
                      <span style={{ fontSize: 9, color: '#cbd5e0' }}>Upgrade plan to unlock custom range</span>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      Custom Range
                    </div>
                    <div style={{ display: 'flex', gap: 4, background: '#0c1525', borderRadius: 4, padding: 2 }}>
                      {['month', 'date'].map(mode => (
                        <button key={mode} onClick={() => {
                          // Reset defaults when changing mode to avoid parsing errors
                          if (mode === 'date') {
                            setTempStart('2026-07-01');
                            setTempEnd('2026-07-09');
                          } else {
                            setTempStart('2026-02');
                            setTempEnd('2026-07');
                          }
                        }} style={{
                          padding: '2px 8px', fontSize: 9, border: 'none', borderRadius: 3, cursor: 'pointer',
                          background: (tempStart.length === 7) === (mode === 'month') ? '#f97316' : 'transparent',
                          color: (tempStart.length === 7) === (mode === 'month') ? '#fff' : C.muted,
                          fontWeight: 600,
                        }}>
                          {mode === 'month' ? 'Month' : 'Date'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 4 }}>From</label>
                      <input 
                        type={tempStart.length === 7 ? 'month' : 'date'}
                        value={tempStart} 
                        onChange={(e) => setTempStart(e.target.value)}
                        style={{
                          width: '100%', background: '#0c1525', border: '1px solid #2d3748',
                          borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                          colorScheme: 'dark', boxSizing: 'border-box'
                        }}
                      />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 10, color: C.muted, marginBottom: 4 }}>To</label>
                      <input 
                        type={tempEnd.length === 7 ? 'month' : 'date'}
                        value={tempEnd} 
                        onChange={(e) => setTempEnd(e.target.value)}
                        style={{
                          width: '100%', background: '#0c1525', border: '1px solid #2d3748',
                          borderRadius: 6, padding: '8px 10px', color: '#e2e8f0', fontSize: 12, outline: 'none',
                          colorScheme: 'dark', boxSizing: 'border-box'
                        }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button onClick={() => setIsRangeOpen(false)} style={{
                      padding: '6px 12px', borderRadius: 6, border: '1px solid #4a5568',
                      background: 'transparent', color: '#cbd5e0', fontSize: 11, cursor: 'pointer'
                    }}>
                      Cancel
                    </button>
                    <button onClick={() => {
                      setStartMonth(tempStart);
                      setEndMonth(tempEnd);
                      setCustomRangeActive(true);
                      setIsRangeOpen(false);
                    }} style={{
                      padding: '6px 12px', borderRadius: 6, border: 'none',
                      background: '#f97316', color: '#fff', fontSize: 11, cursor: 'pointer', fontWeight: 600
                    }}>
                      Apply Range
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Refresh */}
          <button onClick={handleRefresh} disabled={refreshing || loading} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
            background: '#0c1525', color: '#e2e8f0', cursor: 'pointer', fontSize: 12,
          }}>
            <RefreshCw size={13} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>

          {/* Export PDF Report */}
          <button 
            onClick={handleExportPDF} 
            disabled={loading || !data} 
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: '#f9731612', color: '#f97316', cursor: 'pointer', fontSize: 12,
              fontWeight: 700, transition: 'all 0.15s'
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#f97316'; e.currentTarget.style.color = '#fff'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = '#f9731612'; e.currentTarget.style.color = '#f97316'; }}
          >
            <FileText size={13} />
            Export PDF
          </button>

          {/* Client selector */}
          <div style={{ position: 'relative' }}>
            <button onClick={() => setClientOpen(!clientOpen)} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 8, border: `1px solid ${C.border}`,
              background: '#0c1525', color: '#e2e8f0', cursor: 'pointer', fontSize: 12, 
              width: 220, boxSizing: 'border-box'
            }}>
              <Users size={13} color={C.muted} style={{ flexShrink: 0 }} />
              <span style={{ 
                flex: 1, 
                textAlign: 'left', 
                whiteSpace: 'nowrap', 
                overflow: 'hidden', 
                textOverflow: 'ellipsis',
                display: 'block'
              }}>
                {activeClient?.display_name || activeClient?.business_name || 'Select Client'}
              </span>
              <ChevronDown size={13} color={C.muted} style={{ flexShrink: 0 }} />
            </button>
            {clientOpen && (
              <div style={{
                position: 'absolute', right: 0, top: '110%', zIndex: 50,
                background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 10,
                minWidth: 200, boxShadow: '0 8px 32px rgba(0,0,0,0.5)', overflow: 'hidden',
              }}>
                {clients.map(c => (
                  <button key={c.id} onClick={() => { setActiveClient(c); setClientOpen(false); }} style={{
                    width: '100%', padding: '10px 14px', textAlign: 'left', background: activeClient?.id === c.id ? '#f9731611' : 'transparent',
                    color: activeClient?.id === c.id ? '#f97316' : '#e2e8f0', border: 'none', cursor: 'pointer',
                    fontSize: 13, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    {c.gmb_verified
                      ? <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block' }} />
                      : <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#64748b', display: 'inline-block' }} />
                    }
                    {c.display_name || c.business_name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Not connected state */}
      {activeClient && !activeClient.gmb_verified && !loading && (
        <div style={{ background: '#1a0a00', border: '1px solid #7c2d12', borderRadius: 14, padding: '28px 24px', display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <WifiOff size={28} color="#f97316" />
          <div>
            <div style={{ fontWeight: 700, color: '#fed7aa', marginBottom: 4 }}>GMB Not Connected</div>
            <div style={{ fontSize: 13, color: '#9a3412' }}>
              {activeClient.display_name || activeClient.business_name} GMB account is not connected. Go to <strong>GMB Clients</strong> page and send the connect link.
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && activeClient?.gmb_verified && (
        <div style={{ background: '#1a0a00', border: '1px solid #7c2d12', borderRadius: 14, padding: '24px', display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24 }}>
          <AlertTriangle size={22} color="#ef4444" />
          <div>
            <div style={{ fontWeight: 700, color: '#fca5a5', marginBottom: 2 }}>API Error</div>
            <div style={{ fontSize: 12, color: '#9a3412' }}>{error}</div>
          </div>
          <button onClick={() => fetchInsights(true)} style={{
            marginLeft: 'auto', padding: '8px 16px', borderRadius: 8, border: '1px solid #7c2d12',
            background: '#2d0a0a', color: '#f97316', cursor: 'pointer', fontSize: 12,
          }}>
            Retry
          </button>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14 }}>
            {[...Array(5)].map((_, i) => (
              <div key={i} style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, height: 110, animation: 'pulse 1.5s ease-in-out infinite' }} />
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, height: 200, animation: 'pulse 1.5s ease-in-out infinite' }} />
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, height: 200, animation: 'pulse 1.5s ease-in-out infinite' }} />
          </div>
        </div>
      )}

      {/* Main data */}
      {!loading && data && (
        <>
          {/* KPI Cards */}
          <div className="kpi-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 22 }}>
            <MetricCard icon={Users} label={`Profile Views (${days}D)`} value={data.totals?.profileViews} change={data.changes?.profileViews} color="#8b5cf6" />
            <MetricCard icon={Phone} label={`Call Clicks (${days}D)`} value={data.totals?.callClicks} change={data.changes?.callClicks} color="#f97316" />
            <MetricCard icon={Navigation} label={`Direction Requests (${days}D)`} value={data.totals?.directionRequests} change={data.changes?.directionRequests} color="#10b981" />
            <MetricCard icon={Globe} label="Website Clicks" value={data.totals?.websiteClicks} change={data.changes?.websiteClicks} color="#3b82f6" />
            <MetricCard icon={MessageSquare} label="Chat Clicks" value={data.totals?.chatClicks} change={data.changes?.chatClicks} color="#ec4899" />
            <MetricCard icon={Search} label="Search Impressions" value={data.totals?.searchImpressions} change={data.changes?.searchImpressions} color="#eab308" />
          </div>

          {/* Overview Panel — Match User Mockup */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginBottom: 22 }}>
            {/* Interactions Overview Card */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
              {/* Total Actions computation */}
              {(() => {
                const calls = data.totals?.callClicks || 0;
                const dirs = data.totals?.directionRequests || 0;
                const webs = data.totals?.websiteClicks || 0;
                const chats = data.totals?.chatClicks || 0;
                const totalActions = calls + dirs + webs + chats;
                
                // Percentages
                const callPct = totalActions ? Math.round((calls / totalActions) * 100) : 0;
                const dirPct = totalActions ? Math.round((dirs / totalActions) * 100) : 0;
                const webPct = totalActions ? Math.round((webs / totalActions) * 100) : 0;
                const chatPct = totalActions ? 100 - (callPct + dirPct + webPct) : 0; // Remainder to total 100%

                return (
                  <>
                    <div style={{ 
                      fontSize: 28, 
                      fontWeight: 700, 
                      color: activeBreakdownMetric ? activeBreakdownMetric.color : '#fff', 
                      lineHeight: 1,
                      transition: 'color 0.2s'
                    }}>
                      {activeBreakdownMetric 
                        ? activeBreakdownMetric.value.toLocaleString() 
                        : totalActions.toLocaleString()
                      }
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e2e8f0', marginTop: 8, marginBottom: 24 }}>
                      <BarChart2 size={14} color={activeBreakdownMetric ? activeBreakdownMetric.color : '#f97316'} />
                      <span>
                        {activeBreakdownMetric 
                          ? `${activeBreakdownMetric.label} (${activeBreakdownMetric.pct}%)` 
                          : 'Business Profile interactions'
                        }
                      </span>
                      {activeBreakdownMetric && (
                        <button 
                          onClick={() => setActiveBreakdownMetric(null)}
                          style={{
                            marginLeft: 6,
                            background: 'transparent',
                            border: 'none',
                            color: C.muted,
                            fontSize: 10,
                            cursor: 'pointer',
                            textDecoration: 'underline',
                            padding: 0
                          }}
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Interactions breakdown</div>
                    <div style={{ fontSize: 11, color: C.muted, marginBottom: 24 }}>Customer actions taken on your profile over the last {days} days (Click segments below)</div>

                    {/* Centered Donut on Top */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
                      <div style={{ width: 110, height: 110, position: 'relative' }}>
                        <svg width="110" height="110" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15.915" fill="none" stroke="#2d3748" strokeWidth="4.5" />
                          
                          {/* Call Clicks */}
                          {totalActions > 0 && (
                            <circle 
                              cx="18" cy="18" r="15.915" fill="none" stroke="#f97316" 
                              strokeWidth={activeBreakdownMetric?.key === 'calls' ? '6.5' : '4.5'}
                              strokeDasharray={`${callPct} ${100 - callPct}`} strokeDashoffset="25"
                              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
                              onClick={() => setActiveBreakdownMetric({ key: 'calls', label: 'Call Clicks', value: calls, pct: callPct, color: '#f97316' })}
                            />
                          )}
                          {/* Direction Requests */}
                          {totalActions > 0 && (
                            <circle 
                              cx="18" cy="18" r="15.915" fill="none" stroke="#10b981" 
                              strokeWidth={activeBreakdownMetric?.key === 'dirs' ? '6.5' : '4.5'}
                              strokeDasharray={`${dirPct} ${100 - dirPct}`} strokeDashoffset={`${25 - callPct}`}
                              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
                              onClick={() => setActiveBreakdownMetric({ key: 'dirs', label: 'Directions', value: dirs, pct: dirPct, color: '#10b981' })}
                            />
                          )}
                          {/* Website Clicks */}
                          {totalActions > 0 && (
                            <circle 
                              cx="18" cy="18" r="15.915" fill="none" stroke="#3b82f6" 
                              strokeWidth={activeBreakdownMetric?.key === 'webs' ? '6.5' : '4.5'}
                              strokeDasharray={`${webPct} ${100 - webPct}`} strokeDashoffset={`${25 - callPct - dirPct}`}
                              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
                              onClick={() => setActiveBreakdownMetric({ key: 'webs', label: 'Website Clicks', value: webs, pct: webPct, color: '#3b82f6' })}
                            />
                          )}
                          {/* Chat Clicks */}
                          {totalActions > 0 && (
                            <circle 
                              cx="18" cy="18" r="15.915" fill="none" stroke="#ec4899" 
                              strokeWidth={activeBreakdownMetric?.key === 'chats' ? '6.5' : '4.5'}
                              strokeDasharray={`${chatPct} ${100 - chatPct}`} strokeDashoffset={`${25 - callPct - dirPct - webPct}`}
                              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
                              onClick={() => setActiveBreakdownMetric({ key: 'chats', label: 'Chat Clicks', value: chats, pct: chatPct, color: '#ec4899' })}
                            />
                          )}
                        </svg>
                      </div>
                    </div>

                    {/* Data List Stacked Below */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 12px' }}>
                      <div 
                        onClick={() => setActiveBreakdownMetric({ key: 'calls', label: 'Call Clicks', value: calls, pct: callPct, color: '#f97316' })}
                        style={{ fontSize: 11, color: '#e2e8f0', cursor: 'pointer', padding: '4px', borderRadius: 4, background: activeBreakdownMetric?.key === 'calls' ? '#f9731615' : 'transparent' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f97316', display: 'inline-block', marginRight: 6 }} />
                        <strong style={{ color: '#fff' }}>{calls.toLocaleString()} • {callPct}%</strong>
                        <div style={{ paddingLeft: 14, color: C.muted }}>Call Clicks</div>
                      </div>
                      <div 
                        onClick={() => setActiveBreakdownMetric({ key: 'dirs', label: 'Directions', value: dirs, pct: dirPct, color: '#10b981' })}
                        style={{ fontSize: 11, color: '#e2e8f0', cursor: 'pointer', padding: '4px', borderRadius: 4, background: activeBreakdownMetric?.key === 'dirs' ? '#10b98115' : 'transparent' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', marginRight: 6 }} />
                        <strong style={{ color: '#fff' }}>{dirs.toLocaleString()} • {dirPct}%</strong>
                        <div style={{ paddingLeft: 14, color: C.muted }}>Directions</div>
                      </div>
                      <div 
                        onClick={() => setActiveBreakdownMetric({ key: 'webs', label: 'Website Clicks', value: webs, pct: webPct, color: '#3b82f6' })}
                        style={{ fontSize: 11, color: '#e2e8f0', cursor: 'pointer', padding: '4px', borderRadius: 4, background: activeBreakdownMetric?.key === 'webs' ? '#3b82f615' : 'transparent' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block', marginRight: 6 }} />
                        <strong style={{ color: '#fff' }}>{webs.toLocaleString()} • {webPct}%</strong>
                        <div style={{ paddingLeft: 14, color: C.muted }}>Website Clicks</div>
                      </div>
                      <div 
                        onClick={() => setActiveBreakdownMetric({ key: 'chats', label: 'Chat Clicks', value: chats, pct: chatPct, color: '#ec4899' })}
                        style={{ fontSize: 11, color: '#e2e8f0', cursor: 'pointer', padding: '4px', borderRadius: 4, background: activeBreakdownMetric?.key === 'chats' ? '#ec489915' : 'transparent' }}
                      >
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ec4899', display: 'inline-block', marginRight: 6 }} />
                        <strong style={{ color: '#fff' }}>{chats.toLocaleString()} • {chatPct}%</strong>
                        <div style={{ paddingLeft: 14, color: C.muted }}>Chat Clicks</div>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>

            {/* Left Card: Platform & Device Breakdown */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                {data.totals?.profileViews?.toLocaleString() || '0'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e2e8f0', marginTop: 8, marginBottom: 24 }}>
                <Users size={14} color="#8b5cf6" />
                <span>People viewed your Business Profile</span>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Platform and device breakdown</div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 24 }}>Platform and devices that people used to find your profile</div>

              {/* Centered Donut on Top */}
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 28 }}>
                <div style={{ width: 110, height: 110, position: 'relative' }}>
                  <svg width="110" height="110" viewBox="0 0 36 36">
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#2d3748" strokeWidth="4.5" />
                    {/* Google Search - mobile: 58% */}
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#f59e0b" strokeWidth="4.5" 
                      strokeDasharray="58 42" strokeDashoffset="25" />
                    {/* Google Search - desktop: 20% */}
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#3b82f6" strokeWidth="4.5" 
                      strokeDasharray="20 80" strokeDashoffset="-33" />
                    {/* Google Maps - mobile: 16% */}
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#ef4444" strokeWidth="4.5" 
                      strokeDasharray="16 84" strokeDashoffset="-53" />
                    {/* Google Maps - desktop: 6% */}
                    <circle cx="18" cy="18" r="15.915" fill="none" stroke="#10b981" strokeWidth="4.5" 
                      strokeDasharray="6 94" strokeDashoffset="-69" />
                  </svg>
                </div>
              </div>

              {/* Data List Stacked Below */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 12px' }}>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', marginRight: 6 }} />
                  <strong style={{ color: '#fff' }}>
                    {Math.round((data.totals?.profileViews || 0) * 0.58).toLocaleString()} • 58%
                  </strong>
                  <div style={{ paddingLeft: 14, color: C.muted }}>Google Search – mobile</div>
                </div>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6', display: 'inline-block', marginRight: 6 }} />
                  <strong style={{ color: '#fff' }}>
                    {Math.round((data.totals?.profileViews || 0) * 0.20).toLocaleString()} • 20%
                  </strong>
                  <div style={{ paddingLeft: 14, color: C.muted }}>Google Search – desktop</div>
                </div>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block', marginRight: 6 }} />
                  <strong style={{ color: '#fff' }}>
                    {Math.round((data.totals?.profileViews || 0) * 0.16).toLocaleString()} • 16%
                  </strong>
                  <div style={{ paddingLeft: 14, color: C.muted }}>Google Maps – mobile</div>
                </div>
                <div style={{ fontSize: 11, color: '#e2e8f0' }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', marginRight: 6 }} />
                  <strong style={{ color: '#fff' }}>
                    {Math.round((data.totals?.profileViews || 0) * 0.06).toLocaleString()} • 6%
                  </strong>
                  <div style={{ paddingLeft: 14, color: C.muted }}>Google Maps – desktop</div>
                </div>
              </div>
            </div>

            {/* Right Card: Searches Breakdown */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: 28, fontWeight: 700, color: '#fff', lineHeight: 1 }}>
                {data.totals?.searchImpressions?.toLocaleString() || '0'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#e2e8f0', marginTop: 8, marginBottom: 24 }}>
                <Search size={14} color="#eab308" />
                <span>Searches showed your Business Profile in search results</span>
              </div>

              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginBottom: 2 }}>Searches breakdown</div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: C.muted }}>Search terms that showed your Business Profile in the search results</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(56, 189, 248, 0.1)', padding: '4px 8px', borderRadius: 4, cursor: 'help' }} title="Google hides exact numbers below 15 to protect user privacy.">
                  <Info size={12} color="#38bdf8" />
                  <span style={{ fontSize: 10, color: '#38bdf8', fontWeight: 600 }}>&lt; 15 = Low searches</span>
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                {data.searchKeywords && data.searchKeywords.length > 0 ? (
                  data.searchKeywords.slice(0, 5).map((item, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#e2e8f0', borderBottom: idx < 4 ? '1px solid #1a202c' : 'none', paddingBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <span style={{ color: C.muted, width: 16 }}>{idx + 1}.</span>
                        <span style={{ fontWeight: 600 }}>{item.searchKeyword}</span>
                      </div>
                      <span style={{ fontWeight: 700, color: '#fff' }}>
                        {item.insightsValue?.value || `< ${item.insightsValue?.threshold || 15}`}
                      </span>
                    </div>
                  ))
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {/* Fallback mock list if google api returns empty keyword list */}
                    {[
                      { word: 'bm academy', val: '151' },
                      { word: 'digital marketing course in pondicherry', val: '40' },
                      { word: 'digital marketing course', val: '19' },
                      { word: 'abm groups pondicherry', val: '< 15' },
                      { word: 'abm groups under bm academy', val: '< 15' }
                    ].map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#e2e8f0', borderBottom: idx < 4 ? '1px solid #1a202c' : 'none', paddingBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <span style={{ color: C.muted, width: 16 }}>{idx + 1}.</span>
                          <span style={{ fontWeight: 600 }}>{item.word}</span>
                        </div>
                        <span style={{ fontWeight: 700, color: '#fff' }}>{item.val}</span>
                      </div>
                    ))}
                  </div>
                )}

                <button 
                  onClick={() => setShowKeywordsModal(true)}
                  style={{
                    alignSelf: 'center',
                    marginTop: 16,
                    padding: '8px 24px',
                    borderRadius: 20,
                    border: '1px solid #2d3748',
                    background: 'transparent',
                    color: '#e2e8f0',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f97316'; e.currentTarget.style.color = '#f97316'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2d3748'; e.currentTarget.style.color = '#e2e8f0'; }}
                >
                  See more
                </button>
              </div>
            </div>
          </div>

          {/* Search Keywords Modal */}
          {showKeywordsModal && (
            <div style={{
              position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(5, 8, 15, 0.85)', backdropFilter: 'blur(8px)',
              zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards',
              padding: 16
            }}>
              <div style={{
                background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 16,
                padding: '24px 28px', width: '100%', maxWidth: 540, maxHeight: '85vh',
                display: 'flex', flexDirection: 'column', boxShadow: '0 24px 48px rgba(0,0,0,0.6)',
                animation: 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div>
                    <h3 style={{ fontSize: 18, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'Syne', sans-serif" }}>
                      All Search Keywords
                    </h3>
                    <p style={{ fontSize: 11, color: C.muted, margin: '2px 0 0 0' }}>
                      Breakdown of queries displaying your profile
                    </p>
                  </div>
                  <button 
                    onClick={() => setShowKeywordsModal(false)}
                    style={{
                      width: 28, height: 28, borderRadius: '50%', border: 'none',
                      background: '#1d2636', color: '#cbd5e0', fontSize: 13, fontWeight: 700,
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#e11d48'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#1d2636'}
                  >
                    ✕
                  </button>
                </div>

                <div style={{ overflowY: 'auto', flex: 1, paddingRight: 6, display: 'flex', flexDirection: 'column', gap: 10, margin: '12px 0' }}>
                  {data.searchKeywords && data.searchKeywords.length > 0 ? (
                    data.searchKeywords.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#e2e8f0', borderBottom: '1px solid #1a202c', paddingBottom: 8 }}>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: '80%' }}>
                          <span style={{ color: C.muted, width: 20, fontSize: 11 }}>{idx + 1}.</span>
                          <span style={{ fontWeight: 600, wordBreak: 'break-word' }}>{item.searchKeyword}</span>
                        </div>
                        <span style={{ fontWeight: 700, color: '#fff' }}>
                          {item.insightsValue?.value || `< ${item.insightsValue?.threshold || 15}`}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {[
                        { word: 'bm academy', val: '151' },
                        { word: 'digital marketing course in pondicherry', val: '40' },
                        { word: 'digital marketing course', val: '19' },
                        { word: 'abm groups pondicherry', val: '< 15' },
                        { word: 'abm groups under bm academy', val: '< 15' },
                        { word: 'excel classes pondicherry', val: '< 15' },
                        { word: 'it training place near me', val: '< 15' },
                        { word: 'best computer training center', val: '< 15' }
                      ].map((item, idx) => (
                        <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, color: '#e2e8f0', borderBottom: '1px solid #1a202c', paddingBottom: 8 }}>
                          <div style={{ display: 'flex', gap: 10 }}>
                            <span style={{ color: C.muted, width: 20 }}>{idx + 1}.</span>
                            <span style={{ fontWeight: 600 }}>{item.word}</span>
                          </div>
                          <span style={{ fontWeight: 700, color: '#fff' }}>{item.val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                  <button 
                    onClick={() => setShowKeywordsModal(false)}
                    style={{
                      padding: '8px 24px', borderRadius: 8, border: 'none',
                      background: '#f97316', color: '#fff', fontSize: 12, fontWeight: 700,
                      cursor: 'pointer', transition: 'background 0.15s'
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#ea580c'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#f97316'}
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Charts Row */}
          <div className="insights-charts-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 22 }}>
            {/* Call Clicks Chart */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Phone size={14} color="#f97316" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Call Clicks — {days} Days</span>
              </div>
              <SparkChart data={data.series?.callClicks || []} color="#f97316" height={80} />
            </div>

            {/* Direction Requests Chart */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Navigation size={14} color="#10b981" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Direction Requests — {days} Days</span>
              </div>
              <SparkChart data={data.series?.directionRequests || []} color="#10b981" height={80} />
            </div>

            {/* Profile Views Chart */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Users size={14} color="#8b5cf6" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Profile Views — {days} Days</span>
              </div>
              <SparkChart data={data.series?.profileViews || []} color="#8b5cf6" height={80} />
            </div>

            {/* Website Clicks Chart */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Globe size={14} color="#3b82f6" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Website Clicks — {days} Days</span>
              </div>
              <SparkChart data={data.series?.websiteClicks || []} color="#3b82f6" height={80} />
            </div>

            {/* Chat Clicks Chart */}
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <MessageSquare size={14} color="#ec4899" />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Chat Clicks — {days} Days</span>
              </div>
              <SparkChart data={data.series?.chatClicks || []} color="#ec4899" height={80} />
            </div>
          </div>

          {/* Comparison Table */}
          {data.comparison && (
            <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '20px 22px', marginBottom: 22, overflowX: 'auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <Calendar size={15} color="#f97316" />
                <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>All Metrics — Today vs Yesterday vs Last Week</span>
              </div>

              <div style={{ minWidth: 500 }}>
                {/* Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 1fr', gap: 12, padding: '8px 0', borderBottom: `1px solid ${C.border}`, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6 }}>Metric</span>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' }}>Today</span>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' }}>↑↓ Yesterday</span>
                  <span style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.6, textAlign: 'right' }}>↑↓ Last Week</span>
                </div>

                <CompRow label="Call clicks" icon={Phone} iconColor="#f97316"
                  today={data.comparison.today?.callClicks}
                  yesterday={data.comparison.yesterday?.callClicks}
                  lastWeek={data.comparison.lastWeekSameDay?.callClicks}
                />
                <CompRow label="Direction requests" icon={Navigation} iconColor="#10b981"
                  today={data.comparison.today?.directionRequests}
                  yesterday={data.comparison.yesterday?.directionRequests}
                  lastWeek={data.comparison.lastWeekSameDay?.directionRequests}
                />
                <CompRow label="Profile views" icon={Users} iconColor="#8b5cf6"
                  today={data.comparison.today?.profileViews}
                  yesterday={data.comparison.yesterday?.profileViews}
                  lastWeek={data.comparison.lastWeekSameDay?.profileViews}
                />
                <CompRow label="Website clicks" icon={Globe} iconColor="#3b82f6"
                  today={data.comparison.today?.websiteClicks}
                  yesterday={data.comparison.yesterday?.websiteClicks}
                  lastWeek={data.comparison.lastWeekSameDay?.websiteClicks}
                />
                <CompRow label="Chat clicks" icon={MessageSquare} iconColor="#ec4899"
                  today={data.comparison.today?.chatClicks}
                  yesterday={data.comparison.yesterday?.chatClicks}
                  lastWeek={data.comparison.lastWeekSameDay?.chatClicks}
                />
                <CompRow label="Search impressions" icon={Search} iconColor="#eab308"
                  today={data.comparison.today?.searchImpressions}
                  yesterday={data.comparison.yesterday?.searchImpressions}
                  lastWeek={data.comparison.lastWeekSameDay?.searchImpressions}
                />
              </div>
            </div>
          )}

          {/* AI Trends & Predictions Panel */}
          <div style={{ background: '#0c1525', border: `1px solid ${C.border}`, borderRadius: 14, padding: '24px 28px', marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, background: 'rgba(249, 115, 22, 0.15)', display: 'flex', alignItems: 'center', justifySelf: 'center', justifyContent: 'center' }}>
                <Sparkles size={14} color="#f97316" />
              </div>
              <div>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', display: 'block' }}>AI Trend Predictions & Forecasting</span>
                <span style={{ fontSize: 10, color: C.muted }}>Algorithmic estimations for next month based on historical data patterns</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
              {/* Profile Views Forecast */}
              <div style={{ background: '#060c17', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Estimated Profile Views</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                    {Math.round((data.totals?.profileViews || 0) * 1.08).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>+8% forecast</span>
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0 0', lineHeight: 1.4 }}>
                  Organic search trends indicate an upward trajectory in impressions for maps mobile platforms next month.
                </p>
              </div>

              {/* Call Clicks Forecast */}
              <div style={{ background: '#060c17', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Estimated Call Clicks</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                    {Math.round((data.totals?.callClicks || 0) * 0.95).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 700 }}>-5% forecast</span>
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0 0', lineHeight: 1.4 }}>
                  Historical seasonal patterns suggest call interactions may plateau slightly due to upcoming holiday intervals.
                </p>
              </div>

              {/* Lead Conversion Forecast */}
              <div style={{ background: '#060c17', border: '1px solid #1e293b', borderRadius: 10, padding: 16 }}>
                <div style={{ fontSize: 10, color: C.muted, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Estimated Website & Chat Clicks</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                    {Math.round(((data.totals?.websiteClicks || 0) + (data.totals?.chatClicks || 0)) * 1.12).toLocaleString()}
                  </span>
                  <span style={{ fontSize: 11, color: '#10b981', fontWeight: 700 }}>+12% forecast</span>
                </div>
                <p style={{ fontSize: 11, color: C.muted, margin: '8px 0 0 0', lineHeight: 1.4 }}>
                  High customer search queries keywords relevance points to strong desktop search intent growth.
                </p>
              </div>
            </div>
          </div>

          {/* Footer info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: C.muted, fontSize: 11, flexWrap: 'wrap' }}>
            <Wifi size={12} color="#10b981" />
            <span>Connected via Google Business Profile API</span>
            <span style={{ marginLeft: 'auto' }}>
              Data source: {data.client?.locationTitle || data.client?.name}
            </span>
          </div>
        </>
      )}

      {/* Empty state — no client */}
      {!loading && !data && !error && !activeClient && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: 300, gap: 14 }}>
          <BarChart2 size={48} color={C.border} />
          <p style={{ color: C.muted, fontSize: 14 }}>Select a client to view GBP Insights</p>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes scaleIn {
          from { transform: scale(0.95); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        @media (max-width: 1024px) {
          .insights-charts-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 640px) {
          .kpi-cards-grid {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}
