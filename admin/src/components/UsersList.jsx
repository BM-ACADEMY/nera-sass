import React from 'react';
import { FiMoreHorizontal, FiSlash, FiCheckCircle, FiRefreshCw, FiKey, FiEdit2 } from 'react-icons/fi';
import DataTable from './DataTable';
import UserAvatar from './UserAvatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { roleStyle, formatRole } from '../utils/roles';

const UsersList = ({ users, loading, onChangeRole, onToggleActive, onRevokeSessions, onResetMfa }) => {
  const columns = [
    {
      key: 'name',
      title: 'User',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (user) => (
        <div className="flex items-center gap-3">
          <UserAvatar name={user.name} role={user.role || user.staff_role} size={38} />
          <div className="min-w-0">
            <div className="text-[13.5px] font-semibold whitespace-nowrap">{user.name || 'Unnamed User'}</div>
            <div className="text-xs whitespace-nowrap text-slate-400">{user.email || 'No email on file'}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'phone',
      title: 'Phone',
      render: (user) => <span className={user.phone ? 'text-[13px] text-slate-600' : 'text-[13px] text-slate-300'}>{user.phone || '—'}</span>,
    },
    {
      key: 'role',
      title: 'Role',
      render: (user) => {
        const displayRole = user.staff_role || user.role || 'agent';
        const style = roleStyle(displayRole);
        return (
          <Badge className="border-transparent px-3 text-[11px] font-bold" style={{ background: style.bg, color: style.color }}>
            {user.is_platform_staff ? `Staff · ${formatRole(displayRole)}` : formatRole(displayRole)}
          </Badge>
        );
      },
    },
    {
      key: 'is_active',
      title: 'Status',
      render: (user) => (
        <Badge variant={user.is_active !== false ? 'success' : 'danger'}>
          {user.is_active !== false ? 'Active' : 'Deactivated'}
        </Badge>
      ),
    },
    {
      key: 'tenant_id',
      title: 'Workspace',
      render: (user) => (
        <span className={user.tenant_id ? 'text-xs font-medium text-slate-700' : 'text-xs font-medium text-slate-400'}>
          {user.tenant_id ? `Tenant #${user.tenant_id}` : 'Platform'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (user) => {
        const isActive = user.is_active !== false;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="User actions">
                <FiMoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onChangeRole && onChangeRole(user)}>
                <FiEdit2 /> Change Role
              </DropdownMenuItem>
              <DropdownMenuItem variant={isActive ? 'destructive' : 'default'} onSelect={() => onToggleActive && onToggleActive(user)}>
                {isActive ? <FiSlash /> : <FiCheckCircle />} {isActive ? 'Deactivate User' : 'Reactivate User'}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => onRevokeSessions && onRevokeSessions(user)}>
                <FiRefreshCw /> Revoke All Sessions
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!user.mfa_enabled} onSelect={() => onResetMfa && onResetMfa(user)}>
                <FiKey /> Reset MFA
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return <DataTable columns={columns} data={users} loading={loading} pageSize={8} emptyText="No users found." />;
};

export default UsersList;
