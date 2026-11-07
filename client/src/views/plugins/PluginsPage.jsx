import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiSettings } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function PluginCard({ logo, name, description, badge, note, children }) {
  return (
    <Card className="gap-4 px-5 py-5">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl"><img src={logo} alt="" className="size-10 object-contain" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-bold">{name}</h3>
            {badge}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {note && <p className="mt-2 text-sm text-amber-700">{note}</p>}
        </div>
      </div>
      <div className="mt-auto flex flex-wrap gap-2">{children}</div>
    </Card>
  );
}

/**
 * Customer panel: plugins this workspace can switch on for itself. Each
 * workspace connects its own accounts; nothing is shared between workspaces.
 */
const PluginsPage = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      setStatus(await api.get('/calendar/status'));
      setError(null);
    } catch (err) {
      setError(err?.message || 'Could not load plugins');
    }
  };
  useEffect(() => { load(); }, []);

  const connect = async () => {
    setBusy('connect');
    try {
      const { url } = await api.post('/calendar/google/connect', {});
      window.location.href = url;
    } catch (err) {
      toast.error(err?.message || 'Could not start the Google sign-in');
      setBusy('');
    }
  };

  const setting = async (key, value, done) => {
    setBusy(key);
    try {
      const { settings } = await api.put('/calendar/settings', { [key]: value });
      setStatus((s) => ({ ...s, settings }));
      toast.success(done);
    } catch (err) {
      toast.error(err?.message || 'Could not save');
    } finally {
      setBusy('');
    }
  };

  if (error && !status) {
    return (
      <div className="p-4 md:p-8">
        <Card className="items-center gap-3 px-6 py-14 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Could not load plugins</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }
  if (!status) {
    return (
      <div className="grid gap-4 p-4 md:grid-cols-2 md:p-8">
        <Skeleton className="h-44" />
        <Skeleton className="h-44" />
      </div>
    );
  }

  const canManage = Boolean(status.can_manage);
  const settings = status.settings || {};
  const calendarOn = status.connected && settings.booking_enabled;
  const meetOn = settings.meet_enabled !== false;

  const calendarBadge = status.connected
    ? (settings.booking_enabled ? <Badge variant="success"><FiCheckCircle /> On</Badge> : <Badge variant="muted">Connected, paused</Badge>)
    : status.needs_reconnect ? <Badge variant="danger"><FiAlertTriangle /> Needs reconnect</Badge> : <Badge variant="muted">Off</Badge>;

  const meetBadge = !status.connected
    ? <Badge variant="muted">Needs Google Calendar</Badge>
    : meetOn ? <Badge variant="success"><FiCheckCircle /> On</Badge> : <Badge variant="muted">Off</Badge>;

  return (
    <div className="space-y-5 p-4 md:p-8">
      <div>
        <h2 className="text-lg font-bold">Plugins</h2>
        <p className="text-sm text-muted-foreground">Switch on what your WhatsApp AI can do. Each plugin uses your own account.</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <PluginCard
          logo="/plugins/google-calendar.png"
          name="Google Calendar"
          badge={calendarBadge}
          description={status.connected
            ? `Customers can book appointments from WhatsApp chat. Bookings go to ${status.email || 'your Google Calendar'}.`
            : 'Let customers book appointments from WhatsApp chat. The AI checks your free time and adds the booking to your Google Calendar.'}
          note={!status.configured ? "Google sign-in isn't set up on the server yet. Please contact support." : status.needs_reconnect ? (status.error || 'Google access expired. Please connect again.') : null}
        >
          {canManage && status.configured && (!status.connected || status.needs_reconnect) && (
            <Button onClick={connect} disabled={busy === 'connect'}>{busy === 'connect' ? 'Opening Google…' : status.needs_reconnect ? 'Reconnect' : 'Connect Google'}</Button>
          )}
          {canManage && status.connected && (
            <Button variant="outline" disabled={busy === 'booking_enabled'} onClick={() => setting('booking_enabled', !settings.booking_enabled, settings.booking_enabled ? 'Bookings paused' : 'Bookings switched on')}>
              {settings.booking_enabled ? 'Pause bookings' : 'Turn on bookings'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => navigate('/calendar')}><FiSettings /> Settings &amp; meetings</Button>
        </PluginCard>

        <PluginCard
          logo="/plugins/google-meet.png"
          name="Google Meet"
          badge={meetBadge}
          description={meetOn
            ? 'Every booking gets a Google Meet video link, sent to the customer on WhatsApp and in their calendar invite.'
            : 'Turn on to add a Google Meet video link to every booking. While off, bookings are in-person or phone appointments.'}
          note={status.connected && !calendarOn && meetOn ? 'Google Calendar bookings are paused, so no meetings are being booked.' : null}
        >
          {!status.connected
            ? <span className="text-sm text-muted-foreground">Connect Google Calendar first.</span>
            : canManage && (
              <Button variant={meetOn ? 'outline' : 'default'} disabled={busy === 'meet_enabled'} onClick={() => setting('meet_enabled', !meetOn, meetOn ? 'Google Meet switched off' : 'Google Meet switched on')}>
                {meetOn ? 'Turn off' : 'Turn on'}
              </Button>
            )}
        </PluginCard>
      </div>

      {!canManage && <p className="text-sm text-muted-foreground">Only the workspace owner or an admin can change plugins.</p>}
    </div>
  );
};

export default PluginsPage;
