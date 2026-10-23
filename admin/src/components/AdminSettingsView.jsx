import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiChevronRight } from 'react-icons/fi';
import axiosClient from '../api/axiosClient';
import UserAvatar from './UserAvatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ProfileSettings from './settings/ProfileSettings';
import TwoStepSettings from './settings/TwoStepSettings';
import PasswordSettings from './settings/PasswordSettings';
import SystemSettings from './settings/SystemSettings';
import { SETTINGS_SECTIONS } from './settings/SettingsPageHeader';

const ROLE_NAMES = { founder: 'Admin (Owner)', ops: 'Staff' };

const AdminSettingsView = ({ userProfile, section, permissions = {}, onProfileChanged }) => {
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const canSystem = Boolean(permissions['platform.staff.manage']);

  const loadAccount = async () => {
    try {
      setAccount((await axiosClient.get('/auth/me')).data);
    } catch {
      setAccount(null);
    }
  };
  useEffect(() => { loadAccount(); }, [section]);

  if (section === 'profile') return <ProfileSettings account={account} userProfile={userProfile} onSaved={() => { loadAccount(); onProfileChanged?.(); }} />;
  if (section === 'two-step') return <TwoStepSettings account={account} onChanged={loadAccount} />;
  if (section === 'password') return <PasswordSettings />;
  if (section === 'system' && canSystem) return <SystemSettings />;

  const methods = account?.mfa_methods || userProfile?.mfa_methods || [];
  const status = {
    profile: userProfile?.phone ? userProfile.phone : 'Add a phone number',
    'two-step': methods.length
      ? <Badge variant="success">On · {methods.map((m) => (m === 'email' ? 'Email' : 'Authenticator')).join(' + ')}</Badge>
      : <Badge variant="danger">Off</Badge>,
    password: null,
    system: null,
  };

  return (
    <div className="max-w-6xl">
      {/* Account summary */}
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white shadow-sm sm:p-6">
        <div className="pointer-events-none absolute -top-16 -right-10 size-48 rounded-full bg-white/10" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="rounded-full bg-white p-1 shadow-md"><UserAvatar name={userProfile?.name} role={userProfile?.staff_role} size={56} /></span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-extrabold">{userProfile?.name || 'Admin'}</div>
            <div className="truncate text-sm text-blue-100">{userProfile?.email}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-semibold ring-1 ring-white/25">{ROLE_NAMES[userProfile?.staff_role] || 'Staff'}</span>
            <span className={cn('rounded-full px-3 py-1 text-xs font-semibold ring-1', methods.length ? 'bg-emerald-400/20 ring-emerald-200/40' : 'bg-red-400/25 ring-red-200/40')}>
              {methods.length ? '2-step on' : '2-step off'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {Object.entries(SETTINGS_SECTIONS).filter(([, s]) => !s.founderOnly || canSystem).map(([slug, s]) => {
          const Icon = s.icon;
          return (
            <button
              key={slug}
              type="button"
              onClick={() => navigate(`/dashboard/settings/${slug}`)}
              className="group flex cursor-pointer items-start gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
            >
              <span className={cn('flex size-12 shrink-0 items-center justify-center rounded-xl ring-4', s.tone)}><Icon size={22} /></span>
              <span className="min-w-0 flex-1">
                <span className="block font-bold text-slate-900">{s.title}</span>
                <span className="mt-0.5 block text-[13px] text-muted-foreground">{s.text}</span>
                {status[slug] && <span className="mt-2.5 block text-xs text-slate-500">{status[slug]}</span>}
              </span>
              <FiChevronRight className="mt-1 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default AdminSettingsView;
