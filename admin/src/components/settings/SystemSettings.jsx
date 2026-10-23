import React, { useEffect, useState } from 'react';
import { FiServer, FiMail, FiShield, FiCpu, FiClock, FiHash } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { SettingsPageHeader } from './SettingsPageHeader';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const uptime = (seconds) => {
  if (!seconds) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, `${m}m`].filter(Boolean).join(' ');
};

const SystemSettings = () => {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    axiosClient.get('/admin/settings').then((r) => setInfo(r.data?.system || {})).catch(() => setInfo({}));
  }, []);

  const tiles = [
    { label: 'Environment', icon: FiServer, tone: 'bg-blue-50 text-blue-600', value: <Badge variant={info?.environment === 'production' ? 'success' : 'warning'}>{String(info?.environment || 'development').toUpperCase()}</Badge> },
    { label: 'Email delivery', icon: FiMail, tone: 'bg-sky-50 text-sky-600', value: <Badge variant="info">{info?.emailDelivery || '—'}</Badge> },
    { label: 'Two-step enforcement', icon: FiShield, tone: 'bg-emerald-50 text-emerald-600', value: <Badge variant={info?.mfaEnforced ? 'success' : 'danger'}>{info?.mfaEnforced ? 'Required for admins' : 'Off'}</Badge> },
    { label: 'Node runtime', icon: FiCpu, tone: 'bg-violet-50 text-violet-600', value: info?.nodeVersion || '—' },
    { label: 'API port', icon: FiHash, tone: 'bg-slate-100 text-slate-600', value: info?.port || '—' },
    { label: 'Server uptime', icon: FiClock, tone: 'bg-amber-50 text-amber-600', value: uptime(info?.uptimeSeconds) },
  ];

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="system" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map(({ label, icon: Icon, tone, value }) => (
          <Card key={label} className="gap-3 py-5">
            <CardContent className="flex items-center gap-3.5">
              <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-xl', tone)}><Icon size={18} /></span>
              <div className="min-w-0">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="mt-0.5 text-sm font-semibold">{info ? value : <Skeleton className="h-4 w-24" />}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default SystemSettings;
