const axios = require('axios');
const {
  AllianceInboxSettings,
  AllianceInboxConversations,
  AllianceInboxContacts,
  AllianceInboxMessages,
  AllianceProspects,
  AllianceWhatsappCampaignRecipients,
  AllianceWhatsappCampaigns,
} = require('../models');
const ensureAllianceSchema = require('../db/alliance-schema');
const openRouter = require('./openrouter');
const { getAllianceBrainContext } = require('./alliance-brain-context');
const { getAlliancePromptRules } = require('./alliance-prompt-rules');
const { getAllianceLeadMemory, saveAllianceLeadMemory } = require('./alliance-lead-memory');

let interval;
let processing = false;

const ENABLED = String(process.env.ALLIANCE_AI_NUDGE_ENABLED || '').toLowerCase() === 'true';
// WhatsApp only allows free-form text within 24h of the contact's last reply, so a nudge
// is only attempted while that session window is still open. There is no fixed quiet
// window here: each contact's threshold comes from their own campaign's "first reminder
// after" setting (alliance_whatsapp_campaigns.followup_delay_minutes/_days) — the exact
// same delay already used for that campaign's template-based follow-up.
const MAX_NUDGES = Math.max(Number(process.env.ALLIANCE_AI_NUDGE_MAX) || 2, 0);
const POLL_SECONDS = Math.max(Number(process.env.ALLIANCE_AI_NUDGE_POLL_SECONDS) || 60, 15);

async function configuredSender() {
  const settings = await AllianceInboxSettings.findOne({ active: true }).sort({ id: 1 }).lean();
  if (settings) return settings;
  return process.env.ALLIANCE_WA_PHONE_NUMBER_ID
    ? { phone_number_id: process.env.ALLIANCE_WA_PHONE_NUMBER_ID, access_token_env: 'ALLIANCE_WA_ACCESS_TOKEN' }
    : null;
}

// Claims (and immediately marks) one quiet, previously-replied conversation that hasn't
// been nudged since its latest inbound message, so a slow AI+send call never double-fires.
// The quiet threshold itself is per-contact: whatever "first reminder after" delay is set
// on the most recent WhatsApp campaign that messaged this prospect.
// Delay (minutes) of the most recent WhatsApp campaign that messaged this prospect.
async function campaignDelayMinutes(prospectId) {
  const recipients = await AllianceWhatsappCampaignRecipients.find({ prospect_id: prospectId }, { campaign_id: 1, sent_at: 1, created_at: 1 }).lean();
  const latest = recipients.sort((a, b) => new Date(b.sent_at || b.created_at || 0) - new Date(a.sent_at || a.created_at || 0))[0];
  if (!latest) return null;
  const campaign = await AllianceWhatsappCampaigns.findOne({ id: latest.campaign_id }, { followup_delay_minutes: 1, followup_delay_days: 1 }).lean();
  if (!campaign) return null;
  return Math.trunc(Number(campaign.followup_delay_minutes) || Math.max(Number(campaign.followup_delay_days ?? 4), 1) * 1440);
}

async function claimDueNudge() {
  const now = Date.now();
  const candidates = await AllianceInboxConversations.find({
    last_inbound_at: { $ne: null, $gt: new Date(now - 24 * 60 * 60 * 1000) },
    ai_nudge_count: { $lt: MAX_NUDGES },
    $or: [{ last_ai_nudge_at: null }, { $expr: { $lt: ['$last_ai_nudge_at', '$last_inbound_at'] } }],
  }).sort({ last_inbound_at: 1 }).lean();

  for (const cv of candidates) {
    const ic = await AllianceInboxContacts.findOne({ id: cv.contact_id }).lean();
    if (!ic || ic.prospect_id === null || ic.prospect_id === undefined) continue;
    const p = await AllianceProspects.findOne({ id: ic.prospect_id }, { audience: 1, business_name: 1, status: 1, suppressed: 1 }).lean();
    if (p && p.status && ['converted', 'closed', 'not_interested', 'unsubscribed'].includes(p.status)) continue;
    if (p && p.suppressed === true) continue;
    const quietMinutes = (await campaignDelayMinutes(ic.prospect_id)) ?? 5760;
    if (new Date(cv.last_inbound_at).getTime() > now - quietMinutes * 60 * 1000) continue;

    // Claim atomically: only succeeds if nobody else nudged this conversation meanwhile.
    const claimed = await AllianceInboxConversations.updateOne(
      { id: cv.id, ai_nudge_count: cv.ai_nudge_count, last_ai_nudge_at: cv.last_ai_nudge_at ?? null },
      { $set: { last_ai_nudge_at: new Date() }, $inc: { ai_nudge_count: 1 } }
    );
    if (!claimed.modifiedCount) continue;
    return {
      conversation_id: cv.id,
      contact_id: cv.contact_id,
      last_inbound_at: cv.last_inbound_at,
      ai_nudge_count: cv.ai_nudge_count,
      phone: ic.phone,
      name: ic.name,
      prospect_id: ic.prospect_id,
      audience: p?.audience ?? null,
      business_name: p?.business_name ?? null,
      status: p?.status ?? null,
      quiet_minutes: quietMinutes,
    };
  }
  return null;
}

async function draftNudgeMessage(row) {
  const historyRows = await AllianceInboxMessages.find(
    { contact_id: row.contact_id, is_deleted: false },
    { _id: 0, direction: 1, content: 1, msg_type: 1, sent_at: 1 }
  ).sort({ sent_at: -1 }).limit(30).lean();
  const history = { rows: historyRows };
  const latestInbound = history.rows.find((message) => message.direction === 'inbound');
  const brain = await getAllianceBrainContext(row.audience, latestInbound?.content);
  const durableLeadMemory = row.prospect_id ? await getAllianceLeadMemory(row.prospect_id) : null;
  const promptRules = await getAlliancePromptRules('ai_nudge', 'whatsapp', row.audience, latestInbound?.content || '');
  const prompt = `This WhatsApp lead replied earlier but has now gone quiet. Write ONE short, natural re-engagement nudge to send right now — this is NOT a reply to a specific message, it is a proactive check-in after silence.
Lead context: ${JSON.stringify({ name: row.name, business_name: row.business_name, status: row.status })}
AUTHORITATIVE AI BRAIN (the only source for brand, course, service, price, duration, policy, and contact facts): ${brain ? JSON.stringify(brain) : 'Not configured for this audience yet — do not state any brand facts.'}
Pre-matched administrator rules (mandatory; lower priority number wins if instructions conflict): ${promptRules}
This contact's conversation history, oldest to newest: ${JSON.stringify(history.rows.reverse())}
Durable lead memory${durableLeadMemory ? ` keyed by ${durableLeadMemory.lead_key}` : ''}: ${JSON.stringify(durableLeadMemory || {})}
Reference something specific and true from this contact's own history or memory so the nudge feels personal, not generic. Keep it short (1-3 sentences), warm, low-pressure, and end with at most one easy question. Never claim you already tried reaching them before if there is no evidence of that. Never invent brand facts not present in the brain context.${brain ? ` ${brain.instructions}` : ''}
Merge context into durable memory. Return JSON only: {"message":"nudge text","memory":{"summary":"concise cumulative conversation summary","requirements":[],"interests":[],"objections":[],"commitments":[],"next_step":"","relationship_stage":"new|engaged|evaluating|ready|closed"}}.`;
  const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 500 } });
  let parsed;
  try { parsed = JSON.parse(String(generated.text || '').replace(/^```json\s*|\s*```$/g, '')); }
  catch { parsed = { message: String(generated.text || '').trim(), memory: durableLeadMemory }; }
  const message = String(parsed.message || '').trim();
  if (row.prospect_id && parsed.memory) {
    await saveAllianceLeadMemory(row.prospect_id, parsed.memory, 'whatsapp', new Date());
  }
  return message;
}

async function sendNudge(row, io) {
  const message = await draftNudgeMessage(row);
  if (!message) throw new Error('AI returned an empty nudge message.');
  const settings = await configuredSender();
  const token = process.env[settings?.access_token_env || 'ALLIANCE_WA_ACCESS_TOKEN'];
  if (!settings?.phone_number_id || !token) throw new Error('Alliance WhatsApp credentials are not configured.');
  const response = await axios.post(
    `https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`,
    { messaging_product: 'whatsapp', recipient_type: 'individual', to: row.phone, type: 'text', text: { body: message } },
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 20000 }
  );
  const waMessageId = response.data?.messages?.[0]?.id || null;
  const existing = waMessageId ? await AllianceInboxMessages.findOne({ wa_msg_id: waMessageId }, { id: 1 }).lean() : null;
  let outMessage;
  if (existing) {
    outMessage = await AllianceInboxMessages.findOneAndUpdate({ id: existing.id }, { $set: { status: 'sent' } }, { new: true, projection: { _id: 0 } }).lean();
  } else {
    outMessage = (await AllianceInboxMessages.create({
      conversation_id: row.conversation_id,
      contact_id: row.contact_id,
      wa_msg_id: waMessageId,
      direction: 'outbound',
      msg_type: 'text',
      content: message,
      status: 'sent',
      raw_payload: { purpose: 'ai_inactivity_nudge', nudge_no: Number(row.ai_nudge_count) + 1, sender_type: 'automation' },
      sent_at: new Date(),
    })).toObject();
  }
  await AllianceInboxConversations.updateOne(
    { id: row.conversation_id },
    { $set: { last_message: message, last_message_at: new Date(), updated_at: new Date() } }
  );
  io?.emit('alliance_contacts_changed', { contact_id: String(row.contact_id) });
  if (outMessage) io?.emit('alliance_outgoing_message', { lead_id: String(row.contact_id), message: { ...outMessage, type: outMessage.msg_type, timestamp: outMessage.sent_at, sender_type: 'automation' } });
  return { sent: true, wa_msg_id: waMessageId, message };
}

async function processAllianceAiNudges(io) {
  if (!ENABLED || !openRouter.isConfigured) return;
  if (processing) return; processing = true;
  try {
    for (let count = 0; count < 10; count += 1) {
      const row = await claimDueNudge();
      if (!row) break;
      try { await sendNudge(row, io); }
      catch (error) {
        console.error('[Alliance AI nudge] send failed:', { conversation_id: row.conversation_id, contact_id: row.contact_id, error: error.response?.data || error.message });
      }
    }
  } finally { processing = false; }
}

async function startAllianceAiNudgeWorker(io) {
  await ensureAllianceSchema();
  if (!ENABLED) { console.log('[Alliance AI nudge] disabled (set ALLIANCE_AI_NUDGE_ENABLED=true to enable).'); return; }
  if (!openRouter.isConfigured) { console.log('[Alliance AI nudge] OPENROUTER_API_KEY is not configured — worker not started.'); return; }
  if (!interval) {
    setTimeout(() => processAllianceAiNudges(io).catch(console.error), 10000);
    interval = setInterval(() => processAllianceAiNudges(io).catch(console.error), POLL_SECONDS * 1000);
    interval.unref?.();
  }
  console.log(`[Alliance AI nudge] enabled — quiet window follows each contact's own campaign delay, max=${MAX_NUDGES}, poll=${POLL_SECONDS}s`);
}

module.exports = { startAllianceAiNudgeWorker, processAllianceAiNudges };
