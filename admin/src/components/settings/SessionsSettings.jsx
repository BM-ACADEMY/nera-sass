import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiMonitor, FiSmartphone, FiTablet, FiHelpCircle, FiMapPin, FiRefreshCw, FiLogOut, FiEdit2 } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { timeAgo, shortDateTime, locationLabel, deviceLabel, sessionTitle, deviceKind, sessionsError, collectClientHints } from '../../api/sessionFormat';
import ConfirmSignOutDialog from './ConfirmSignOutDialog';
import RenameDeviceDialog from './RenameDeviceDialog';
import { SettingsPageHeader } from './SettingsPageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const ICONS = { desktop: FiMonitor, mobile: FiSmartphone, tablet: FiTablet, unknown: FiHelpCircle };
const errorOf = (err, fallback) => err.response?.data?.code === 'API_UNREACHABLE'
  ? err.response.data.error
  : sessionsError({ status: err.response?.status, code: err.response?.data?.code }, fallback);

// My sessions for platform staff: where this admin account is signed in.
const SessionsSettings = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // { title, description, actionLabel, run(body) } while the password dialog is open
  const [confirm, setConfirm] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setData((await axiosClient.get('/account/sessions')).data);
      setError(null);
    } catch (err) {
      setError(errorOf(err, 'Could not load your sessions. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    // Once per visit: tell the server this browser's model / platform (Chromium
    // client hints) so this device gets a real name, then load the list.
    (async () => {
      const hints = await collectClientHints();
      if (hints) await axiosClient.put('/account/sessions/current/hints', { client_hints: hints }).catch(() => {});
      load();
    })();
  }, []);

  const sessions = data?.sessions || [];

  // Both sign-outs need the password (and two-step code); the server checks
  // them and errors stay in the dialog.
  const signOutOne = (session) => setConfirm({
    title: 'Sign out this device?',
    description: `${sessionTitle(session)} (${locationLabel(session.location)}) will be signed out right away and must sign in again.`,
    actionLabel: 'Sign out',
    run: async (body) => {
      await axiosClient.delete(`/account/sessions/${session.id}`, { data: body });
      toast.success(`Signed out ${sessionTitle(session)}`);
      load();
    },
  });

  const signOutOthers = () => setConfirm({
    title: 'Sign out all other devices?',
    description: 'Every other browser and device will be signed out right away. You stay signed in here.',
    actionLabel: 'Sign out others',
    run: async (body) => {
      const res = await axiosClient.post('/account/sessions/revoke-others', body);
      // This device keeps working with the new token (same end time as before).
      if (res.data?.token) localStorage.setItem('adminToken', res.data.token);
      const n = res.data?.revoked || 0;
      toast.success(n ? `Signed out ${n} other device${n === 1 ? '' : 's'}` : 'All other devices are signed out');
      load();
    },
  });

  const renameDevice = async (name) => {
    await axiosClient.patch(`/account/sessions/${renaming.id}`, { name });
    toast.success(name ? 'Device renamed' : 'Name removed');
    load();
  };

  const confirmError = (err, fallback) => {
    const body = err.response?.data;
    return [403, 423].includes(err.response?.status) || body?.code === 'OTP_RESEND_WAIT' ? body?.error || fallback : errorOf(err, fallback);
  };

  return (
    <div className="max-w-6xl">
      <SettingsPageHeader section="sessions" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={load} disabled={loading}><FiRefreshCw className={cn(loading && 'animate-spin')} /> Refresh</Button>
        <Button variant="destructive" size="sm" disabled={!data} onClick={signOutOthers}><FiLogOut /> Sign out all other devices</Button>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error} <button type="button" className="ml-2 font-semibold underline" onClick={load}>Try again</button>
        </Card>
      )}
      {data && !data.current_session_tracked && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This browser signed in before device tracking started, so it is not listed yet. Sign in again (or use "Sign out all other devices") and it will appear as "This device".
        </Card>
      )}

      <Card className="gap-0 overflow-hidden p-0">
        {!data && !error && [0, 1].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border p-4 last:border-b-0">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72" /></div>
          </div>
        ))}
        {sessions.map((s) => {
          const Icon = ICONS[deviceKind(s)];
          return (
            <div key={s.id} className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center">
              <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-xl', s.current ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600')}>
                <Icon size={20} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-slate-900">{sessionTitle(s)}</span>
                  {s.current && <Badge variant="info">This device</Badge>}
                  <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-slate-900" onClick={() => setRenaming(s)} aria-label="Rename this device">
                    <FiEdit2 size={12} /> Rename
                  </button>
                </div>
                {s.name && <div className="mt-0.5 text-[13px] text-muted-foreground">{deviceLabel(s)}</div>}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><FiMapPin size={12} /> {locationLabel(s.location)}</span>
                  {s.ip && <span>IP {s.ip}</span>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {s.current ? 'Active now' : `Last active ${timeAgo(s.last_seen_at)}`} · Signed in {shortDateTime(s.created_at)}
                </div>
              </div>
              {!s.current && (
                <Button variant="outline" size="sm" className="w-fit border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => signOutOne(s)}>
                  <FiLogOut /> Sign out
                </Button>
              )}
            </div>
          );
        })}
        {data && !sessions.length && <div className="p-6 text-center text-sm text-muted-foreground">No other signed-in devices.</div>}
      </Card>

      <RenameDeviceDialog
        session={renaming}
        label={renaming ? deviceLabel(renaming) : ''}
        onClose={() => setRenaming(null)}
        save={renameDevice}
        messageOf={(err, fallback) => (err.response?.status === 400 ? err.response.data?.error || fallback : errorOf(err, fallback))}
      />
      <ConfirmSignOutDialog
        open={confirm}
        onClose={() => setConfirm(null)}
        mfaMethods={data?.mfa_methods || []}
        submit={(body) => confirm.run(body)}
        sendCode={async (password, channel) => (await axiosClient.post('/account/sessions/confirm-code', { password, channel })).data}
        messageOf={confirmError}
      />
    </div>
  );
};

export default SessionsSettings;
