/**
 * Reports > Team: what each person in a workspace did in a date range.
 *
 * Every read runs in the caller's tenant context (the tenant scope plugin adds
 * tenant_id to every query and aggregate), so another workspace's rows are
 * never counted. A handful of aggregate queries, no per-lead or per-member
 * loops against the database.
 *
 * Metric definitions (all "in range" = from <= time < to):
 *   leads_open        leads assigned to the member now whose status is not
 *                     converted or lost (current state, not range-bound).
 *   leads_assigned    leads assigned to the member in range by someone on the
 *                     Leads page (LEAD_ASSIGNED / LEADS_BULK_ASSIGNED audit
 *                     events; automatic assignment is not audited).
 *   replies           WhatsApp messages and templates the member sent from the
 *                     app in range (MESSAGE_SENT / TEMPLATE_SENT audit events
 *                     with the member as actor).
 *   avg_first_reply_seconds
 *                     A "wait" starts at the first customer (inbound) message
 *                     after the last outbound message of a chat and ends at
 *                     the next outbound message that was not a failed send.
 *                     When that message was sent by the member (messages.
 *                     sent_by) and it falls in range, the wait counts for the
 *                     member; when it was an AI reply it counts for the AI
 *                     row. Waits longer than FIRST_REPLY_LOOKBACK_DAYS are
 *                     left out (an old thread picked up again is not a reply
 *                     time), which also caps how far before the range the
 *                     messages are read. Null when there is nothing to
 *                     average.
 *   status_changes    lead status changes made by the member in range
 *                     (LEAD_STATUS_CHANGED = 1, LEADS_BULK_STATUS_CHANGED =
 *                     its lead count); converted / lost = changes to that
 *                     status.
 *   notes             notes the member added in range (LEAD_NOTE_ADDED and
 *                     SALES_NOTE_ADDED).
 *   tasks_done        sales tasks assigned to the member completed in range.
 *   tasks_overdue     sales tasks assigned to the member, not completed, not
 *                     removed, with a due time before now (current state).
 *   last_active_at    the member's latest audit event of any kind (sign-ins,
 *                     sends and edits are all audited).
 * AI row: ai_replies = outbound messages with is_ai in range; handovers =
 * ai_reply_logs with handoff in range; avg_first_reply_seconds as above.
 */
const { Users, Leads, Messages, SalesTasks, AuditEvents, AiReplyLogs } = require('../models');

const DAY_MS = 86400000;
const FIRST_REPLY_LOOKBACK_DAYS = 7;
const CLOSED_STATUSES = ['converted', 'lost'];
const REPLY_EVENTS = ['MESSAGE_SENT', 'TEMPLATE_SENT'];
const STATUS_EVENTS = ['LEAD_STATUS_CHANGED', 'LEADS_BULK_STATUS_CHANGED'];
const NOTE_EVENTS = ['LEAD_NOTE_ADDED', 'SALES_NOTE_ADDED'];
const ASSIGN_EVENTS = ['LEAD_ASSIGNED', 'LEADS_BULK_ASSIGNED'];
const BULK_EVENTS = ['LEADS_BULK_STATUS_CHANGED', 'LEADS_BULK_ASSIGNED'];

class TeamReportError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/**
 * The same ranges as GET /api/reports/summary: range=7d|30d|90d (today and
 * the days before it) or range=custom&from=YYYY-MM-DD&to=YYYY-MM-DD (whole
 * days, both included), on the server clock.
 */
function parseRange(query = {}, now = new Date()) {
  const range = String(query.range || (query.from || query.to ? 'custom' : '30d'));
  if (range === 'custom') {
    const { from, to } = query;
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(from || '') || !day.test(to || '') || from > to) throw new TeamReportError('Invalid custom date range');
    const [fy, fm, fd] = from.split('-').map(Number);
    const [ty, tm, td] = to.split('-').map(Number);
    return { range, from: new Date(fy, fm - 1, fd), to: addDays(new Date(ty, tm - 1, td), 1) };
  }
  const days = { '7d': 7, '30d': 30, '90d': 90 }[range];
  if (!days) throw new TeamReportError('Use range 7d, 30d, 90d or custom');
  const today = startOfDay(now);
  return { range, from: addDays(today, -(days - 1)), to: addDays(today, 1) };
}

/**
 * Walks each chat's messages in time order and returns the first-reply waits
 * that ended in [from, to): { member: Map(userId -> [ms]), ai: [ms] }.
 * `chats` is [{ m: [{ d, t, by, ai, f }] }] sorted by time inside each chat.
 * Exported for tests.
 */
function firstReplyWaits(chats, from, to, lookbackMs = FIRST_REPLY_LOOKBACK_DAYS * DAY_MS) {
  const member = new Map();
  const ai = [];
  for (const chat of chats) {
    let waitingSince = null;
    for (const msg of chat.m || []) {
      const at = new Date(msg.t).getTime();
      if (msg.d === 'inbound') {
        if (waitingSince == null) waitingSince = at;
        continue;
      }
      if (msg.d !== 'outbound' || msg.f) continue;
      if (waitingSince != null) {
        const wait = at - waitingSince;
        if (at >= from.getTime() && at < to.getTime() && wait >= 0 && wait <= lookbackMs) {
          if (msg.ai) ai.push(wait);
          else if (msg.by != null) {
            if (!member.has(msg.by)) member.set(msg.by, []);
            member.get(msg.by).push(wait);
          }
        }
      }
      waitingSince = null;
    }
  }
  return { member, ai };
}

const average = (list) => (list && list.length ? list.reduce((a, b) => a + b, 0) / list.length : null);
const toSeconds = (ms) => (ms == null ? null : Math.round(ms / 1000));

async function firstReplies(from, to) {
  const chats = await Messages.aggregate([
    { $match: { sent_at: { $gte: new Date(from.getTime() - FIRST_REPLY_LOOKBACK_DAYS * DAY_MS), $lt: to }, direction: { $in: ['inbound', 'outbound'] } } },
    { $sort: { conversation_id: 1, sent_at: 1, id: 1 } },
    { $group: {
      _id: '$conversation_id',
      m: { $push: { d: '$direction', t: '$sent_at', by: '$sent_by', ai: '$is_ai', f: { $eq: ['$status', 'failed'] } } },
    } },
  ]).allowDiskUse(true);
  return firstReplyWaits(chats, from, to);
}

/** The team report for the tenant in the current context. */
async function build(query = {}, now = new Date()) {
  const { range, from, to } = parseRange(query, now);
  const inRange = { $gte: from, $lt: to };

  const users = await Users.find(
    { removed_at: null, is_platform_staff: { $ne: true } },
    { _id: 0, id: 1, name: 1, email: 1, role: 1, is_active: 1 },
  ).sort({ name: 1 }).lean();
  const ids = users.map((u) => u.id);

  const [leadsOpen, audit, tasks, replies, aiReplies, handovers] = await Promise.all([
    Leads.aggregate([
      { $match: { assigned_to: { $in: ids }, status: { $nin: CLOSED_STATUSES } } },
      { $group: { _id: '$assigned_to', n: { $sum: 1 } } },
    ]),
    AuditEvents.aggregate([
      { $match: { $or: [
        { actor_user_id: { $in: ids } },
        { event: { $in: ASSIGN_EVENTS }, created_at: inRange },
      ] } },
      { $facet: {
        // What each member did in range, by event and new status.
        actions: [
          { $match: { actor_user_id: { $in: ids }, created_at: inRange, event: { $in: [...REPLY_EVENTS, ...STATUS_EVENTS, ...NOTE_EVENTS] } } },
          { $group: {
            _id: { user: '$actor_user_id', event: '$event', status: '$meta.after.status' },
            n: { $sum: { $cond: [{ $in: ['$event', BULK_EVENTS] }, { $ifNull: ['$meta.count', 1] }, 1] } },
          } },
        ],
        // Leads given to each member in range, by whoever assigned them.
        assigned: [
          { $match: { event: { $in: ASSIGN_EVENTS }, created_at: inRange, 'meta.after.assigned_to': { $in: ids } } },
          { $group: {
            _id: '$meta.after.assigned_to',
            n: { $sum: { $cond: [{ $in: ['$event', BULK_EVENTS] }, { $ifNull: ['$meta.count', 1] }, 1] } },
          } },
        ],
        lastActive: [
          { $match: { actor_user_id: { $in: ids } } },
          { $group: { _id: '$actor_user_id', at: { $max: '$created_at' } } },
        ],
      } },
    ]),
    SalesTasks.aggregate([
      { $match: { assigned_to: { $in: ids }, deleted_at: null } },
      { $facet: {
        done: [{ $match: { status: 'completed', completed_at: inRange } }, { $group: { _id: '$assigned_to', n: { $sum: 1 } } }],
        overdue: [{ $match: { status: { $ne: 'completed' }, due_at: { $ne: null, $lt: now } } }, { $group: { _id: '$assigned_to', n: { $sum: 1 } } }],
      } },
    ]),
    firstReplies(from, to),
    Messages.countDocuments({ direction: 'outbound', is_ai: true, sent_at: inRange }),
    AiReplyLogs.countDocuments({ handoff: true, created_at: inRange }),
  ]);

  const byId = (rows) => new Map(rows.map((r) => [r._id, r.n]));
  const open = byId(leadsOpen);
  const facets = audit[0] || { actions: [], assigned: [], lastActive: [] };
  const assigned = byId(facets.assigned);
  const lastActive = new Map(facets.lastActive.map((r) => [r._id, r.at]));
  const done = byId(tasks[0]?.done || []);
  const overdue = byId(tasks[0]?.overdue || []);

  const counts = new Map(ids.map((id) => [id, { replies: 0, status_changes: 0, converted: 0, lost: 0, notes: 0 }]));
  for (const { _id: key, n } of facets.actions) {
    const row = counts.get(key.user);
    if (!row) continue;
    if (REPLY_EVENTS.includes(key.event)) row.replies += n;
    else if (NOTE_EVENTS.includes(key.event)) row.notes += n;
    else if (STATUS_EVENTS.includes(key.event)) {
      row.status_changes += n;
      if (key.status === 'converted') row.converted += n;
      if (key.status === 'lost') row.lost += n;
    }
  }

  const members = users.map((user) => {
    const waits = replies.member.get(user.id) || [];
    return {
      user_id: user.id,
      name: user.name || user.email || `User #${user.id}`,
      role: user.role || null,
      active: user.is_active !== false,
      leads_open: open.get(user.id) || 0,
      leads_assigned: assigned.get(user.id) || 0,
      ...counts.get(user.id),
      first_replies: waits.length,
      avg_first_reply_seconds: toSeconds(average(waits)),
      tasks_done: done.get(user.id) || 0,
      tasks_overdue: overdue.get(user.id) || 0,
      last_active_at: lastActive.get(user.id) || null,
    };
  });

  const sum = (key) => members.reduce((total, m) => total + (m[key] || 0), 0);
  const allWaits = members.flatMap((m) => replies.member.get(m.user_id) || []);
  const totals = {
    members: members.length,
    leads_open: sum('leads_open'),
    leads_assigned: sum('leads_assigned'),
    replies: sum('replies'),
    first_replies: allWaits.length,
    avg_first_reply_seconds: toSeconds(average(allWaits)),
    status_changes: sum('status_changes'),
    converted: sum('converted'),
    lost: sum('lost'),
    notes: sum('notes'),
    tasks_done: sum('tasks_done'),
    tasks_overdue: sum('tasks_overdue'),
    last_active_at: members.reduce((latest, m) => (m.last_active_at && (!latest || m.last_active_at > latest) ? m.last_active_at : latest), null),
  };

  return {
    range,
    date_range: { from, to },
    first_reply_lookback_days: FIRST_REPLY_LOOKBACK_DAYS,
    members,
    totals,
    ai: {
      replies: aiReplies,
      handovers,
      first_replies: replies.ai.length,
      avg_first_reply_seconds: toSeconds(average(replies.ai)),
    },
  };
}

module.exports = { build, parseRange, firstReplyWaits, TeamReportError, FIRST_REPLY_LOOKBACK_DAYS };
