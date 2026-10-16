import React from 'react';
import { FiUsers, FiShield, FiUser, FiBriefcase } from 'react-icons/fi';

const StatsCards = ({ users = [], tenantCount }) => {
  const total = users.length;
  const admins = users.filter((u) => u.is_platform_staff || ['owner', 'admin', 'superadmin', 'staff_admin'].includes(String(u.role || u.staff_role || '').toLowerCase())).length;
  const standard = total - admins;
  const validTenantIds = new Set(users.map((u) => u.tenant_id).filter(id => id !== null && id !== undefined && id > 0));
  const workspaces = typeof tenantCount === 'number' ? tenantCount : validTenantIds.size;

  const stats = [
    { key: 'total', label: 'Total Accounts', value: total, icon: <FiUsers size={17} />, accent: '#2563eb', tint: '#eff6ff' },
    { key: 'admins', label: 'Staff & Admins', value: admins, icon: <FiShield size={17} />, accent: '#0369a1', tint: '#e0f2fe' },
    { key: 'users', label: 'Standard Users', value: standard, icon: <FiUser size={17} />, accent: '#15803d', tint: '#dcfce7' },
    { key: 'workspaces', label: 'Workspaces', value: workspaces, icon: <FiBriefcase size={17} />, accent: '#b45309', tint: '#fef3c7' },
  ];

  return (
    <div className="stats-grid">
      {stats.map((s) => (
        <div className="stat-card" key={s.key}>
          <div className="stat-card-icon" style={{ background: s.tint, color: s.accent }}>
            {s.icon}
          </div>
          <div className="stat-card-body">
            <div className="stat-card-value">{s.value}</div>
            <div className="stat-card-label">{s.label}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StatsCards;
