// Pure helpers for the Sales Tasks page. Dates are read on the workspace clock
// (the server sends time_zone, Asia/Kolkata by default), never the browser's.

export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

export const TASK_TYPES = {
  manual: { label: 'Task', variant: 'muted' },
  hot_lead: { label: 'Hot lead', variant: 'danger' },
  call: { label: 'Demo call', variant: 'info' },
  followup: { label: 'Follow-up', variant: 'purple' },
  overdue: { label: 'Follow-up', variant: 'purple' },
};

const AUTO_TITLES = {
  hot_lead: 'Contact this hot lead',
  call: 'Attend the demo call',
  followup: 'Follow up with the lead',
  overdue: 'Follow up with the lead',
};

export const typeOf = (task) => TASK_TYPES[task.task_type] || { label: 'Task', variant: 'muted' };
export const taskTitle = (task) => task.title || AUTO_TITLES[task.task_type] || 'Task';
export const isDone = (task) => task.status === 'completed';

function safeZone(timeZone) {
  try { new Intl.DateTimeFormat('en-US', { timeZone }); return timeZone; } catch { return DEFAULT_TIME_ZONE; }
}

function parts(date, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: safeZone(timeZone), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date).map((p) => [p.type, p.value]));
}

/** 'YYYY-MM-DD' of the moment on the workspace clock. */
export function dayKey(value, timeZone = DEFAULT_TIME_ZONE) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = parts(date, timeZone);
  return `${p.year}-${p.month}-${p.day}`;
}

/** Values for the date and time inputs of the task form. */
export function dueInputs(value, timeZone = DEFAULT_TIME_ZONE) {
  if (!value) return { date: '', time: '' };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: '', time: '' };
  const p = parts(date, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** none | done | overdue | today | upcoming */
export function dueState(task, now = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (isDone(task)) return 'done';
  if (!task.due_at) return 'none';
  const due = new Date(task.due_at);
  if (Number.isNaN(due.getTime())) return 'none';
  if (due < now) return 'overdue';
  return dayKey(due, timeZone) === dayKey(now, timeZone) ? 'today' : 'upcoming';
}

export function formatDue(value, timeZone = DEFAULT_TIME_ZONE, now = new Date()) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const zone = safeZone(timeZone);
  const time = date.toLocaleTimeString('en-IN', { timeZone: zone, hour: 'numeric', minute: '2-digit' });
  const day = dayKey(date, zone);
  const today = dayKey(now, zone);
  const tomorrow = dayKey(new Date(now.getTime() + 24 * 60 * 60 * 1000), zone);
  const yesterday = dayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), zone);
  if (day === today) return `Today, ${time}`;
  if (day === tomorrow) return `Tomorrow, ${time}`;
  if (day === yesterday) return `Yesterday, ${time}`;
  const sameYear = day.slice(0, 4) === today.slice(0, 4);
  const dateText = date.toLocaleDateString('en-IN', { timeZone: zone, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
  return `${dateText}, ${time}`;
}

export const formatDateTime = (value, timeZone = DEFAULT_TIME_ZONE) => (value
  ? new Date(value).toLocaleString('en-IN', { timeZone: safeZone(timeZone), dateStyle: 'medium', timeStyle: 'short' })
  : '—');

/**
 * filters: { status: 'open'|'all'|'pending'|'processing'|'completed',
 *            assignee: 'all'|'me'|'none'|<user id>, due: 'all'|'overdue'|'today'|'upcoming'|'none',
 *            tag: ''|<tag id>, search: string }
 */
export function filterTasks(tasks, filters, { me = null, now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const term = String(filters.search || '').trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  return tasks.filter((task) => {
    const status = filters.status || 'open';
    if (status === 'open' && isDone(task)) return false;
    if (!['open', 'all'].includes(status) && task.status !== status) return false;
    const assignee = filters.assignee || 'all';
    if (assignee === 'me' && (me == null || task.assigned_to !== me)) return false;
    if (assignee === 'none' && task.assigned_to != null) return false;
    if (!['all', 'me', 'none'].includes(assignee) && task.assigned_to !== Number(assignee)) return false;
    const due = filters.due || 'all';
    if (due !== 'all' && dueState(task, now, timeZone) !== due) return false;
    if (filters.tag && !(task.tags || []).some((t) => t.id === Number(filters.tag))) return false;
    if (!term) return true;
    const text = [taskTitle(task), task.description, task.name, task.assigned_name, task.brand_name].filter(Boolean).join(' ').toLowerCase();
    const phone = String(task.phone || '').replace(/\D/g, '');
    return text.includes(term) || Boolean(digits.length >= 3 && phone.includes(digits));
  });
}

const DUE_ORDER = { overdue: 0, today: 1, upcoming: 2, none: 3, done: 4 };

/** Overdue first, then by due time, then newest; finished tasks last. */
export function sortTasks(tasks, { now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  return [...tasks].sort((a, b) => {
    const sa = dueState(a, now, timeZone);
    const sb = dueState(b, now, timeZone);
    if (DUE_ORDER[sa] !== DUE_ORDER[sb]) return DUE_ORDER[sa] - DUE_ORDER[sb];
    if (sa === 'done') return new Date(b.completed_at || 0) - new Date(a.completed_at || 0);
    if (a.due_at && b.due_at) return new Date(a.due_at) - new Date(b.due_at);
    return new Date(b.created_at || 0) - new Date(a.created_at || 0) || (b.id || 0) - (a.id || 0);
  });
}

export function countDue(tasks, { now = new Date(), timeZone = DEFAULT_TIME_ZONE } = {}) {
  const counts = { overdue: 0, today: 0, upcoming: 0, open: 0 };
  for (const task of tasks) {
    const state = dueState(task, now, timeZone);
    if (state !== 'done') counts.open += 1;
    if (state in counts) counts[state] += 1;
  }
  return counts;
}

/** Request body for POST/PATCH from the form. */
export function taskBody(form) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    lead_id: form.lead ? form.lead.id : null,
    assigned_to: form.assigned_to ? Number(form.assigned_to) : null,
    due_date: form.due_date || null,
    due_time: form.due_date && form.due_time ? form.due_time : null,
  };
}
