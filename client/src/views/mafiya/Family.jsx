import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { C } from '../../constants/theme.js';
import {
  Users, Target, Star, AlertTriangle, TrendingUp, ChevronRight,
  Shield, Brain, Search, X, Loader2, ArrowUpRight, Award, MessageSquare, MapPin, Image
} from 'lucide-react';
import toast from 'react-hot-toast';

const API_URL = import.meta.env.VITE_API_URL || '';

export default function Family() {
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [orders, setOrders] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [metrics, setMetrics] = useState({
    territoryCaptured: 12,
    territoryCapturedChange: 3,
    newReviews: 28,
    newReviewsChange: 8,
    codeRedAlerts: 2,
    directionRequests: 347,
    directionRequestsChange: 22
  });
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Active Alert Detail Modal State
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);

  // Selected Client Details Modal State
  const [showClientModal, setShowClientModal] = useState(false);
  const [selectedClientForModal, setSelectedClientForModal] = useState(null);

  const handleClientCardClick = (client) => {
    setSelectedClientForModal(client);
    setShowClientModal(true);
  };

  const fetchDashboardData = async () => {
    try {
      setIsLoading(true);
      const token = localStorage.getItem('leados_token');
      const res = await axios.get(`${API_URL}/api/mafiya/clients/family/dashboard`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data) {
        setClients(res.data.clients || []);
        setPlans(res.data.plans || []);
        setOrders(res.data.orders || []);
        setAlerts(res.data.alerts || []);
        setMetrics(res.data.metrics || {});
      }
    } catch (err) {
      console.error('[Family Dashboard] fetch error:', err);
      toast.error('Failed to load GMB Family dashboard data');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const filteredClients = clients.filter(c =>
    (c.display_name || c.business_name || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleAlertClick = (alert) => {
    setSelectedAlert(alert);
    setShowAlertModal(true);
  };

  // Get status color & labels for usage dynamically based on total consumption ratio
  const getClientHealth = (client) => {
    if (client.client_type === 'internal') {
      return { score: 0, label: 'Used', color: '#10b981' };
    }
    
    const repliesUsed = client.ai_replies_used || 0;
    const repliesLimit = client.ai_replies_limit || 20;

    const sugUsed = client.ai_sug_used || 0;
    const sugLimit = client.ai_sug_limit || 10;

    const brainUsed = client.brain_ai_used || 0;
    const brainLimit = client.brain_ai_limit || 10;

    const scansUsed = client.scans_used || 0;
    const scansLimit = client.scans_limit || 3;

    const totalUsed = repliesUsed + sugUsed + brainUsed + scansUsed;
    const totalLimit = repliesLimit + sugLimit + brainLimit + scansLimit;

    // Used percentage
    let score = Math.round((totalUsed / Math.max(1, totalLimit)) * 100);
    score = Math.max(0, Math.min(100, score));

    let label = 'Used';
    let color = '#10b981'; // green for low usage

    if (score > 80) {
      color = '#ef4444'; // red for high usage
    } else if (score > 50) {
      color = '#f97316'; // orange
    }

    return { score, label, color };
  };

  // Get progress percentage for credits usage
  const getUsagePercent = (client, type) => {
    const isInternal = client.client_type === 'internal';
    let limit = 100;
    let current = 0;

    if (type === 'ai_replies') {
      limit = isInternal ? 100 : (client.ai_replies_limit || 20);
      current = client.ai_replies_used || 0;
    } else if (type === 'ai_suggestions') {
      limit = isInternal ? 100 : (client.ai_sug_limit || 10);
      current = client.ai_sug_used || 0;
    } else if (type === 'brain_ai') {
      limit = isInternal ? 100 : (client.brain_ai_limit || 10);
      current = client.brain_ai_used || 0;
    } else {
      limit = isInternal ? 100 : (client.scans_limit || 3);
      current = client.scans_used || 0;
    }

    if (limit === -1) limit = 10000;
    const pct = isInternal || limit === 10000 ? 0 : Math.round((current / Math.max(1, limit)) * 100);
    return { current, limit: isInternal || limit === 10000 ? '∞' : limit, pct };
  };

  const getDailyUsagePercent = (client, type) => {
    const isInternal = client.client_type === 'internal';
    let limit = 100;
    let current = 0;

    if (type === 'ai_replies') {
      limit = isInternal ? 100 : (client.ai_replies_daily_limit !== undefined ? client.ai_replies_daily_limit : 5);
      current = client.ai_replies_today_used || 0;
    } else if (type === 'ai_suggestions') {
      limit = isInternal ? 100 : (client.ai_sug_daily_limit !== undefined ? client.ai_sug_daily_limit : 3);
      current = client.ai_sug_today_used || 0;
    } else if (type === 'brain_ai') {
      limit = isInternal ? 100 : (client.brain_ai_daily_limit !== undefined ? client.brain_ai_daily_limit : 2);
      current = client.brain_ai_today_used || 0;
    } else {
      limit = isInternal ? 100 : (client.scans_daily_limit !== undefined ? client.scans_daily_limit : 1);
      current = client.scans_today_used || 0;
    }

    if (limit === -1) limit = 10000;
    const pct = isInternal || limit === 10000 ? 0 : Math.round((current / Math.max(1, limit)) * 100);
    return { current, limit: isInternal || limit === 10000 ? '∞' : limit, pct };
  };

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 size={42} className="animate-spin" style={{ color: C.accent, marginBottom: 12 }} />
          <p style={{ fontSize: 14 }}>Assembling GMB Family...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: 26, color: C.text, height: '100%', overflowY: 'auto', background: C.bg, position: 'relative' }}>
      
      {/* Visual background gradient */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400, background: 'radial-gradient(circle at 50% -20%, rgba(249,115,22,0.04) 0%, transparent 70%)', pointerEvents: 'none', zIndex: 0 }} />

      <div style={{ position: 'relative', zIndex: 1 }}>

        {/* ═══ Header Section ═══ */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 26, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 24, fontWeight: 800, color: '#fff', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              The Family <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(249,115,22,0.12)', color: C.accent, padding: '3px 8px', borderRadius: 20 }}>GMB Mafia</span>
            </h1>
            <p style={{ color: C.muted, fontSize: 12.5, marginTop: 5, margin: 0 }}>
              🟢 Live • {clients.length} brands • Last sync 6:32 AM today
            </p>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '0 12px', width: '100%', maxWidth: 280 }}>
            <Search size={14} color={C.muted} />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search Family Brands..."
              style={{ background: 'transparent', border: 'none', color: '#fff', padding: '10px 8px', width: '100%', outline: 'none', fontSize: 12.5 }}
            />
          </div>
        </div>

        {/* ═══ Top Dashboard Cards ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16, marginBottom: 28 }}>
          
          {/* Card 1: Territory Captured */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Territory Captured</span>
              <Target size={16} color={C.accent} />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>{metrics.territoryCaptured || 0}</div>
            <div style={{ fontSize: 11.5, color: '#10b981', marginTop: 4 }}>↑ {metrics.territoryCapturedChange || 0} keywords at #1</div>
          </div>

          {/* Card 2: New Reviews */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>New Reviews (7D)</span>
              <Star size={16} color="#f59e0b" />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>{metrics.newReviews || 0}</div>
            <div style={{ fontSize: 11.5, color: '#10b981', marginTop: 4 }}>↑ {metrics.newReviewsChange || 0} vs last week</div>
          </div>

          {/* Card 3: Code Red Alerts */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Code Red Alerts</span>
              <AlertTriangle size={16} color="#ef4444" />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#ef4444', fontFamily: "'Syne', sans-serif" }}>{metrics.codeRedAlerts || 0}</div>
            <div style={{ fontSize: 11.5, color: '#fca5a5', marginTop: 4 }}>Action needed today</div>
          </div>

          {/* Card 4: Direction Requests */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 }}>Direction Requests</span>
              <TrendingUp size={16} color="#3b82f6" />
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>{metrics.directionRequests || 0}</div>
            <div style={{ fontSize: 11.5, color: '#3b82f6', marginTop: 4 }}>↑ {metrics.directionRequestsChange || 0}% walk-in signals</div>
          </div>

        </div>

        {/* ═══ Main Split Content ═══ */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 24, alignItems: 'flex-start' }}>
          
          {/* Left Column: Family Health - All Brands */}
          <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'Syne', sans-serif" }}>
                Family Health — All Brands
              </h2>
              <span style={{ fontSize: 12, color: C.muted }}>Live status</span>
            </div>

            {filteredClients.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: C.muted, fontSize: 13 }}>
                No family brands found.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {filteredClients.map((client) => {
                  const health = getClientHealth(client);
                  const aiUsage = getUsagePercent(client, 'ai');
                  const serpUsage = getUsagePercent(client, 'serp');

                  return (
                    <div 
                      key={client.id} 
                      onClick={() => handleClientCardClick(client)}
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.01)', 
                        border: `1px solid ${C.border}50`, 
                        borderRadius: 12, 
                        padding: '16px 20px', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: 12,
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.06)'}
                    >
                      
                      {/* Top Brand Info */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <h3 style={{ fontSize: 14.5, fontWeight: 800, color: '#fff', margin: 0 }}>
                            {client.display_name || client.business_name}
                          </h3>
                          <span style={{ fontSize: 11, color: C.muted }}>
                            {client.business_category} • {client.client_type === 'internal' ? 'Internal' : 'Growth Plan'}
                          </span>
                        </div>

                        {/* Health indicator */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: health.color }}>
                            {health.score}%
                          </span>
                          <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, fontWeight: 700, background: `${health.color}15`, color: health.color }}>
                            {health.label}
                          </span>
                        </div>
                      </div>

                      {/* Usage progress bars */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '18px 24px', borderTop: `1px solid ${C.border}30`, paddingTop: 12 }}>
                        {/* AI Review Replies */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                            <span style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Brain size={12} /> AI Replies
                            </span>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{getDailyUsagePercent(client, 'ai_replies').current} / {getDailyUsagePercent(client, 'ai_replies').limit} replies (Today)</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${getDailyUsagePercent(client, 'ai_replies').pct}%`, height: '100%', background: getDailyUsagePercent(client, 'ai_replies').pct > 80 ? '#ef4444' : C.accent, borderRadius: 3 }} />
                          </div>
                        </div>
 
                        {/* AI Post Suggestions */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                            <span style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Brain size={12} /> AI Post Suggestions
                            </span>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{getDailyUsagePercent(client, 'ai_suggestions').current} / {getDailyUsagePercent(client, 'ai_suggestions').limit} posts (Today)</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${getDailyUsagePercent(client, 'ai_suggestions').pct}%`, height: '100%', background: getDailyUsagePercent(client, 'ai_suggestions').pct > 80 ? '#ef4444' : C.accent, borderRadius: 3 }} />
                          </div>
                        </div>
 
                        {/* GMB Brain AI */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                            <span style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Brain size={12} /> GMB Brain AI
                            </span>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{getDailyUsagePercent(client, 'brain_ai').current} / {getDailyUsagePercent(client, 'brain_ai').limit} actions (Today)</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${getDailyUsagePercent(client, 'brain_ai').pct}%`, height: '100%', background: getDailyUsagePercent(client, 'brain_ai').pct > 80 ? '#ef4444' : C.accent, borderRadius: 3 }} />
                          </div>
                        </div>
 
                        {/* ValueSERP scans */}
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 11 }}>
                            <span style={{ color: C.muted, display: 'flex', alignItems: 'center', gap: 4 }}>
                              <Target size={12} /> ValueSERP
                            </span>
                            <span style={{ color: '#fff', fontWeight: 600 }}>{getDailyUsagePercent(client, 'serp').current} / {getDailyUsagePercent(client, 'serp').limit} scans (Today)</span>
                          </div>
                          <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${getDailyUsagePercent(client, 'serp').pct}%`, height: '100%', background: getDailyUsagePercent(client, 'serp').pct > 80 ? '#ef4444' : '#3b82f6', borderRadius: 3 }} />
                          </div>
                        </div>
                      </div>

                    </div>
                  );
                })}
              </div>
            )}

          </div>

          {/* Right Column: Alerts & Orders */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            
            {/* ═══ Active Alerts ═══ */}
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} color="#ef4444" />
                  <h2 style={{ fontSize: 15, fontWeight: 800, color: '#fff', margin: 0, fontFamily: "'Syne', sans-serif" }}>
                    Active Alerts
                  </h2>
                </div>
                <span style={{ fontSize: 10.5, fontWeight: 700, background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '2px 8px', borderRadius: 20 }}>
                  {alerts.filter(a => a.urgency === 'urgent').length} urgent
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {alerts.map((alert) => (
                  <div
                    key={alert.id}
                    onClick={() => handleAlertClick(alert)}
                    style={{
                      background: 'rgba(255, 255, 255, 0.01)',
                      border: `1px solid ${alert.urgency === 'urgent' ? 'rgba(239,68,68,0.2)' : C.border}50`,
                      borderRadius: 12,
                      padding: 14,
                      cursor: 'pointer',
                      transition: 'all 0.15s',
                      position: 'relative'
                    }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = C.accent}
                    onMouseLeave={e => e.currentTarget.style.borderColor = alert.urgency === 'urgent' ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.06)'}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: alert.urgency === 'urgent' ? '#fca5a5' : '#e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6
                      }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: alert.urgency === 'urgent' ? '#ef4444' : C.muted }} />
                        {alert.title}
                      </span>
                      <span style={{ fontSize: 10, color: C.muted }}>{alert.time}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: 12, color: C.muted }}>
                      {alert.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </div>

      {/* ═══ Turf Control / Alert Detail Graph Modal ═══ */}
      {showAlertModal && selectedAlert && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 8, 16, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'linear-gradient(145deg, #111827 0%, #030712 100%)',
            border: `1px solid ${selectedAlert.urgency === 'urgent' ? 'rgba(239, 68, 68, 0.4)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 24,
            padding: '28px',
            maxWidth: 520,
            width: '92%',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            position: 'relative'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 34, height: 34, background: selectedAlert.urgency === 'urgent' ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.15)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={18} color={selectedAlert.urgency === 'urgent' ? '#ef4444' : C.accent} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                    {selectedAlert.title}
                  </h3>
                  <span style={{ fontSize: 11, color: C.muted }}>{selectedAlert.brand}</span>
                </div>
              </div>
              <button
                onClick={() => setShowAlertModal(false)}
                style={{ background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}
              >
                <X size={15} />
              </button>
            </div>

            {/* Turf / Rank Drop Alert with Interactive SVG Graph */}
            {selectedAlert.type === 'rank-drop' && (
              <div>
                <p style={{ margin: '0 0 16px 0', fontSize: 13.5, color: '#e2e8f0', lineHeight: 1.5 }}>
                  The keyword <strong style={{ color: C.accent }}>"{selectedAlert.keyword}"</strong> dropped from rank <strong style={{ color: '#10b981' }}>#{selectedAlert.previousRank}</strong> to <strong style={{ color: '#ef4444' }}>#{selectedAlert.currentRank}</strong> in the local search grid.
                </p>

                {/* Graph Title */}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 11.5, color: C.muted }}>
                  <span>Rank Position Timeline</span>
                  <span style={{ color: '#f59e0b' }}>Lower is Better</span>
                </div>

                {/* Visual SVG Line Graph */}
                <div style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${C.border}50`, borderRadius: 16, padding: '20px 14px', marginBottom: 20 }}>
                  <svg viewBox="0 0 380 140" style={{ width: '100%', height: 'auto', overflow: 'visible' }}>
                    {/* Grid lines */}
                    <line x1="60" y1="20" x2="320" y2="20" stroke="rgba(255,255,255,0.05)" strokeDasharray="3" />
                    <line x1="60" y1="50" x2="320" y2="50" stroke="rgba(255,255,255,0.05)" strokeDasharray="3" />
                    <line x1="60" y1="80" x2="320" y2="80" stroke="rgba(255,255,255,0.05)" strokeDasharray="3" />
                    <line x1="60" y1="110" x2="320" y2="110" stroke="rgba(255,255,255,0.05)" strokeDasharray="3" />

                    {/* Rank markers labels */}
                    <text x="35" y="24" fill={C.muted} fontSize="10">#1</text>
                    <text x="35" y="54" fill={C.muted} fontSize="10">#3</text>
                    <text x="35" y="84" fill={C.muted} fontSize="10">#6</text>
                    <text x="35" y="114" fill={C.muted} fontSize="10">#9</text>

                    {/* Graph line using actual Initial (X=80), Previous (X=200), Current (X=300) */}
                    <path
                      d={`M 80 ${20 + (Math.max(1, Math.min(10, selectedAlert.initialRank || 10)) - 1) * 10} L 200 ${20 + (Math.max(1, Math.min(10, selectedAlert.previousRank || 10)) - 1) * 10} L 300 ${20 + (Math.max(1, Math.min(10, selectedAlert.currentRank || 10)) - 1) * 10}`}
                      fill="none"
                      stroke="url(#rankGradient)"
                      strokeWidth="3.5"
                      strokeLinecap="round"
                    />

                    {/* Gradient under the line */}
                    <path
                      d={`M 80 ${20 + (Math.max(1, Math.min(10, selectedAlert.initialRank || 10)) - 1) * 10} L 200 ${20 + (Math.max(1, Math.min(10, selectedAlert.previousRank || 10)) - 1) * 10} L 300 ${20 + (Math.max(1, Math.min(10, selectedAlert.currentRank || 10)) - 1) * 10} L 300 120 L 80 120 Z`}
                      fill="url(#areaGradient)"
                      opacity="0.12"
                    />

                    {/* Data Points */}
                    <circle cx="80" cy={20 + (Math.max(1, Math.min(10, selectedAlert.initialRank || 10)) - 1) * 10} r="5" fill="#10b981" />
                    <circle cx="200" cy={20 + (Math.max(1, Math.min(10, selectedAlert.previousRank || 10)) - 1) * 10} r="5" fill="#f59e0b" />
                    <circle cx="300" cy={20 + (Math.max(1, Math.min(10, selectedAlert.currentRank || 10)) - 1) * 10} r="6" fill="#ef4444" stroke="#fff" strokeWidth="1.5" />

                    {/* Labels for points */}
                    <text x="80" y={15 + (Math.max(1, Math.min(10, selectedAlert.initialRank || 10)) - 1) * 10} fill="#fff" fontSize="9" fontWeight="bold" textAnchor="middle">#{selectedAlert.initialRank}</text>
                    <text x="200" y={15 + (Math.max(1, Math.min(10, selectedAlert.previousRank || 10)) - 1) * 10} fill="#fff" fontSize="9" fontWeight="bold" textAnchor="middle">#{selectedAlert.previousRank}</text>
                    <text x="300" y={15 + (Math.max(1, Math.min(10, selectedAlert.currentRank || 10)) - 1) * 10} fill="#fff" fontSize="9" fontWeight="bold" textAnchor="middle">#{selectedAlert.currentRank}</text>

                    {/* Labels for X axis */}
                    <text x="80" y="132" fill={C.muted} fontSize="9.5" textAnchor="middle">Initial Rank</text>
                    <text x="200" y="132" fill={C.muted} fontSize="9.5" textAnchor="middle">Previous Rank</text>
                    <text x="300" y="132" fill={C.muted} fontSize="9.5" textAnchor="middle">Current Rank</text>

                    {/* Gradients definitions */}
                    <defs>
                      <linearGradient id="rankGradient" x1="0" y1="0" x2="1" y2="0">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="60%" stopColor="#f59e0b" />
                        <stop offset="100%" stopColor="#ef4444" />
                      </linearGradient>
                      <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#ef4444" />
                        <stop offset="100%" stopColor="transparent" />
                      </linearGradient>
                    </defs>
                  </svg>
                </div>

                {/* Stats Table */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 20 }}>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}50`, borderRadius: 10, padding: 12 }}>
                    <span style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase' }}>Initial Rank</span>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#10b981', marginTop: 4 }}>#{selectedAlert.initialRank}</div>
                  </div>
                  <div style={{ background: 'rgba(255,255,255,0.02)', border: `1px solid ${C.border}50`, borderRadius: 10, padding: 12 }}>
                    <span style={{ fontSize: 10.5, color: C.muted, textTransform: 'uppercase' }}>Current Rank</span>
                    <div style={{ fontSize: 15, fontWeight: 800, color: '#ef4444', marginTop: 4 }}>#{selectedAlert.currentRank}</div>
                  </div>
                </div>

                {/* Recapture button */}
                <button
                  onClick={() => {
                    toast.success('Dispatched post automation & citation audits to reclaim rankings!');
                    setShowAlertModal(false);
                  }}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(90deg, #f97316 0%, #ea580c 100%)',
                    border: 'none',
                    borderRadius: 12,
                    padding: '12px',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 4px 15px rgba(249, 115, 22, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6
                  }}
                >
                  Recapture Turf <ArrowUpRight size={15} />
                </button>
              </div>
            )}

            {/* Review Alert details */}
            {selectedAlert.type === 'review' && (
              <div>
                <div style={{ display: 'flex', gap: 2, marginBottom: 12 }}>
                  <Star size={16} color="#ef4444" fill="#ef4444" />
                  <Star size={16} color="rgba(255,255,255,0.1)" />
                  <Star size={16} color="rgba(255,255,255,0.1)" />
                  <Star size={16} color="rgba(255,255,255,0.1)" />
                  <Star size={16} color="rgba(255,255,255,0.1)" />
                </div>
                <p style={{ fontStyle: 'italic', fontSize: 13.5, color: '#fff', background: 'rgba(255,255,255,0.02)', padding: 14, borderRadius: 10, border: `1px solid ${C.border}30`, margin: '0 0 16px 0' }}>
                  "{selectedAlert.reviewText}"
                </p>
                <div style={{ fontSize: 12, color: C.muted, marginBottom: 18 }}>
                  Author: <strong style={{ color: '#fff' }}>{selectedAlert.author}</strong>
                </div>

                <div style={{ background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 12, padding: 14, marginBottom: 20 }}>
                  <h4 style={{ margin: '0 0 6px 0', fontSize: 12.5, fontWeight: 700, color: '#10b981' }}>
                    Suggested AI Counter-reply
                  </h4>
                  <p style={{ margin: 0, fontSize: 12, color: '#a7f3d0', lineHeight: 1.5 }}>
                    {selectedAlert.draftReply}
                  </p>
                </div>

                <button
                  onClick={() => {
                    toast.success('Reply submitted to Google Business Profile!');
                    setShowAlertModal(false);
                  }}
                  style={{
                    width: '100%',
                    background: 'linear-gradient(90deg, #10b981 0%, #059669 100%)',
                    border: 'none',
                    borderRadius: 12,
                    padding: '12px',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Send AI Reply
                </button>
              </div>
            )}

            {/* General alert details */}
            {(selectedAlert.type === 'quiet' || selectedAlert.type === 'loyalty') && (
              <div>
                <p style={{ fontSize: 13.5, color: '#fff', margin: '0 0 20px 0' }}>
                  {selectedAlert.description}
                </p>
                <button
                  onClick={() => setShowAlertModal(false)}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.05)',
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: '12px',
                    color: '#fff',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer'
                  }}
                >
                  Acknowledge Alert
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ═══ Client Usage Breakdown Modal with Activity Rings ═══ */}
      {showClientModal && selectedClientForModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(5, 8, 16, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'linear-gradient(145deg, #111827 0%, #030712 100%)',
            border: `1px solid ${C.border}`,
            borderRadius: 24,
            padding: '28px',
            maxWidth: 480,
            width: '92%',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)',
            position: 'relative'
          }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#fff', fontFamily: "'Syne', sans-serif" }}>
                  {selectedClientForModal.display_name || selectedClientForModal.business_name}
                </h3>
                <span style={{ fontSize: 11.5, color: C.muted }}>
                  {selectedClientForModal.business_category} • {selectedClientForModal.client_type === 'internal' ? 'Internal ABM' : 'Paying Client'}
                </span>
              </div>
              <button
                onClick={() => setShowClientModal(false)}
                style={{ background: 'rgba(255,255,255,0.03)', border: 'none', borderRadius: '50%', width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted }}
              >
                <X size={15} />
              </button>
            </div>
 
            {/* Content: Circular Chart & Features List */}
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', background: 'rgba(0,0,0,0.2)', border: `1px solid ${C.border}50`, borderRadius: 16, padding: '20px 24px', marginBottom: 24 }}>
              
              {/* Apple-style Rings Chart */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <svg width="120" height="120" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                  {/* Background tracks */}
                  <circle cx="60" cy="60" r="45" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="6" />
                  <circle cx="60" cy="60" r="35" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="6" />
                  <circle cx="60" cy="60" r="25" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="6" />
                  <circle cx="60" cy="60" r="15" fill="none" stroke="rgba(255,255,255,0.03)" strokeWidth="6" />
 
                  {/* Active rings */}
                  {/* AI Replies (Outer - Orange) */}
                  <circle
                    cx="60" cy="60" r="45" fill="none" stroke={C.accent} strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 45}
                    strokeDashoffset={2 * Math.PI * 45 - (getUsagePercent(selectedClientForModal, 'ai_replies').pct / 100) * 2 * Math.PI * 45}
                    strokeLinecap="round"
                  />
                  {/* AI Suggestions (Green) */}
                  <circle
                    cx="60" cy="60" r="35" fill="none" stroke="#10b981" strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 35}
                    strokeDashoffset={2 * Math.PI * 35 - (getUsagePercent(selectedClientForModal, 'ai_suggestions').pct / 100) * 2 * Math.PI * 35}
                    strokeLinecap="round"
                  />
                  {/* GMB Brain AI (Blue) */}
                  <circle
                    cx="60" cy="60" r="25" fill="none" stroke="#3b82f6" strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 25}
                    strokeDashoffset={2 * Math.PI * 25 - (getUsagePercent(selectedClientForModal, 'brain_ai').pct / 100) * 2 * Math.PI * 25}
                    strokeLinecap="round"
                  />
                  {/* ValueSERP scans (Purple) */}
                  <circle
                    cx="60" cy="60" r="15" fill="none" stroke="#a855f7" strokeWidth="6"
                    strokeDasharray={2 * Math.PI * 15}
                    strokeDashoffset={2 * Math.PI * 15 - (getUsagePercent(selectedClientForModal, 'serp').pct / 100) * 2 * Math.PI * 15}
                    strokeLinecap="round"
                  />
                </svg>
              </div>
 
              {/* Legend list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flexGrow: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: C.accent }} />
                  <span style={{ color: C.muted, flexGrow: 1 }}>AI Replies:</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{getUsagePercent(selectedClientForModal, 'ai_replies').pct}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                  <span style={{ color: C.muted, flexGrow: 1 }}>AI Posts:</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{getUsagePercent(selectedClientForModal, 'ai_suggestions').pct}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#3b82f6' }} />
                  <span style={{ color: C.muted, flexGrow: 1 }}>Brain AI:</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{getUsagePercent(selectedClientForModal, 'brain_ai').pct}%</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7' }} />
                  <span style={{ color: C.muted, flexGrow: 1 }}>ValueSERP:</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>{getUsagePercent(selectedClientForModal, 'serp').pct}%</span>
                </div>
              </div>
 
            </div>
 
            {/* Numerical breakdown details */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 24 }}>
              <h4 style={{ margin: 0, fontSize: 12, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                Usage & Limits Breakdown
              </h4>
 
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, background: 'rgba(255,255,255,0.01)', border: `1px solid ${C.border}30`, borderRadius: 14, padding: 16 }}>
                
                {/* AI Replies */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ color: C.muted }}>AI Review Replies Limit</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>
                    {getUsagePercent(selectedClientForModal, 'ai_replies').current} / {getUsagePercent(selectedClientForModal, 'ai_replies').limit} drafts
                  </span>
                </div>
 
                {/* AI Post Suggestions */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: `1px solid ${C.border}20`, paddingTop: 10 }}>
                  <span style={{ color: C.muted }}>AI Post Suggestions Limit</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>
                    {getUsagePercent(selectedClientForModal, 'ai_suggestions').current} / {getUsagePercent(selectedClientForModal, 'ai_suggestions').limit} suggestions
                  </span>
                </div>
 
                {/* GMB Brain AI */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: `1px solid ${C.border}20`, paddingTop: 10 }}>
                  <span style={{ color: C.muted }}>GMB Brain AI Limit</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>
                    {getUsagePercent(selectedClientForModal, 'brain_ai').current} / {getUsagePercent(selectedClientForModal, 'brain_ai').limit} actions
                  </span>
                </div>
 
                {/* ValueSERP scans */}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, borderTop: `1px solid ${C.border}20`, paddingTop: 10 }}>
                  <span style={{ color: C.muted }}>ValueSERP grid scans</span>
                  <span style={{ color: '#fff', fontWeight: 700 }}>
                    {getUsagePercent(selectedClientForModal, 'serp').current} / {getUsagePercent(selectedClientForModal, 'serp').limit} scans
                  </span>
                </div>
 
              </div>
            </div>
 
            {/* Close action */}
            <button
              onClick={() => setShowClientModal(false)}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: `1px solid ${C.border}`,
                borderRadius: 12,
                padding: '12px',
                color: '#fff',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
                textAlign: 'center'
              }}
            >
              Close Details
            </button>
          </div>
        </div>
      )}
 
    </div>
  );
}
