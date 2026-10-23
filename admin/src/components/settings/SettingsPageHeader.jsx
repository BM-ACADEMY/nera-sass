import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FiUser, FiShield, FiLock, FiArrowLeft } from 'react-icons/fi';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Settings sections; each opens its own page at /dashboard/settings/<slug>.
export const SETTINGS_SECTIONS = {
  profile: { title: 'Profile', icon: FiUser, tone: 'bg-blue-50 text-blue-600 ring-blue-100', text: 'Your name, phone number and sign-in email.' },
  'two-step': { title: 'Two-step verification', icon: FiShield, tone: 'bg-emerald-50 text-emerald-600 ring-emerald-100', text: 'Email codes, authenticator app and recovery codes.' },
  password: { title: 'Password & sessions', icon: FiLock, tone: 'bg-amber-50 text-amber-600 ring-amber-100', text: 'Change your password or sign out of every device.' },
};

// Header of one settings page: breadcrumb back to the hub, icon and title.
export const SettingsPageHeader = ({ section }) => {
  const navigate = useNavigate();
  const meta = SETTINGS_SECTIONS[section];
  const Icon = meta.icon;
  return (
    <div className="mb-6">
      <Button variant="ghost" size="sm" className="-ml-2 mb-3 text-slate-500" onClick={() => navigate('/dashboard/settings')}>
        <FiArrowLeft /> Settings
      </Button>
      <div className="flex items-center gap-3.5">
        <span className={cn('flex size-11 items-center justify-center rounded-xl ring-4', meta.tone)}><Icon size={20} /></span>
        <div>
          <h1 className="text-lg font-extrabold tracking-tight">{meta.title}</h1>
          <p className="text-[13px] text-muted-foreground">{meta.text}</p>
        </div>
      </div>
    </div>
  );
};
