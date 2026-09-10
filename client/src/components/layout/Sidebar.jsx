import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import { Layout, Menu, Badge } from 'antd';
import { 
  Home, Users, Inbox, Zap, FileText, Brain, BarChart2, Building2, 
  Settings, LogOut, Activity, Share2, User, Layers, MonitorPlay, Shield,
  UploadCloud, List, Globe, Megaphone, MessageCircle, BookOpen, Sparkles, Columns,
  CheckSquare, FileSearch, Target, FileOutput, ShieldAlert, Heart, ClipboardList, UserPlus
} from 'lucide-react';
import { C } from '../../constants/theme.js';
import { api } from '../../services/api.js';
import { useAuth } from '../../hooks/useAuth.js';

const { Sider } = Layout;

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
  const location = useLocation();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(window.innerWidth <= 768);
  const [taskUnreadCount, setTaskUnreadCount] = useState(0);

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

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setCollapsed(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMenuClick = ({ key }) => {
    if (key === 'logout') {
      onLogout();
      return;
    }
    if (key === '/sales-tasks' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    navigate(key);
    if (window.innerWidth <= 768) {
      setMobileOpen(false);
    }
  };

  const menuItems = [
    ...NAV.map(item => {
      const badgeCount = item.taskBadge ? taskUnreadCount : (item.showBadge ? unreadCount : 0);
      return {
        key: item.path,
        icon: <item.Icon size={16} />,
        label: badgeCount > 0 ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{item.label}</span>
            <Badge count={badgeCount} style={{ backgroundColor: '#1677ff' }} />
          </div>
        ) : item.label,
      };
    }),
    { type: 'divider' },
    
    // AllianceOS (Commented out per request, using false && to hide)
    ...(false ? [{
      key: 'alliance',
      icon: <Layers size={16} />,
      label: 'AllianceOS',
      children: [
        { key: '/alliance/analytics', icon: <BarChart2 size={14} />, label: 'Analytics' },
        { key: '/alliance/upload', icon: <UploadCloud size={14} />, label: 'Upload Leads' },
        { key: '/alliance/prospects', icon: <List size={14} />, label: 'Prospects' },
        { key: '/alliance/number-health', icon: <Activity size={14} />, label: 'Number Health' },
        { key: '/alliance/email-setup', icon: <Globe size={14} />, label: 'Email Senders' },
        { key: '/alliance/email-campaigns/new', icon: <Megaphone size={14} />, label: 'Email Campaigns' },
        { key: '/alliance/whatsapp-campaigns/new', icon: <MessageCircle size={14} />, label: 'WhatsApp Campaigns' },
        { key: '/alliance/replies', icon: <Inbox size={14} />, label: 'Replies' },
        { key: '/alliance/ai-brain', icon: <BookOpen size={14} />, label: 'AI Brain' },
        { key: '/alliance/prompts', icon: <Sparkles size={14} />, label: 'Prompts' },
        { key: '/alliance/planner', icon: <Columns size={14} />, label: 'Campaign Planner' },
        { key: '/alliance-inbox', icon: <Inbox size={14} />, label: 'WhatsApp Inbox' },
      ]
    }] : []),

    // Content OS (Commented out)
    ...(false ? [{
      key: 'content-os',
      icon: <MonitorPlay size={16} />,
      label: 'Content OS',
      children: [
        { key: '/admin/content-os/approval', icon: <CheckSquare size={14} />, label: 'Approval Room' },
        { key: '/admin/content-os/monitors', icon: <FileSearch size={14} />, label: 'Folder Monitors' },
        { key: '/admin/content-os/scheduler', icon: <Target size={14} />, label: 'Scheduler' },
        { key: '/admin/content-os/captions', icon: <Sparkles size={14} />, label: 'Caption Studio' },
        { key: '/admin/content-os/thumbnail-brain', icon: <Brain size={14} />, label: 'Thumbnail Brain' },
        { key: '/admin/content-os/social-connection', icon: <Share2 size={14} />, label: 'Social Accounts' },
        { key: '/admin/content-os/tokens', icon: <Shield size={14} />, label: 'Token Health' },
        { key: '/admin/content-os/logs', icon: <FileText size={14} />, label: 'Publish Logs' },
        { key: '/admin/content-os/reach', icon: <BarChart2 size={14} />, label: 'Reach Report' },
        { key: '/admin/content-os/failed', icon: <ShieldAlert size={14} />, label: 'Failed Jobs' },
      ]
    }] : []),

    // Mafiya OS (Commented out)
    ...(false ? [{
      key: 'mafiya-os',
      icon: <Shield size={16} />,
      label: 'Mafiya OS',
      children: [
        { key: '/mafiya/family', icon: <Users size={14} />, label: 'The Family' },
        { key: '/mafiya/add-client', icon: <UserPlus size={14} />, label: 'GMB Clients' },
        { key: '/mafiya/plans', icon: <Layers size={14} />, label: 'Mafiya Plans' },
        { key: '/mafiya/loyalty', icon: <Heart size={14} />, label: 'Loyalty (Review)' },
        { key: '/mafiya/street-posts', icon: <Megaphone size={14} />, label: 'Street Posts' },
        { key: '/mafiya/rivals', icon: <Target size={14} />, label: 'Rival Families' },
        { key: '/mafiya/gbp-insights', icon: <BarChart2 size={14} />, label: 'GBP Insights' },
        { key: '/mafiya/citations', icon: <Globe size={14} />, label: 'Citation' },
        { key: '/mafiya/orders', icon: <ClipboardList size={14} />, label: 'Mafia Orders' },
        { key: '/mafiya/brain', icon: <Brain size={14} />, label: "Don's Brain" },
        { key: '/mafiya/usage', icon: <Activity size={14} />, label: 'Usage' },
      ]
    }] : []),

    {
      key: '/workflows',
      icon: <Activity size={16} />,
      label: 'Workflow Logs',
    },
    {
      key: '/settings',
      icon: <Settings size={16} />,
      label: 'Settings',
    }
  ];

  return (
    <>
      {mobileOpen && (
        <div
          className="mobile-overlay show-mobile"
          onClick={() => setMobileOpen(false)}
          style={{ display: 'none' }} // Ensure overlay handles correctly with app CSS
        />
      )}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        width={250}
        theme="light"
        trigger={null}
        className={`mobile-sidebar ${!mobileOpen ? 'closed' : ''}`}
        style={{
          height: '100vh',
          position: 'relative',
          left: 0,
          top: 0,
          bottom: 0,
          borderRight: `1px solid ${C.border}`,
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Custom Header with Logo and Toggle */}
        <div style={{ height: 72, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', padding: collapsed ? '0' : '0 20px', transition: 'all 0.2s' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <div style={{ width: 36, height: 36, flexShrink: 0, background: '#4299e1', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <BarChart2 size={20} color="#fff" />
            </div>
          </div>
          {!collapsed && (
            <div onClick={() => setCollapsed(true)} style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 4, opacity: 0.5 }}>
              <div style={{ width: 16, height: 2, background: C.text, borderRadius: 2 }} />
              <div style={{ width: 12, height: 2, background: C.text, borderRadius: 2, alignSelf: 'flex-end' }} />
            </div>
          )}
        </div>
        {collapsed && (
          <div onClick={() => setCollapsed(false)} style={{ height: 20, cursor: 'pointer', display: 'flex', justifyContent: 'center', opacity: 0.5, marginBottom: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ width: 16, height: 2, background: C.text, borderRadius: 2 }} />
              <div style={{ width: 16, height: 2, background: C.text, borderRadius: 2 }} />
            </div>
          </div>
        )}

        {/* Menu Area */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
          <Menu
            theme="light"
            mode="inline"
            selectedKeys={[location.pathname]}
            onClick={handleMenuClick}
            items={menuItems}
            style={{ borderRight: 0, padding: '0 12px' }}
          />
        </div>

        {/* Custom Footer (User Profile) */}
        <div style={{ padding: collapsed ? '20px 0' : '20px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'space-between', background: '#f8fafc', margin: collapsed ? '0' : '0 12px 12px 12px', borderRadius: collapsed ? 0 : 12, cursor: 'pointer' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ position: 'relative' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: C.accent, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 600, fontSize: 14 }}>
                {user?.name ? user.name[0].toUpperCase() : 'U'}
              </div>
              <div style={{ position: 'absolute', bottom: 0, right: -2, width: 10, height: 10, borderRadius: '50%', background: '#48bb78', border: '2px solid #fff' }} />
            </div>
            {!collapsed && (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{user?.name || 'User'}</span>
                <span style={{ fontSize: 11, color: C.muted }}>{user?.role === 'admin' ? 'Administrator' : 'Product Manager'}</span>
              </div>
            )}
          </div>
          {!collapsed && (
            <div onClick={(e) => { e.stopPropagation(); onLogout(); }} title="Sign Out" style={{ padding: 4, opacity: 0.5 }}>
              <LogOut size={16} />
            </div>
          )}
        </div>
      </Sider>
      <style>{`
        .ant-menu-light .ant-menu-item-selected {
          background-color: #ebf4ff !important;
          color: #3182ce !important;
          font-weight: 600;
        }
        .ant-menu-light .ant-menu-item-selected .lucide {
          color: #3182ce !important;
        }
      `}</style>
    </>
  );
};
