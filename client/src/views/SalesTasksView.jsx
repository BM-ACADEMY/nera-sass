import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { io as socketIO } from 'socket.io-client';
import {
  FiPlus, FiSearch, FiX, FiRefreshCw, FiDownload, FiMoreVertical, FiEdit2, FiTrash2, FiCheck, FiCircle,
  FiCheckCircle, FiRotateCcw, FiMessageSquare, FiExternalLink, FiAlertTriangle, FiClock, FiUser, FiChevronDown,
  FiChevronUp, FiCalendar, FiPlay, FiCheckSquare,
} from 'react-icons/fi';
import { api } from '../services/api.js';
import { labelsAsInboxTags } from './leads/labels/labelsApi.js';
import {
  DEFAULT_TIME_ZONE, typeOf, taskTitle, isDone, dueState, dueInputs, formatDue, formatDateTime, filterTasks, sortTasks, countDue, taskBody, bulkTaskConfirm,
} from '../utils/salesTasks.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Customer Sales Tasks: tasks the team adds by hand plus the automatic ones
// (hot lead, demo call, follow-up) created from each lead. Every request runs
// in the signed-in user's workspace; the server checks leads and assignees.

const PAGE_SIZE = 20;
const DEFAULT_FILTERS = { status: 'open', assignee: 'all', due: 'all', tag: '', search: '' };
const SALES_STATUSES = [
  ['new', 'New'], ['contacted', 'Contacted'], ['processing', 'In progress'], ['follow_up', 'Follow-up'],
  ['converted', 'Converted'], ['not_interested', 'Not interested'], ['closed', 'Closed'],
];

const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

function DueBadge({ task, now, timeZone }) {
  const state = dueState(task, now, timeZone);
  if (!task.due_at) return <span className="text-sm text-muted-foreground">No due date</span>;
  const text = formatDue(task.due_at, timeZone, now);
  if (state === 'overdue') return <Badge variant="danger"><FiAlertTriangle /> {text}</Badge>;
  if (state === 'today') return <Badge variant="warning"><FiClock /> {text}</Badge>;
  return <span className={cn('inline-flex items-center gap-1.5 text-sm', state === 'done' ? 'text-muted-foreground' : 'text-foreground')}><FiCalendar className="size-3.5 text-muted-foreground" />{text}</span>;
}

function Assignee({ task }) {
  if (!task.assigned_name) return <span className="text-sm text-muted-foreground">Unassigned</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[10px] font-bold text-blue-700 ring-1 ring-blue-100">{initials(task.assigned_name)}</span>
      <span className="truncate">{task.assigned_name}</span>
    </span>
  );
}

function LeadLink({ task, onOpen }) {
  if (!task.lead_id) return <span className="text-sm text-muted-foreground">No lead</span>;
  return (
    <button type="button" onClick={() => onOpen(task)} className="group inline-flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm font-medium text-blue-700 hover:underline" title="Open the chat with this lead">
      <span className="truncate">{task.name || 'Unnamed lead'}</span>
      <FiExternalLink className="size-3.5 shrink-0 opacity-60 group-hover:opacity-100" />
    </button>
  );
}

function CompleteToggle({ task, busy, onToggle }) {
  const done = isDone(task);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onToggle(task)}
      aria-label={done ? 'Reopen task' : 'Mark as done'}
      title={done ? 'Reopen task' : 'Mark as done'}
      className={cn('mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors disabled:opacity-50',
        done ? 'text-green-600 hover:text-green-700' : 'text-slate-300 hover:text-blue-600')}
    >
      {done ? <FiCheckCircle className="size-5" /> : <FiCircle className="size-5" />}
    </button>
  );
}

function RowMenu({ task, onEdit, onStatus, onOpenLead, onNote, onDelete }) {
  const done = isDone(task);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" aria-label="Task actions"><FiMoreVertical /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onEdit(task)}><FiEdit2 /> Edit</DropdownMenuItem>
        {done
          ? <DropdownMenuItem onSelect={() => onStatus(task, 'pending')}><FiRotateCcw /> Reopen</DropdownMenuItem>
          : <DropdownMenuItem onSelect={() => onStatus(task, 'completed')}><FiCheck /> Mark as done</DropdownMenuItem>}
        {task.status === 'pending' && <DropdownMenuItem onSelect={() => onStatus(task, 'processing')}><FiPlay /> Mark as in progress</DropdownMenuItem>}
        {task.lead_id && <DropdownMenuItem onSelect={() => onOpenLead(task)}><FiExternalLink /> Open chat</DropdownMenuItem>}
        {task.lead_id && <DropdownMenuItem onSelect={() => onNote(task)}><FiMessageSquare /> {task.latest_sales_note ? 'Edit sales note' : 'Add sales note'}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onDelete(task)}><FiTrash2 /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TaskDetails({ task, timeZone, onSalesStatus, onNote, onOpenLead }) {
  const rows = [
    ['Created', `${formatDateTime(task.created_at, timeZone)}${task.created_by_name ? ` by ${task.created_by_name}` : ''}`],
    task.completed_at && isDone(task) ? ['Completed', formatDateTime(task.completed_at, timeZone)] : null,
    task.lead_id ? ['Phone', task.phone || '—'] : null,
    task.lead_id ? ['Brand', task.brand_name || '—'] : null,
    task.lead_id ? ['Lead stage', task.lead_status || 'New'] : null,
    task.lead_id ? ['Source', task.source || '—'] : null,
    task.lead_id ? ['Lead score', task.score ?? 0] : null,
    task.lead_id ? ['Last message', formatDateTime(task.last_contact, timeZone)] : null,
    task.task_type === 'call' ? ['Meeting status', task.booking_status || 'Pending'] : null,
    task.lead_id ? ['Next AI follow-up', task.sales_followup_stopped ? 'Stopped' : formatDateTime(task.sales_followup_at || task.next_followup_due, timeZone)] : null,
  ].filter(Boolean);
  return (
    <div className="space-y-4 rounded-lg border border-border bg-slate-50/70 p-4">
      {task.description && <p className="text-sm whitespace-pre-wrap text-foreground">{task.description}</p>}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="truncate text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      {task.lead_id && (
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-end">
          <div className="space-y-1.5 sm:w-56">
            <Label htmlFor={`sales-status-${task.id}`} className="text-xs text-muted-foreground">Lead sales status</Label>
            <Select value={task.sales_status || 'new'} onValueChange={(value) => onSalesStatus(task, value)}>
              <SelectTrigger id={`sales-status-${task.id}`} className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SALES_STATUSES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="text-xs text-muted-foreground">Latest sales note</div>
            <div className="truncate text-sm">{task.latest_sales_note || <span className="text-muted-foreground">No note yet</span>}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => onNote(task)}><FiMessageSquare /> {task.latest_sales_note ? 'Edit note' : 'Add note'}</Button>
            <Button variant="outline" size="sm" onClick={() => onOpenLead(task)}><FiExternalLink /> Open chat</Button>
            {task.google_meet_link && <Button variant="outline" size="sm" asChild><a href={task.google_meet_link} target="_blank" rel="noreferrer">Join Google Meet</a></Button>}
            {task.calendar_event_url && <Button variant="outline" size="sm" asChild><a href={task.calendar_event_url} target="_blank" rel="noreferrer">Open in Google Calendar</a></Button>}
          </div>
        </div>
      )}
    </div>
  );
}

// Lead search for the task form: GET /api/leads?search=… (this workspace only).
function LeadPicker({ value, onChange, disabled }) {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) return undefined;
    let active = true;
    const timer = setTimeout(() => {
      setSearching(true);
      api.getLeads({ search: query, limit: 8 })
        .then((res) => { if (active) setResults(res.leads || []); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [term]);

  if (value) {
    return (
      <div className="flex h-9 items-center justify-between gap-2 rounded-md border border-border bg-slate-50 px-3 text-sm">
        <span className="min-w-0 truncate"><b className="font-medium">{value.name || 'Unnamed lead'}</b>{value.phone && <span className="text-muted-foreground"> · {value.phone}</span>}</span>
        {!disabled && <button type="button" onClick={() => onChange(null)} className="cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Remove lead"><FiX /></button>}
      </div>
    );
  }
  const showResults = term.trim().length >= 2;
  return (
    <div className="relative">
      <FiSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input id="task-lead" value={term} disabled={disabled} onChange={(e) => setTerm(e.target.value)} placeholder="Search a lead by name or phone" className="pl-9" autoComplete="off" />
      {showResults && (
        <div className="absolute inset-x-0 top-full z-10 mt-1 max-h-56 overflow-y-auto rounded-md border border-border bg-popover p-1 shadow-md">
          {searching && !results.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">Searching…</div>}
          {!searching && !results.length && <div className="px-2 py-1.5 text-sm text-muted-foreground">No lead found</div>}
          {results.map((lead) => (
            <button key={lead.id} type="button" onClick={() => { onChange({ id: lead.id, name: lead.name, phone: lead.phone }); setTerm(''); setResults([]); }}
              className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent">
              <span className="truncate font-medium">{lead.name || 'Unnamed lead'}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{lead.phone}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formFor(task, timeZone) {
  if (!task) return { title: '', description: '', lead: null, assigned_to: '', due_date: '', due_time: '' };
  const due = dueInputs(task.due_at, timeZone);
  return {
    title: task.title || '',
    description: task.description || '',
    lead: task.lead_id ? { id: task.lead_id, name: task.name, phone: task.phone } : null,
    assigned_to: task.assigned_to ? String(task.assigned_to) : '',
    due_date: due.date,
    due_time: due.time,
  };
}

function TaskDialog({ open, task, assignees, timeZone, onClose, onSaved }) {
  // Mounted fresh (keyed) for every open, so the form starts from the task.
  const [form, setForm] = useState(() => formFor(task, timeZone));
  const [initialDue] = useState(() => ({ date: form.due_date, time: form.due_time }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const automatic = Boolean(task && task.task_type !== 'manual');

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const save = async (e) => {
    e.preventDefault();
    if (!automatic && !form.title.trim()) { setError('Enter what needs to be done.'); return; }
    const body = taskBody(form);
    // Leave an automatic task's due time alone unless it was changed.
    if (task && form.due_date === initialDue.date && form.due_time === initialDue.time) {
      delete body.due_date; delete body.due_time;
    }
    if (automatic) delete body.lead_id;
    setSaving(true);
    setError('');
    try {
      const res = task ? await api.patch(`/sales-tasks/${task.id}`, body) : await api.post('/sales-tasks', body);
      toast.success(task ? 'Task updated' : 'Task added');
      onSaved(res.task);
    } catch (err) {
      setError(err?.message || 'Could not save the task. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // The current assignee stays selectable even if they have since left.
  const options = task?.assigned_to && !assignees.some((u) => u.id === task.assigned_to)
    ? [...assignees, { id: task.assigned_to, name: task.assigned_name || 'Former member' }]
    : assignees;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !saving) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={save} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{task ? 'Edit task' : 'New task'}</DialogTitle>
            <DialogDescription>{automatic ? `${typeOf(task).label} task for ${task.name || 'this lead'}.` : 'Add a to-do for yourself or a team member.'}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="task-title">Task{automatic && <span className="font-normal text-muted-foreground"> (optional)</span>}</Label>
            <Input id="task-title" value={form.title} maxLength={200} autoFocus onChange={(e) => set('title', e.target.value)} placeholder={automatic ? taskTitle({ task_type: task.task_type }) : 'For example: Send the price list'} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-description">Details <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea id="task-description" rows={3} maxLength={2000} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Anything the person doing this should know" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-lead">Lead <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <LeadPicker value={form.lead} disabled={automatic} onChange={(lead) => set('lead', lead)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-assignee">Assigned to</Label>
            <Select value={form.assigned_to ? String(form.assigned_to) : 'none'} onValueChange={(value) => set('assigned_to', value === 'none' ? '' : value)}>
              <SelectTrigger id="task-assignee" className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Unassigned</SelectItem>
                {options.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="task-due-date">Due date</Label>
              <div className="flex gap-2">
                <Input id="task-due-date" type="date" value={form.due_date} onChange={(e) => set('due_date', e.target.value)} />
                {form.due_date && <Button type="button" variant="ghost" size="icon" className="shrink-0 text-muted-foreground" aria-label="Clear due date" onClick={() => setForm((f) => ({ ...f, due_date: '', due_time: '' }))}><FiX /></Button>}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-due-time">Time</Label>
              <Input id="task-due-time" type="time" value={form.due_time} disabled={!form.due_date} onChange={(e) => set('due_time', e.target.value)} />
            </div>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">Times are in {timeZone.replace('_', ' ')}. A date without a time is due at the end of that day.</p>
          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Saving…' : task ? 'Save changes' : 'Add task'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ task, onClose, onSaved }) {
  const editingId = task?.latest_sales_note_id || null;
  const [text, setText] = useState(task?.latest_sales_note || '');
  const [busy, setBusy] = useState('');

  const save = async () => {
    if (!text.trim()) { toast.error('Enter a note'); return; }
    setBusy('save');
    try {
      if (editingId) {
        const res = await api.put(`/sales-tasks/notes/${editingId}`, { note: text.trim() });
        onSaved(task.lead_id, { latest_sales_note: res.note.note, latest_sales_note_at: res.note.created_at });
        toast.success('Note updated');
      } else {
        const res = await api.post(`/sales-tasks/lead/${task.lead_id}/notes`, { note: text.trim() });
        onSaved(task.lead_id, { ...res.lead, latest_sales_note: res.note.note, latest_sales_note_at: res.note.created_at, latest_sales_note_id: res.note.id });
        toast.success(res.lead?.sales_followup_stopped ? 'Note saved. Automatic follow-ups are stopped.' : res.lead?.sales_followup_at ? 'Note saved. The follow-up is moved to the new time.' : 'Note saved');
      }
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not save the note');
    } finally { setBusy(''); }
  };

  const remove = async () => {
    setBusy('delete');
    try {
      const res = await api.delete(`/sales-tasks/notes/${editingId}`);
      onSaved(task.lead_id, { latest_sales_note: res.latest_note?.note || null, latest_sales_note_at: res.latest_note?.created_at || null, latest_sales_note_id: res.latest_note?.id || null });
      toast.success('Note deleted');
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not delete the note');
    } finally { setBusy(''); }
  };

  return (
    <Dialog open={Boolean(task)} onOpenChange={(next) => { if (!next && !busy) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editingId ? 'Edit sales note' : 'Add sales note'}</DialogTitle>
          <DialogDescription>{task?.name || 'Lead'}</DialogDescription>
        </DialogHeader>
        <Textarea autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="For example: Customer asked for a call back tomorrow at 5 PM." />
        <p className="text-xs text-muted-foreground">The AI reads this note before its next message. “Already enrolled”, “Not interested” or “Do not contact” stops automatic follow-ups. A future call-back time moves the follow-up to that time.</p>
        <DialogFooter className="sm:justify-between">
          {editingId
            ? <Button variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" disabled={Boolean(busy)} onClick={remove}><FiTrash2 /> {busy === 'delete' ? 'Deleting…' : 'Delete note'}</Button>
            : <span />}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" disabled={Boolean(busy)} onClick={onClose}>Cancel</Button>
            <Button disabled={Boolean(busy)} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save note'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Asks before a delete or a bulk change. `confirm` carries title, text and,
// for bulk actions, actionLabel / busyLabel / destructive (bulkTaskConfirm).
function ConfirmDelete({ confirm, busy, onCancel, onConfirm }) {
  const destructive = confirm?.destructive !== false;
  return (
    <Dialog open={Boolean(confirm)} onOpenChange={(next) => { if (!next && !busy) onCancel(); }}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{destructive ? <FiAlertTriangle className="text-red-500" /> : <FiCheck className="text-blue-600" />} {confirm?.title}</DialogTitle>
          <DialogDescription>{confirm?.text}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>
            {busy ? (confirm?.busyLabel || 'Deleting…') : (confirm?.actionLabel || 'Delete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateRangeDialog({ open, tasks, timeZone, onClose, onDelete }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const valid = from && to && from <= to;
  const count = valid ? tasks.filter((t) => {
    const day = dueInputs(t.created_at, timeZone).date;
    return day >= from && day <= to;
  }).length : 0;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete tasks by date</DialogTitle>
          <DialogDescription>Deletes every task created between these dates (both days included).</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="range-from">From</Label><Input id="range-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="range-to">To</Label><Input id="range-to" type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {from && to && !valid && <p className="text-sm text-red-600">The “To” date must be on or after the “From” date.</p>}
        {valid && <p className="text-sm text-muted-foreground">{count} task{count === 1 ? '' : 's'} on this page match.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={!valid || count === 0} onClick={() => onDelete({ from, to, count })}>Delete {count || ''} task{count === 1 ? '' : 's'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const SalesTasksView = () => {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState([]);
  const [timeZone, setTimeZone] = useState(DEFAULT_TIME_ZONE);
  const [me, setMe] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [assignees, setAssignees] = useState([]);
  const [tags, setTags] = useState([]);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [busyIds, setBusyIds] = useState([]);
  const [dialog, setDialog] = useState(null); // { task } for edit, { task: null } for new
  const [noteTask, setNoteTask] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setLoading(true);
    try {
      const res = await api.get('/sales-tasks');
      const list = res.tasks || [];
      setTasks(list);
      setTimeZone(res.time_zone || DEFAULT_TIME_ZONE);
      setMe(res.me ?? null);
      setSelected((current) => current.filter((id) => list.some((t) => t.id === id)));
      setLoadError('');
      setLoaded(true);
      setNow(new Date());
    } catch (err) {
      setLoadError(err?.message || 'Please check your connection and try again.');
      if (quiet) toast.error('Could not refresh tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      load();
      api.get('/sales-tasks/assignees').then((res) => setAssignees(res.users || [])).catch(() => setAssignees([]));
      // This workspace's lead labels (task.tags are the lead's labels).
      labelsAsInboxTags.getTags().then((res) => setTags(Array.isArray(res) ? res : res?.tags || [])).catch(() => setTags([]));
    }, 0);
    // Overdue highlights move on while the page is open.
    const clock = setInterval(() => setNow(new Date()), 60 * 1000);
    return () => { clearTimeout(first); clearInterval(clock); };
  }, [load]);

  // Live: a task added, changed or removed elsewhere reloads the list.
  useEffect(() => {
    let timer;
    const socket = socketIO(api.baseUrl, { auth: { token: localStorage.getItem('leados_token') }, transports: ['websocket', 'polling'] });
    socket.on('sales_task_update', () => {
      clearTimeout(timer);
      timer = setTimeout(() => load({ quiet: true }), 500);
    });
    return () => { clearTimeout(timer); socket.disconnect(); };
  }, [load]);

  const setFilter = (key, value) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); };
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(DEFAULT_FILTERS);

  const counts = useMemo(() => countDue(tasks, { now, timeZone }), [tasks, now, timeZone]);
  const visible = useMemo(
    () => sortTasks(filterTasks(tasks, filters, { me, now, timeZone }), { now, timeZone }),
    [tasks, filters, me, now, timeZone]
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const pageTasks = visible.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageIds = pageTasks.map((t) => t.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.includes(id));

  const replaceTask = (task) => setTasks((list) => (list.some((t) => t.id === task.id) ? list.map((t) => (t.id === task.id ? { ...t, ...task } : t)) : [task, ...list]));
  const withBusy = async (id, fn) => {
    setBusyIds((ids) => [...ids, id]);
    try { await fn(); } finally { setBusyIds((ids) => ids.filter((x) => x !== id)); }
  };

  const setStatus = (task, status) => withBusy(task.id, async () => {
    try {
      const res = await api.patch(`/sales-tasks/${task.id}`, { status });
      replaceTask(res.task);
      toast.success(status === 'completed' ? 'Task done' : status === 'processing' ? 'Task in progress' : 'Task reopened');
    } catch (err) {
      toast.error(err?.message || 'Could not update the task');
    }
  });
  const toggleDone = (task) => setStatus(task, isDone(task) ? 'pending' : 'completed');

  const markRead = (task) => {
    if (!task.unread) return;
    const request = task.lead_id ? api.put(`/sales-tasks/lead/${task.lead_id}/read`, {}) : api.put(`/sales-tasks/${task.id}/read`, {});
    request.catch(() => {});
    setTasks((list) => list.map((t) => ((task.lead_id ? t.lead_id === task.lead_id : t.id === task.id) ? { ...t, unread: false } : t)));
  };

  const openLead = (task) => {
    markRead(task);
    navigate('/inbox', { state: { leadId: task.lead_id } });
  };

  const toggleDetails = (task) => {
    markRead(task);
    setExpanded((id) => (id === task.id ? null : task.id));
  };

  const updateSalesStatus = async (task, status) => {
    try {
      const res = await api.put(`/sales-tasks/lead/${task.lead_id}/sales-status`, { status });
      setTasks((list) => list.map((t) => (t.lead_id === task.lead_id ? { ...t, ...res.lead, id: t.id } : t)));
      toast.success('Lead status updated');
    } catch (err) {
      toast.error(err?.message || 'Could not update the lead status');
    }
  };

  const noteSaved = (leadId, changes) => {
    const rest = { ...changes };
    delete rest.id; // res.lead.id is the lead, not the task
    setTasks((list) => list.map((t) => (t.lead_id === leadId ? { ...t, ...rest } : t)));
  };

  const runDelete = async () => {
    if (!confirm) return;
    setDeleting(true);
    try {
      if (confirm.kind === 'complete') {
        await completeSelected(confirm.ids);
      } else if (confirm.kind === 'one') {
        await api.delete(`/sales-tasks/${confirm.task.id}`);
        setTasks((list) => list.filter((t) => t.id !== confirm.task.id));
        setSelected((ids) => ids.filter((id) => id !== confirm.task.id));
        toast.success('Task deleted');
      } else {
        const body = confirm.kind === 'selected' ? { ids: selected } : { from: confirm.from, to: confirm.to };
        const res = await api.post('/sales-tasks/bulk-delete', body);
        const gone = new Set(res.deletedIds || []);
        setTasks((list) => list.filter((t) => !gone.has(t.id)));
        setSelected([]);
        toast.success(`${res.deletedCount} task${res.deletedCount === 1 ? '' : 's'} deleted`);
      }
      setConfirm(null);
    } catch (err) {
      toast.error(err?.message || 'Could not delete');
    } finally {
      setDeleting(false);
    }
  };

  // Open tasks among the ticked ones; "Mark as done" asks first with that count.
  const openSelected = () => selected.filter((id) => !isDone(tasks.find((t) => t.id === id) || {}));
  const askCompleteSelected = () => {
    const ids = openSelected();
    if (!ids.length) { toast('The selected tasks are already done'); return; }
    setConfirm({ kind: 'complete', ids, ...bulkTaskConfirm('complete', ids.length) });
  };

  const completeSelected = async (ids) => {
    const results = await Promise.allSettled(ids.map((id) => api.patch(`/sales-tasks/${id}`, { status: 'completed' })));
    results.forEach((r) => { if (r.status === 'fulfilled' && r.value?.task) replaceTask(r.value.task); });
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed) toast.error(`${failed} task${failed === 1 ? '' : 's'} could not be updated`);
    else toast.success(`${ids.length} task${ids.length === 1 ? '' : 's'} done`);
    setSelected([]);
  };

  const exportTasks = () => {
    if (!visible.length) return;
    toast.promise(api.exportSalesTasks(visible.map((t) => t.id)), {
      loading: 'Preparing the Excel file…',
      success: 'Tasks downloaded',
      error: (err) => err?.message || 'Could not export tasks',
    });
  };

  const onSaved = (task) => {
    if (task) replaceTask(task);
    setDialog(null);
  };

  const rowHandlers = {
    onEdit: (task) => { markRead(task); setDialog({ task }); },
    onStatus: setStatus,
    onOpenLead: openLead,
    onNote: (task) => setNoteTask(task),
    onDelete: (task) => setConfirm({ kind: 'one', task, title: 'Delete this task?', text: `“${taskTitle(task)}” will be removed from Sales Tasks. This cannot be undone.` }),
  };

  // ── Loading and error states ──
  if (!loaded && loading) {
    return (
      <div className="space-y-4 p-4 md:p-8">
        <div className="flex flex-wrap gap-3"><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-32" /><Skeleton className="h-9 w-32" /></div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-80 w-full rounded-xl" />
      </div>
    );
  }
  if (!loaded && loadError) {
    return (
      <div className="p-4 md:p-8">
        <Card className="items-center gap-3 px-6 py-14 text-center">
          <FiAlertTriangle className="size-7 text-amber-500" />
          <div className="font-semibold">Sales tasks could not be loaded</div>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={() => load()}><FiRefreshCw /> Try again</Button>
        </Card>
      </div>
    );
  }

  const quick = [
    { key: 'overdue', label: 'Overdue', count: counts.overdue, tone: 'text-red-600', active: 'border-red-300 bg-red-50' },
    { key: 'today', label: 'Due today', count: counts.today, tone: 'text-amber-600', active: 'border-amber-300 bg-amber-50' },
    { key: 'upcoming', label: 'Upcoming', count: counts.upcoming, tone: 'text-blue-600', active: 'border-blue-300 bg-blue-50' },
  ];

  return (
    <div className="space-y-4 p-4 md:p-8">
      {/* Summary and actions */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {quick.map((q) => {
            const on = filters.due === q.key;
            return (
              <button key={q.key} type="button" onClick={() => setFilter('due', on ? 'all' : q.key)} aria-pressed={on}
                className={cn('flex cursor-pointer flex-col items-start rounded-lg border bg-card px-3 py-2 text-left shadow-xs transition-colors hover:bg-slate-50 sm:min-w-32', on ? q.active : 'border-border')}>
                <span className={cn('text-lg leading-tight font-bold', q.count ? q.tone : 'text-slate-400')}>{q.count}</span>
                <span className="text-xs text-muted-foreground">{q.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => load({ quiet: true })} disabled={loading} aria-label="Refresh" title="Refresh">
            <FiRefreshCw className={cn(loading && 'animate-spin')} />
          </Button>
          <Button variant="outline" onClick={exportTasks} disabled={!visible.length}><FiDownload /> Export</Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="More actions" title="More actions"><FiMoreVertical /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setRangeOpen(true)}><FiTrash2 /> Delete tasks by date…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="flex-1 sm:flex-none" onClick={() => setDialog({ task: null })}><FiPlus /> New task</Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="gap-3 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative sm:col-span-2 lg:col-span-1">
            <FiSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={filters.search} onChange={(e) => setFilter('search', e.target.value)} placeholder="Search task, lead name or phone" className="pr-9 pl-9" aria-label="Search tasks" />
            {filters.search && (
              <button type="button" onClick={() => setFilter('search', '')} className="absolute top-1/2 right-3 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground" aria-label="Clear search"><FiX className="size-4" /></button>
            )}
          </div>
          <Select value={filters.status} onValueChange={(value) => setFilter('status', value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="open"><FiCircle className="text-blue-600" /> Open tasks</SelectItem>
              <SelectItem value="pending"><FiClock className="text-amber-600" /> To do</SelectItem>
              <SelectItem value="processing"><FiPlay className="text-violet-600" /> In progress</SelectItem>
              <SelectItem value="completed"><FiCheckCircle className="text-green-600" /> Done</SelectItem>
              <SelectItem value="all"><FiCheckSquare className="text-muted-foreground" /> All tasks</SelectItem>
            </SelectContent>
          </Select>
          <Select value={String(filters.assignee)} onValueChange={(value) => setFilter('assignee', value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Assigned to"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><FiUser className="text-muted-foreground" /> Anyone</SelectItem>
              {me != null && <SelectItem value="me"><FiUser className="text-blue-600" /> Assigned to me</SelectItem>}
              <SelectItem value="none"><FiUser className="text-muted-foreground opacity-60" /> Unassigned</SelectItem>
              {assignees.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={filters.due} onValueChange={(value) => setFilter('due', value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Due"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all"><FiCalendar className="text-muted-foreground" /> Any due date</SelectItem>
              <SelectItem value="overdue"><FiAlertTriangle className="text-red-600" /> Overdue</SelectItem>
              <SelectItem value="today"><FiClock className="text-amber-600" /> Due today</SelectItem>
              <SelectItem value="upcoming"><FiCalendar className="text-blue-600" /> Upcoming</SelectItem>
              <SelectItem value="none"><FiCalendar className="text-muted-foreground opacity-60" /> No due date</SelectItem>
            </SelectContent>
          </Select>
          <Select value={filters.tag ? String(filters.tag) : 'any'} onValueChange={(value) => setFilter('tag', value === 'any' ? '' : value)}>
            <SelectTrigger className="h-9 w-full" aria-label="Lead label"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any label</SelectItem>
              {tags.map((tag) => <SelectItem key={tag.id} value={String(tag.id)}>{tag.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(filtersActive || loadError) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">{loadError ? <span className="text-red-600">Could not refresh: {loadError}</span> : `${visible.length} of ${tasks.length} tasks`}</span>
            {filtersActive && <Button variant="link" size="sm" className="h-auto p-0" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}>Clear filters</Button>}
          </div>
        )}
      </Card>

      {/* Selection bar */}
      {selected.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5">
          <span className="text-sm font-medium text-blue-900">{selected.length} selected</span>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="bg-white" onClick={askCompleteSelected}><FiCheck /> Mark as done</Button>
            <Button size="sm" variant="outline" className="bg-white text-red-600 hover:text-red-700" onClick={() => setConfirm({ kind: 'selected', ...bulkTaskConfirm('selected', selected.length) })}><FiTrash2 /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
          </div>
        </div>
      )}

      {/* Task list */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="hidden grid-cols-[20px_minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_32px] items-center gap-4 border-b border-border bg-slate-50 px-4 py-2.5 text-xs font-semibold text-muted-foreground md:grid">
          <input type="checkbox" className="size-4 cursor-pointer accent-primary" aria-label="Select all tasks on this page" checked={allOnPage} disabled={!pageIds.length}
            onChange={() => setSelected((ids) => (allOnPage ? ids.filter((id) => !pageIds.includes(id)) : [...new Set([...ids, ...pageIds])]))} />
          <span>Task</span><span>Lead</span><span>Due</span><span>Assigned to</span><span />
        </div>

        {pageTasks.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-slate-100 text-slate-400"><FiCheckSquare className="size-6" /></span>
            {tasks.length === 0 ? (
              <>
                <div className="font-semibold">No sales tasks yet</div>
                <p className="max-w-sm text-sm text-muted-foreground">Hot leads, booked demo calls and follow-ups show up here on their own. You can also add a task yourself.</p>
                <Button onClick={() => setDialog({ task: null })}><FiPlus /> New task</Button>
              </>
            ) : (
              <>
                <div className="font-semibold">{filters.status === 'open' && !filtersActive ? 'All caught up' : 'No tasks match these filters'}</div>
                <p className="text-sm text-muted-foreground">{filters.status === 'open' && !filtersActive ? 'Every open task is done.' : 'Try another filter or search.'}</p>
                {filtersActive && <Button variant="outline" onClick={() => { setFilters(DEFAULT_FILTERS); setPage(1); }}>Clear filters</Button>}
              </>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {pageTasks.map((task) => {
              const type = typeOf(task);
              const done = isDone(task);
              const overdue = dueState(task, now, timeZone) === 'overdue';
              const open = expanded === task.id;
              const busy = busyIds.includes(task.id);
              const checked = selected.includes(task.id);
              const toggleSelect = () => setSelected((ids) => (checked ? ids.filter((id) => id !== task.id) : [...ids, task.id]));
              const titleBlock = (
                <div className="flex min-w-0 items-start gap-2.5">
                  <CompleteToggle task={task} busy={busy} onToggle={toggleDone} />
                  <div className="min-w-0 flex-1">
                    <button type="button" onClick={() => toggleDetails(task)} aria-expanded={open}
                      className={cn('flex max-w-full cursor-pointer items-center gap-1.5 text-left text-sm font-semibold hover:text-blue-700', done && 'text-muted-foreground line-through')}>
                      {task.unread && !done && <span className="size-2 shrink-0 rounded-full bg-blue-600" title="New" />}
                      <span className="truncate">{taskTitle(task)}</span>
                      {open ? <FiChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <FiChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                    </button>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant={type.variant}>{type.label}</Badge>
                      {task.status === 'processing' && <Badge variant="info">In progress</Badge>}
                      {(task.tags || []).map((tag) => (
                        <span key={tag.id} className="inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold" style={{ color: tag.color, borderColor: `${tag.color}55`, background: `${tag.color}14` }}>{tag.name}</span>
                      ))}
                    </div>
                  </div>
                </div>
              );
              return (
                <li key={task.id} className={cn('px-4 py-3', overdue && 'bg-red-50/40', checked && 'bg-blue-50/50')}>
                  {/* Desktop row */}
                  <div className="hidden grid-cols-[20px_minmax(0,2.4fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_32px] items-center gap-4 md:grid">
                    <input type="checkbox" className="size-4 cursor-pointer accent-primary" aria-label={`Select ${taskTitle(task)}`} checked={checked} onChange={toggleSelect} />
                    {titleBlock}
                    <div className="min-w-0"><LeadLink task={task} onOpen={openLead} /></div>
                    <div className="min-w-0"><DueBadge task={task} now={now} timeZone={timeZone} /></div>
                    <div className="min-w-0"><Assignee task={task} /></div>
                    <RowMenu task={task} {...rowHandlers} />
                  </div>
                  {/* Mobile card */}
                  <div className="flex items-start gap-3 md:hidden">
                    <input type="checkbox" className="mt-1 size-4 shrink-0 cursor-pointer accent-primary" aria-label={`Select ${taskTitle(task)}`} checked={checked} onChange={toggleSelect} />
                    <div className="min-w-0 flex-1 space-y-2">
                      {titleBlock}
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pl-7.5">
                        <DueBadge task={task} now={now} timeZone={timeZone} />
                        {task.lead_id && <span className="inline-flex min-w-0 items-center gap-1.5"><FiUser className="size-3.5 shrink-0 text-muted-foreground" /><LeadLink task={task} onOpen={openLead} /></span>}
                        <Assignee task={task} />
                      </div>
                    </div>
                    <RowMenu task={task} {...rowHandlers} />
                  </div>
                  {open && (
                    <div className="mt-3 md:ml-9">
                      <TaskDetails task={task} timeZone={timeZone} onSalesStatus={updateSalesStatus} onNote={setNoteTask} onOpenLead={openLead} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {visible.length > PAGE_SIZE && (
          <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm text-muted-foreground">
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, visible.length)} of {visible.length}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <span className="px-1 text-sm font-medium">Page {currentPage} of {pages}</span>
              <Button variant="outline" size="sm" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>

      {dialog && <TaskDialog key={dialog.task?.id ?? 'new'} open task={dialog?.task || null} assignees={assignees} timeZone={timeZone} onClose={() => setDialog(null)} onSaved={onSaved} />}
      {noteTask && <NoteDialog key={noteTask.id} task={noteTask} onClose={() => setNoteTask(null)} onSaved={noteSaved} />}
      <ConfirmDelete confirm={confirm} busy={deleting} onCancel={() => setConfirm(null)} onConfirm={runDelete} />
      {rangeOpen && <DateRangeDialog open tasks={tasks} timeZone={timeZone} onClose={() => setRangeOpen(false)}
        onDelete={({ from, to, count }) => { setRangeOpen(false); setConfirm({ kind: 'range', from, to, ...bulkTaskConfirm('range', count, { from, to }) }); }} />}
    </div>
  );
};
