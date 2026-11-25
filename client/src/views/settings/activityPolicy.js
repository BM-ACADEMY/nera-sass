// Settings > Activity: filter choices and wording for the activity log
// (GET /api/activity). The server writes the action names and details in plain
// English; this file only builds the query and formats times and people.

export const ACTIVITY_GROUPS = [
  { value: 'leads', label: 'Leads & sales tasks' },
  { value: 'chat', label: 'Chats & messages' },
  { value: 'campaigns', label: 'Campaigns' },
  { value: 'settings', label: 'Settings & AI' },
  { value: 'team', label: 'Team' },
  { value: 'security', label: 'Sign-in & security' },
];

const GROUP_TONES = {
  leads: 'info', chat: 'success', campaigns: 'purple', settings: 'warning', team: 'gold', security: 'danger',
};
export const groupTone = (group) => GROUP_TONES[group] || 'muted';
export const groupLabel = (group) => ACTIVITY_GROUPS.find((g) => g.value === group)?.label || 'Other';

export const ACTIVITY_PAGE_SIZE = 25;
const ALL = 'all';

export const emptyActivityFilters = () => ({ user: ALL, group: ALL, from: '', to: '' });

// The query for the API from the page's filters ('all' means no filter).
export function activityQuery(filters = {}, page = 1) {
  const query = { page, limit: ACTIVITY_PAGE_SIZE };
  if (filters.user && filters.user !== ALL) query.user_id = filters.user;
  if (filters.group && filters.group !== ALL) query.group = filters.group;
  if (filters.from) query.from = filters.from;
  if (filters.to) query.to = filters.to;
  return query;
}

// A date range the server would refuse, said before asking it.
export function activityFilterProblem(filters = {}) {
  if (filters.from && filters.to && filters.from > filters.to) return 'The "From" date must be on or before the "To" date.';
  return '';
}

export const hasActivityFilters = (filters = {}) => Boolean(
  (filters.user && filters.user !== ALL) || (filters.group && filters.group !== ALL) || filters.from || filters.to,
);

const ROLE_NAMES = { owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent' };

// "Priya · Manager", "Getnera team", "System".
export function actorText(actor) {
  if (!actor) return 'System';
  const role = ROLE_NAMES[actor.role];
  return role ? `${actor.name} · ${role}` : actor.name || 'System';
}

export function activityTime(value, now = new Date()) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return { date: '', time: '' };
  const sameDay = at.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === at.toDateString();
  return {
    date: sameDay ? 'Today' : yesterday ? 'Yesterday' : at.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: at.getFullYear() === now.getFullYear() ? undefined : 'numeric' }),
    time: at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }),
  };
}
