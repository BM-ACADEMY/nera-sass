const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const db = require('../db/connection');
const { scoreAllianceProspect } = require('./alliance-lead-scoring');
const ensureAllianceSchema = require('../db/alliance-schema');
const openRouter = require('./openrouter');
const { getAllianceBrainContext } = require('./alliance-brain-context');
const { getAlliancePromptRules } = require('./alliance-prompt-rules');
const { getAllianceLeadMemory, saveAllianceLeadMemory } = require('./alliance-lead-memory');

let interval;
let polling = false;
let consecutiveFailures = 0;
let nextAllowedPollAt = 0;

const normalizeMessageId = (value) => String(value || '').trim().replace(/^<|>$/g, '').toLowerCase();
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const errorDetail = (error) => error?.responseText || error?.response || error?.message || 'Unknown IMAP error';
const latestReplyText = (value) => String(value || '')
  .split(/\r?\nOn .+?wrote:\s*\r?\n/i)[0]
  .split(/\r?\n-{2,}\s*Original Message\s*-{2,}/i)[0]
  .trim();
const normalizeCatalogText = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function imapConfig() {
  return {
    host: process.env.ALLIANCE_EMAIL_IMAP_HOST || 'imap.zoho.in',
    port: Number(process.env.ALLIANCE_EMAIL_IMAP_PORT) || 993,
    secure: String(process.env.ALLIANCE_EMAIL_IMAP_SECURE || 'true').toLowerCase() !== 'false',
    auth: {
      user: process.env.ALLIANCE_EMAIL_IMAP_USER || process.env.ALLIANCE_EMAIL_SMTP_USER,
      pass: process.env.ALLIANCE_EMAIL_IMAP_PASSWORD || process.env.ALLIANCE_EMAIL_SMTP_PASSWORD,
    },
    logger: false,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  };
}

async function correlateReply(parsed) {
  const references = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])]
    .map(normalizeMessageId).filter(Boolean);
  if (references.length) {
    const linked = await db.query(
      `SELECT t.id AS touch_id, t.campaign_id, t.prospect_id
       FROM alliance_touches t
       WHERE LOWER(TRIM(BOTH '<>' FROM COALESCE(t.provider_message_id,''))) = ANY($1::text[])
       ORDER BY t.sent_at DESC LIMIT 1`,
      [references]
    );
    if (linked.rowCount) return { ...linked.rows[0], references };
  }
  const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address);
  const fallback = await db.query(
    `SELECT t.id AS touch_id, t.campaign_id, t.prospect_id
     FROM alliance_touches t JOIN alliance_prospects p ON p.id = t.prospect_id
     WHERE LOWER(p.email) = $1 AND t.channel = 'email' AND t.status = 'sent'
       AND t.sent_at > NOW() - INTERVAL '30 days'
     ORDER BY t.sent_at DESC LIMIT 1`,
    [fromEmail]
  );
  return fallback.rowCount ? { ...fallback.rows[0], references } : { references };
}

async function recordCampaignReply(inboundId, correlation, parsed) {
  if (!correlation.prospect_id || !correlation.campaign_id) return null;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `UPDATE alliance_email_inbound SET prospect_id=$1, campaign_id=$2, touch_id=$3, processing_status='matched'
       WHERE id=$4`,
      [correlation.prospect_id, correlation.campaign_id, correlation.touch_id || null, inboundId]
    );
    await client.query(`UPDATE alliance_prospects SET status='in_process', updated_at=NOW() WHERE id=$1`, [correlation.prospect_id]);
    const reply = await client.query(
      `INSERT INTO alliance_replies (prospect_id, channel, body, status, email_inbound_id)
       VALUES ($1,'email',$2,'new',$3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [correlation.prospect_id, latestReplyText(parsed.text) || parsed.text || String(parsed.html || ''), inboundId]
    );
    const storedReply = reply.rowCount
      ? reply.rows[0]
      : (await client.query(`SELECT * FROM alliance_replies WHERE email_inbound_id=$1`, [inboundId])).rows[0];
    await client.query('COMMIT');
    return storedReply;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function enrichReply(reply, correlation, parsed, io) {
  if (!reply) return;
  let intent = 'other';
  let draft = '';
  try {
    if (openRouter.isConfigured) {
      const context = await db.query(
        `SELECT p.name,p.business_name,p.audience,p.status,a.brand
         FROM alliance_prospects p LEFT JOIN alliance_audiences a ON a.code=p.audience
         WHERE p.id=$1`,
        [correlation.prospect_id]
      );
      const inboundReply = latestReplyText(parsed.text) || String(parsed.text || '');
      const memoryResult = await db.query(
        `SELECT direction,message_type,subject,body,occurred_at FROM (
           SELECT 'outbound'::text AS direction,'campaign'::text AS message_type,t.subject,
                  t.message_body AS body,t.sent_at AS occurred_at
           FROM alliance_touches t
           WHERE t.prospect_id=$1 AND t.channel='email' AND t.status='sent'
           UNION ALL
           SELECT 'inbound','recipient_reply',ei.subject,COALESCE(r.body,ei.text_body),ei.received_at
           FROM alliance_email_inbound ei
           LEFT JOIN alliance_replies r ON r.email_inbound_id=ei.id
           WHERE ei.prospect_id=$1
           UNION ALL
           SELECT 'outbound','approved_reply',ei.subject,r.ai_draft,r.approved_at
           FROM alliance_replies r
           JOIN alliance_email_inbound ei ON ei.id=r.email_inbound_id
           WHERE r.prospect_id=$1 AND r.channel='email' AND r.status='sent' AND r.approved_at IS NOT NULL
         ) memory
         WHERE body IS NOT NULL AND occurred_at IS NOT NULL
         ORDER BY occurred_at DESC LIMIT 30`,
        [correlation.prospect_id]
      );
      const prospectMemory = memoryResult.rows.reverse();
      const durableLeadMemory = await getAllianceLeadMemory(correlation.prospect_id);
      const brain = await getAllianceBrainContext(context.rows[0]?.audience, `${parsed.subject || ''} ${inboundReply}`);
      const promptRules = await getAlliancePromptRules('reply_suggestion', 'email', context.rows[0]?.audience, inboundReply);
      const classifyRules = await getAlliancePromptRules('classify', 'email', context.rows[0]?.audience, inboundReply);
      const prompt = `Analyze this inbound B2B email reply and write a personalized response for HUMAN REVIEW only.
Recipient and conversation context (not a source of course facts): ${JSON.stringify(context.rows[0] || {})}
Prospect-specific conversation memory, oldest to newest (belongs only to this prospect; use it for continuity, never as a source of brand facts): ${JSON.stringify(prospectMemory)}
Durable lead memory keyed by ${durableLeadMemory.lead_key}: ${JSON.stringify(durableLeadMemory)}
AUTHORITATIVE AI BRAIN (the only source for brand, course, service, price, duration, policy, and contact facts): ${brain ? JSON.stringify(brain) : 'Not configured for this audience yet — do not state any brand facts.'}
Pre-matched administrator rules (mandatory; lower priority number wins if instructions conflict): ${promptRules}
Pre-matched reply-classification rules (mandatory; lower priority number wins if instructions conflict): ${classifyRules}
Inbound subject: ${parsed.subject || ''}
Inbound reply: ${inboundReply}
The draft is mandatory and must directly answer the latest inbound message and continue naturally from this prospect's own raw history and durable memory. Never greet or introduce the brand as if this were a first conversation when memory shows an ongoing discussion. Keep it professional and conversational with one clear next step. Use the detected brand only. If question_scope is "broad_catalog", list EVERY active entry in exact_catalog exactly once; do not select only popular courses, do not omit entries, and do not rename them. Grouping by exact category is allowed. Include duration and fee only when present in that catalog entry. If suggested_questions is non-empty, use at most one of those questions as the next step and do not replace it with an unrelated generic question. For a specific-offering match, answer only with relevant_offerings. Use only the AUTHORITATIVE AI BRAIN for factual claims.${brain ? ` ${brain.instructions}` : ''}
Update memory by merging prior durable memory with the latest exchange. Preserve still-relevant facts and never copy facts from another lead. Return JSON only: {"intent":"interested|question|objection|not_interested|ooo|other","draft":"complete email reply body without subject","memory":{"summary":"concise cumulative conversation summary","requirements":[],"interests":[],"objections":[],"commitments":[],"next_step":"","relationship_stage":"new|engaged|evaluating|ready|closed"}}.`;
      const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 2600 } });
      const result = JSON.parse(String(generated.text).replace(/^```json\s*|\s*```$/g, ''));
      intent = ['interested', 'question', 'objection', 'not_interested', 'ooo', 'other'].includes(result.intent) ? result.intent : 'other';
      draft = String(result.draft || '');
      if (!draft.trim()) throw new Error('OpenRouter returned an empty reply draft.');
      if (brain?.internal?.escalation_phone && brain.internal.public_contact_phone) {
        draft = draft.replaceAll(brain.internal.escalation_phone, brain.internal.public_contact_phone);
      }
      if (brain?.question_scope === 'broad_catalog' && brain.exact_catalog?.length) {
        const normalizedDraft = normalizeCatalogText(draft);
        const missingOfferings = brain.exact_catalog.filter((offering) => !normalizedDraft.includes(normalizeCatalogText(offering.name)));
        if (missingOfferings.length) {
          const recipientName = context.rows[0]?.name || context.rows[0]?.business_name || 'there';
          const catalogLines = brain.exact_catalog.map((offering) => {
            const facts = [offering.duration, offering.fee ? `₹${offering.fee}` : ''].filter(Boolean).join(', ');
            return `* **${offering.name}**${facts ? ` — ${facts}` : ''}`;
          });
          const nextQuestion = brain.suggested_questions?.[0] || 'Which course would you like to explore in detail?';
          draft = `Dear ${recipientName},\n\nThank you for your interest in ${brain.brand.name}. Here is our complete current course and service catalog:\n\n${catalogLines.join('\n')}\n\n${nextQuestion}`;
        }
      }
      if (brain?.internal?.escalation_phone && brain.internal.public_contact_phone) {
        draft = draft.replaceAll(brain.internal.escalation_phone, brain.internal.public_contact_phone);
      }
      const memoryUpdate = result.memory || {
        ...durableLeadMemory,
        summary: `${durableLeadMemory.summary ? `${durableLeadMemory.summary}\n` : ''}Latest inbound message: ${inboundReply}`,
      };
      await saveAllianceLeadMemory(correlation.prospect_id, memoryUpdate, 'email', new Date());
    }
    await db.query(
      `UPDATE alliance_replies SET ai_intent=$1, ai_draft=$2, status='drafted' WHERE id=$3`,
      [intent, draft || null, reply.id]
    );
    const prospectStatus = intent === 'interested'
      ? 'interested'
      : intent === 'not_interested' ? 'not_interested' : 'in_process';
    await db.query(
      `UPDATE alliance_prospects SET status=$1, updated_at=NOW() WHERE id=$2`,
      [prospectStatus, correlation.prospect_id]
    );
    await scoreAllianceProspect(correlation.prospect_id, {
      message: latestReplyText(parsed.text) || String(parsed.text || ''),
      intent,
      channel: 'email',
      eventKey: `inbound:${reply.email_inbound_id || reply.id}`,
    });
    if (intent === 'not_interested') {
      await db.query(
        `UPDATE alliance_touches SET status='cancelled',error_message='Prospect is not interested; follow-ups stopped.'
         WHERE campaign_id=$1 AND prospect_id=$2 AND status IN ('scheduled','paused') AND sent_at IS NULL`,
        [correlation.campaign_id,correlation.prospect_id]
      );
      await db.query(
        `UPDATE alliance_campaign_prospects SET enrollment_status='stopped',stopped_at=NOW(),
                stop_reason='not_interested',next_touch_at=NULL
         WHERE campaign_id=$1 AND prospect_id=$2`,
        [correlation.campaign_id,correlation.prospect_id]
      );
      await db.query(
        `INSERT INTO alliance_suppression (email, phone, reason)
         SELECT email,phone,'not_interested' FROM alliance_prospects WHERE id=$1
         ON CONFLICT DO NOTHING`,
        [correlation.prospect_id]
      );
    }
    await db.query(
      `UPDATE alliance_email_inbound SET processing_status='processed', processing_error=NULL WHERE id=$1`,
      [reply.email_inbound_id]
    );
    io?.emit('alliance_email_reply', { reply_id: reply.id, prospect_id: correlation.prospect_id, campaign_id: correlation.campaign_id });
  } catch (error) {
    await db.query(`UPDATE alliance_email_inbound SET processing_status='processed', processing_error=$1 WHERE id=$2`, [error.message, reply.email_inbound_id]);
    console.error('[Alliance email AI reply]', error.message);
  }
}

async function regenerateReplySuggestion(replyId) {
  const result = await db.query(
    `SELECT r.*, ei.subject, ei.text_body, ei.html_body, ei.campaign_id, ei.touch_id
     FROM alliance_replies r JOIN alliance_email_inbound ei ON ei.id=r.email_inbound_id
     WHERE r.id=$1`,
    [replyId]
  );
  if (!result.rowCount) throw new Error('Reply record not found.');
  if (!openRouter.isConfigured) throw new Error('OpenRouter is not configured.');
  const row = result.rows[0];
  const parsed = { subject: row.subject, text: row.text_body || String(row.html_body || '') };
  await enrichReply(row, { prospect_id: row.prospect_id, campaign_id: row.campaign_id, touch_id: row.touch_id }, parsed);
  await db.query(`UPDATE alliance_replies SET body=$1 WHERE id=$2`, [latestReplyText(parsed.text) || parsed.text, replyId]);
  const updated = await db.query(`SELECT id, ai_intent, ai_draft, status FROM alliance_replies WHERE id=$1`, [replyId]);
  if (!updated.rows[0]?.ai_draft) throw new Error('AI could not create a reply suggestion. Please try again.');
  return updated.rows[0];
}

async function processMessage(parsed, io) {
  const messageId = normalizeMessageId(parsed.messageId) || `generated-${crypto.createHash('sha256').update(`${parsed.from?.text || ''}|${parsed.date || ''}|${parsed.subject || ''}|${parsed.text || ''}`).digest('hex')}`;
  const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address);
  if (!fromEmail || fromEmail === normalizeEmail(process.env.ALLIANCE_EMAIL_FROM)) return;
  const correlation = await correlateReply(parsed);
  const inserted = await db.query(
    `INSERT INTO alliance_email_inbound
      (message_id,in_reply_to,message_references,from_email,from_name,to_email,subject,text_body,html_body,received_at,processing_status,raw_headers)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'received',$11::jsonb)
     ON CONFLICT (message_id) DO NOTHING RETURNING id`,
    [messageId, normalizeMessageId(parsed.inReplyTo) || null, correlation.references || [], fromEmail,
      parsed.from?.value?.[0]?.name || null, parsed.to?.value?.[0]?.address || null, parsed.subject || null,
      parsed.text || null, typeof parsed.html === 'string' ? parsed.html : null, parsed.date || new Date(),
      JSON.stringify(Object.fromEntries(parsed.headers || []))]
  );
  let inboundId = inserted.rows[0]?.id;
  if (!inboundId) {
    const existing = await db.query(
      `SELECT id, processing_status FROM alliance_email_inbound WHERE message_id=$1`,
      [messageId]
    );
    if (!existing.rowCount || existing.rows[0].processing_status === 'processed') return;
    inboundId = existing.rows[0].id;
  }
  if (Array.isArray(parsed.attachments) && parsed.attachments.length) {
    for (const [index, attachment] of parsed.attachments.entries()) {
      if (!attachment?.content) continue;
      await db.query(
        `INSERT INTO alliance_email_attachments
          (inbound_id,attachment_index,filename,content_type,content_id,size_bytes,content)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (inbound_id,attachment_index) DO NOTHING`,
        [inboundId, index, attachment.filename || `attachment-${index + 1}`,
          attachment.contentType || null, attachment.contentId || null,
          attachment.size || attachment.content.length, attachment.content]
      );
    }
  }
  try {
    const reply = await recordCampaignReply(inboundId, correlation, parsed);
    if (!reply) {
      await db.query(`UPDATE alliance_email_inbound SET processing_status='unmatched' WHERE id=$1`, [inboundId]);
      return;
    }
    await enrichReply(reply, correlation, parsed, io);
  } catch (error) {
    await db.query(`UPDATE alliance_email_inbound SET processing_status='failed', processing_error=$1 WHERE id=$2`, [error.message, inboundId]);
    throw error;
  }
}

async function pollAllianceEmailReplies(io) {
  if (polling || Date.now() < nextAllowedPollAt) return;
  polling = true;
  const config = imapConfig();
  const mailbox = config.auth.user;
  let client;
  try {
    if (!mailbox || !config.auth.pass) throw new Error('Alliance Zoho IMAP credentials are not configured.');
    client = new ImapFlow(config);
    // ImapFlow emits socket errors in addition to rejecting the active command.
    // An error listener is required or a transient Zoho reset terminates Node.
    client.on('error', (error) => {
      console.warn('[Alliance Zoho IMAP socket]', errorDetail(error));
    });
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let checkpointUid = null;
    try {
      const state = await db.query(`SELECT last_uid FROM alliance_email_sync_state WHERE mailbox=$1`, [mailbox]);
      const savedUid = state.rows[0]?.last_uid == null ? null : Number(state.rows[0].last_uid);
      const latestUid = Math.max(0, Number(client.mailbox?.uidNext || 1) - 1);
      let uids = [];
      if (savedUid == null) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        uids = await client.search({ since }, { uid: true });
        uids = uids.slice(-200);
      } else if (savedUid < latestUid) {
        uids = await client.search({ uid: `${savedUid + 1}:${latestUid}` }, { uid: true });
      }
      if (uids.length) {
        for await (const message of client.fetch(uids.join(','), { uid: true, source: true }, { uid: true })) {
          if (!message.source) continue;
          await processMessage(await simpleParser(message.source), io);
        }
      }
      checkpointUid = latestUid;
    } finally {
      lock.release();
    }
    await db.query(
      `INSERT INTO alliance_email_sync_state (mailbox,last_checked_at,last_success_at,last_error,last_uid)
       VALUES ($1,NOW(),NOW(),NULL,$2) ON CONFLICT (mailbox) DO UPDATE SET
       last_checked_at=NOW(),last_success_at=NOW(),last_error=NULL,last_uid=COALESCE(EXCLUDED.last_uid,alliance_email_sync_state.last_uid),updated_at=NOW()`,
      [mailbox, checkpointUid]
    );
    consecutiveFailures = 0;
    nextAllowedPollAt = 0;
  } catch (error) {
    consecutiveFailures += 1;
    const backoffMs = Math.min(15 * 60 * 1000, 30000 * (2 ** Math.min(consecutiveFailures - 1, 5)));
    nextAllowedPollAt = Date.now() + backoffMs;
    if (mailbox) await db.query(
      `INSERT INTO alliance_email_sync_state (mailbox,last_checked_at,last_error)
       VALUES ($1,NOW(),$2) ON CONFLICT (mailbox) DO UPDATE SET last_checked_at=NOW(),last_error=$2,updated_at=NOW()`,
      [mailbox, error.message]
    ).catch(() => {});
    const detail = errorDetail(error);
    if (mailbox) await db.query(`UPDATE alliance_email_sync_state SET last_error=$2, updated_at=NOW() WHERE mailbox=$1`, [mailbox, detail]).catch(() => {});
    console.error('[Alliance Zoho IMAP]', detail);
  } finally {
    if (client?.usable) await client.logout().catch(() => {});
    else if (client) client.close();
    polling = false;
  }
}

async function startAllianceEmailReplyPoller(io) {
  await ensureAllianceSchema();
  if (interval) return;
  setTimeout(() => pollAllianceEmailReplies(io), 4000);
  interval = setInterval(() => pollAllianceEmailReplies(io), 60000);
  interval.unref?.();
}

module.exports = { startAllianceEmailReplyPoller, pollAllianceEmailReplies, regenerateReplySuggestion };
