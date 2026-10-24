import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import {
  LayoutDashboard, Users, ClipboardCheck, Inbox, Megaphone, FileText, Brain, BarChart2,
  Share2, Settings, LogOut, MoreVertical, MessageCircle,
} from 'lucide-react';
import { api } from '../../services/api.js';
import { roleLabel } from '../../views/settings/settingsPolicy.js';
import { useAuth } from '../../hooks/useAuth.js';

// Same structure and look as the admin panel sidebar: brand header, labelled
// sections, a solid blue active item, icon-only collapsed mode and the
// signed-in user with a sign-out menu at the bottom.
const SECTIONS = [
  {
    label: 'Workspace',
    items: [
      { path: '/dashboard', Icon: LayoutDashboard, label: 'Dashboard' },
      { path: '/leads', Icon: Users, label: 'Leads' },
      { path: '/sales-tasks', Icon: ClipboardCheck, label: 'Sales Task', badge: 'tasks' },
      { path: '/inbox', Icon: Inbox, label: 'Inbox', badge: 'inbox' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { path: '/campaigns', Icon: Megaphone, label: 'Campaigns' },
      { path: '/templates', Icon: FileText, label: 'Templates' },
      { path: '/brain', Icon: Brain, label: 'AI Brain' },
      { path: '/reports', Icon: BarChart2, label: 'Reports' },
    ],
  },
  {
    label: 'Setup',
    items: [
      { path: '/integrations', Icon: Share2, label: 'Integrations' },
      { path: '/settings', Icon: Settings, label: 'Settings' },
    ],
  },
];

const isMobile = () => window.innerWidth <= 768;

export const Sidebar = ({ onLogout, unreadCount = 0, collapsed = false, mobileOpen, setMobileOpen }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [taskUnreadCount, setTaskUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const footerRef = useRef(null);
  // On a phone the sidebar is a full-width drawer, never icon-only.
  const iconOnly = collapsed && !isMobile();

  useEffect(() => {
    const loadUnread = () => api.get('/sales-tasks/unread-count')
      .then(data => setTaskUnreadCount(data.count || 0))
      .catch(() => {});
    loadUnread();

    const socket = socketIO(api.baseUrl, { auth: { token: localStorage.getItem('leados_token') }, transports: ['websocket', 'polling'] });
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

  // Close the user menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return undefined;
    const close = (e) => { if (footerRef.current && !footerRef.current.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const go = (path) => {
    if (path === '/sales-tasks' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    navigate(path);
    if (isMobile()) setMobileOpen(false);
  };

  const badgeFor = (item) => (item.badge === 'tasks' ? taskUnreadCount : item.badge === 'inbox' ? unreadCount : 0);
  const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const initial = user?.name ? user.name.trim()[0].toUpperCase() : 'U';
  const workspaceName = user?.tenant_name || 'Your workspace';

  return (
    <>
      {mobileOpen && (
        <div className="mobile-overlay show-mobile" onClick={() => setMobileOpen(false)} style={{ display: 'none' }} />
      )}
      <aside className={`gsb mobile-sidebar ${!mobileOpen ? 'closed' : ''} ${iconOnly ? 'gsb--icons' : ''}`}>
        {/* Brand */}
        <div className="gsb-brand" title={iconOnly ? `Getnera · ${workspaceName}` : undefined}>
          <span className="gsb-logo"><MessageCircle size={18} strokeWidth={2.4} /></span>
          {!iconOnly && (
            <span className="gsb-brand-text">
              <span className="gsb-brand-name">Getnera</span>
              <span className="gsb-brand-sub">{workspaceName}</span>
            </span>
          )}
        </div>

        {/* Sections */}
        <nav className="gsb-nav">
          {SECTIONS.map(section => (
            <div key={section.label} className="gsb-group">
              {!iconOnly && <div className="gsb-group-label">{section.label}</div>}
              {section.items.map(item => {
                const count = badgeFor(item);
                const active = isActive(item.path);
                return (
                  <button
                    key={item.path}
                    type="button"
                    className={`gsb-item ${active ? 'is-active' : ''}`}
                    onClick={() => go(item.path)}
                    title={iconOnly ? (count ? `${item.label} (${count})` : item.label) : undefined}
                    aria-current={active ? 'page' : undefined}
                  >
                    <item.Icon size={17} className="gsb-icon" />
                    {!iconOnly && <span className="gsb-label">{item.label}</span>}
                    {count > 0 && (iconOnly
                      ? <span className="gsb-dot" />
                      : <span className="gsb-badge">{count > 99 ? '99+' : count}</span>)}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Signed-in user */}
        <div className="gsb-footer" ref={footerRef}>
          {menuOpen && (
            <div className={`gsb-menu ${iconOnly ? 'gsb-menu--side' : ''}`} role="menu">
              <div className="gsb-menu-head">
                <div className="gsb-menu-name">{user?.name || 'User'}</div>
                <div className="gsb-menu-email">{user?.email || ''}</div>
              </div>
              <button type="button" className="gsb-menu-item danger" onClick={() => { setMenuOpen(false); onLogout(); }} role="menuitem">
                <LogOut size={15} /> Log out
              </button>
            </div>
          )}
          <button type="button" className="gsb-user" onClick={() => setMenuOpen(v => !v)} title={iconOnly ? (user?.name || 'Account') : undefined} aria-haspopup="menu" aria-expanded={menuOpen}>
            <span className="gsb-avatar">{initial}<span className="gsb-online" /></span>
            {!iconOnly && (
              <>
                <span className="gsb-user-text">
                  <span className="gsb-user-name">{user?.name || 'User'}</span>
                  <span className="gsb-user-sub">{user?.email || roleLabel(user?.role)}</span>
                </span>
                <MoreVertical size={16} className="gsb-more" />
              </>
            )}
          </button>
        </div>
      </aside>

      <style>{`
        .gsb { width: 256px; height: 100vh; flex-shrink: 0; display: flex; flex-direction: column; background: #fff; border-right: 1px solid #e2e8f0; font-family: 'Inter', sans-serif; transition: width .2s ease; position: relative; z-index: 10; }
        .gsb--icons { width: 60px; }
        .gsb-brand { display: flex; align-items: center; gap: 10px; height: 64px; padding: 0 14px; flex-shrink: 0; }
        .gsb--icons .gsb-brand { justify-content: center; padding: 0; }
        .gsb-logo { width: 34px; height: 34px; border-radius: 9px; background: #2563eb; color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 2px 6px rgba(37,99,235,.25); }
        .gsb-brand-text { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
        .gsb-brand-name { font-size: 15px; font-weight: 800; color: #0f172a; }
        .gsb-brand-sub { font-size: 11.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gsb-nav { flex: 1; overflow-y: auto; overflow-x: hidden; padding: 4px 8px 8px; }
        .gsb-group { padding: 6px 0; }
        .gsb--icons .gsb-group + .gsb-group { border-top: 1px solid #f1f5f9; }
        .gsb-group-label { font-size: 12px; font-weight: 500; color: #64748b; padding: 8px 10px 6px; }
        .gsb-item { position: relative; width: 100%; display: flex; align-items: center; gap: 10px; height: 38px; padding: 0 10px; margin: 1px 0; border: 0; border-radius: 8px; background: transparent; color: #1e293b; font-size: 14px; text-align: left; cursor: pointer; transition: background .15s, color .15s; }
        .gsb--icons .gsb-item { justify-content: center; padding: 0; }
        .gsb-item:hover { background: #f1f5f9; }
        .gsb-item:focus-visible { outline: 2px solid #2563eb; outline-offset: 1px; }
        .gsb-item.is-active { background: #2563eb; color: #fff; font-weight: 600; }
        .gsb-item.is-active:hover { background: #1d4ed8; }
        .gsb-icon { flex-shrink: 0; }
        .gsb-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gsb-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: #2563eb; color: #fff; font-size: 11px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
        .gsb-item.is-active .gsb-badge { background: #fff; color: #2563eb; }
        .gsb-dot { position: absolute; top: 7px; right: 10px; width: 8px; height: 8px; border-radius: 50%; background: #ef4444; border: 2px solid #fff; }
        .gsb-footer { position: relative; padding: 8px; border-top: 1px solid #f1f5f9; flex-shrink: 0; }
        .gsb-user { width: 100%; display: flex; align-items: center; gap: 10px; padding: 8px; border: 0; border-radius: 10px; background: transparent; cursor: pointer; text-align: left; }
        .gsb-user:hover, .gsb-user[aria-expanded="true"] { background: #f1f5f9; }
        .gsb--icons .gsb-user { justify-content: center; padding: 8px 0; }
        .gsb-avatar { position: relative; width: 34px; height: 34px; border-radius: 50%; background: #dbeafe; color: #1d4ed8; font-weight: 700; font-size: 14px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .gsb-online { position: absolute; bottom: 0; right: -1px; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #fff; }
        .gsb-user-text { flex: 1; min-width: 0; display: flex; flex-direction: column; line-height: 1.25; }
        .gsb-user-name { font-size: 13px; font-weight: 600; color: #0f172a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gsb-user-sub { font-size: 11.5px; color: #94a3b8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gsb-more { color: #64748b; flex-shrink: 0; }
        .gsb-menu { position: absolute; left: 8px; right: 8px; bottom: calc(100% - 2px); background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; box-shadow: 0 10px 30px rgba(15,23,42,.12); padding: 4px; z-index: 30; }
        .gsb-menu--side { left: calc(100% + 6px); right: auto; bottom: 8px; width: 220px; }
        .gsb-menu-head { padding: 8px 10px; border-bottom: 1px solid #f1f5f9; margin-bottom: 4px; }
        .gsb-menu-name { font-size: 13px; font-weight: 600; color: #0f172a; }
        .gsb-menu-email { font-size: 12px; color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .gsb-menu-item { width: 100%; display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 0; border-radius: 6px; background: transparent; font-size: 13px; cursor: pointer; color: #1e293b; }
        .gsb-menu-item:hover { background: #f1f5f9; }
        .gsb-menu-item.danger { color: #dc2626; }
        .gsb-menu-item.danger:hover { background: #fef2f2; }
        @media (max-width: 768px) { .gsb { width: 272px; } }
      `}</style>
    </>
  );
};
