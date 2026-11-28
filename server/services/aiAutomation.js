/**
 * Server-side rules for the n8n AI workflows (WF1 reply, WF2 welcome,
 * WF3 follow-up, WF4 handover). n8n only drafts and calls back; every check
 * that protects a customer (paused AI, opt-out, hourly cap, quiet hours,
 * follow-up schedule) lives here so a workflow mistake cannot bypass it.
 * All functions run inside the caller's tenant context.
 */
const { Leads, Messages, Users } = require('../models');
const { tenantCanSend, tenantLifecycle } = require('./lifecycle');
const { currentTenantId } = require('./tenantContext');

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Follow-up 1 on day 2 after the customer went quiet, 2 on day 5, 3 on day 10.
const FOLLOWUP_GAP_DAYS = [2, 3, 5];
const MAX_FOLLOWUP_STEPS = FOLLOWUP_GAP_DAYS.length;
// Optional per-workspace schedule (tenant.ai_followup_plan). Unset = the 2/3/5-day
// plan above. 'quick': nudge 1 two hours after the customer's last message,
// nudge 2 the next morning at 09:30 (never after the 24-hour window closes),
// and, only when tenant.ai_followup_template_after_window === true, one
// approved template after the window. Never more than 3 messages, 2 free text.
const QUICK = { first_delay_ms: 2 * HOUR_MS, morning: [9, 30], max_nudges: 2 };
const planOf = (tenant) => (tenant?.ai_followup_plan === 'quick' ? 'quick' : 'default');
const templateAfterWindow = (tenant) => tenant?.ai_followup_template_after_window === true;
const maxStepsFor = (tenant) => (planOf(tenant) === 'quick' ? QUICK.max_nudges + (templateAfterWindow(tenant) ? 1 : 0) : MAX_FOLLOWUP_STEPS);
const CLOSED_STATUSES = ['converted', 'lost', 'closed', 'opt-out', 'opted_out'];

const hourlyCap = () => Number(process.env.AI_REPLIES_PER_TENANT_HOUR || 200);

// Seconds the server waits for more customer messages before asking n8n.
// How long to wait after a customer message before asking the AI, so a burst
// of quick messages gets one reply. Short by default: replies should feel live.
function replyDelayMs(tenant) {
  const seconds = Number(tenant?.ai_reply_delay_seconds ?? process.env.AI_REPLY_DELAY_SECONDS ?? 3);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 3, 0), 600) * 1000;
}

// Hour of day (0-23) in the workspace's time zone.
function localHour(tenant, date = new Date()) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tenant?.timezone || 'Asia/Kolkata' }).format(date));
  } catch {
    return date.getUTCHours();
  }
}

// Follow-ups go out only inside AI_SENDING_HOURS local time ("9-21" = 9:00 to 20:59).
const inSendingHours = (tenant, date = new Date()) => {
  const [from, to] = String(process.env.AI_SENDING_HOURS || '9-21').split('-').map(Number);
  const hour = localHour(tenant, date);
  return hour >= (Number.isFinite(from) ? from : 9) && hour < (Number.isFinite(to) ? to : 21);
};

const optedOut = (lead) => Boolean(lead?.opted_out || lead?.whatsapp_opt_out);

/** Why the AI must not answer this lead now, or null when it may. */
async function aiBlockReason(tenant, lead) {
  if (!(await tenantCanSend(tenant.id))) return 'workspace cannot send';
  if (tenant.ai_enabled === false) return 'AI is turned off for this workspace';
  if (lead.ai_paused) return 'AI paused for this chat';
  if (optedOut(lead)) return 'customer opted out';
  const since = new Date(Date.now() - HOUR_MS);
  const sentLastHour = await Messages.countDocuments({ direction: 'outbound', is_ai: true, sent_at: { $gte: since } });
  if (sentLastHour >= hourlyCap()) return 'hourly AI limit reached';
  return null;
}

// Offset (ms) of the workspace time zone from UTC at an instant.
function tzOffsetMs(tenant, date) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tenant?.timezone || 'Asia/Kolkata', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(date).map((p) => [p.type, Number(p.value)]));
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - Math.floor(date.getTime() / 1000) * 1000;
  } catch {
    return 0;
  }
}

// The instant of hh:mm local time on the calendar day after `date`'s local day.
function nextMorning(tenant, date, [hh, mm]) {
  const local = new Date(date.getTime() + tzOffsetMs(tenant, date));
  const guess = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + 1, hh, mm);
  const first = guess - tzOffsetMs(tenant, new Date(guess));
  return new Date(guess - tzOffsetMs(tenant, new Date(first)));
}

/**
 * 'quick' plan, nudge 2: tomorrow 09:30 while that is inside the 24-hour window
 * of the customer's last message; otherwise 30 minutes before the window closes,
 * or the last sending-hours moment before that. Never outside sending hours and
 * never after the window closes. Not earlier than `now`.
 */
function quickSecondNudgeAt(tenant, now, lastInboundAt) {
  const windowEnd = new Date(lastInboundAt).getTime() + DAY_MS;
  const morning = nextMorning(tenant, now, QUICK.morning);
  if (morning.getTime() < windowEnd) return morning;
  let at = windowEnd - 30 * 60 * 1000;
  for (let i = 0; i < 24 * 60 && !inSendingHours(tenant, new Date(at)); i += 1) at -= 60 * 1000;
  return new Date(Math.max(at, now.getTime()));
}

async function loadTenant() {
  const id = currentTenantId();
  return id ? (await tenantLifecycle(id)).tenant : null;
}

/**
 * 'quick' plan: a customer who got a nudge and answered goes to a telecaller.
 * Never overwrites an assignee and never reaches into another workspace.
 * Order: a team member with role "telecaller" (fewest leads first), then
 * tenant.followup_assignee_user_id; with neither the chat is flagged needs_human.
 */
async function assignTelecaller(tenant, leadId) {
  const lead = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, tenant_id: 1, assigned_to: 1, needs_human: 1 }).lean();
  if (!lead || lead.assigned_to != null || lead.tenant_id !== tenant.id) return null;
  const members = await Users.find({ tenant_id: tenant.id, role: 'telecaller', is_active: { $ne: false } }, { _id: 0, id: 1 }).sort({ id: 1 }).lean();
  let pick = null;
  if (members.length) {
    let best = Infinity;
    for (const m of members) {
      const load = await Leads.countDocuments({ assigned_to: m.id });
      if (load < best) { best = load; pick = m.id; }
    }
  } else if (tenant.followup_assignee_user_id != null) {
    const user = await Users.findOne({ id: Number(tenant.followup_assignee_user_id), tenant_id: tenant.id, is_active: { $ne: false } }, { _id: 0, id: 1 }).lean();
    pick = user ? user.id : null;
  }
  if (pick == null) {
    if (!lead.needs_human) {
      await Leads.updateOne({ id: lead.id, assigned_to: null }, { $set: { needs_human: true, handover_reason: 'Replied to a follow-up; no telecaller set up', handover_at: new Date(), updated_at: new Date() } });
    }
    return null;
  }
  const done = await Leads.updateOne({ id: lead.id, assigned_to: null }, { $set: { assigned_to: pick, updated_at: new Date() } });
  return done.modifiedCount === 1 ? pick : null;
}

/** A customer wrote: restart the follow-up schedule from now. */
async function recordInbound(leadId, at = new Date()) {
  // A date the customer gave ("I'll contact you on Monday") is kept while it
  // is still ahead; the normal 2/3/5-day schedule applies otherwise.
  const lead = await Leads.findOne({ id: leadId }, { _id: 0, ai_followup_promised_for: 1, ai_followup_step: 1 }).lean();
  const tenant = await loadTenant();
  const quick = planOf(tenant) === 'quick';
  const firstDelay = quick ? QUICK.first_delay_ms : FOLLOWUP_GAP_DAYS[0] * DAY_MS;
  const promised = lead?.ai_followup_promised_for ? new Date(lead.ai_followup_promised_for) : null;
  const keep = promised && promised.getTime() > at.getTime();
  await Leads.updateOne({ id: leadId }, {
    $set: { last_inbound_at: at, ai_followup_step: 0, ai_followup_due: keep ? promised : new Date(at.getTime() + firstDelay) },
    ...(keep ? {} : { $unset: { ai_followup_promised_for: '' } }),
  });
  if (quick && Number(lead?.ai_followup_step || 0) >= 1) {
    try { await assignTelecaller(tenant, leadId); } catch (err) { console.error('[followup] telecaller assignment failed:', err.message); }
  }
}

/** The customer named a day to come back: follow up then, instead of day 2. */
async function setPromisedFollowup(leadId, at) {
  const result = await Leads.updateOne({ id: Number(leadId) }, {
    $set: { ai_followup_step: 0, ai_followup_due: at, ai_followup_promised_for: at },
  });
  return result.matchedCount === 1;
}

/**
 * Hands a chat to a person.
 *   pause  (default) a person is told; AI stops only with AI_HANDOVER_PAUSES=true
 *   notify a person is told, AI keeps working (technical failures)
 *   hot    hot-lead alert, sent once per lead
 * Returns { notified } so callers know whether anything was raised.
 */
async function handover(io, { leadId, reason, draft, mode = 'pause' }) {
  const lead = await Leads.findOne({ id: Number(leadId) }, { _id: 0, id: 1, hot_notified_at: 1 }).lean();
  if (!lead) return null;
  const now = new Date();
  const text = String(reason || 'Needs a person').slice(0, 300);
  if (mode === 'hot') {
    const claimed = await Leads.updateOne({ id: lead.id, hot_notified_at: null }, { $set: { hot_notified_at: now } });
    if (claimed.modifiedCount !== 1) return { notified: false };
    io.emit('lead_handover', { lead_id: String(lead.id), reason: text, mode });
    return { notified: true };
  }
  const set = { needs_human: true, handover_reason: text, handover_at: now, updated_at: now };
  if (draft) set.ai_draft = String(draft).slice(0, 2000);
  // A handover tells the team and the AI keeps answering, unless
  // AI_HANDOVER_PAUSES=true. A person can still pause a chat by hand.
  const pauses = mode !== 'notify' && process.env.AI_HANDOVER_PAUSES === 'true';
  if (pauses) Object.assign(set, { ai_paused: true, ai_paused_at: now });
  await Leads.updateOne({ id: lead.id }, { $set: set });
  io.emit('ai_typing', { lead_id: String(lead.id), typing: false });
  io.emit('lead_handover', { lead_id: String(lead.id), reason: text, mode, paused: pauses });
  return { notified: true };
}

/** A person takes back the chat or hands it back to the AI. */
async function setAiPaused(leadId, paused) {
  const set = paused
    ? { ai_paused: true, ai_paused_at: new Date() }
    : { ai_paused: false, needs_human: false, ai_draft: null, handover_reason: null };
  const result = await Leads.updateOne({ id: Number(leadId) }, { $set: { ...set, updated_at: new Date() } });
  return result.matchedCount === 1;
}

/** After follow-up `step` went out: schedule the next one, or stop after the last. */
async function markFollowupSent(leadId, step) {
  const s = Number(step);
  const lead = await Leads.findOne({ id: Number(leadId) }, { _id: 0, last_inbound_at: 1 }).lean();
  const tenant = lead ? await loadTenant() : null;
  if (planOf(tenant) === 'quick') {
    if (!Number.isInteger(s) || s < 1 || s > maxStepsFor(tenant)) return false;
    const now = new Date();
    const inbound = lead.last_inbound_at ? new Date(lead.last_inbound_at) : now;
    let due = null;
    if (s === 1) due = quickSecondNudgeAt(tenant, now, inbound);
    else if (s === 2 && templateAfterWindow(tenant)) due = new Date(Math.max(inbound.getTime() + DAY_MS + 60 * 1000, now.getTime()));
    const result = await Leads.updateOne({ id: Number(leadId) }, {
      $set: { ai_followup_step: s, ai_followup_due: due, last_followup: now },
      $unset: { ai_followup_promised_for: '' },
    });
    return result.matchedCount === 1;
  }
  if (!Number.isInteger(s) || s < 1 || s > MAX_FOLLOWUP_STEPS) return false;
  const gap = FOLLOWUP_GAP_DAYS[s];
  const result = await Leads.updateOne({ id: Number(leadId) }, {
    $set: { ai_followup_step: s, ai_followup_due: gap ? new Date(Date.now() + gap * DAY_MS) : null, last_followup: new Date() },
    $unset: { ai_followup_promised_for: '' },
  });
  return result.matchedCount === 1;
}

module.exports = {
  FOLLOWUP_GAP_DAYS,
  MAX_FOLLOWUP_STEPS,
  QUICK,
  planOf,
  templateAfterWindow,
  maxStepsFor,
  quickSecondNudgeAt,
  assignTelecaller,
  CLOSED_STATUSES,
  DAY_MS,
  HOUR_MS,
  replyDelayMs,
  inSendingHours,
  optedOut,
  aiBlockReason,
  recordInbound,
  setPromisedFollowup,
  handover,
  setAiPaused,
  markFollowupSent,
};
