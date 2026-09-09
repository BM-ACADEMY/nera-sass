import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import { Home, Users, LineChart, Inbox, Zap, FileText, Brain, BarChart2, Building2, Settings, LogOut, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Layers, UploadCloud, Columns, Sparkles, List, User, BookOpen, CheckSquare, MonitorPlay, Search, Activity, FileSearch, ShieldAlert, FileOutput, Share2, Eye, FileJson, GitPullRequest, Link as LinkIcon, Target, Shield, UserPlus, Heart, Megaphone, MessageCircle, Globe, ClipboardList, Wand2 } from 'lucide-react';
import { C } from '../../constants/theme.js';
import { useClient } from '../../contexts/ClientContext.jsx';
import { api } from '../../services/api.js';

// Sidebar-scoped palette (indigo/purple, floating-card look). Kept local so it
// doesn't affect the app's global orange accent theme used elsewhere (buttons, charts, etc).
const SB = {
  bg: '#101c30',
  card: '#1f1a42',
  border: '#332a5e',
  accent: '#7c6cf6',
  accentSoft: '#7c6cf62a',
  text: '#efedfb',
  muted: '#8f88b8',
  dim: '#635c8f',
};

const NAV = [
  { path: '/dashboard', Icon: Home, label: 'Dashboard' },
  { path: '/leads', Icon: Users, label: 'Leads' },
  { path: '/sales-tasks', Icon: User, label: 'Sales Task', taskBadge: true },
  { path: '/inbox', Icon: Inbox, label: 'Inbox', showBadge: true },
  { path: '/campaigns', Icon: Zap, label: 'Campaigns' },
  { path: '/templates', Icon: FileText, label: 'Templates' },
  { path: '/brain', Icon: Brain, label: 'AI Brain' },
  { path: '/reports', Icon: BarChart2, label: 'Reports' },
  { path: '/founder-reports', Icon: FileText, label: 'Founder Reports' },
  { path: '/clients', Icon: Building2, label: 'Clients' },
  { path: '/integrations', Icon: Share2, label: 'Integrations' },
];

export const Sidebar = ({ onLogout, unreadCount = 0, mobileOpen, setMobileOpen }) => {
  const navigate = useNavigate();
  const [isExpanded, setIsExpanded] = useState(window.innerWidth > 768);
  const [allianceOpen, setAllianceOpen] = useState(false);
  const [contentOsOpen, setContentOsOpen] = useState(false);
  const [thedalOsOpen, setThedalOsOpen] = useState(false);
  const [mafiyaOpen, setMafiyaOpen] = useState(false);
  const [rankDropCount, setRankDropCount] = useState(0);
  const [taskUnreadCount, setTaskUnreadCount] = useState(0);

  const { clients, plans, activeClient, setActiveClient } = useClient();

  useEffect(() => {
    const loadUnread = () => api.get('/sales-tasks/unread-count')
      .then(data => setTaskUnreadCount(data.count || 0))
      .catch(() => {});
    loadUnread();

    const socket = socketIO(api.baseUrl, { transports: ['websocket', 'polling'] });
    socket.on('sales_task_update', data => {
      setTaskUnreadCount(data.unread_count || 0);
      if (data.event === 'created' && data.task && 'Notification' in window && Notification.permission === 'granted') {
        const labels = { call: 'New demo call booked', hot_lead: 'New hot lead', followup: 'New follow-up task', overdue: 'Overdue follow-up' };
        const notification = new Notification(labels[data.task.task_type] || 'New sales task', { body: 'Click to open the lead conversation.', tag: `sales-task-${data.task.id}` });
        notification.onclick = async () => {
          window.focus();
          await api.put(`/sales-tasks/lead/${data.task.lead_id}/read`, {}).catch(() => {});
          navigate('/inbox', { state: { leadId: data.task.lead_id } });
          notification.close();
        };
      }
    });
    return () => socket.disconnect();
  }, [navigate]);

  // Fetch unread rank drop alert count
  useEffect(() => {
    const fetchRankDropCount = async () => {
      try {
        const token = localStorage.getItem('leados_token');
        const API_URL = import.meta.env.VITE_API_URL || '';
        const url = activeClient
          ? `${API_URL}/api/thedal/rankdropalert/count?client=${encodeURIComponent(activeClient.business_name || activeClient.client_name)}`
          : `${API_URL}/api/thedal/rankdropalert/count`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setRankDropCount(data.count || 0);
        }
      } catch (e) {
        console.error('Error fetching rank drop count:', e);
       }
    };
    fetchRankDropCount();
    const interval = setInterval(fetchRankDropCount, 5 * 60 * 1000); // every 5 mins
    return () => clearInterval(interval);
  }, [activeClient]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setIsExpanded(true); // Auto expand on mobile for better usability in the offcanvas
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleNavClick = (item) => {
    if (item?.path === '/sales-tasks' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    if (window.innerWidth <= 768) {
      setMobileOpen(false);
    }
  };

  const isFeatureEnabled = (featureName) => {
    if (!activeClient) return true; // Enable all if no client selected

    const plan = plans.find(p => p.name === activeClient.plan);
    if (!plan || !plan.features) return false;

    return plan.features.some(f => f.feature_name === featureName);
  };

  // --- Shared style helpers (rounded-pill / floating-card language) ---

  // Top-level primary nav item — solid filled pill when active
  const navItemStyle = (isActive) => ({
    width: '100%',
    height: 40,
    borderRadius: 12,
    border: 'none',
    background: isActive ? SB.accent : 'transparent',
    boxShadow: isActive ? `0 4px 14px ${SB.accent}55` : 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: isExpanded ? 'flex-start' : 'center',
    padding: isExpanded ? '0 13px' : '0',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.15s, box-shadow 0.15s',
    textDecoration: 'none',
  });

  // Collapsible section header (AllianceOS, Content OS, Thedal OS, Mafiya OS)
  const sectionHeaderStyle = (open) => ({
    width: '100%',
    height: 40,
    borderRadius: 12,
    border: 'none',
    background: open ? SB.card : 'transparent',
    display: 'flex',
    alignItems: 'center',
    justifyContent: isExpanded ? 'space-between' : 'center',
    padding: isExpanded ? '0 12px' : '0',
    cursor: 'pointer',
    color: open ? SB.text : SB.muted,
    transition: 'background 0.15s',
  });

  // Child / nested nav link — rounded pill, solid fill when active
  const childLinkStyle = (isActive, featureName = null) => {
    const enabled = featureName ? isFeatureEnabled(featureName) : true;
    return {
      width: '100%',
      height: 32,
      borderRadius: 9,
      display: 'flex',
      alignItems: 'center',
      padding: '0 10px',
      fontSize: 12.5,
      color: isActive ? '#fff' : SB.muted,
      background: isActive ? SB.accent : 'transparent',
      textDecoration: 'none',
      fontWeight: isActive ? 600 : 500,
      opacity: enabled ? 1 : 0.3,
      pointerEvents: enabled ? 'auto' : 'none',
      transition: 'background 0.12s, color 0.12s',
    };
  };
  // Backward-compatible alias used further below
  const getLinkStyle = childLinkStyle;

  const sectionDividerStyle = { height: 1, background: SB.border, margin: '10px 6px', width: 'calc(100% - 12px)' };

  const sectionLabelStyle = { margin: '14px 0 6px 10px', fontSize: 10.5, fontWeight: 700, color: SB.dim, textTransform: 'uppercase', letterSpacing: 0.8 };

  return (
    <>
      {mobileOpen && (
        <div
          className="mobile-overlay show-mobile"
          onClick={() => setMobileOpen(false)}
          style={{ display: 'none' }}
        />
      )}
      <div
        className={`mobile-sidebar ${!mobileOpen ? 'closed' : ''}`}
        style={{
          width: isExpanded ? 232 : 68,
          transition: 'width 0.2s, transform 0.3s',
          position: 'relative',
          height: '100vh',
          margin: 0,
          flexShrink: 0,
        }}
      >
        {/* Collapse toggle — a fixed handle straddling the right border, independent of expand state */}
        <button
          className="hide-mobile"
          onClick={() => setIsExpanded(!isExpanded)}
          style={{ position: 'absolute', top: 24, right: -12, background: SB.card, border: '1px solid ' + SB.border, borderRadius: '50%', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: SB.muted, zIndex: 20, boxShadow: '0 2px 6px rgba(0,0,0,0.35)' }}
        >
          {isExpanded ? <ChevronLeft size={13} /> : <ChevronRight size={13} />}
        </button>

        <div style={{
          width: '100%',
          height: '100%',
          background: SB.bg,
          borderRight: '1px solid ' + SB.border,
          display: 'flex',
          flexDirection: 'column',
          alignItems: isExpanded ? 'flex-start' : 'center',
          padding: '18px 0',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: isExpanded ? 'flex-start' : 'center', width: '100%', padding: isExpanded ? '0 14px' : '0', marginBottom: 10 }}>
          <div style={{ width: 32, height: 32, flexShrink: 0, background: SB.accent, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Syne',sans-serif", fontSize: 14, fontWeight: 800, color: '#fff' }}>L</div>
          {isExpanded && <span style={{ marginLeft: 9, fontFamily: "'Syne',sans-serif", fontSize: 16, fontWeight: 800, color: '#fff', letterSpacing: 0.2, whiteSpace: 'nowrap' }}>LeadOS</span>}
        </div>

        <div style={{ ...sectionDividerStyle, margin: '0 6px 10px' }} />

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3, width: '100%', padding: isExpanded ? '0 10px' : '0 9px' }}>
          {NAV.map((item) => {
            const Icon = item.Icon;
            const badgeCount = item.taskBadge ? taskUnreadCount : unreadCount;
            const displayBadge = (item.showBadge || item.taskBadge) && badgeCount > 0;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={() => handleNavClick(item)}
                title={!isExpanded ? item.label : undefined}
                style={({ isActive }) => navItemStyle(isActive)}
              >
                {({ isActive }) => (
                  <>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, flexShrink: 0 }}>
                      <Icon size={16} color={isActive ? '#fff' : SB.muted} strokeWidth={2} />
                      {displayBadge && (
                        <div style={{ position: 'absolute', top: -7, left: 9, minWidth: 15, height: 15, padding: '0 3px', borderRadius: 8, background: isActive ? '#fff' : SB.accent, color: isActive ? SB.accent : '#fff', fontSize: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, boxSizing: 'border-box', border: `2px solid ${isActive ? SB.accent : SB.bg}` }}>
                          {badgeCount > 99 ? '99+' : badgeCount}
                        </div>
                      )}
                    </div>
                    {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? '#fff' : SB.text }}>{item.label}</span>}
                  </>
                )}
              </NavLink>
            );
          })}

          <div style={sectionDividerStyle} />

          {/* Alliance Parent Link with Nested Children */}
          <div style={{ width: '100%' }}>
            <button
              onClick={() => {
                setAllianceOpen(!allianceOpen);
                if (!isExpanded) setIsExpanded(true); // Auto-expand sidebar if collapsed
              }}
              title={!isExpanded ? "AllianceOS" : undefined}
              style={sectionHeaderStyle(allianceOpen)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Layers size={16} color={allianceOpen ? SB.text : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: allianceOpen ? 600 : 500 }}>AllianceOS</span>}
              </div>
              {isExpanded && (
                allianceOpen ? <ChevronUp size={13} color={SB.muted} /> : <ChevronDown size={13} color={SB.muted} />
              )}
            </button>

            {/* Child Links */}
            {isExpanded && allianceOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10, marginTop: 4, marginBottom: 6 }}>
                <NavLink to="/alliance/analytics" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <BarChart2 size={13} style={{ marginRight: 8 }} /> Analytics
                </NavLink>

                <NavLink to="/alliance/upload" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <UploadCloud size={13} style={{ marginRight: 8 }} /> Upload Leads
                </NavLink>

                <NavLink to="/alliance/prospects" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <List size={13} style={{ marginRight: 8 }} /> Prospects
                </NavLink>

                <NavLink to="/alliance/number-health" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Activity size={13} style={{ marginRight: 8 }} /> Number Health
                </NavLink>

                <NavLink to="/alliance/email-setup" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Globe size={13} style={{ marginRight: 8 }} /> Email Senders
                </NavLink>

                <NavLink to="/alliance/email-campaigns/new" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Megaphone size={13} style={{ marginRight: 8 }} /> Email Campaigns
                </NavLink>

                <NavLink to="/alliance/whatsapp-campaigns/new" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <MessageCircle size={13} style={{ marginRight: 8 }} /> WhatsApp Campaigns
                </NavLink>

                <NavLink to="/alliance/replies" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Inbox size={13} style={{ marginRight: 8 }} /> Replies
                </NavLink>

                <NavLink to="/alliance/ai-brain" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <BookOpen size={13} style={{ marginRight: 8 }} /> AI Brain
                </NavLink>

                <NavLink to="/alliance/prompts" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Sparkles size={13} style={{ marginRight: 8 }} /> Prompts
                </NavLink>

                <NavLink to="/alliance/planner" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Columns size={13} style={{ marginRight: 8 }} /> Campaign Planner
                </NavLink>

                <NavLink to="/alliance-inbox" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Inbox size={13} style={{ marginRight: 8 }} /> WhatsApp Inbox
                </NavLink>

              </div>
            )}
          </div>

          {/* Content OS Parent Link */}
          <div style={{ width: '100%' }}>
            <button
              onClick={() => {
                setContentOsOpen(!contentOsOpen);
                if (!isExpanded) setIsExpanded(true);
              }}
              title={!isExpanded ? "Content OS" : undefined}
              style={sectionHeaderStyle(contentOsOpen)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <MonitorPlay size={16} color={contentOsOpen ? SB.text : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: contentOsOpen ? 600 : 500 }}>Content OS</span>}
              </div>
              {isExpanded && (
                contentOsOpen ? <ChevronUp size={13} color={SB.muted} /> : <ChevronDown size={13} color={SB.muted} />
              )}
            </button>

            {/* Child Links */}
            {isExpanded && contentOsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10, marginTop: 4, marginBottom: 6 }}>
                <NavLink to="/admin/content-os/approval" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <CheckSquare size={13} style={{ marginRight: 8 }} /> Approval Room
                </NavLink>

                <NavLink to="/admin/content-os/monitors" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <FileSearch size={13} style={{ marginRight: 8 }} /> Folder Monitors
                </NavLink>

                <NavLink to="/admin/content-os/scheduler" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Target size={13} style={{ marginRight: 8 }} /> Scheduler
                </NavLink>

                <NavLink to="/admin/content-os/captions" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Sparkles size={13} style={{ marginRight: 8 }} /> Caption Studio
                </NavLink>

                <NavLink to="/admin/content-os/thumbnail-brain" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Brain size={13} style={{ marginRight: 8 }} /> Thumbnail Brain
                </NavLink>

                <NavLink to="/admin/content-os/social-connection" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Share2 size={13} style={{ marginRight: 8 }} /> Social Accounts
                </NavLink>

                <NavLink to="/admin/content-os/tokens" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <Shield size={13} style={{ marginRight: 8 }} /> Token Health
                </NavLink>

                <NavLink to="/admin/content-os/logs" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <FileText size={13} style={{ marginRight: 8 }} /> Publish Logs
                </NavLink>

                <NavLink to="/admin/content-os/reach" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <BarChart2 size={13} style={{ marginRight: 8 }} /> Reach Report
                </NavLink>

                <NavLink to="/admin/content-os/failed" onClick={handleNavClick} style={({ isActive }) => childLinkStyle(isActive)}>
                  <ShieldAlert size={13} style={{ marginRight: 8 }} /> Failed Jobs
                </NavLink>
              </div>
            )}
          </div>

          {/* Thedal OS Parent Link */}
          <div style={{ width: '100%' }}>
            <button
              onClick={() => {
                setThedalOsOpen(!thedalOsOpen);
                if (!isExpanded) setIsExpanded(true);
              }}
              title={!isExpanded ? "Thedal OS" : undefined}
              style={sectionHeaderStyle(thedalOsOpen)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Search size={16} color={thedalOsOpen ? SB.text : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: thedalOsOpen ? 600 : 500 }}>Thedal OS</span>}
              </div>
              {isExpanded && (
                thedalOsOpen ? <ChevronUp size={13} color={SB.muted} /> : <ChevronDown size={13} color={SB.muted} />
              )}
            </button>

            {/* Child Links */}
            {isExpanded && thedalOsOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10, marginTop: 4, marginBottom: 6 }}>
                {/* Client Selector Dropdown */}
                <div style={{ padding: '2px 0 10px' }}>
                  <select
                    value={activeClient ? activeClient.id : ''}
                    onChange={(e) => {
                      const client = clients.find(c => c.id === parseInt(e.target.value));
                      setActiveClient(client || null);
                    }}
                    style={{ width: '100%', background: SB.card, border: `1px solid ${SB.border}`, borderRadius: 8, padding: '7px 10px', color: SB.text, fontSize: 11.5, outline: 'none', cursor: 'pointer', appearance: 'none' }}
                  >
                    <option value="" style={{ background: SB.card, color: '#fff' }}>All Clients (No Selection)</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id} style={{ background: SB.card, color: '#fff' }}>
                        {c.business_name && c.client_name && c.business_name !== c.client_name
                          ? `${c.business_name} (${c.client_name})`
                          : c.business_name || c.client_name} - {c.plan}
                      </option>
                    ))}
                  </select>
                </div>

                <NavLink to="/thedal/keyword-tracking" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Keyword Tracking Limit')}>
                  <Activity size={13} style={{ marginRight: 8 }} /> Keyword Tracking
                </NavLink>

                <NavLink to="/thedal/gsc-intel" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'GSC Intel Access')}>
                  <LineChart size={13} style={{ marginRight: 8 }} /> GSC Intel
                </NavLink>

                <NavLink to="/thedal/on-page-audit" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'On-Page Audit Scans/mo')}>
                  <FileSearch size={13} style={{ marginRight: 8 }} /> On-Page Audit
                </NavLink>

                <NavLink to="/thedal/content-factory" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Content Factory Drafts/mo')}>
                  <Brain size={13} style={{ marginRight: 8 }} /> Content Factory
                </NavLink>

                <NavLink to="/thedal/monthly-report" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Monthly PDF Report')}>
                  <FileOutput size={13} style={{ marginRight: 8 }} /> Monthly PDF Report
                </NavLink>

                <NavLink to="/thedal/rank-drop-alert" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Rank Drop Alert')}>
                  <ShieldAlert size={13} style={{ marginRight: 8 }} /> Rank Drop Alert
                  {rankDropCount > 0 && (
                    <span style={{ marginLeft: 'auto', background: C.red, color: '#fff', fontSize: 9.5, fontWeight: 800, padding: '2px 6px', borderRadius: 20, minWidth: 17, textAlign: 'center', lineHeight: '15px' }}>
                      {rankDropCount}
                    </span>
                  )}
                </NavLink>

                <div style={sectionLabelStyle}>Manage</div>

                <NavLink to="/thedal/clients" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive)}>
                  <Target size={13} style={{ marginRight: 8 }} /> Clients
                </NavLink>

                <NavLink to="/thedal/plan-subscription" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive)}>
                  <Activity size={13} style={{ marginRight: 8 }} /> Plan Subscription
                </NavLink>

                <NavLink to="/thedal/plans" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive)}>
                  <Activity size={13} style={{ marginRight: 8 }} /> Plans & Pricing
                </NavLink>

                <div style={sectionLabelStyle}>Intelligence</div>

                <NavLink to="/thedal/serp-radar" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'SERP Radar Access')}>
                  <Eye size={13} style={{ marginRight: 8 }} /> SERP Radar
                </NavLink>

                <NavLink to="/thedal/gap-hunter" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Gap Hunter Access')}>
                  <Target size={13} style={{ marginRight: 8 }} /> Gap Hunter
                </NavLink>

                <NavLink to="/thedal/schema-library" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Schema Library Builder')}>
                  <FileJson size={13} style={{ marginRight: 8 }} /> Schema Library
                </NavLink>

                <NavLink to="/thedal/competitor-spy" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Competitor Spy Limit')}>
                  <GitPullRequest size={13} style={{ marginRight: 8 }} /> Competitor Spy
                </NavLink>

                <NavLink to="/thedal/backlink-tracker" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Backlink Tracker CRM')}>
                  <LinkIcon size={13} style={{ marginRight: 8 }} /> Backlink Tracker
                </NavLink>
              </div>
            )}
          </div>

          {/* Mafiya OS Section */}
          <div style={{ width: '100%' }}>
            <button
              onClick={() => {
                setMafiyaOpen(!mafiyaOpen);
                if (!isExpanded) setIsExpanded(true);
              }}
              title={!isExpanded ? "Mafiya OS" : undefined}
              style={sectionHeaderStyle(mafiyaOpen)}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <Shield size={16} color={mafiyaOpen ? SB.text : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: mafiyaOpen ? 600 : 500 }}>Mafiya OS</span>}
              </div>
              {isExpanded && (
                mafiyaOpen ? <ChevronUp size={13} color={SB.muted} /> : <ChevronDown size={13} color={SB.muted} />
              )}
            </button>

            {/* Child Links */}
            {isExpanded && mafiyaOpen && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 10, marginTop: 4, marginBottom: 6 }}>
                <NavLink to="/mafiya/family" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'The Family')}>
                  <Users size={13} style={{ marginRight: 8 }} /> The Family
                </NavLink>

                <NavLink to="/mafiya/add-client" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'GMB Clients')}>
                  <UserPlus size={13} style={{ marginRight: 8 }} /> GMB Clients
                </NavLink>

                <NavLink to="/mafiya/plans" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Mafiya Plans')}>
                  <Layers size={13} style={{ marginRight: 8 }} /> Mafiya Plans
                </NavLink>

                <NavLink to="/thedal/keyword-tracking" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Turf Control')}>
                  <Target size={13} style={{ marginRight: 8 }} /> Turf Control
                </NavLink>

                <NavLink to="/mafiya/loyalty" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Loyalty (Review)')}>
                  <Heart size={13} style={{ marginRight: 8 }} /> Loyalty (Review)
                </NavLink>

                <NavLink to="/mafiya/street-posts" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Street Posts')}>
                  <Megaphone size={13} style={{ marginRight: 8 }} /> Street Posts
                </NavLink>

                <NavLink to="/mafiya/rivals" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Rival Families')}>
                  <Target size={13} style={{ marginRight: 8 }} /> Rival Families
                </NavLink>

                <NavLink to="/mafiya/gbp-insights" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'GBP Insights')}>
                  <BarChart2 size={13} style={{ marginRight: 8 }} /> GBP Insights
                </NavLink>

                <NavLink to="/mafiya/citations" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Citation')}>
                  <Globe size={13} style={{ marginRight: 8 }} /> Citation
                </NavLink>

                <NavLink to="/mafiya/orders" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Mafia Orders')}>
                  <ClipboardList size={13} style={{ marginRight: 8 }} /> Mafia Orders
                </NavLink>

                <NavLink to="/mafiya/brain" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, "Don's Brain")}>
                  <Brain size={13} style={{ marginRight: 8 }} /> Don's Brain
                </NavLink>

                <NavLink to="/mafiya/usage" onClick={handleNavClick} style={({ isActive }) => getLinkStyle(isActive, 'Usage')}>
                  <Activity size={13} style={{ marginRight: 8 }} /> Usage
                </NavLink>

              </div>
            )}
          </div>
        </div>

        <div style={sectionDividerStyle} />

        <div style={{ padding: isExpanded ? '0 10px' : '0 9px', display: 'flex', flexDirection: 'column', gap: 3, width: '100%' }}>
          <NavLink
            to="/workflows"
            onClick={handleNavClick}
            title={!isExpanded ? "Workflow Logs" : undefined}
            style={({ isActive }) => navItemStyle(isActive)}
          >
            {({ isActive }) => (
              <>
                <Activity size={16} color={isActive ? '#fff' : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? '#fff' : SB.text }}>Workflow Logs</span>}
              </>
            )}
          </NavLink>
          <NavLink
            to="/settings"
            onClick={handleNavClick}
            title={!isExpanded ? "Settings" : undefined}
            style={({ isActive }) => navItemStyle(isActive)}
          >
            {({ isActive }) => (
              <>
                <Settings size={16} color={isActive ? '#fff' : SB.muted} strokeWidth={2} />
                {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: isActive ? 600 : 500, color: isActive ? '#fff' : SB.text }}>Settings</span>}
              </>
            )}
          </NavLink>
          <button
            onClick={onLogout}
            title={!isExpanded ? "Logout" : undefined}
            style={{ width: '100%', height: 40, borderRadius: 12, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: isExpanded ? 'flex-start' : 'center', padding: isExpanded ? '0 13px' : '0', cursor: 'pointer' }}
          >
            <LogOut size={16} color={SB.muted} strokeWidth={2} />
            {isExpanded && <span style={{ marginLeft: 11, fontSize: 12.5, fontWeight: 500, color: SB.text }}>Logout</span>}
          </button>
        </div>
        </div>
      </div>
    </>
  );
};
