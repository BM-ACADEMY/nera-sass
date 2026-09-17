import React from 'react';
import { roleStyle } from '../utils/roles';

const RoleFilter = ({ users, value, onChange }) => {
  const roles = [...new Set(users.map((u) => u.role))];

  const tabs = [
    { key: 'all', label: 'All', count: users.length },
    ...roles.map((role) => ({
      key: role,
      label: role.replace('_', ' '),
      count: users.filter((u) => u.role === role).length,
    })),
  ];

  return (
    <div className="role-filter">
      {tabs.map((tab) => {
        const active = value === tab.key;
        const style = tab.key === 'all' ? null : roleStyle(tab.key);
        return (
          <button
            key={tab.key}
            type="button"
            className={`role-filter-tab${active ? ' active' : ''}`}
            onClick={() => onChange(tab.key)}
            style={active && style ? { background: style.bg, color: style.color } : undefined}
          >
            <span style={{ textTransform: 'capitalize' }}>{tab.label}</span>
            <span className="role-filter-count">{tab.count}</span>
          </button>
        );
      })}
    </div>
  );
};

export default RoleFilter;
