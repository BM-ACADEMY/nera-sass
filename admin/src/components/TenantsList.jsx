import React from 'react';
import { FiMoreHorizontal, FiSettings, FiSlash, FiCheckCircle } from 'react-icons/fi';
import { FaWhatsapp } from 'react-icons/fa';
import DataTable from './DataTable';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

const STATUS_TAGS = {
  active: { variant: 'success', label: 'Active' },
  suspended: { variant: 'danger', label: 'Suspended (No Login)' },
  deleted: { variant: 'muted', label: 'Deleted' },
};

const WA_STATUS_TAGS = {
  verified: { variant: 'success', label: 'Verified' },
  verification_pending: { variant: 'warning', label: 'Pending' },
  verification_failed: { variant: 'danger', label: 'Failed' },
  not_configured: { variant: 'muted', label: 'Not Configured' },
};

const TenantsList = ({
  tenants,
  loading,
  onConfigureWhatsApp,
  onSuspendTenant,
  onReinstateTenant,
  onViewTenant,
}) => {
  const columns = [
    {
      key: 'name',
      title: 'Workspace',
      sorter: (a, b) => String(a.name || '').localeCompare(String(b.name || '')),
      render: (tenant) => (
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">{tenant.name || 'Unnamed Workspace'}</span>
            {tenant.is_founding_client && <Badge variant="gold" className="text-[10.5px]">Founding Client</Badge>}
          </div>
          <div className="text-[11.5px] text-slate-400">
            ID: #{tenant.id} · Brand: {tenant.brand?.name || tenant.name}
          </div>
        </div>
      ),
    },
    {
      key: 'owner',
      title: 'Owner',
      render: (tenant) => {
        const owner = tenant.owner;
        if (!owner) {
          return <span className="text-[12.5px] text-slate-400 italic">Pending Invitation</span>;
        }
        return (
          <div>
            <div className="text-[13px] font-semibold text-slate-700">{owner.name}</div>
            <div className="text-[11.5px] text-slate-400">{owner.email}</div>
          </div>
        );
      },
    },
    {
      key: 'login',
      title: 'Login',
      render: (tenant) => (
        <span className="text-[12.5px] text-muted-foreground">
          {tenant.users?.active ? 'Active' : tenant.users?.pending_invitations ? 'Invitation pending' : 'No login yet'}
        </span>
      ),
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp',
      render: (tenant) => {
        const statusKey = tenant.brand?.whatsapp_status || 'not_configured';
        const tag = WA_STATUS_TAGS[statusKey] || WA_STATUS_TAGS.not_configured;
        const num = tenant.brand?.whatsapp_number;
        return (
          <div>
            <Badge variant={tag.variant}><FaWhatsapp />{tag.label}</Badge>
            {num && <div className="mt-0.5 text-[11.5px] text-muted-foreground">{num}</div>}
          </div>
        );
      },
    },
    {
      key: 'status',
      title: 'Status',
      render: (tenant) => {
        const tag = STATUS_TAGS[tenant.lifecycle_state] || STATUS_TAGS.active;
        return <Badge variant={tag.variant}>{tag.label}</Badge>;
      },
    },
    {
      key: 'created_at',
      title: 'Created',
      render: (tenant) => (
        <span className="text-xs text-muted-foreground">
          {tenant.created_at ? new Date(tenant.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (tenant) => {
        const isSuspended = tenant.status === 'suspended';
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8" aria-label="Workspace actions">
                <FiMoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onConfigureWhatsApp && onConfigureWhatsApp(tenant)}>
                <FaWhatsapp className="text-[#25D366]" /> Configure WhatsApp
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => onViewTenant && onViewTenant(tenant)}>
                <FiSettings /> View Workspace Details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {isSuspended ? (
                <DropdownMenuItem onSelect={() => onReinstateTenant && onReinstateTenant(tenant)}>
                  <FiCheckCircle /> Reinstate Workspace
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem variant="destructive" onSelect={() => onSuspendTenant && onSuspendTenant(tenant)}>
                  <FiSlash /> Suspend Workspace
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return <DataTable columns={columns} data={tenants} loading={loading} pageSize={10} emptyText="No workspaces found." />;
};

export default TenantsList;
