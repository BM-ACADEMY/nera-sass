import React, { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  FiSearch,
  FiX,
  FiPlus,
  FiUsers,
  FiSmartphone,
  FiActivity,
  FiBarChart2,
  FiSettings
} from 'react-icons/fi';
import { MdOutlineSpaceDashboard } from 'react-icons/md';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import CreateTenantModal from '../components/CreateTenantModal';
import WorkspaceDetail from '../components/workspaces/WorkspaceDetail';
import TenantsList from '../components/TenantsList';
import UsersPage from '../components/users/UsersPage';
import AppSidebar from '../components/AppSidebar';
import StatsCards from '../components/StatsCards';
import ClientsManagement from '../components/ClientsManagement';
import WorkflowLogsView from '../components/WorkflowLogsView';
import FounderReportsView from '../components/FounderReportsView';
import AdminSettingsView from '../components/AdminSettingsView';
import axiosClient from '../api/axiosClient';
import { disconnectRealtime, useLiveRefresh, useLiveStatus } from '../api/realtime';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

// Each sidebar section has its own URL (/dashboard/<slug>) so the address bar
// follows the section and a refresh stays on it.
const TAB_SLUGS = {
  tenants: 'workspaces',
  clients: 'whatsapp-numbers',
  workflows: 'workflow-logs',
  'founder-reports': 'founder-reports',
  users: 'users',
  settings: 'settings',
};
const TAB_BY_SLUG = Object.fromEntries(Object.entries(TAB_SLUGS).map(([key, slug]) => [slug, key]));

const Dashboard = () => {
  const navigate = useNavigate();
  const { tab: tabSlug, itemId } = useParams();
  // /dashboard/workspaces/<id> opens one workspace's detail page.
  const detailTenantId = tabSlug === TAB_SLUGS.tenants && itemId ? Number(itemId) : null;
  const [detailRefresh, setDetailRefresh] = useState(0);
  const activeTab = TAB_BY_SLUG[tabSlug] || 'tenants'; // 'tenants' | 'clients' | 'workflows' | 'founder-reports' | 'users' | 'settings'
  const setActiveTab = (key) => navigate(`/dashboard/${TAB_SLUGS[key]}`);
  const [users, setUsers] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userProfile, setUserProfile] = useState(null);
  const [permissions, setPermissions] = useState({});
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isTenantModalOpen, setIsTenantModalOpen] = useState(false);
  const [suspendModalTenant, setSuspendModalTenant] = useState(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);

  const fetchTenants = async () => {
    try {
      const res = await axiosClient.get('/admin/tenants');
      setTenants(res.data?.tenants || []);
    } catch (err) {
      console.error('Failed to fetch tenants', err);
    }
  };

  const fetchUsers = async () => {
    try {
      const res = await axiosClient.get('/admin/users');
      setUsers(res.data?.users || []);
    } catch (err) {
      console.error('Failed to fetch users', err);
    }
  };

  const fetchProfile = async () => {
    try {
      const res = await axiosClient.get('/admin/me');
      setUserProfile(res.data?.user || null);
      setPermissions(res.data?.permissions || {});
    } catch (err) {
      console.error('Failed to fetch admin profile', err);
    }
  };

  const reloadAll = async () => {
    setLoading(true);
    await Promise.all([fetchProfile(), fetchTenants(), fetchUsers()]);
    setLoading(false);
  };

  useEffect(() => {
    reloadAll();
  }, []);

  // Live updates: any audited change by anyone, or coming back to this tab,
  // reloads the workspaces, users and an open workspace detail page.
  useLiveRefresh(() => {
    fetchTenants();
    fetchUsers();
    setDetailRefresh((n) => n + 1);
  });
  const live = useLiveStatus();

  const handleLogout = () => {
    disconnectRealtime();
    localStorage.removeItem('adminToken');
    navigate('/login');
  };

  // Tenant Lifecycle Actions
  const handleConfirmSuspend = async () => {
    if (!suspendModalTenant) return;
    if (!suspendReason.trim()) {
      toast.error('Please enter a reason for suspension');
      return;
    }
    setIsSuspending(true);
    try {
      await axiosClient.post(`/admin/tenants/${suspendModalTenant.id}/suspend`, { reason: suspendReason.trim() });
      toast.success(`Workspace "${suspendModalTenant.name}" has been suspended`);
      setSuspendModalTenant(null);
      setSuspendReason('');
      fetchTenants();
      setDetailRefresh((n) => n + 1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to suspend workspace');
    } finally {
      setIsSuspending(false);
    }
  };

  const handleReinstate = async (tenant) => {
    try {
      await axiosClient.post(`/admin/tenants/${tenant.id}/reinstate`);
      toast.success(`Workspace "${tenant.name}" has been reinstated`);
      fetchTenants();
      setDetailRefresh((n) => n + 1);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reinstate workspace');
    }
  };

  // Filtering

  const filteredTenants = tenants.filter((tenant) => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return [tenant.name, tenant.brand?.name, tenant.owner?.name, tenant.owner?.email, tenant.brand?.whatsapp_number]
      .some(field => String(field || '').toLowerCase().includes(q));
  });

  const menuItems = [
    { key: 'tenants', icon: MdOutlineSpaceDashboard, label: 'Workspaces' },
    { key: 'clients', icon: FiSmartphone, label: 'WhatsApp Numbers' },
    { key: 'workflows', icon: FiActivity, label: 'Workflow Logs' },
    { key: 'founder-reports', icon: FiBarChart2, label: 'Founder Reports' },
    { key: 'users', icon: FiUsers, label: 'Users & Team' },
    { key: 'settings', icon: FiSettings, label: 'Settings' },
  ];

  const getTabTitle = () => {
    switch (activeTab) {
      case 'tenants': return detailTenantId ? 'Workspace Details' : 'Workspaces & Tenants';
      case 'clients': return 'WhatsApp Numbers & Meta Inventory';
      case 'workflows': return 'Workflow Automation Engines';
      case 'founder-reports': return 'Founder Reports';
      case 'users': return 'Users & Team';
      case 'settings': return 'Platform Settings & Infrastructure';
      default: return 'Platform Administration';
    }
  };

  // /dashboard or an unknown section: land on Workspaces with a real URL.
  if (!TAB_BY_SLUG[tabSlug]) return <Navigate to={`/dashboard/${TAB_SLUGS.tenants}`} replace />;

  return (
    <SidebarProvider>
      <AppSidebar
        items={menuItems}
        activeTab={activeTab}
        onSelect={(key) => { setActiveTab(key); setSearchQuery(''); }}
        workspaceCount={tenants.length}
        userCount={users.length}
        userProfile={userProfile}
        onLogout={handleLogout}
      />

      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b border-border bg-card px-4 md:px-6">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 data-[orientation=vertical]:h-4" />
          <h1 className="truncate text-lg font-semibold">{getTabTitle()}</h1>
          <span
            className={cn('ml-1 hidden shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold sm:inline-flex', live ? 'border-green-200 bg-green-50 text-green-700' : 'border-border bg-muted text-muted-foreground')}
            title={live ? 'Changes appear here as they happen' : 'Live updates are reconnecting; data refreshes when you return to this tab'}
          >
            <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-green-500' : 'bg-slate-400')} />
            {live ? 'Live' : 'Offline'}
          </span>

          {activeTab === 'tenants' && !detailTenantId && (
            <div className="relative ml-auto hidden w-full max-w-72 sm:block">
              <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search workspaces..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 pr-8 pl-9"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 cursor-pointer text-slate-400 hover:text-foreground"
                >
                  <FiX />
                </button>
              )}
            </div>
          )}
        </header>

        <div className="flex-1 p-4 md:p-8">
          {activeTab === 'tenants' && detailTenantId && (
            <WorkspaceDetail
              tenantId={detailTenantId}
              refreshKey={detailRefresh}
              onSuspend={(tenant) => { setSuspendModalTenant(tenant); setSuspendReason(''); }}
              onReinstate={handleReinstate}
            />
          )}

          {activeTab === 'tenants' && !detailTenantId && (
            <>
              <div className="mb-6 flex justify-end">
                <Button size="lg" onClick={() => setIsTenantModalOpen(true)} className="font-semibold">
                  <FiPlus /> Provision Workspace
                </Button>
              </div>

              <StatsCards users={users} tenantCount={tenants.length} />
            </>
          )}

          {activeTab === 'tenants' && !detailTenantId && (
            <Card className="gap-5">
              <CardHeader>
                <div>
                  <CardTitle>All Workspaces</CardTitle>
                  <CardDescription className="mt-1 text-xs">
                    {filteredTenants.length} of {tenants.length} workspace{tenants.length === 1 ? '' : 's'} shown
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="px-2">
                <TenantsList
                  tenants={filteredTenants}
                  loading={loading}
                  onConfigureWhatsApp={(tenant) => navigate(`/dashboard/${TAB_SLUGS.clients}?workspace=${tenant.id}`)}
                  onSuspendTenant={(tenant) => { setSuspendModalTenant(tenant); setSuspendReason(''); }}
                  onReinstateTenant={handleReinstate}
                  onViewTenant={(tenant) => navigate(`/dashboard/${TAB_SLUGS.tenants}/${tenant.id}`)}
                />
              </CardContent>
            </Card>
          )}

          {activeTab === 'users' && <UsersPage currentUser={userProfile} permissions={permissions} onChanged={fetchUsers} />}

          {activeTab === 'clients' && <ClientsManagement />}

          {activeTab === 'workflows' && <WorkflowLogsView />}

          {activeTab === 'founder-reports' && <FounderReportsView />}

          {activeTab === 'settings' && <AdminSettingsView userProfile={userProfile} />}
        </div>
      </SidebarInset>

      {/* Provision Workspace Modal */}
      <Dialog open={isTenantModalOpen} onOpenChange={setIsTenantModalOpen}>
        <DialogContent className="sm:max-w-[640px]">
          <DialogTitle className="sr-only">Provision Workspace</DialogTitle>
          <CreateTenantModal
            onTenantCreated={() => { setIsTenantModalOpen(false); fetchTenants(); fetchUsers(); }}
            onCancel={() => setIsTenantModalOpen(false)}
          />
        </DialogContent>
      </Dialog>

      {/* Suspend Tenant Modal */}
      <Dialog open={Boolean(suspendModalTenant)} onOpenChange={(open) => !open && setSuspendModalTenant(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend Workspace: {suspendModalTenant?.name}</DialogTitle>
            <DialogDescription>
              Suspension blocks all customer logins for this workspace while safely retaining all leads, conversations and settings.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="suspend-reason" className="text-[12.5px] font-semibold">Reason for suspension:</Label>
            <Textarea
              id="suspend-reason"
              rows={3}
              placeholder="e.g. Non-payment beyond grace period / Terms violation"
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSuspendModalTenant(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleConfirmSuspend} disabled={isSuspending}>
              {isSuspending && <Spinner />} Confirm Suspension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
};

export default Dashboard;
