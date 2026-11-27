// Pure helpers for the Dashboard (views/Dashboard.jsx). Numbers come from
// GET /api/dashboard/attention, GET /api/dashboard/overview and
// GET /api/reports/summary.
import { SOURCE_LABELS } from '../views/leads/leadsPolicy.js';

// Roles that see only their own + unassigned work (server: routes/leados/dashboard.js).
// 'user' and 'ops' are legacy names the server reads as agent.
const STAFF_ROLES = ['agent', 'user', 'ops'];
export const isStaffRole = (role) => STAFF_ROLES.includes(String(role || '').toLowerCase());

const trim = (n) => {
  const fixed = n.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
};

/** ₹0, ₹500, ₹1.2k, ₹45k, ₹3.4L, ₹2.1Cr (Indian units). */
export function formatRupees(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return '₹0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs < 1000) return `${sign}₹${Math.round(abs)}`;
  // Round first so 99,990 reads ₹1L, not ₹100k.
  if (abs < 99950) return `${sign}₹${trim(abs / 1000)}k`;
  if (abs < 9995000) return `${sign}₹${trim(abs / 100000)}L`;
  return `${sign}₹${trim(abs / 10000000)}Cr`;
}

/** Full rupee amount for tooltips: ₹1,23,456. */
export const fullRupees = (value) => `₹${Math.round(Number(value) || 0).toLocaleString('en-IN')}`;

// Lead source kinds from GET /api/dashboard/overview: the Leads page kinds
// plus 'campaign' (leads added by a campaign upload).
export const DASHBOARD_SOURCE_LABELS = { ...SOURCE_LABELS, campaign: 'Campaign upload' };

/** [{ kind, label, count, percent }] largest first; percents add up to 100. */
export function sourceRows(sources) {
  const rows = (sources || [])
    .map((s) => ({ kind: s.kind, count: Number(s.count) || 0 }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = rows.reduce((sum, r) => sum + r.count, 0);
  if (!total) return [];
  const exact = rows.map((r) => (r.count * 100) / total);
  const percent = exact.map(Math.floor);
  // Largest remainders get the leftover points.
  let left = 100 - percent.reduce((a, b) => a + b, 0);
  exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (left > 0) { percent[i] += 1; left -= 1; }
  });
  return rows.map((r, i) => ({ ...r, label: DASHBOARD_SOURCE_LABELS[r.kind] || 'Other', percent: percent[i] }));
}

/** "18 min", "2 h 5 min", "3 h", "1 day" since `value`; '' when unknown. */
export function waitText(value, now = Date.now()) {
  if (!value) return '';
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return '';
  const minutes = Math.max(0, Math.floor((now - at) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * The four "Needs attention now" cards. `to` + `state` are for navigate():
 * chats open the longest-waiting one in WhatsApp Chat; leads and tasks open
 * their page with a filter (/leads?status=hot, /sales-tasks?due=overdue).
 */
export function attentionCards(data, now = Date.now()) {
  if (!data) return [];
  const mine = data.scope === 'mine';
  const unanswered = data.unanswered || {};
  const handovers = data.handovers || {};
  const chatState = (leadId) => (leadId != null ? { leadId } : undefined);
  return [
    {
      key: 'unanswered', label: 'Unanswered chats', count: Number(unanswered.count) || 0,
      hint: unanswered.count ? `Oldest waiting ${waitText(unanswered.oldest_at, now)}` : `No customer waiting over ${unanswered.after_minutes || 15} min`,
      to: '/inbox', state: chatState(unanswered.oldest_lead_id), action: 'Reply',
    },
    {
      key: 'hot', label: 'Hot leads with no reply', count: Number(data.hot_no_reply?.count) || 0,
      hint: data.hot_no_reply?.count ? 'Their last message has no reply' : 'Every hot lead has a reply',
      to: '/leads?status=hot', action: 'View hot leads',
    },
    {
      key: 'handovers', label: 'AI handovers waiting', count: Number(handovers.count) || 0,
      hint: handovers.count ? `Handed over ${waitText(handovers.oldest_at, now) || 'earlier'} ago` : 'No chat is waiting for a person',
      to: '/inbox', state: chatState(handovers.oldest_lead_id), action: 'Open chat',
    },
    {
      key: 'overdue', label: 'Overdue tasks', count: Number(data.overdue_tasks?.count) || 0,
      hint: data.overdue_tasks?.count ? (mine ? 'Yours and unassigned' : 'Past their due time') : 'Nothing overdue',
      to: '/sales-tasks?due=overdue', action: 'View tasks',
    },
  ];
}

/** One allowed value of a URL query parameter, else `fallback`. */
export function queryValue(search, key, allowed, fallback) {
  try {
    const value = new URLSearchParams(search || '').get(key);
    return value != null && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

/** "Good morning" / "Good afternoon" / "Good evening" for the hour. */
export function greeting(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
