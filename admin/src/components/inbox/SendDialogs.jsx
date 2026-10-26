import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FiCrosshair, FiEdit2, FiPlus, FiTrash2 } from 'react-icons/fi';
import axiosClient from '../../api/axiosClient';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

const apiError = (err, fallback) => err.response?.data?.error || fallback;

const Field = ({ label, children, hint }) => (
  <div className="flex flex-col gap-1.5">
    <Label className="text-xs">{label}</Label>
    {children}
    {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
  </div>
);

// Shared shell: title, body, Cancel / Send, and the busy state.
const SendShell = ({ open, onOpenChange, title, description, canSend, onSend, sendLabel = 'Send', children }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="flex flex-col gap-3">{children}</div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button
            disabled={!canSend || busy}
            onClick={async () => {
              setBusy(true);
              try { await onSend(); onOpenChange(false); } catch { /* the page shows why */ } finally { setBusy(false); }
            }}
          >
            {busy && <Spinner />} {sendLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// "11.94, 79.80", or a Google Maps link with @lat,lng / q=lat,lng in it.
export function parseCoordinates(value) {
  const text = decodeURIComponent(String(value || ''));
  const match = text.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)
    || text.match(/[?&](?:q|query|ll)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/)
    || text.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  return match ? { latitude: match[1], longitude: match[2] } : null;
}

export const LocationDialog = ({ open, onOpenChange, onSend }) => {
  const [form, setForm] = useState({ link: '', latitude: '', longitude: '', name: '', address: '' });
  const [locating, setLocating] = useState(false);
  useEffect(() => { if (open) setForm({ link: '', latitude: '', longitude: '', name: '', address: '' }); }, [open]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.latitude !== '' && form.longitude !== '' && Number.isFinite(Number(form.latitude)) && Number.isFinite(Number(form.longitude));

  const useMine = () => {
    if (!navigator.geolocation) { toast.error('This browser cannot share its location'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { set({ latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) }); setLocating(false); },
      () => { toast.error('Allow location access in the browser'); setLocating(false); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  return (
    <SendShell open={open} onOpenChange={onOpenChange} title="Send location" description="The customer sees a map pin they can open." canSend={valid}
      onSend={() => onSend({ latitude: form.latitude, longitude: form.longitude, name: form.name, address: form.address })}>
      <Field label="Google Maps link or coordinates" hint="Paste a maps link, or type 11.9416, 79.8083">
        <Input value={form.link} onChange={(e) => { const c = parseCoordinates(e.target.value); set({ link: e.target.value, ...(c || {}) }); }} placeholder="https://maps.google.com/…" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Latitude"><Input value={form.latitude} onChange={(e) => set({ latitude: e.target.value })} inputMode="decimal" /></Field>
        <Field label="Longitude"><Input value={form.longitude} onChange={(e) => set({ longitude: e.target.value })} inputMode="decimal" /></Field>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={useMine} disabled={locating} className="self-start">
        {locating ? <Spinner /> : <FiCrosshair />} Use my current location
      </Button>
      <Field label="Place name · optional"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} placeholder="Getnera office" /></Field>
      <Field label="Address · optional"><Input value={form.address} onChange={(e) => set({ address: e.target.value })} maxLength={300} /></Field>
    </SendShell>
  );
};

export const ContactDialog = ({ open, onOpenChange, onSend }) => {
  const [form, setForm] = useState({ name: '', phone: '', email: '' });
  useEffect(() => { if (open) setForm({ name: '', phone: '', email: '' }); }, [open]);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const valid = form.name.trim() && form.phone.replace(/\D/g, '').length >= 8;
  return (
    <SendShell open={open} onOpenChange={onOpenChange} title="Send contact" description="Shares a contact card the customer can save or message." canSend={valid} onSend={() => onSend(form)}>
      <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} maxLength={100} placeholder="Priya (Sales)" /></Field>
      <Field label="Phone with country code"><Input value={form.phone} onChange={(e) => set({ phone: e.target.value })} inputMode="tel" placeholder="+91 98765 43210" /></Field>
      <Field label="Email · optional"><Input value={form.email} onChange={(e) => set({ email: e.target.value })} type="email" maxLength={120} /></Field>
    </SendShell>
  );
};

/** Reply buttons (up to 3) or a list (up to 10 options). */
export const InteractiveDialog = ({ open, onOpenChange, onSend }) => {
  const empty = { kind: 'buttons', header: '', body: '', footer: '', buttons: ['', ''], button_text: 'Options', rows: [{ title: '', description: '' }, { title: '', description: '' }] };
  const [form, setForm] = useState(empty);
  useEffect(() => { if (open) setForm(empty); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const isList = form.kind === 'list';
  const filled = isList ? form.rows.filter((r) => r.title.trim()) : form.buttons.filter((b) => b.trim());
  const valid = form.body.trim() && filled.length > 0 && (!isList || form.button_text.trim());

  return (
    <SendShell open={open} onOpenChange={onOpenChange} title="Buttons or list" description="The customer replies with one tap. Their choice comes back as a message." canSend={valid}
      onSend={() => onSend({
        kind: form.kind, header: form.header, body: form.body, footer: form.footer,
        ...(isList ? { button_text: form.button_text, rows: form.rows.filter((r) => r.title.trim()) } : { buttons: form.buttons.filter((b) => b.trim()) }),
      })}>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
        {[['buttons', 'Buttons (up to 3)'], ['list', 'List (up to 10)']].map(([k, label]) => (
          <button key={k} type="button" onClick={() => set({ kind: k })} className={cn('cursor-pointer rounded-md py-1.5 text-xs font-semibold', form.kind === k ? 'bg-card shadow-sm' : 'text-muted-foreground')}>{label}</button>
        ))}
      </div>
      <Field label="Heading · optional"><Input value={form.header} onChange={(e) => set({ header: e.target.value })} maxLength={60} /></Field>
      <Field label="Message"><Textarea value={form.body} onChange={(e) => set({ body: e.target.value })} maxLength={1024} rows={3} placeholder="Would you like a free demo?" /></Field>
      <Field label="Footer · optional"><Input value={form.footer} onChange={(e) => set({ footer: e.target.value })} maxLength={60} /></Field>

      {isList ? (
        <>
          <Field label="List button text"><Input value={form.button_text} onChange={(e) => set({ button_text: e.target.value })} maxLength={20} /></Field>
          <Label className="text-xs">Options</Label>
          {form.rows.map((r, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex flex-1 flex-col gap-1">
                <Input value={r.title} onChange={(e) => set({ rows: form.rows.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} maxLength={24} placeholder={`Option ${i + 1}`} />
                <Input value={r.description} onChange={(e) => set({ rows: form.rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} maxLength={72} placeholder="Description · optional" className="h-8 text-xs" />
              </div>
              <Button variant="ghost" size="icon" onClick={() => set({ rows: form.rows.filter((_, j) => j !== i) })} disabled={form.rows.length === 1} aria-label="Remove option"><FiTrash2 /></Button>
            </div>
          ))}
          {form.rows.length < 10 && <Button variant="outline" size="sm" className="self-start" onClick={() => set({ rows: [...form.rows, { title: '', description: '' }] })}><FiPlus /> Add option</Button>}
        </>
      ) : (
        <>
          <Label className="text-xs">Buttons</Label>
          {form.buttons.map((b, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input value={b} onChange={(e) => set({ buttons: form.buttons.map((x, j) => (j === i ? e.target.value : x)) })} maxLength={20} placeholder={['Yes', 'Later', 'Call me'][i]} />
              <Button variant="ghost" size="icon" onClick={() => set({ buttons: form.buttons.filter((_, j) => j !== i) })} disabled={form.buttons.length === 1} aria-label="Remove button"><FiTrash2 /></Button>
            </div>
          ))}
          {form.buttons.length < 3 && <Button variant="outline" size="sm" className="self-start" onClick={() => set({ buttons: [...form.buttons, ''] })}><FiPlus /> Add button</Button>}
        </>
      )}
    </SendShell>
  );
};

/** Add, edit and delete saved replies. `onChanged(list)` gets the new list. */
export const QuickRepliesDialog = ({ open, onOpenChange, quickReplies, onChanged }) => {
  const [editing, setEditing] = useState(null); // null | { id?, shortcut, text }
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setEditing(null); }, [open]);

  const reload = async () => onChanged((await axiosClient.get('/admin/inbox/quick-replies')).data.quick_replies || []);
  const save = async () => {
    setBusy(true);
    try {
      if (editing.id) await axiosClient.patch(`/admin/inbox/quick-replies/${editing.id}`, editing);
      else await axiosClient.post('/admin/inbox/quick-replies', editing);
      await reload();
      setEditing(null);
      toast.success('Saved');
    } catch (err) {
      toast.error(apiError(err, 'Could not save'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (q) => {
    if (!window.confirm(`Delete /${q.shortcut}?`)) return;
    try {
      await axiosClient.delete(`/admin/inbox/quick-replies/${q.id}`);
      await reload();
    } catch (err) {
      toast.error(apiError(err, 'Could not delete'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quick replies</DialogTitle>
          <DialogDescription>Type / in the message box, then the shortcut, to insert a saved reply.</DialogDescription>
        </DialogHeader>
        {editing ? (
          <div className="flex flex-col gap-3">
            <Field label="Shortcut" hint="Letters, numbers, - or _. Used as /shortcut.">
              <Input value={editing.shortcut} onChange={(e) => setEditing({ ...editing, shortcut: e.target.value.replace(/\s/g, '').toLowerCase() })} maxLength={30} placeholder="price" />
            </Field>
            <Field label="Reply"><Textarea value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} rows={5} maxLength={4096} /></Field>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(null)} disabled={busy}>Back</Button>
              <Button onClick={save} disabled={busy || !editing.shortcut || !editing.text.trim()}>{busy && <Spinner />} Save</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {quickReplies.length === 0 && <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No quick replies yet.</div>}
            {quickReplies.map((q) => (
              <div key={q.id} className="flex items-start gap-2 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-green-700">/{q.shortcut}</div>
                  <div className="line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground">{q.text}</div>
                </div>
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ ...q })} aria-label="Edit"><FiEdit2 /></Button>
                <Button variant="ghost" size="icon" className="size-8 text-red-600" onClick={() => remove(q)} aria-label="Delete"><FiTrash2 /></Button>
              </div>
            ))}
            <Button className="self-start" size="sm" onClick={() => setEditing({ shortcut: '', text: '' })}><FiPlus /> New quick reply</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
