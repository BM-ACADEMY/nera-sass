import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FiCheckCircle, FiAlertTriangle, FiRefreshCw, FiVideo, FiExternalLink, FiX, FiClock } from 'react-icons/fi';
import { api } from '../../services/api.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle,
  AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LENGTHS = [15, 30, 45, 60, 90, 120];
const selectClass = 'h-9 w-full rounded-md border border-border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50';
const when = (v, timeZone) => (v ? new Date(v).toLocaleString('en-IN', { timeZone, dateStyle: 'medium', timeStyle: 'short' }) : '—');

function StatusBadge({ status }) {
  if (status.connected) return <Badge variant="success"><FiCheckCircle /> Connected</Badge>;
  if (status.needs_reconnect) return <Badge variant="danger"><FiAlertTriangle /> Needs reconnect</Badge>;
  return <Badge variant="muted">Not connected</Badge>;
}

/**
 * Customer panel: the workspace's own Google Calendar. Once connected, the
 * WhatsApp AI books Google Meet meetings on it inside these working hours.
 */
const CalendarPage = () => {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState(null);
  const [meetings, setMeetings] = useState({ upcoming: [], requested: [] });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState('');
  const [confirm, setConfirm] = useState(null); // { kind: 'disconnect' } | { kind: 'cancel', lead }

  const load = async () => {
    try {
      const [s, m] = await Promise.all([api.get('/calendar/status'), api.get('/calendar/meetings').catch(() => null)]);
      setStatus(s);
      setForm(s.settings);
      if (m) setMeetings(m);
      setError(null);
    } catch (err) {
      setError(err?.message || 'Could not load your calendar');
    }
  };
  useEffect(() => { load(); }, []);

  // Google sends people back here with ?calendar=connected|error.
  useEffect(() => {
    const result = params.get('calendar');
    if (!result) return;
    if (result === 'connected') toast.success(`Google Calendar connected${params.get('email') ? ` (${params.get('email')})` : ''}`);
    else toast.error(params.get('message') || 'Could not connect Google Calendar');
    setParams({}, { replace: true });
  }, [params, setParams]);

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

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await api.delete('/calendar/google');
      toast.success('Google Calendar disconnected');
      await load();
    } catch (err) {
      toast.error(err?.message || 'Could not disconnect');
    } finally {
      setBusy('');
    }
  };

  const save = async () => {
    setBusy('save');
    try {
      const { settings } = await api.put('/calendar/settings', form);
      setForm(settings);
      setStatus((s) => ({ ...s, settings }));
      toast.success('Booking settings saved');
    } catch (err) {
      toast.error(err?.message || 'Could not save settings');
    } finally {
      setBusy('');
    }
  };

  const cancelMeeting = async (lead) => {
    setBusy(`cancel-${lead.id}`);
    try {
      const result = await api.post(`/calendar/meetings/${lead.id}/cancel`, {});
      toast.success(result.cancelled ? 'Meeting cancelled' : 'No calendar event was found; marked as cancelled');
      await load();
    } catch (err) {
      toast.error(err?.message || 'Could not cancel the meeting');
    } finally {
      setBusy('');
    }
  };

  if (error && !status) {
    return (
      <div className="p-4 md:p-8">
        <Card className="items-center gap-3 px-6 py-14 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Could not load your calendar</div>
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={load}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }

  if (!status || !form) {
    return (
      <div className="space-y-4 p-4 md:p-8">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const tz = status.settings?.time_zone;
  const canManage = Boolean(status.can_manage);
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggleDay = (d) => set('work_days', form.work_days.includes(d) ? form.work_days.filter((x) => x !== d) : [...form.work_days, d].sort());
  const dirty = JSON.stringify(form) !== JSON.stringify(status.settings);

  return (
    <div className="space-y-5 p-4 md:p-8">
      {/* Connection */}
      <Card className="gap-4 px-5 py-5 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg"><img src="/plugins/google-calendar.png" alt="" className="size-9 object-contain" /></span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold">Google Calendar</h2>
                <StatusBadge status={status} />
              </div>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">
                {status.connected
                  ? <>Meetings are booked on <b className="text-foreground">{status.email || 'your Google account'}</b>. When a customer asks for a meeting on WhatsApp, the AI books a Google Meet here and sends them the link.</>
                  : 'Connect your Google account so the WhatsApp AI can book Google Meet meetings on your calendar. Until then, requested times are saved for your team to confirm.'}
              </p>
              {status.needs_reconnect && <p className="mt-2 text-sm text-red-600">{status.error || 'Google access expired. Please connect again.'}</p>}
              {!status.configured && <p className="mt-2 text-sm text-amber-700">Google sign-in isn't set up on the server yet. Please contact support.</p>}
            </div>
          </div>
          {canManage && status.configured && (
            <div className="flex gap-2">
              {(!status.connected || status.needs_reconnect) && (
                <Button onClick={connect} disabled={busy === 'connect'}>{busy === 'connect' ? 'Opening Google…' : status.needs_reconnect ? 'Reconnect Google' : 'Connect Google'}</Button>
              )}
              {(status.connected || status.needs_reconnect) && !status.legacy && (
                <Button variant="outline" onClick={() => setConfirm({ kind: 'disconnect' })} disabled={busy === 'disconnect'}>Disconnect</Button>
              )}
            </div>
          )}
        </div>
      </Card>

      {/* Booking rules */}
      <Card className="gap-5 px-5 py-5 md:px-6">
        <div>
          <h2 className="text-base font-bold">Booking rules</h2>
          <p className="text-sm text-muted-foreground">The AI only offers and accepts times inside these hours, and only when your calendar is free.</p>
        </div>

        <label className={cn('flex w-fit items-center gap-3 text-sm font-medium', canManage && 'cursor-pointer')}>
          <input type="checkbox" className="size-4 accent-primary" checked={Boolean(form.booking_enabled)} disabled={!canManage} onChange={(e) => set('booking_enabled', e.target.checked)} />
          Let the WhatsApp AI book meetings
        </label>

        <label className={cn('flex w-fit items-center gap-3 text-sm font-medium', canManage && 'cursor-pointer')}>
          <input type="checkbox" className="size-4 accent-primary" checked={form.meet_enabled !== false} disabled={!canManage} onChange={(e) => set('meet_enabled', e.target.checked)} />
          Add a Google Meet video link to each booking
        </label>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label>Meeting length</Label>
            <select className={selectClass} value={form.meeting_minutes} disabled={!canManage} onChange={(e) => set('meeting_minutes', Number(e.target.value))}>
              {LENGTHS.map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>Start time</Label>
            <Input type="time" value={form.work_start} disabled={!canManage} onChange={(e) => set('work_start', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>End time</Label>
            <Input type="time" value={form.work_end} disabled={!canManage} onChange={(e) => set('work_end', e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Time zone</Label>
            <Input value={form.time_zone} disabled={!canManage} onChange={(e) => set('time_zone', e.target.value)} placeholder="Asia/Kolkata" />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Working days</Label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((name, d) => (
              <button
                key={name}
                type="button"
                disabled={!canManage}
                onClick={() => toggleDay(d)}
                className={cn('h-8 rounded-md border px-3 text-sm font-medium transition-colors',
                  form.work_days.includes(d) ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-accent',
                  !canManage && 'cursor-not-allowed opacity-70')}
              >
                {name}
              </button>
            ))}
          </div>
        </div>

        {canManage && (
          <div className="flex gap-2">
            <Button onClick={save} disabled={!dirty || busy === 'save'}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
            {dirty && <Button variant="ghost" onClick={() => setForm(status.settings)}>Discard</Button>}
          </div>
        )}
      </Card>

      {/* Meetings */}
      <Card className="gap-3 px-5 py-5 md:px-6">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Upcoming meetings</h2>
          <Button variant="ghost" size="sm" onClick={load}><FiRefreshCw /> Refresh</Button>
        </div>
        {meetings.upcoming.length === 0
          ? <p className="py-6 text-center text-sm text-muted-foreground">No meetings booked yet.</p>
          : (
            <Table>
              <TableHeader>
                <TableRow><TableHead>Customer</TableHead><TableHead>When</TableHead><TableHead>Meet</TableHead><TableHead className="text-right" /></TableRow>
              </TableHeader>
              <TableBody>
                {meetings.upcoming.map((lead) => (
                  <TableRow key={lead.id}>
                    <TableCell>
                      <div className="font-medium">{lead.name || lead.phone}</div>
                      <div className="text-xs text-muted-foreground">{[lead.phone, lead.email].filter(Boolean).join(' · ')}</div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{when(lead.call_booked_at, tz)}</TableCell>
                    <TableCell>
                      <div className="flex gap-3">
                        {lead.google_meet_link && <a href={lead.google_meet_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-blue-700 hover:underline"><FiVideo /> Join</a>}
                        {lead.calendar_event_url && <a href={lead.calendar_event_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"><FiExternalLink /> Event</a>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-red-600" disabled={busy === `cancel-${lead.id}`} onClick={() => setConfirm({ kind: 'cancel', lead })}><FiX /> Cancel</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
      </Card>

      {meetings.requested.length > 0 && (
        <Card className="gap-3 px-5 py-5 md:px-6">
          <div>
            <h2 className="text-base font-bold">Waiting for your team</h2>
            <p className="text-sm text-muted-foreground">Customers asked for these times while booking was off. Call them to confirm.</p>
          </div>
          <Table>
            <TableHeader><TableRow><TableHead>Customer</TableHead><TableHead>Asked for</TableHead></TableRow></TableHeader>
            <TableBody>
              {meetings.requested.map((lead) => (
                <TableRow key={lead.id}>
                  <TableCell>
                    <div className="font-medium">{lead.name || lead.phone}</div>
                    <div className="text-xs text-muted-foreground">{lead.phone}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap"><FiClock className="mr-1 inline" />{when(lead.meeting_requested_for, tz)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.kind === 'disconnect' ? 'Disconnect Google Calendar?' : 'Cancel this meeting?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === 'disconnect'
                ? 'The AI will stop booking meetings. Customers who ask for one will get "our team will confirm" instead. Meetings already booked stay on your Google Calendar.'
                : `The Google Calendar event for ${confirm?.lead?.name || confirm?.lead?.phone || 'this customer'} will be deleted and invited guests will get a cancellation email. The customer is not messaged on WhatsApp.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => { const c = confirm; setConfirm(null); if (c.kind === 'disconnect') disconnect(); else cancelMeeting(c.lead); }}
            >
              {confirm?.kind === 'disconnect' ? 'Disconnect' : 'Cancel meeting'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CalendarPage;
