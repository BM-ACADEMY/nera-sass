/**
 * LeadOS routes: customer Dashboard (client/src/views/Dashboard.jsx).
 *
 *   GET /api/dashboard/attention   "Needs attention now" counts (+ "My day" for agents)
 *   GET /api/dashboard/overview    ?range=7d|30d|90d&client_id=  converted + lead sources in range
 *
 * Every query runs in the caller's tenant (auth -> runAsTenant, db/tenantScope).
 * Only data the app already stores is read; nothing new is tracked.
 *
 * Who sees what (attention):
 *   owner / admin / manager   the whole workspace
 *   agent                     leads (and tasks) assigned to them, plus unassigned ones
 *
 * Definitions (attention):
 *   unanswered     a chat whose latest message is from the customer, sent more
 *                  than UNANSWERED_AFTER_MIN minutes ago and less than 24 h ago
 *                  (still inside WhatsApp's reply window). Any reply - by a
 *                  person, the AI or a template - answers it. Counted per lead.
 *   hot_no_reply   leads with status "hot" whose latest message is from the
 *                  customer (nothing sent after their last message).
 *   handovers      leads the AI handed to a person (needs_human, set by
 *                  services/aiAutomation.handover) that are still open and that
 *                  no team member has messaged since the handover (activity log
 *                  MESSAGE_SENT / TEMPLATE_SENT). "Resume AI" clears needs_human.
 *   overdue_tasks  open sales tasks shown on the Sales Tasks page whose due time
 *                  has passed (same rules as GET /api/sales-tasks).
 *
 * My day (agents only): open leads assigned to me, messages and templates I sent
 * today (activity log), and my open tasks due today (workspace time zone).
 */
const models = require('../../models');
const { leadSourceKind } = require('../../services/leadSources');
const { CLOSED_STATUSES } = require('../../services/aiAutomation');
const { requireSection } = require('../../services/permissions');

const UNANSWERED_AFTER_MIN = 15;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const FULL_VIEW_ROLES = ['owner', 'admin'];
const AUTO_TASK_TYPES = ['call', 'hot_lead', 'followup', 'overdue'];
const SENT_EVENTS = ['MESSAGE_SENT', 'TEMPLATE_SENT'];
const DEFAULT_TIME_ZONE = 'Asia/Kolkata';
const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90 };
const lower = (value) => String(value ?? '').toLowerCase();

// null = whole workspace; otherwise the user id whose own + unassigned work is counted.
const scopeUserId = (user) => (FULL_VIEW_ROLES.includes(user?.role) ? null : user?.id ?? -1);
const leadScope = (me) => (me == null ? {} : { assigned_to: { $in: [me, null] } });
const inScope = (me, assignee) => me == null || assignee == null || assignee === me;

function timeZoneOf(req) {
  const zone = req.tenant?.timezone || DEFAULT_TIME_ZONE;
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone; } catch { return DEFAULT_TIME_ZONE; }
}

// Start and end (UTC Dates) of the day `now` falls on, on the workspace clock.
function zoneDay(now, timeZone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const wallNow = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  const offset = wallNow - Math.floor(now.getTime() / 1000) * 1000;
  const start = new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day)) - offset);
  return { start, end: new Date(start.getTime() + WINDOW_MS) };
}

// Latest message per conversation: { conversationId -> { direction, at } }.
async function latestByConversation(match) {
  const rows = await models.Messages.aggregate([
    { $match: { ...match, is_deleted: { $ne: true }, direction: { $in: ['inbound', 'outbound'] } } },
    { $sort: { sent_at: -1 } },
    { $group: { _id: '$conversation_id', direction: { $first: '$direction' }, at: { $first: '$sent_at' } } },
  ]);
  return new Map(rows.map((row) => [row._id, row]));
}

async function unansweredChats(me, now) {
  const latest = await latestByConversation({ sent_at: { $gte: new Date(now - WINDOW_MS) } });
  const cutoff = now - UNANSWERED_AFTER_MIN * 60 * 1000;
  const waiting = [...latest.values()].filter((row) => row.direction === 'inbound' && new Date(row.at).getTime() <= cutoff);
  if (!waiting.length) return { count: 0, oldest_at: null, oldest_lead_id: null, after_minutes: UNANSWERED_AFTER_MIN };
  const conversations = await models.Conversations.find({ id: { $in: waiting.map((row) => row._id) }, lead_id: { $ne: null } }, { _id: 0, id: 1, lead_id: 1 }).lean();
  const leads = new Set((await models.Leads.find({ id: { $in: conversations.map((c) => c.lead_id) }, ...leadScope(me) }, { _id: 0, id: 1 }).lean()).map((l) => l.id));
  const leadOf = new Map(conversations.map((c) => [c.id, c.lead_id]));
  const oldestPerLead = new Map();
  for (const row of waiting) {
    const leadId = leadOf.get(row._id);
    if (!leads.has(leadId)) continue;
    const at = new Date(row.at);
    if (!oldestPerLead.has(leadId) || at < oldestPerLead.get(leadId)) oldestPerLead.set(leadId, at);
  }
  let oldest = null;
  for (const [leadId, at] of oldestPerLead) if (!oldest || at < oldest.at) oldest = { leadId, at };
  return { count: oldestPerLead.size, oldest_at: oldest?.at ?? null, oldest_lead_id: oldest?.leadId ?? null, after_minutes: UNANSWERED_AFTER_MIN };
}

async function hotLeadsWithoutReply(me) {
  const hot = await models.Leads.find({ status: 'hot', ...leadScope(me) }, { _id: 0, id: 1 }).lean();
  if (!hot.length) return { count: 0 };
  const conversations = await models.Conversations.find({ lead_id: { $in: hot.map((l) => l.id) } }, { _id: 0, id: 1, lead_id: 1 }).lean();
  if (!conversations.length) return { count: 0 };
  const latest = await latestByConversation({ conversation_id: { $in: conversations.map((c) => c.id) } });
  const lastPerLead = new Map();
  for (const conversation of conversations) {
    const row = latest.get(conversation.id);
    if (!row) continue;
    const current = lastPerLead.get(conversation.lead_id);
    if (!current || new Date(row.at) > new Date(current.at)) lastPerLead.set(conversation.lead_id, row);
  }
  return { count: [...lastPerLead.values()].filter((row) => row.direction === 'inbound').length };
}

async function waitingHandovers(me) {
  const flagged = await models.Leads.find(
    { needs_human: true, status: { $nin: CLOSED_STATUSES }, ...leadScope(me) },
    { _id: 0, id: 1, handover_at: 1 }
  ).lean();
  if (!flagged.length) return { count: 0, oldest_at: null, oldest_lead_id: null };
  const earliest = flagged.reduce((min, l) => (l.handover_at && (!min || l.handover_at < min) ? l.handover_at : min), null);
  const sends = await models.AuditEvents.find({
    event: { $in: SENT_EVENTS }, target_type: 'lead', target_id: { $in: flagged.map((l) => String(l.id)) },
    actor_user_id: { $ne: null }, ...(earliest ? { created_at: { $gte: earliest } } : {}),
  }, { _id: 0, target_id: 1, created_at: 1 }).lean();
  const lastSend = new Map();
  for (const send of sends) {
    const at = new Date(send.created_at);
    if (!lastSend.has(send.target_id) || at > lastSend.get(send.target_id)) lastSend.set(send.target_id, at);
  }
  const waiting = flagged.filter((lead) => {
    const sent = lastSend.get(String(lead.id));
    return !sent || (lead.handover_at && sent < new Date(lead.handover_at));
  });
  const oldest = waiting.filter((l) => l.handover_at).sort((a, b) => new Date(a.handover_at) - new Date(b.handover_at))[0];
  return { count: waiting.length, oldest_at: oldest?.handover_at ?? null, oldest_lead_id: oldest?.id ?? waiting[0]?.id ?? null };
}

// Open tasks the Sales Tasks page shows (routes/salesos.js GET /sales-tasks),
// with their effective due time and assignee.
async function openTasks(dueBefore) {
  const tasks = await models.SalesTasks.find({
    deleted_at: null, status: { $ne: 'completed' },
    $or: [{ due_at: { $lt: dueBefore } }, { due_at: null, task_type: { $in: ['call', 'followup', 'overdue'] } }],
  }, { _id: 0, id: 1, lead_id: 1, task_type: 1, due_at: 1, assigned_to: 1 }).lean();
  const leadIds = [...new Set(tasks.map((t) => t.lead_id).filter((id) => id != null))];
  const leads = new Map((await models.Leads.find({ id: { $in: leadIds } }, {
    _id: 0, id: 1, status: 1, assigned_to: 1, call_booked_at: 1, next_followup_due: 1, sales_status: 1, sales_followup_stopped: 1,
  }).lean()).map((l) => [l.id, l]));
  const out = [];
  for (const task of tasks) {
    const lead = task.lead_id == null ? null : leads.get(task.lead_id);
    if (task.lead_id != null && !lead) continue;
    if (AUTO_TASK_TYPES.includes(task.task_type)) {
      if (!lead || lead.sales_followup_stopped === true) continue;
      if (['converted', 'closed', 'not_interested'].includes(lower(lead.sales_status ?? 'new'))) continue;
      const status = lower(lead.status);
      const shown = (task.task_type === 'call' && lead.call_booked_at != null && status === 'booked')
        || (task.task_type === 'hot_lead' && status === 'hot')
        || (['followup', 'overdue'].includes(task.task_type) && lead.next_followup_due != null && !['converted', 'booked', 'lost', 'opt-out'].includes(status));
      if (!shown) continue;
    }
    const derived = task.task_type === 'call' ? lead?.call_booked_at
      : ['followup', 'overdue'].includes(task.task_type) ? lead?.next_followup_due : null;
    const due = task.due_at ?? derived ?? null;
    if (!due) continue;
    out.push({ id: task.id, due: new Date(due), assigned_to: task.assigned_to ?? lead?.assigned_to ?? null });
  }
  return out;
}

async function myDay(userId, tasks, today) {
  const [openLeads, replies] = await Promise.all([
    models.Leads.countDocuments({ assigned_to: userId, status: { $nin: CLOSED_STATUSES } }),
    models.AuditEvents.countDocuments({ event: { $in: SENT_EVENTS }, actor_user_id: userId, created_at: { $gte: today.start, $lt: today.end } }),
  ]);
  const dueToday = tasks.filter((t) => t.assigned_to === userId && t.due >= today.start && t.due < today.end).length;
  return { open_leads: openLeads, replies_today: replies, tasks_due_today: dueToday };
}

module.exports = function registerDashboardRoutes(app, ctx) {
const { auth } = ctx;

app.get('/api/dashboard/attention', auth, requireSection('dashboard'), async (req, res) => {
  try {
    const now = new Date();
    const me = scopeUserId(req.user);
    const today = zoneDay(now, timeZoneOf(req));
    const [unanswered, hotNoReply, handovers, tasks] = await Promise.all([
      unansweredChats(me, now.getTime()),
      hotLeadsWithoutReply(me),
      waitingHandovers(me),
      openTasks(today.end),
    ]);
    const mine = tasks.filter((t) => inScope(me, t.assigned_to));
    res.json({
      scope: me == null ? 'all' : 'mine',
      generated_at: now,
      unanswered,
      hot_no_reply: hotNoReply,
      handovers,
      overdue_tasks: { count: mine.filter((t) => t.due < now).length },
      ...(me == null ? {} : { my_day: await myDay(me, tasks, today) }),
    });
  } catch (err) {
    console.error('Dashboard attention error:', err.message);
    res.status(500).json({ error: 'Could not load what needs attention. Please try again.' });
  }
});

// Converted leads and lead sources for the Dashboard's date range (the last N
// days including today, like the Lead acquisition chart). Sources use the
// Leads page kinds (services/leadSources.js); "Campaign upload" leads, which
// the Leads page files under Manual, are shown on their own as "campaign".
app.get('/api/dashboard/overview', auth, requireSection('dashboard'), async (req, res) => {
  try {
    const range = RANGE_DAYS[req.query.range] ? req.query.range : '30d';
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RANGE_DAYS[range] - 1));
    const clientId = Number(req.query.client_id);
    const brand = Number.isInteger(clientId) && clientId > 0 ? { client_id: clientId } : {};
    const [converted, rows] = await Promise.all([
      models.Leads.countDocuments({ ...brand, status: 'converted', updated_at: { $gte: from } }),
      models.Leads.aggregate([
        { $match: { ...brand, created_at: { $gte: from } } },
        { $group: {
          _id: {
            source: '$source',
            ad: { $not: [{ $in: [{ $ifNull: ['$ad_id', ''] }, ['']] }] },
            form: { $or: ['leadgen_id', 'meta_lead_id', 'lead_ad_form_id'].map((f) => ({ $not: [{ $in: [{ $ifNull: [`$${f}`, ''] }, ['']] }] })) },
          },
          count: { $sum: 1 },
        } },
      ]),
    ]);
    const byKind = new Map();
    for (const row of rows) {
      const { source, ad, form } = row._id;
      let kind = leadSourceKind({ source, ad_id: ad ? 'ad' : null, leadgen_id: form ? 'form' : null });
      if (kind === 'manual' && /^\s*campaign/i.test(String(source || ''))) kind = 'campaign';
      byKind.set(kind, (byKind.get(kind) || 0) + row.count);
    }
    const sources = [...byKind].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count);
    res.json({ range, from, converted, total_leads: sources.reduce((sum, s) => sum + s.count, 0), sources });
  } catch (err) {
    console.error('Dashboard overview error:', err.message);
    res.status(500).json({ error: 'Could not load the dashboard. Please try again.' });
  }
});
};
