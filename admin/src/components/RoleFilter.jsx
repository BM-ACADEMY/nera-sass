import React from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { roleStyle, formatRole } from '../utils/roles';

const RoleFilter = ({ users, value, onChange }) => {
  const roles = [...new Set(users.map((u) => u.staff_role || u.role).filter(Boolean))];

  const tabs = [
    { key: 'all', label: 'All', count: users.length },
    ...roles.map((role) => ({
      key: role,
      label: formatRole(role),
      count: users.filter((u) => (u.staff_role || u.role) === role).length,
    })),
  ];

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-muted/60 p-1">
      {tabs.map((tab) => {
        const active = value === tab.key;
        const style = tab.key === 'all' ? null : roleStyle(tab.key);
        return (
          <Button
            key={tab.key}
            type="button"
            size="sm"
            variant={active ? 'default' : 'ghost'}
            onClick={() => onChange(tab.key)}
            className={cn('h-7 rounded-lg text-xs font-semibold', !active && 'text-muted-foreground')}
            style={active && style ? { background: style.bg, color: style.color } : undefined}
          >
            {tab.label}
            <span className={cn('rounded-full px-1.5 text-[11px] font-bold', active ? 'bg-black/10' : 'bg-black/5')}>
              {tab.count}
            </span>
          </Button>
        );
      })}
    </div>
  );
};

export default RoleFilter;
