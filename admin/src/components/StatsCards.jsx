import React from 'react';
import { FiUsers, FiShield, FiUser, FiBriefcase } from 'react-icons/fi';
import { Card } from '@/components/ui/card';

const StatsCards = ({ users = [], tenantCount }) => {
  const total = users.length;
  const admins = users.filter((u) => u.is_platform_staff || ['owner', 'admin', 'superadmin', 'staff_admin'].includes(String(u.role || u.staff_role || '').toLowerCase())).length;
  const standard = total - admins;
  const validTenantIds = new Set(users.map((u) => u.tenant_id).filter(id => id !== null && id !== undefined && id > 0));
  const workspaces = typeof tenantCount === 'number' ? tenantCount : validTenantIds.size;

  const stats = [
    { key: 'total', label: 'Total Accounts', value: total, icon: <FiUsers size={17} />, className: 'bg-blue-50 text-blue-600' },
    { key: 'admins', label: 'Staff & Admins', value: admins, icon: <FiShield size={17} />, className: 'bg-sky-100 text-sky-700' },
    { key: 'users', label: 'Standard Users', value: standard, icon: <FiUser size={17} />, className: 'bg-green-100 text-green-700' },
    { key: 'workspaces', label: 'Workspaces', value: workspaces, icon: <FiBriefcase size={17} />, className: 'bg-amber-100 text-amber-700' },
  ];

  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {stats.map((s) => (
        <Card
          key={s.key}
          className="flex-row items-center gap-3.5 px-5 py-4 transition hover:-translate-y-px hover:shadow-md"
        >
          <div className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${s.className}`}>
            {s.icon}
          </div>
          <div className="min-w-0">
            <div className="text-2xl font-extrabold leading-tight tabular-nums">{s.value}</div>
            <div className="truncate text-xs font-semibold text-muted-foreground">{s.label}</div>
          </div>
        </Card>
      ))}
    </div>
  );
};

export default StatsCards;
