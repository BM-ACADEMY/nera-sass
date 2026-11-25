/**
 * Workspace activity log: who in a workspace did what, and when.
 *
 * Staff actions in the customer app are written with log() into the same
 * append-only audit_events collection as every other audited change (see
 * audit.js), with the actor's name and role and a short plain-English summary.
 * list() reads one workspace's events for Settings > Activity (owner/admin)
 * and the admin panel workspace page.
 *
 * Never put secrets, passwords, codes or message text in a summary or meta.
 */
const audit = require('./audit');
const { AuditEvents, Users } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');

const EVENTS = Object.freeze({
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LEAD_CREATED: 'LEAD_CREATED',
  LEAD_UPDATED: 'LEAD_UPDATED',
  LEAD_STATUS_CHANGED: 'LEAD_STATUS_CHANGED',
  LEAD_ASSIGNED: 'LEAD_ASSIGNED',
  LEAD_DELETED: 'LEAD_DELETED',
  LEADS_BULK_ASSIGNED: 'LEADS_BULK_ASSIGNED',
  LEADS_BULK_STATUS_CHANGED: 'LEADS_BULK_STATUS_CHANGED',
  LEADS_EXPORTED: 'LEADS_EXPORTED',
  LEADS_IMPORTED: 'LEADS_IMPORTED',
  MESSAGE_SENT: 'MESSAGE_SENT',
  TEMPLATE_SENT: 'TEMPLATE_SENT',
  CHAT_AI_PAUSED: 'CHAT_AI_PAUSED',
  CHAT_AI_RESUMED: 'CHAT_AI_RESUMED',
  CAMPAIGN_SENT: 'CAMPAIGN_SENT',
  CAMPAIGN_SCHEDULED: 'CAMPAIGN_SCHEDULED',
  CAMPAIGN_UPDATED: 'CAMPAIGN_UPDATED',
  CAMPAIGN_CANCELLED: 'CAMPAIGN_CANCELLED',
  CAMPAIGN_DELETED: 'CAMPAIGN_DELETED',
  CAMPAIGN_RETRIED: 'CAMPAIGN_RETRIED',
  AI_BRAIN_UPDATED: 'AI_BRAIN_UPDATED',
  AI_TURNED_ON: 'AI_TURNED_ON',
  AI_TURNED_OFF: 'AI_TURNED_OFF',
  SALES_TASK_CREATED: 'SALES_TASK_CREATED',
  SALES_TASK_UPDATED: 'SALES_TASK_UPDATED',
  SALES_TASK_COMPLETED: 'SALES_TASK_COMPLETED',
  SALES_TASK_DELETED: 'SALES_TASK_DELETED',
  SALES_STATUS_CHANGED: 'SALES_STATUS_CHANGED',
  SALES_NOTE_ADDED: 'SALES_NOTE_ADDED',
  SALES_TASKS_EXPORTED: 'SALES_TASKS_EXPORTED',
  CALENDAR_SETTINGS_CHANGED: 'CALENDAR_SETTINGS_CHANGED',
});

// Plain-English action names. Unknown events fall back to a readable form of
// the event code, so new events still show up sensibly.
const LABELS = {
  LOGIN_SUCCEEDED: 'Signed in',
  LOGIN_FAILED: 'Sign-in failed',
  LOGIN_FAILED_LOCKOUT: 'Account locked after wrong passwords',
  LEAD_CREATED: 'Added a lead',
  LEAD_UPDATED: 'Edited a lead',
  LEAD_STATUS_CHANGED: 'Changed lead status',
  LEAD_ASSIGNED: 'Assigned a lead',
  LEAD_DELETED: 'Deleted a lead',
  LEADS_BULK_ASSIGNED: 'Assigned leads in bulk',
  LEADS_BULK_STATUS_CHANGED: 'Changed lead status in bulk',
  LEADS_EXPORTED: 'Exported leads',
  LEADS_IMPORTED: 'Imported leads',
  MESSAGE_SENT: 'Sent a WhatsApp message',
  TEMPLATE_SENT: 'Sent a WhatsApp template',
  CHAT_AI_PAUSED: 'Took over a chat from the AI',
  CHAT_AI_RESUMED: 'Handed a chat back to the AI',
  CAMPAIGN_SENT: 'Sent a campaign',
  CAMPAIGN_SCHEDULED: 'Scheduled a campaign',
  CAMPAIGN_UPDATED: 'Changed a campaign',
  CAMPAIGN_CANCELLED: 'Cancelled a campaign',
  CAMPAIGN_DELETED: 'Deleted a campaign',
  CAMPAIGN_RETRIED: 'Restarted a campaign',
  AI_BRAIN_UPDATED: 'Changed the AI Brain',
  AI_TURNED_ON: 'Turned AI replies on',
  AI_TURNED_OFF: 'Turned AI replies off',
  SALES_TASK_CREATED: 'Added a sales task',
  SALES_TASK_UPDATED: 'Updated a sales task',
  SALES_TASK_COMPLETED: 'Completed a sales task',
  SALES_TASK_DELETED: 'Deleted a sales task',
  SALES_STATUS_CHANGED: 'Changed sales status',
  SALES_NOTE_ADDED: 'Added a sales note',
  SALES_TASKS_EXPORTED: 'Exported sales tasks',
  CALENDAR_SETTINGS_CHANGED: 'Changed booking settings',
  // Older audit events that concern a workspace.
  TENANT_UPDATED: 'Changed workspace settings',
  BRAND_UPDATED: 'Changed the brand / WhatsApp profile',
  TOKEN_UPDATED: 'Changed the WhatsApp connection',
  CALENDAR_CONNECTED: 'Connected Google Calendar',
  CALENDAR_DISCONNECTED: 'Disconnected Google Calendar',
  REPLY_WEBHOOK_UPDATED: 'Changed the reply webhook',
  REPLY_WEBHOOK_SECRET_ROTATED: 'Changed the reply webhook secret',
  CONTACT_EXPORTED: 'Exported a contact\'s data',
  WORKSPACE_EXPORTED: 'Exported all workspace data',
  CONTACT_ERASED: 'Erased a contact',
  USER_INVITED: 'Invited a team member',
  INVITATION_REVOKED: 'Cancelled an invitation',
  USER_JOINED: 'Joined the workspace',
  USER_ROLE_CHANGED: 'Changed a team member\'s role',
  USER_DEACTIVATED: 'Deactivated a team member',
  USER_REACTIVATED: 'Reactivated a team member',
  TEAM_MEMBER_ADDED: 'Added a team member',
  TEAM_MEMBER_UPDATED: 'Edited a team member',
  TEAM_MEMBER_ROLE_CHANGED: 'Changed a team member's role',
  TEAM_MEMBER_PASSWORD_RESET: 'Reset a team member's password',
  TEAM_MEMBER_DISABLED: 'Disabled a team member',
  TEAM_MEMBER_ENABLED: 'Enabled a team member',
  TEAM_MEMBER_REMOVED: 'Removed a team member',
  SESSIONS_REVOKED: 'Signed out other devices',
  SESSION_REVOKED: 'Signed out a device',
  PASSWORD_CHANGED: 'Changed password',
  PASSWORD_RESET: 'Reset password',
  MFA_ENROLLED: 'Turned on two-step verification',
  MFA_RESET: 'Two-step verification was reset',
  MFA_METHOD_DISABLED: 'Turned off a two-step method',
  PROFILE_UPDATED: 'Changed own profile',
  TENANT_SUSPENDED: 'Workspace suspended',
  TENANT_REINSTATED: 'Workspace reinstated',
  TENANT_SENDING_PAUSED: 'WhatsApp sending paused',
  TENANT_SENDING_RESUMED: 'WhatsApp sending resumed',
  WALLET_ADJUSTED: 'Wallet adjusted',
  SUBSCRIPTION_GRANTED: 'Plan granted',
  SUBSCRIPTION_EXTENDED: 'Plan extended',
  SUBSCRIPTION_ACTIVATED: 'Plan activated',
  PAYMENT_VERIFIED: 'Payment received',
};

// Filter groups. Team events also match by prefix so team-management events
// added elsewhere (USER_*, INVITATION_*, TEAM_*) are included without a list.
const GROUPS = {
  leads: ['LEAD_CREATED', 'LEAD_UPDATED', 'LEAD_STATUS_CHANGED', 'LEAD_ASSIGNED', 'LEAD_DELETED', 'LEADS_EXPORTED', 'LEADS_IMPORTED',
    'LEADS_BULK_ASSIGNED', 'LEADS_BULK_STATUS_CHANGED', 'SALES_TASK_CREATED', 'SALES_TASK_UPDATED', 'SALES_TASK_COMPLETED', 'SALES_TASK_DELETED', 'SALES_STATUS_CHANGED', 'SALES_NOTE_ADDED', 'SALES_TASKS_EXPORTED',
    'CONTACT_EXPORTED', 'CONTACT_ERASED', 'WORKSPACE_EXPORTED'],
  chat: ['MESSAGE_SENT', 'TEMPLATE_SENT', 'CHAT_AI_PAUSED', 'CHAT_AI_RESUMED'],
  campaigns: ['CAMPAIGN_SENT', 'CAMPAIGN_SCHEDULED', 'CAMPAIGN_UPDATED', 'CAMPAIGN_CANCELLED', 'CAMPAIGN_DELETED', 'CAMPAIGN_RETRIED'],
  settings: ['AI_BRAIN_UPDATED', 'AI_TURNED_ON', 'AI_TURNED_OFF', 'TENANT_UPDATED', 'BRAND_UPDATED', 'TOKEN_UPDATED',
    'CALENDAR_CONNECTED', 'CALENDAR_DISCONNECTED', 'CALENDAR_SETTINGS_CHANGED', 'REPLY_WEBHOOK_UPDATED', 'REPLY_WEBHOOK_SECRET_ROTATED'],
  team: ['USER_INVITED', 'INVITATION_REVOKED', 'USER_JOINED', 'USER_ROLE_CHANGED', 'USER_DEACTIVATED', 'USER_REACTIVATED'],
  security: ['LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGIN_FAILED_LOCKOUT', 'SESSIONS_REVOKED', 'SESSION_REVOKED', 'PASSWORD_CHANGED',
    'PASSWORD_RESET', 'MFA_ENROLLED', 'MFA_RESET', 'MFA_METHOD_DISABLED', 'PROFILE_UPDATED'],
};
const GROUP_PREFIX = { team: /^(USER_|INVITATION_|TEAM_)/ };
const GROUP_NAMES = Object.keys(GROUPS);

// Platform-internal events a workspace never sees in its own log.
const HIDDEN_FROM_CUSTOMER = ['CROSS_TENANT_ACCESS_DENIED', 'TENANT_APPEAL_EXPORTED', 'TENANT_EXPORTED', 'TENANT_DATA_DELETED',
  'TENANT_LIFECYCLE_CHANGED', 'PLATFORM_MAINTENANCE', 'WORKSPACE_LOGIN_LINK_SENT'];

const label = (event) => LABELS[event] || String(event || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
const groupOf = (event) => GROUP_NAMES.find((g) => GROUPS[g].includes(event) || GROUP_PREFIX[g]?.test(event)) || 'other';

/**
 * log(req, event, { targetType, targetId, summary, meta, tenantId, actor })
 * Records one staff action for the signed-in workspace. Calls made by the
 * service key (n8n) are not staff actions and are skipped. Never throws.
 */
async function log(req, event, { targetType = null, targetId = null, summary = null, meta = {}, tenantId, actor } = {}) {
  if (!actor && req?.identity?.kind === 'service') return;
  const tid = tenantId !== undefined ? tenantId : (req?.identity?.tenantId ?? req?.user?.tenant_id ?? null);
  if (tid == null) return;
  await audit.record(event, { tenantId: tid, req, actor, targetType, targetId, summary, meta });
}

// The actor for a sign-in event (there is no session yet).
function actorForUser(user, req) {
  const staff = user.is_platform_staff || (user.tenant_id == null);
  return {
    actor_type: staff ? 'staff' : 'user',
    actor_user_id: user.id ?? null,
    actor_name: user.name || user.email || null,
    actor_role: staff ? (user.staff_role || 'staff') : (user.role || null),
    ip: req?.ip || null,
  };
}

const leadName = (lead) => (lead?.name ? `"${String(lead.name).slice(0, 60)}"` : (lead?.id != null ? `#${lead.id}` : 'a lead'));

// ── Reading ───────────────────────────────────────────────
const DAY_MS = 86400000;
// Date-only filters are whole days in India time (the product's home zone).
function parseDay(value, endOfDay) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const start = new Date(`${text}T00:00:00+05:30`);
    if (Number.isNaN(start.getTime())) return undefined;
    return endOfDay ? new Date(start.getTime() + DAY_MS) : start;
  }
  const at = new Date(text);
  return Number.isNaN(at.getTime()) ? undefined : at;
}

class ActivityQueryError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

function buildFilter(tenantId, query = {}, { audience }) {
  const filter = { tenant_id: Number(tenantId) };
  const and = [];
  if (audience === 'customer') and.push({ event: { $nin: HIDDEN_FROM_CUSTOMER } });
  if (query.user_id !== undefined && query.user_id !== '') {
    const userId = Number(query.user_id);
    if (!Number.isInteger(userId)) throw new ActivityQueryError('Choose a staff member from the list.');
    filter.actor_user_id = userId;
  }
  if (query.group) {
    const group = String(query.group);
    if (!GROUPS[group]) throw new ActivityQueryError(`Unknown group. Use one of: ${GROUP_NAMES.join(', ')}.`);
    and.push(GROUP_PREFIX[group] ? { $or: [{ event: { $in: GROUPS[group] } }, { event: { $regex: GROUP_PREFIX[group] } }] } : { event: { $in: GROUPS[group] } });
  }
  const from = parseDay(query.from, false);
  const to = parseDay(query.to, true);
  if (from === undefined || to === undefined) throw new ActivityQueryError('Enter valid dates.');
  if (from && to && from >= to) throw new ActivityQueryError('The start date must be before the end date.');
  if (from || to) filter.created_at = { ...(from ? { $gte: from } : {}), ...(to ? { $lt: to } : {}) };
  if (and.length) filter.$and = and;
  return filter;
}

/**
 * list(tenantId, query, { audience: 'customer' | 'admin' })
 * query: user_id, group, from, to (YYYY-MM-DD or ISO), page (1+), limit (≤100).
 * Customer reads run in the workspace's own tenant context; admin reads as system
 * with an explicit tenant filter. Platform staff names are shown to customers
 * as "Getnera team".
 */
async function list(tenantId, query = {}, { audience = 'customer' } = {}) {
  const filter = buildFilter(tenantId, query, { audience });
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || 25, 1), 100);
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const run = audience === 'customer'
    ? (fn) => runAsTenant(Number(tenantId), fn)
    : (fn) => runAsSystem(fn, 'activity');
  const [rows, total] = await run(() => Promise.all([
    AuditEvents.find(filter, { _id: 0, ip: 0 }).sort({ created_at: -1, id: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    AuditEvents.countDocuments(filter),
  ]));
  // Names for events written before names were stored, and the staff list
  // for the filter (every login of this workspace).
  const ids = [...new Set(rows.filter((r) => !r.actor_name && r.actor_user_id != null).map((r) => r.actor_user_id))];
  const [people, staff] = await runAsSystem(() => Promise.all([
    ids.length ? Users.find({ id: { $in: ids } }, { _id: 0, id: 1, name: 1, email: 1 }).lean() : [],
    Users.find({ tenant_id: Number(tenantId) }, { _id: 0, id: 1, name: 1, email: 1, role: 1, is_active: 1 }).sort({ name: 1 }).lean(),
  ]), 'activity');
  const nameOf = new Map(people.map((u) => [u.id, u.name || u.email]));
  const events = rows.map((row) => {
    const platform = row.actor_type === 'staff';
    let actorName = row.actor_name || nameOf.get(row.actor_user_id) || null;
    if (platform && audience === 'customer') actorName = 'Getnera team';
    if (!actorName) actorName = row.actor_type === 'system' || row.actor_type === 'service' ? 'System' : 'Unknown';
    return {
      id: row.id,
      at: row.created_at,
      event: row.event,
      group: groupOf(row.event),
      action: label(row.event),
      details: row.summary || null,
      actor: {
        id: platform && audience === 'customer' ? null : (row.actor_user_id ?? null),
        name: actorName,
        role: platform && audience === 'customer' ? null : (row.actor_role || null),
        type: row.actor_type || 'system',
      },
      target_type: row.target_type || null,
      target_id: row.target_id || null,
      changes: Array.isArray(row.meta?.fields) ? row.meta.fields : null,
      ...(audience === 'admin' ? { meta: row.meta || {} } : {}),
    };
  });
  return {
    events,
    page,
    limit,
    total,
    pages: Math.max(Math.ceil(total / limit), 1),
    groups: GROUP_NAMES,
    staff: staff.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role || null, active: u.is_active !== false })),
  };
}

module.exports = {
  EVENTS, GROUPS, GROUP_NAMES, LABELS, HIDDEN_FROM_CUSTOMER, ActivityQueryError,
  log, list, label, groupOf, actorForUser, leadName, buildFilter,
};
