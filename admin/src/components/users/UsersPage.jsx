import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FiUserPlus, FiMoreHorizontal, FiSearch, FiShield, FiSlash, FiCheckCircle, FiLogOut, FiKey,
  FiRefreshCw, FiX, FiMail, FiClock, FiUsers, FiBriefcase, FiAlertTriangle,
} from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import DataTable from '../DataTable';
import UserAvatar from '../UserAvatar';
import StatTile from '../StatTile';
import ConfirmDialog from '../ConfirmDialog';
import InviteStaffDialog, { deliveryNotice } from './InviteStaffDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { userType } from '../../utils/roles';
import { relativeTime, shortDate, fullDateTime } from '../../utils/time';

const apiError = (err, fallback) => err.response?.data?.error || fallback;

const matches = (q, ...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));

const Person = ({ user, isYou }) => (
  <div className="flex min-w-0 items-center gap-3">
    <UserAvatar name={user.name} role={user.staff_role || 'customer'} size={36} />
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-[13.5px] font-semibold">
        <span className="truncate">{user.name || 'Unnamed'}</span>
        {isYou && <Badge variant="info" className="px-1.5 py-0 text-[10px]">You</Badge>}
      </div>
      <div className="truncate text-xs text-muted-foreground">{user.email || 'No email on file'}</div>
    </div>
  </div>
);

const TypeBadge = ({ user }) => {
  const type = userType(user);
  return (
    <Badge className="border-transparent text-[11px] font-bold" style={{ background: type.bg, color: type.color }}>
      {type.label}
    </Badge>
  );
};

const StatusBadge = ({ active }) => (
  <Badge variant={active ? 'success' : 'danger'}>{active ? 'Active' : 'Deactivated'}</Badge>
);

const MfaBadge = ({ enabled }) => (
  <Badge variant={enabled ? 'success' : 'muted'}><FiShield /> {enabled ? 'On' : 'Off'}</Badge>
);

const LastActive = ({ value }) => (
  <span className="text-xs text-muted-foreground" title={fullDateTime(value)}>{relativeTime(value) || 'Never signed in'}</span>
);

const RowMenu = ({ children, label }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size="icon" className="size-8" aria-label={label}>
        <FiMoreHorizontal />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="min-w-52">{children}</DropdownMenuContent>
  </DropdownMenu>
);

// Admin panel people: the platform team (Admin (Owner) / Staff, invited by
// email) and the customers (one login per workspace).
const UsersPage = ({ currentUser, permissions = {}, onChanged }) => {
  const canManageTeam = Boolean(permissions['platform.staff.manage']);
  const canManageCustomers = Boolean(permissions['platform.users.manage']);

  const [tab, setTab] = useState('team');
  const [search, setSearch] = useState('');
  const [staff, setStaff] = useState([]);
  const [invitations, setInvitations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const [staffRes, usersRes] = await Promise.all([axiosClient.get('/admin/staff'), axiosClient.get('/admin/users')]);
      setStaff(staffRes.data?.staff || []);
      setInvitations(staffRes.data?.invitations || []);
      setCustomers((usersRes.data?.users || []).filter((u) => !u.is_platform_staff && u.tenant_id != null));
    } catch (err) {
      toast.error(apiError(err, 'Failed to load users'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const refresh = async () => {
    await load();
    onChanged?.();
  };

  // Runs one action, shows the result and reloads the lists.
  const act = (request, success, failure) => async () => {
    try {
      await request();
      toast.success(success);
      await refresh();
    } catch (err) {
      toast.error(apiError(err, failure));
      throw err;
    }
  };

  const q = search.trim().toLowerCase();
  const visibleStaff = useMemo(() => staff.filter((u) => matches(q, u.name, u.email)), [staff, q]);
  const visibleInvites = useMemo(() => invitations.filter((i) => matches(q, i.name, i.email)), [invitations, q]);
  const visibleCustomers = useMemo(() => customers.filter((u) => matches(q, u.name, u.email, u.tenant_name)), [customers, q]);

  const activeStaff = staff.filter((u) => u.is_active).length;
  const activeAccounts = [...staff, ...customers].filter((u) => u.is_active);
  const withoutMfa = activeAccounts.filter((u) => !u.mfa_enabled).length;

  // ── Team ──
  const staffActions = (user) => {
    const isYou = Number(user.id) === Number(currentUser?.id);
    if (!canManageTeam || isYou) return <span className="text-xs text-muted-foreground">{isYou ? '—' : ''}</span>;
    const name = user.name || user.email;
    const toAdmin = user.staff_role !== 'founder';
    return (
      <RowMenu label={`Actions for ${name}`}>
        <DropdownMenuItem onSelect={() => setConfirm({
          title: toAdmin ? `Make ${name} an Admin (Owner)?` : `Change ${name} to Staff?`,
          description: toAdmin
            ? 'Admins have full access, including billing, creating workspaces and managing the team.'
            : 'Staff lose access to billing, workspace creation and team management.',
          actionLabel: toAdmin ? 'Make Admin (Owner)' : 'Change to Staff',
          run: act(() => axiosClient.patch(`/admin/staff/${user.id}`, { staff_role: toAdmin ? 'founder' : 'ops' }), 'Role updated', 'Failed to change the role'),
        })}>
          <FiShield /> {toAdmin ? 'Make Admin (Owner)' : 'Change to Staff'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setConfirm({
          title: `Sign ${name} out everywhere?`,
          description: 'Every signed-in session of this person ends now. They can sign in again with their password.',
          actionLabel: 'Sign out everywhere',
          run: act(() => axiosClient.post(`/admin/staff/${user.id}/revoke-sessions`), `${name} was signed out everywhere`, 'Failed to sign out'),
        })}>
          <FiLogOut /> Sign out everywhere
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!user.mfa_enabled} onSelect={() => setConfirm({
          title: `Reset 2-step verification for ${name}?`,
          description: 'Use this when they lost their authenticator phone. They set up 2-step verification again at their next sign-in.',
          actionLabel: 'Reset 2-step',
          run: act(() => axiosClient.post(`/admin/users/${user.id}/reset-mfa`), '2-step verification reset', 'Failed to reset 2-step verification'),
        })}>
          <FiKey /> Reset 2-step verification
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user.is_active ? (
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({
            title: `Deactivate ${name}?`,
            description: 'They are signed out and cannot sign in until you reactivate them. Nothing they did is deleted.',
            actionLabel: 'Deactivate',
            destructive: true,
            run: act(() => axiosClient.post(`/admin/staff/${user.id}/deactivate`), `${name} was deactivated`, 'Failed to deactivate'),
          })}>
            <FiSlash /> Deactivate
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setConfirm({
            title: `Reactivate ${name}?`,
            description: 'They can sign in again with their existing password.',
            actionLabel: 'Reactivate',
            run: act(() => axiosClient.post(`/admin/staff/${user.id}/reactivate`), `${name} was reactivated`, 'Failed to reactivate'),
          })}>
            <FiCheckCircle /> Reactivate
          </DropdownMenuItem>
        )}
      </RowMenu>
    );
  };

  const teamColumns = [
    { key: 'name', title: 'Member', sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')), render: (u) => <Person user={u} isYou={Number(u.id) === Number(currentUser?.id)} /> },
    { key: 'role', title: 'Role', render: (u) => <TypeBadge user={u} /> },
    { key: 'status', title: 'Status', render: (u) => <StatusBadge active={u.is_active} /> },
    { key: 'mfa', title: '2-step', render: (u) => <MfaBadge enabled={u.mfa_enabled} /> },
    { key: 'last_login', title: 'Last active', sorter: (a, b) => new Date(a.last_login || 0) - new Date(b.last_login || 0), render: (u) => <LastActive value={u.last_login} /> },
    { key: 'created_at', title: 'Joined', render: (u) => <span className="text-xs text-muted-foreground">{shortDate(u.created_at) || '—'}</span> },
    { key: 'actions', title: '', className: 'text-right', render: staffActions },
  ];

  const resendInvite = async (inv) => {
    try {
      const { data } = await axiosClient.post(`/admin/staff/invitations/${inv.id}/resend`);
      const notice = deliveryNotice(data.delivery);
      if (notice.ok) toast.success(`A new link was sent to ${inv.email}. The old link no longer works.`);
      else toast.warning(notice.text);
      await refresh();
    } catch (err) {
      toast.error(apiError(err, 'Failed to resend the invitation'));
    }
  };

  const inviteColumns = [
    {
      key: 'email', title: 'Invited',
      render: (i) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"><FiMail /></span>
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-semibold">{i.name || i.email}</div>
            {i.name && <div className="truncate text-xs text-muted-foreground">{i.email}</div>}
          </div>
        </div>
      ),
    },
    { key: 'role', title: 'Role', render: (i) => <TypeBadge user={{ is_platform_staff: true, staff_role: i.role }} /> },
    {
      key: 'status', title: 'Status',
      render: (i) => (i.status === 'expired'
        ? <Badge variant="danger"><FiAlertTriangle /> Expired</Badge>
        : <Badge variant="warning"><FiClock /> Waiting to accept</Badge>),
    },
    { key: 'invited_by', title: 'Invited by', render: (i) => <span className="text-xs text-muted-foreground">{i.invited_by_name || '—'}<br />{relativeTime(i.created_at)}</span> },
    {
      key: 'expires', title: 'Link expires',
      render: (i) => <span className={cn('text-xs', i.status === 'expired' ? 'text-red-600' : 'text-muted-foreground')} title={fullDateTime(i.expires_at)}>{relativeTime(i.expires_at)}</span>,
    },
    {
      key: 'actions', title: '', className: 'text-right',
      render: (i) => canManageTeam && (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={() => resendInvite(i)}>
            <FiRefreshCw /> Resend
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirm({
            title: `Cancel the invitation for ${i.email}?`,
            description: 'The link in their email stops working. You can invite them again later.',
            actionLabel: 'Cancel invitation',
            destructive: true,
            run: act(() => axiosClient.delete(`/admin/staff/invitations/${i.id}`), 'Invitation cancelled', 'Failed to cancel the invitation'),
          })}>
            <FiX /> Cancel
          </Button>
        </div>
      ),
    },
  ];

  // ── Customers ──
  const customerActions = (user) => {
    if (!canManageCustomers) return null;
    const name = user.name || user.email;
    return (
      <RowMenu label={`Actions for ${name}`}>
        <DropdownMenuItem onSelect={() => setConfirm({
          title: `Sign ${name} out everywhere?`,
          description: 'Every signed-in session of this customer ends now. They can sign in again with their password.',
          actionLabel: 'Sign out everywhere',
          run: act(() => axiosClient.post(`/admin/users/${user.id}/revoke-sessions`), `${name} was signed out everywhere`, 'Failed to sign out'),
        })}>
          <FiLogOut /> Sign out everywhere
        </DropdownMenuItem>
        <DropdownMenuItem disabled={!user.mfa_enabled} onSelect={() => setConfirm({
          title: `Reset 2-step verification for ${name}?`,
          description: 'They set up 2-step verification again at their next sign-in.',
          actionLabel: 'Reset 2-step',
          run: act(() => axiosClient.post(`/admin/users/${user.id}/reset-mfa`), '2-step verification reset', 'Failed to reset 2-step verification'),
        })}>
          <FiKey /> Reset 2-step verification
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {user.is_active ? (
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirm({
            title: `Deactivate ${name}?`,
            description: `This is the only login of ${user.tenant_name || 'this workspace'}, so nobody from that workspace can sign in until you reactivate it. No data is deleted.`,
            actionLabel: 'Deactivate',
            destructive: true,
            run: act(() => axiosClient.post(`/admin/users/${user.id}/deactivate`), `${name} was deactivated`, 'Failed to deactivate'),
          })}>
            <FiSlash /> Deactivate login
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={() => setConfirm({
            title: `Reactivate ${name}?`,
            description: 'They can sign in again with their existing password.',
            actionLabel: 'Reactivate',
            run: act(() => axiosClient.post(`/admin/users/${user.id}/reactivate`), `${name} was reactivated`, 'Failed to reactivate'),
          })}>
            <FiCheckCircle /> Reactivate login
          </DropdownMenuItem>
        )}
      </RowMenu>
    );
  };

  const customerColumns = [
    { key: 'name', title: 'Customer', sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')), render: (u) => <Person user={u} /> },
    {
      key: 'workspace', title: 'Workspace', sorter: (a, b) => String(a.tenant_name || '').localeCompare(String(b.tenant_name || '')),
      render: (u) => (
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{u.tenant_name || 'Unknown workspace'}</div>
          <div className="text-[11px] text-muted-foreground">Workspace #{u.tenant_id}</div>
        </div>
      ),
    },
    { key: 'status', title: 'Status', render: (u) => <StatusBadge active={u.is_active} /> },
    { key: 'mfa', title: '2-step', render: (u) => <MfaBadge enabled={u.mfa_enabled} /> },
    { key: 'last_login', title: 'Last active', sorter: (a, b) => new Date(a.last_login || 0) - new Date(b.last_login || 0), render: (u) => <LastActive value={u.last_login} /> },
    { key: 'created_at', title: 'Created', render: (u) => <span className="text-xs text-muted-foreground">{shortDate(u.created_at) || '—'}</span> },
    { key: 'actions', title: '', className: 'text-right', render: customerActions },
  ];

  const tabs = [
    ['team', 'Team', staff.length, FiUsers],
    ['customers', 'Customers', customers.length, FiBriefcase],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile label="Team members" value={activeStaff} valueClassName="text-indigo-600" />
        <StatTile label="Pending invites" value={invitations.length} valueClassName="text-amber-600" />
        <StatTile label="Customers" value={customers.length} valueClassName="text-green-600" />
        <StatTile label="2-step off" value={withoutMfa} valueClassName={withoutMfa ? 'text-red-600' : 'text-green-600'} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-border bg-muted/60 p-1" role="tablist">
          {tabs.map(([key, label, count, Icon]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-md px-3.5 py-1.5 text-sm font-semibold transition-colors',
                tab === key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="size-4" /> {label}
              <span className="rounded-full bg-black/5 px-1.5 text-[11px] tabular-nums">{count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-64">
            <FiSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={tab === 'team' ? 'Search team...' : 'Search customers or workspaces...'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 pl-9"
            />
          </div>
          {tab === 'team' && canManageTeam && (
            <Button onClick={() => setInviteOpen(true)} className="font-semibold">
              <FiUserPlus /> Invite team member
            </Button>
          )}
        </div>
      </div>

      {tab === 'team' && (
        <>
          <Card className="gap-4">
            <CardHeader>
              <div>
                <CardTitle className="text-[15px]">Team members</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  People who use this admin panel. Admin (Owner) has full access; Staff has everything except billing and team changes.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2">
              <DataTable columns={teamColumns} data={visibleStaff} loading={loading} pageSize={10} emptyText={q ? 'No team member matches your search.' : 'No team members yet.'} />
            </CardContent>
          </Card>

          <Card className="gap-4">
            <CardHeader>
              <div>
                <CardTitle className="text-[15px]">Pending invitations</CardTitle>
                <CardDescription className="mt-1 text-xs">
                  Invited people who have not set their password yet. Resend gives them a fresh link; the old one stops working.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="px-2">
              <DataTable columns={inviteColumns} data={visibleInvites} loading={loading} pageSize={10} emptyText="No pending invitations." />
            </CardContent>
          </Card>
        </>
      )}

      {tab === 'customers' && (
        <Card className="gap-4">
          <CardHeader>
            <div>
              <CardTitle className="text-[15px]">Customer logins</CardTitle>
              <CardDescription className="mt-1 text-xs">
                Each workspace has one login, created with Provision Workspace. Deactivating it blocks that whole workspace from signing in.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="px-2">
            <DataTable columns={customerColumns} data={visibleCustomers} loading={loading} pageSize={10} emptyText={q ? 'No customer matches your search.' : 'No customers yet. Provision a workspace to create one.'} />
          </CardContent>
        </Card>
      )}

      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={refresh} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} />
    </div>
  );
};

export default UsersPage;
