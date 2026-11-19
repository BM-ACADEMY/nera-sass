/**
 * "While you slept": what the AI did for a workspace overnight (23:00 to 08:00
 * India time), sent to the owner each morning and shown in the panel.
 *
 *   chats_answered       different conversations the AI replied in
 *   replies_sent         messages the AI sent
 *   appointments_booked  appointments the AI booked (not cancelled since)
 *   handed_to_team       conversations the AI passed to a person
 *
 * Counts come from our own records (ai_reply_logs, appointments), never from
 * the model. A workspace with no activity gets no email. Owners can turn the
 * email off (tenants.overnight_summary_enabled).
 */
const { AiReplyLogs, Appointments, Tenants, Users } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const notify = require('./notify');

const IST_MS = 330 * 60000;
const HOUR_MS = 3600000;
const WINDOW_HOURS = 9; // 23:00 to 08:00

/** The most recent finished night: ends 08:00 IST, starts 9 hours earlier. */
function lastWindow(now = new Date()) {
  const ist = new Date(now.getTime() + IST_MS);
  let endIstMs = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate(), 8, 0, 0);
  if (ist.getTime() < endIstMs) endIstMs -= 24 * HOUR_MS;
  const end = new Date(endIstMs - IST_MS);
  return { start: new Date(end.getTime() - WINDOW_HOURS * HOUR_MS), end };
}

/** Counts for the current tenant context in [start, end). */
async function buildSummary({ start, end }) {
  const inWindow = { $gte: start, $lt: end };
  const [answered, handed, replies, booked] = await Promise.all([
    AiReplyLogs.distinct('conversation_id', { status: 'sent', created_at: inWindow }),
    AiReplyLogs.distinct('conversation_id', { handoff: true, created_at: inWindow }),
    AiReplyLogs.countDocuments({ status: 'sent', created_at: inWindow }),
    Appointments.countDocuments({ created_at: inWindow, source: 'ai_brain', status: { $ne: 'cancelled' } }),
  ]);
  return {
    window: { start, end },
    chats_answered: answered.length,
    replies_sent: replies,
    appointments_booked: booked,
    handed_to_team: handed.length,
  };
}

const hasActivity = (s) => s.chats_answered > 0 || s.appointments_booked > 0 || s.handed_to_team > 0;

function summaryLines(s) {
  const lines = [`Last night, 11 PM to 8 AM, your AI answered ${s.chats_answered} chat${s.chats_answered === 1 ? '' : 's'} (${s.replies_sent} repl${s.replies_sent === 1 ? 'y' : 'ies'}).`];
  if (s.appointments_booked) lines.push(`${s.appointments_booked} appointment${s.appointments_booked === 1 ? ' was' : 's were'} booked.`);
  if (s.handed_to_team) lines.push(`${s.handed_to_team} chat${s.handed_to_team === 1 ? ' was' : 's were'} passed to your team and ${s.handed_to_team === 1 ? 'is' : 'are'} waiting for a person to reply.`);
  return lines;
}

/** Emails the owner of one tenant. Returns 'sent' | 'quiet' | 'off' | 'no_owner'. */
async function sendForTenant(tenant, window) {
  if (tenant.overnight_summary_enabled === false) return 'off';
  return runAsTenant(tenant.id, async () => {
    const summary = await buildSummary(window);
    if (!hasActivity(summary)) return 'quiet';
    let owner = tenant.owner_user_id ? await Users.findOne({ id: tenant.owner_user_id }, { _id: 0, name: 1, email: 1 }).lean() : null;
    if (!owner) owner = await Users.findOne({ role: 'owner', is_active: { $ne: false } }, { _id: 0, name: 1, email: 1 }).sort({ id: 1 }).lean();
    if (!owner?.email) return 'no_owner';
    await notify.customerAlertEmail({
      to: owner.email, ownerName: owner.name, workspaceName: tenant.name,
      title: 'While you slept: what your AI did overnight', lines: summaryLines(summary), path: '/',
    });
    return 'sent';
  });
}

/** Morning job: every active workspace, one failing never stops the rest. */
async function runMorningSummaries(now = new Date()) {
  const window = lastWindow(now);
  const tenants = await runAsSystem(() => Tenants.find({ status: 'active' }, { _id: 0, id: 1, name: 1, owner_user_id: 1, overnight_summary_enabled: 1 }).lean(), 'overnight-summary');
  const result = { sent: 0, quiet: 0, off: 0, no_owner: 0, failed: 0 };
  for (const tenant of tenants) {
    try {
      result[await sendForTenant(tenant, window)] += 1;
    } catch (error) {
      result.failed += 1;
      console.error(`[OvernightSummary] Tenant ${tenant.id} failed:`, error.message);
    }
  }
  return result;
}

module.exports = { lastWindow, buildSummary, hasActivity, summaryLines, sendForTenant, runMorningSummaries };
