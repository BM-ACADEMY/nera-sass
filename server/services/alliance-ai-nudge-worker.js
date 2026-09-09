const axios = require('axios');
const db = require('../db/connection');
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
  const result = await db.query(`SELECT * FROM alliance_inbox_settings WHERE active = TRUE ORDER BY id LIMIT 1`);
  if (result.rows[0]) return result.rows[0];
  return process.env.ALLIANCE_WA_PHONE_NUMBER_ID
    ? { phone_number_id: process.env.ALLIANCE_WA_PHONE_NUMBER_ID, access_token_env: 'ALLIANCE_WA_ACCESS_TOKEN' }
    : null;
}

// Claims (and immediately marks) one quiet, previously-replied conversation that hasn't
// been nudged since its latest inbound message, so a slow AI+send call never double-fires.
// The quiet threshold itself is per-contact: whatever "first reminder after" delay is set
// on the most recent WhatsApp campaign that messaged this prospect.
async function claimDueNudge() {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const due = await client.query(
      `SELECT cv.id AS conversation_id, cv.contact_id, cv.last_inbound_at, cv.ai_nudge_count,
              ic.phone, ic.name, ic.prospect_id, p.audience, p.business_name, p.status,
              COALESCE(camp.delay_minutes, 5760) AS quiet_minutes
       FROM alliance_inbox_conversations cv
       JOIN alliance_inbox_contacts ic ON ic.id = cv.contact_id
       LEFT JOIN alliance_prospects p ON p.id = ic.prospect_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(NULLIF(c.followup_delay_minutes,0), GREATEST(COALESCE(c.followup_delay_days,4),1)*1440)::int AS delay_minutes
         FROM alliance_whatsapp_campaign_recipients r
         JOIN alliance_whatsapp_campaigns c ON c.id = r.campaign_id
         WHERE r.prospect_id = ic.prospect_id
         ORDER BY COALESCE(r.sent_at,r.created_at) DESC LIMIT 1
       ) camp ON TRUE
       WHERE cv.last_inbound_at IS NOT NULL
         AND cv.last_inbound_at > NOW() - INTERVAL '24 hours'
         AND cv.last_inbound_at <= NOW() - (COALESCE(camp.delay_minutes,5760) * INTERVAL '1 minute')
         AND (cv.last_ai_nudge_at IS NULL OR cv.last_ai_nudge_at < cv.last_inbound_at)
         AND cv.ai_nudge_count < $1
         AND ic.prospect_id IS NOT NULL
         AND (p.status IS NULL OR p.status NOT IN ('converted','closed','not_interested','unsubscribed'))
         AND (p.suppressed IS NULL OR p.suppressed = FALSE)
       ORDER BY cv.last_inbound_at
       FOR UPDATE OF cv SKIP LOCKED LIMIT 1`,
      [MAX_NUDGES]
    );
    if (!due.rowCount) { await client.query('COMMIT'); return null; }
    const row = due.rows[0];
    await client.query(
      `UPDATE alliance_inbox_conversations SET last_ai_nudge_at = NOW(), ai_nudge_count = ai_nudge_count + 1 WHERE id = $1`,
      [row.conversation_id]
    );
    await client.query('COMMIT');
    return row;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function draftNudgeMessage(row) {
  const history = await db.query(
    `SELECT direction, content, msg_type, sent_at FROM alliance_inbox_messages
     WHERE contact_id = $1 AND is_deleted = FALSE ORDER BY sent_at DESC LIMIT 30`,
    [row.contact_id]
  );
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
  const saved = await db.query(
    `INSERT INTO alliance_inbox_messages
      (conversation_id, contact_id, wa_msg_id, direction, msg_type, content, status, raw_payload, sent_at)
     VALUES ($1,$2,$3,'outbound','text',$4,'sent',$5::jsonb,NOW())
     ON CONFLICT (wa_msg_id) DO UPDATE SET status = EXCLUDED.status
     RETURNING *`,
    [row.conversation_id, row.contact_id, waMessageId, message, JSON.stringify({ purpose: 'ai_inactivity_nudge', nudge_no: Number(row.ai_nudge_count) + 1, sender_type: 'automation' })]
  );
  await db.query(
    `UPDATE alliance_inbox_conversations SET last_message = $1, last_message_at = NOW(), updated_at = NOW() WHERE id = $2`,
    [message, row.conversation_id]
  );
  const outMessage = saved.rows[0];
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
