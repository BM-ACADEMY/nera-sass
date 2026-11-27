// Formatting and sorting for the Reports page (pure functions, tested in
// reportFormat.test.js).

// Roles that see Reports > Team (server permission 'reports.team').
export const TEAM_REPORT_ROLES = ['owner', 'admin', 'manager'];
export const canViewTeamReport = (role) => TEAM_REPORT_ROLES.includes(String(role || '').toLowerCase());

const trim = (value) => value.toFixed(1).replace(/\.0$/, '');

/**
 * Short rupee amounts for chart axes and cards: ₹0, ₹500, ₹1.2k, ₹3.4L,
 * ₹1.5Cr (Indian lakh/crore). Fractions of a rupee round to whole rupees.
 */
export function formatMoney(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '₹0';
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  if (abs < 1000) return `${sign}₹${Math.round(abs)}`;
  // Round first so 99,999 reads ₹1L, not ₹100k.
  if (abs < 99950) return `${sign}₹${trim(abs / 1000)}k`;
  if (abs < 9995000) return `${sign}₹${trim(abs / 100000)}L`;
  return `${sign}₹${trim(abs / 10000000)}Cr`;
}

/** Full rupee amount with Indian grouping: ₹12,34,567. */
export function formatMoneyFull(value) {
  const amount = Math.round(Number(value) || 0);
  return `₹${amount.toLocaleString('en-IN')}`;
}

/**
 * A wait in seconds, short: "45s", "4m", "1h 20m", "2h", "1d 3h"; "—" when
 * there is nothing to show.
 */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const total = Math.round(Number(seconds));
  if (!Number.isFinite(total) || total < 0) return '—';
  if (total < 60) return `${total}s`;
  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days}d ${restHours}h` : `${days}d`;
}

/** True when a chart has nothing but zeros (or no points at all). */
export function isAllZero(rows, keys) {
  if (!Array.isArray(rows) || !rows.length) return true;
  return rows.every((row) => keys.every((key) => !Number(row?.[key])));
}

// Team table columns that sort. Text sorts A-Z first, numbers high first;
// an empty value (no reply time, never active) always goes last.
export const TEAM_COLUMNS = [
  { key: 'name', label: 'Member', type: 'text' },
  { key: 'leads_open', label: 'Leads open', type: 'number' },
  { key: 'replies', label: 'Replies', type: 'number' },
  { key: 'avg_first_reply_seconds', label: 'Avg first reply', type: 'number' },
  { key: 'converted', label: 'Converted', type: 'number' },
  { key: 'lost', label: 'Lost', type: 'number' },
  { key: 'notes', label: 'Notes', type: 'number' },
  { key: 'tasks_done', label: 'Tasks done', type: 'number' },
  { key: 'tasks_overdue', label: 'Overdue', type: 'number' },
  { key: 'last_active_at', label: 'Last active', type: 'date' },
];

export const defaultTeamSort = (key) => {
  const column = TEAM_COLUMNS.find((c) => c.key === key);
  // Faster replies first; text A-Z; everything else biggest / latest first.
  if (key === 'avg_first_reply_seconds' || column?.type === 'text') return 'asc';
  return 'desc';
};

export function sortMembers(members, key, direction) {
  const column = TEAM_COLUMNS.find((c) => c.key === key) || TEAM_COLUMNS[0];
  const factor = direction === 'asc' ? 1 : -1;
  const value = (m) => {
    const raw = m?.[column.key];
    if (raw === null || raw === undefined || raw === '') return null;
    if (column.type === 'text') return String(raw).toLowerCase();
    if (column.type === 'date') return new Date(raw).getTime();
    return Number(raw);
  };
  return [...(members || [])].sort((a, b) => {
    const x = value(a);
    const y = value(b);
    if (x === null && y === null) return String(a?.name || '').localeCompare(String(b?.name || ''));
    if (x === null) return 1;
    if (y === null) return -1;
    if (x < y) return -1 * factor;
    if (x > y) return 1 * factor;
    return String(a?.name || '').localeCompare(String(b?.name || ''));
  });
}

/** True when nobody did anything in the period (the table shows an empty state). */
export function teamHasActivity(report) {
  const t = report?.totals;
  const ai = report?.ai;
  if (!t) return false;
  return ['replies', 'status_changes', 'notes', 'tasks_done', 'leads_assigned', 'first_replies'].some((k) => Number(t[k]) > 0)
    || Number(ai?.replies) > 0 || Number(ai?.handovers) > 0;
}
