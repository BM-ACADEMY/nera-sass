/**
 * Server-side rules for the n8n AI workflows (WF1 reply, WF2 welcome,
 * WF3 follow-up, WF4 handover). n8n only drafts and calls back; every check
 * that protects a customer (paused AI, opt-out, hourly cap, quiet hours,
 * follow-up schedule) lives here so a workflow mistake cannot bypass it.
 * All functions run inside the caller's tenant context.
 */
const { Leads, Messages } = require('../models');
const { tenantCanSend } = require('./lifecycle');

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Follow-up 1 on day 2 after the customer went quiet, 2 on day 5, 3 on day 10.
const FOLLOWUP_GAP_DAYS = [2, 3, 5];
const MAX_FOLLOWUP_STEPS = FOLLOWUP_GAP_DAYS.length;
const CLOSED_STATUSES = ['converted', 'lost', 'closed', 'opt-out', 'opted_out'];

const hourlyCap = () => Number(process.env.AI_REPLIES_PER_TENANT_HOUR || 200);

// Seconds the server waits for more customer messages before asking n8n.
function replyDelayMs(tenant) {
  const seconds = Number(tenant?.ai_reply_delay_seconds ?? process.env.AI_REPLY_DELAY_SECONDS ?? 60);
  return Math.min(Math.max(Number.isFinite(seconds) ? seconds : 60, 0), 600) * 1000;
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

/** A customer wrote: restart the follow-up schedule from now. */
async function recordInbound(leadId, at = new Date()) {
  await Leads.updateOne({ id: leadId }, {
    $set: { last_inbound_at: at, ai_followup_step: 0, ai_followup_due: new Date(at.getTime() + FOLLOWUP_GAP_DAYS[0] * DAY_MS) },
  });
}

/**
 * Hands a chat to a person.
 *   pause  (default) AI stops replying to this lead until a person resumes it
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
  if (mode !== 'notify') Object.assign(set, { ai_paused: true, ai_paused_at: now });
  await Leads.updateOne({ id: lead.id }, { $set: set });
  io.emit('ai_typing', { lead_id: String(lead.id), typing: false });
  io.emit('lead_handover', { lead_id: String(lead.id), reason: text, mode, paused: mode !== 'notify' });
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
  if (!Number.isInteger(s) || s < 1 || s > MAX_FOLLOWUP_STEPS) return false;
  const gap = FOLLOWUP_GAP_DAYS[s];
  const result = await Leads.updateOne({ id: Number(leadId) }, {
    $set: { ai_followup_step: s, ai_followup_due: gap ? new Date(Date.now() + gap * DAY_MS) : null, last_followup: new Date() },
  });
  return result.matchedCount === 1;
}

module.exports = {
  FOLLOWUP_GAP_DAYS,
  MAX_FOLLOWUP_STEPS,
  CLOSED_STATUSES,
  DAY_MS,
  HOUR_MS,
  replyDelayMs,
  inSendingHours,
  optedOut,
  aiBlockReason,
  recordInbound,
  handover,
  setAiPaused,
  markFollowupSent,
};
