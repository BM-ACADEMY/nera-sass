import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { FiMonitor, FiSmartphone, FiTablet, FiHelpCircle, FiMapPin, FiRefreshCw, FiLogOut, FiShield, FiEdit2 } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { timeAgo, shortDateTime, locationLabel, deviceLabel, sessionTitle, deviceKind, sessionsError, collectClientHints } from '../../services/sessionFormat.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import ConfirmSignOutDialog from './ConfirmSignOutDialog.jsx';
import RenameDeviceDialog from './RenameDeviceDialog.jsx';

const ICONS = { desktop: FiMonitor, mobile: FiSmartphone, tablet: FiTablet, unknown: FiHelpCircle };

function SessionRow({ session, onSignOut, onRename }) {
  const Icon = ICONS[deviceKind(session)];
  return (
    <div className="flex flex-col gap-3 border-b border-border p-4 last:border-b-0 sm:flex-row sm:items-center">
      <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl ${session.current ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-600'}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-foreground">{sessionTitle(session)}</span>
          {session.current && <Badge variant="info">This device</Badge>}
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => onRename(session)} aria-label="Rename this device">
            <FiEdit2 size={12} /> Rename
          </button>
        </div>
        {session.name && <div className="mt-0.5 text-[13px] text-muted-foreground">{deviceLabel(session)}</div>}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
          <span className="inline-flex items-center gap-1"><FiMapPin size={12} /> {locationLabel(session.location)}</span>
          {session.ip && <span>IP {session.ip}</span>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {session.current ? 'Active now' : `Last active ${timeAgo(session.last_seen_at)}`} · Signed in {shortDateTime(session.created_at)}
        </div>
      </div>
      {!session.current && (
        <Button variant="outline" size="sm" className="w-fit border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => onSignOut(session)}>
          <FiLogOut /> Sign out
        </Button>
      )}
    </div>
  );
}

/**
 * My sessions: every browser and device where this account is signed in,
 * with a sign-out for one session or for all other devices.
 */
const SessionsPage = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  // { title, description, actionLabel, run(body) } while the password dialog is open
  const [confirm, setConfirm] = useState(null);
  const [renaming, setRenaming] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      setData(await api.get('/account/sessions'));
      setError(null);
    } catch (err) {
      setError(sessionsError(err, 'Could not load your sessions. Try again in a moment.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    // Once per visit: tell the server this browser's model / platform (Chromium
    // client hints) so this device gets a real name, then load the list.
    (async () => {
      const hints = await collectClientHints();
      if (hints) await api.put('/account/sessions/current/hints', { client_hints: hints }).catch(() => {});
      load();
    })();
  }, []);

  const sessions = data?.sessions || [];
  const others = sessions.filter((s) => !s.current);

  // Both sign-outs need the password (and two-step code); the server checks
  // them and errors stay in the dialog.
  const signOutOne = (session) => setConfirm({
    title: 'Sign out this device?',
    description: `${sessionTitle(session)} (${locationLabel(session.location)}) will be signed out right away and must sign in again.`,
    actionLabel: 'Sign out',
    run: async (body) => {
      await api.delete(`/account/sessions/${session.id}`, { body: JSON.stringify(body) });
      toast.success(`Signed out ${sessionTitle(session)}`);
      load();
    },
  });
  const signOutOthers = () => setConfirm({
    title: 'Sign out all other devices?',
    description: 'Every other browser and device will be signed out right away. You stay signed in here.',
    actionLabel: 'Sign out others',
    run: async (body) => {
      const res = await api.post('/account/sessions/revoke-others', body);
      // This device keeps working with the new token (same end time as before).
      if (res?.token) api.setToken(res.token);
      toast.success(res?.revoked ? `Signed out ${res.revoked} other device${res.revoked === 1 ? '' : 's'}` : 'All other devices are signed out');
      load();
    },
  });
  const renameDevice = async (name) => {
    await api.patch(`/account/sessions/${renaming.id}`, { name });
    toast.success(name ? 'Device renamed' : 'Name removed');
    load();
  };

  const confirmError = (err, fallback) => ([403, 423].includes(err?.status) || err?.code === 'OTP_RESEND_WAIT' ? err.message : sessionsError(err, fallback));

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-6">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-bold text-foreground"><FiShield className="text-blue-600" /> Where you're signed in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Browsers and devices signed in to your account. If you don't recognise one, sign it out and change your password.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}><FiRefreshCw className={loading ? 'animate-spin' : ''} /> Refresh</Button>
          <Button variant="destructive" size="sm" disabled={!data} onClick={signOutOthers}>
            <FiLogOut /> Sign out all other devices
          </Button>
        </div>
      </div>

      {error && (
        <Card className="mb-4 border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error} <button type="button" className="ml-2 font-semibold underline" onClick={load}>Try again</button>
        </Card>
      )}

      {data && !data.current_session_tracked && (
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          This browser signed in before device tracking started, so it is not listed yet. Sign out and in again (or use "Sign out all other devices") and it will appear as "This device".
        </Card>
      )}

      <Card className="gap-0 overflow-hidden p-0">
        {!data && !error && [0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 border-b border-border p-4 last:border-b-0">
            <Skeleton className="size-11 rounded-xl" />
            <div className="flex-1 space-y-2"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-72" /></div>
          </div>
        ))}
        {data && sessions.map((s) => <SessionRow key={s.id} session={s} onSignOut={signOutOne} onRename={setRenaming} />)}
        {data && !sessions.length && <div className="p-6 text-center text-sm text-muted-foreground">No other signed-in devices.</div>}
      </Card>
      {data && sessions.length > 0 && !others.length && (
        <p className="mt-3 text-center text-xs text-muted-foreground">You are signed in on this device only.</p>
      )}

      <RenameDeviceDialog
        session={renaming}
        label={renaming ? deviceLabel(renaming) : ''}
        onClose={() => setRenaming(null)}
        save={renameDevice}
        messageOf={(err, fallback) => (err?.status === 400 ? err.message : sessionsError(err, fallback))}
      />
      <ConfirmSignOutDialog
        open={confirm}
        onClose={() => setConfirm(null)}
        mfaMethods={data?.mfa_methods || []}
        submit={(body) => confirm.run(body)}
        sendCode={(password, channel) => api.post('/account/sessions/confirm-code', { password, channel })}
        messageOf={confirmError}
      />
    </div>
  );
};

export default SessionsPage;
