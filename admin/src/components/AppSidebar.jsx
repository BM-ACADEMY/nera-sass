import React from 'react';
import { FiLogOut, FiMoreVertical, FiSettings, FiUser, FiShield } from 'react-icons/fi';
import { MdOutlineSpaceDashboard } from 'react-icons/md';
import { FaWhatsapp } from 'react-icons/fa';
import UserAvatar from './UserAvatar';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';

// Platform navigation: brand, the menu in labelled sections, and the signed-in
// admin (account settings and sign-out live in that profile menu).
// `sections`: [{ label, items: [{ key, icon, label, badge?, whatsapp? }] }]
const AppSidebar = ({
  sections,
  activeTab,
  onSelect,
  onOpenSettings,
  workspaceCount,
  userCount,
  userProfile,
  onLogout,
}) => {
  const { isMobile, setOpenMobile } = useSidebar();

  const select = (key) => {
    onSelect(key);
    if (isMobile) setOpenMobile(false);
  };
  const openSettings = (section) => {
    onOpenSettings(section);
    if (isMobile) setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="hover:bg-transparent active:bg-transparent">
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <MdOutlineSpaceDashboard className="size-5" />
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[15px] font-extrabold">Getnera Admin</span>
                <span className="truncate text-[11px] text-slate-400">
                  {workspaceCount} workspace{workspaceCount === 1 ? '' : 's'} · {userCount} users
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.filter((section) => section.items.length).map((section) => (
          <SidebarGroup key={section.label}>
            <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map(({ key, icon: Icon, label, badge, whatsapp }) => (
                  <SidebarMenuItem key={key}>
                    <SidebarMenuButton
                      isActive={activeTab === key}
                      tooltip={badge ? `${label} (${badge} unread)` : label}
                      onClick={() => select(key)}
                      className={whatsapp ? 'data-[active=true]:bg-green-50 data-[active=true]:text-green-800' : undefined}
                    >
                      {whatsapp ? <FaWhatsapp className="text-[#25D366]" /> : <Icon />}
                      <span>{label}</span>
                    </SidebarMenuButton>
                    {badge > 0 && (
                      <SidebarMenuBadge className={`rounded-full ${whatsapp ? 'bg-[#25D366]' : 'bg-blue-600'} text-white peer-data-[active=true]/menu-button:text-white`}>
                        {badge > 99 ? '99+' : badge}
                      </SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                ))}
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
                <SidebarMenuButton size="lg" isActive={activeTab === 'settings'} className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <UserAvatar name={userProfile?.name} role={userProfile?.staff_role || 'superadmin'} size={32} />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-[13px] font-semibold">{userProfile?.name || 'Platform Admin'}</span>
                    <span className="truncate text-[11.5px] text-slate-400">{userProfile?.email || ''}</span>
                  </div>
                  <FiMoreVertical className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                side={isMobile ? 'bottom' : 'right'}
                align="end"
                sideOffset={4}
              >
                <div className="px-2 py-1.5 text-sm">
                  <div className="truncate font-semibold">{userProfile?.name || 'Platform Admin'}</div>
                  <div className="truncate text-xs text-muted-foreground">{userProfile?.email || ''}</div>
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => openSettings('profile')}><FiUser /> Profile</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openSettings('two-step')}><FiShield /> Two-step verification</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => openSettings(null)}><FiSettings /> Settings</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={onLogout}>
                  <FiLogOut /> Log out
                </DropdownMenuItem>
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
