import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { io as socketIO } from 'socket.io-client';
import { FiGrid, FiUsers, FiCheckSquare, FiSmartphone, FiFileText, FiSend, FiCpu, FiBarChart2, FiSettings, FiCalendar, FiPackage, FiLogOut, FiMoreVertical, FiCreditCard, FiMonitor, FiUserPlus } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import getneraLogo from '../../assets/getnera-logo.png';
import { api } from '../../services/api.js';
import { roleLabel } from '../../views/settings/settingsPolicy.js';
import { canSeeTeam, menuSections, mySections, hasSection } from '../../views/settings/teamPolicy.js';
import { useAuth } from '../../hooks/useAuth.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader,
  SidebarMenu, SidebarMenuBadge, SidebarMenuButton, SidebarMenuItem, SidebarRail, useSidebar,
} from '@/components/ui/sidebar';

// The customer panel menu, in the same sections and look as the admin panel.
// Settings, Billing and sign-out live in the profile menu at the bottom.
// `section`: shown only to people given that section (Owners have all);
// `permission`: shown only with that GET /api/tenant permission flag.
export const SECTIONS = [
  { label: 'Overview', items: [{ path: '/dashboard', icon: FiGrid, label: 'Dashboard', section: 'dashboard' }] },
  {
    label: 'Sales',
    items: [
      { path: '/leads', icon: FiUsers, label: 'Leads', section: 'leads' },
      { path: '/sales-tasks', icon: FiCheckSquare, label: 'Sales Task', badge: 'tasks', section: 'sales_tasks' },
    ],
  },
  // Only for people who may see the team (GET /api/tenant permissions.view_team).
  { label: 'Workspace', items: [{ path: '/team', icon: FiUserPlus, label: 'Team', permission: 'view_team' }] },
  {
    label: 'WhatsApp',
    items: [
      { path: '/inbox', label: 'WhatsApp Chat', whatsapp: true, section: 'inbox' },
      // Connecting the number is for Owners.
      { path: '/whatsapp', icon: FiSmartphone, label: 'WhatsApp Number', permission: 'manage_whatsapp' },
      { path: '/templates', icon: FiFileText, label: 'Templates', section: 'templates' },
      { path: '/campaigns', icon: FiSend, label: 'Campaigns', section: 'campaigns' },
    ],
  },
  { label: 'AI', items: [{ path: '/brain', icon: FiCpu, label: 'AI Brain', section: 'ai_brain' }] },
  {
    label: 'Plugins',
    items: [
      { path: '/plugins', icon: FiPackage, label: 'Plugins', section: 'plugins' },
      { path: '/calendar', icon: FiCalendar, label: 'Calendar', section: 'plugins' },
    ],
  },
  { label: 'Insights', items: [{ path: '/reports', icon: FiBarChart2, label: 'Reports', section: 'reports' }] },
];

const AppSidebar = ({ onLogout }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { isMobile, setOpenMobile } = useSidebar();
  const [taskUnread, setTaskUnread] = useState(0);
  const [permissions, setPermissions] = useState(null);

  // The server's permission flags and sections decide the gated items. Asked
  // once per role and sections; a failed request is tried again on the next
  // page change. Until it answers, the signed-in user's own sections are used.
  const askedFor = useRef(null);
  const accessKey = `${user?.role}|${(user?.sections || []).join(',')}`;
  useEffect(() => {
    if (askedFor.current === accessKey) return;
    askedFor.current = accessKey;
    api.getTenant()
      .then((data) => setPermissions({
        view_team: canSeeTeam(data.permissions),
        manage_whatsapp: Boolean(data.permissions?.manage_whatsapp),
        sections: Array.isArray(data.sections) ? data.sections : mySections(user),
      }))
      .catch(() => { askedFor.current = null; });
  }, [accessKey, location.pathname, user]);
  const access = permissions || { view_team: false, manage_whatsapp: user?.role === 'owner', sections: mySections(user) };
  const canTasks = hasSection(access.sections, 'sales_tasks');

  useEffect(() => {
    if (!canTasks) return undefined;
    api.get('/sales-tasks/unread-count').then((d) => setTaskUnread(d.count || 0)).catch(() => {});
    const socket = socketIO(api.baseUrl, { auth: { token: localStorage.getItem('leados_token') }, transports: ['websocket', 'polling'] });
    socket.on('sales_task_update', (data) => {
      setTaskUnread(data.unread_count || 0);
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
  }, [navigate, canTasks]);

  const go = (path) => {
    if (path === '/sales-tasks' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    navigate(path);
    if (isMobile) setOpenMobile(false);
  };
  const isActive = (path) => location.pathname === path || location.pathname.startsWith(`${path}/`);
  const badgeOf = (item) => (item.badge === 'tasks' ? taskUnread : 0);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-transparent active:bg-transparent">
              <img src={getneraLogo} alt="" className="aspect-square size-8 shrink-0 rounded-lg object-cover" />
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[15px] font-extrabold">Getnera</span>
                <span className="truncate text-[11px] text-slate-400">{user?.tenant_name || 'Your workspace'}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {menuSections(SECTIONS, access).map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  const badge = badgeOf(item);
                  return (
                    <SidebarMenuItem key={item.path}>
                      <SidebarMenuButton
                        isActive={isActive(item.path)}
                        tooltip={badge ? `${item.label} (${badge})` : item.label}
                        onClick={() => go(item.path)}
                        className={item.whatsapp ? 'data-[active=true]:bg-green-50 data-[active=true]:text-green-800' : undefined}
                      >
                        {item.whatsapp ? <FaWhatsapp className="text-[#25D366]" /> : <Icon />}
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {badge > 0 && (
                        <SidebarMenuBadge className="rounded-full bg-blue-600 text-white peer-data-[active=true]/menu-button:text-white">{badge > 99 ? '99+' : badge}</SidebarMenuBadge>
                      )}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" isActive={isActive('/settings') || isActive('/billing')} className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
                    {user?.name ? user.name.trim()[0].toUpperCase() : 'U'}
                  </span>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[13px] font-semibold">{user?.name || 'User'}</span>
                    <span className="truncate text-[11.5px] text-slate-400">{user?.email || roleLabel(user?.role)}</span>
                  </div>
                  <FiMoreVertical className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56" side={isMobile ? 'bottom' : 'right'} align="end" sideOffset={4}>
                <div className="px-2 py-1.5 text-sm">
                  <div className="truncate font-semibold">{user?.name || 'User'}</div>
                  <div className="truncate text-xs text-muted-foreground">{user?.email || ''} · {roleLabel(user?.role)}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => go('/settings')}><FiSettings /> Settings</DropdownMenuItem>
                {/* Billing is for Owners and Admins (Admins can look, only Owners pay). */}
                {user?.role !== 'staff' && <DropdownMenuItem onSelect={() => go('/billing')}><FiCreditCard /> Billing</DropdownMenuItem>}
                <DropdownMenuItem onSelect={() => go('/account/sessions')}><FiMonitor /> My sessions</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onLogout}><FiLogOut /> Log out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
};

export default AppSidebar;
