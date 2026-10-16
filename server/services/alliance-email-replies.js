const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const crypto = require('crypto');
const {
  AllianceTouches,
  AllianceProspects,
  AllianceAudiences,
  AllianceEmailInbound,
  AllianceEmailAttachments,
  AllianceEmailSyncState,
  AllianceReplies,
  AllianceCampaignProspects,
  AllianceSuppression,
} = require('../models');
const { escapeRegex, ieq } = require('../db/mongo');
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

// Email conversation history for one prospect, newest first (max 30): campaign touches,
// inbound replies and approved outbound replies.
async function loadEmailMemory(prospectId) {
  const touches = await AllianceTouches.find(
    { prospect_id: prospectId, channel: 'email', status: 'sent' },
    { subject: 1, message_body: 1, sent_at: 1 }
  ).lean();
  const inbound = await AllianceEmailInbound.find({ prospect_id: prospectId }, { id: 1, subject: 1, text_body: 1, received_at: 1 }).lean();
  const inboundIds = inbound.map((ei) => ei.id);
  const repliesByInbound = new Map((await AllianceReplies.find(
    { email_inbound_id: { $in: inboundIds } },
    { email_inbound_id: 1, body: 1 }
  ).lean()).map((r) => [r.email_inbound_id, r]));
  const approved = await AllianceReplies.find(
    { prospect_id: prospectId, channel: 'email', status: 'sent', approved_at: { $ne: null }, email_inbound_id: { $ne: null } },
    { email_inbound_id: 1, ai_draft: 1, approved_at: 1 }
  ).lean();
  const approvedInbound = new Map((await AllianceEmailInbound.find(
    { id: { $in: approved.map((r) => r.email_inbound_id) } },
    { id: 1, subject: 1 }
  ).lean()).map((ei) => [ei.id, ei]));

  return [
    ...touches.map((t) => ({ direction: 'outbound', message_type: 'campaign', subject: t.subject ?? null, body: t.message_body ?? null, occurred_at: t.sent_at ?? null })),
    ...inbound.map((ei) => ({
      direction: 'inbound', message_type: 'recipient_reply', subject: ei.subject ?? null,
      body: repliesByInbound.get(ei.id)?.body ?? ei.text_body ?? null, occurred_at: ei.received_at ?? null,
    })),
    ...approved.filter((r) => approvedInbound.has(r.email_inbound_id)).map((r) => ({
      direction: 'outbound', message_type: 'approved_reply', subject: approvedInbound.get(r.email_inbound_id).subject ?? null,
      body: r.ai_draft ?? null, occurred_at: r.approved_at ?? null,
    })),
  ]
    .filter((item) => item.body !== null && item.occurred_at !== null)
    .sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))
    .slice(0, 30);
}

// INSERT INTO alliance_suppression (email, phone, reason) SELECT ... ON CONFLICT DO NOTHING
async function suppressProspect(prospectId, reason) {
  const prospect = await AllianceProspects.findOne({ id: prospectId }, { email: 1, phone: 1 }).lean();
  if (!prospect || (prospect.email == null && prospect.phone == null)) return;
  await AllianceSuppression.create({ email: prospect.email ?? null, phone: prospect.phone ?? null, reason })
    .catch((error) => { if (error.code !== 11000) throw error; });
}

async function correlateReply(parsed) {
  const references = [parsed.inReplyTo, ...(Array.isArray(parsed.references) ? parsed.references : [parsed.references])]
    .map(normalizeMessageId).filter(Boolean);
  const asCorrelation = (touch) => ({ touch_id: touch.id, campaign_id: touch.campaign_id ?? null, prospect_id: touch.prospect_id });
  if (references.length) {
    // provider_message_id may be stored with or without <> and in any case
    const linked = await AllianceTouches.findOne(
      { provider_message_id: { $in: references.map((ref) => new RegExp(`^<*${escapeRegex(ref)}>*$`, 'i')) } },
      { id: 1, campaign_id: 1, prospect_id: 1 }
    ).sort({ sent_at: -1 }).lean();
    if (linked) return { ...asCorrelation(linked), references };
  }
  const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address);
  const prospectIds = fromEmail ? await AllianceProspects.distinct('id', { email: ieq(fromEmail) }) : [];
  const fallback = prospectIds.length ? await AllianceTouches.findOne(
    {
      prospect_id: { $in: prospectIds },
      channel: 'email',
      status: 'sent',
      sent_at: { $gt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    { id: 1, campaign_id: 1, prospect_id: 1 }
  ).sort({ sent_at: -1 }).lean() : null;
  return fallback ? { ...asCorrelation(fallback), references } : { references };
}

async function recordCampaignReply(inboundId, correlation, parsed) {
  if (!correlation.prospect_id || !correlation.campaign_id) return null;
  await AllianceEmailInbound.updateOne(
    { id: inboundId },
    { $set: {
      prospect_id: correlation.prospect_id,
      campaign_id: correlation.campaign_id,
      touch_id: correlation.touch_id || null,
      processing_status: 'matched',
    } }
  );
  await AllianceProspects.updateOne({ id: correlation.prospect_id }, { $set: { status: 'in_process', updated_at: new Date() } });
  try {
    const reply = await AllianceReplies.create({
      prospect_id: correlation.prospect_id,
      channel: 'email',
      body: latestReplyText(parsed.text) || parsed.text || String(parsed.html || ''),
      status: 'new',
      email_inbound_id: inboundId,
    });
    return reply.toObject();
  } catch (error) {
    if (error.code !== 11000) throw error; // ON CONFLICT DO NOTHING
    return AllianceReplies.findOne({ email_inbound_id: inboundId }, { _id: 0 }).lean();
  }
}

async function enrichReply(reply, correlation, parsed, io) {
  if (!reply) return;
  let intent = 'other';
  let draft = '';
  try {
    if (openRouter.isConfigured) {
      const prospect = await AllianceProspects.findOne(
        { id: correlation.prospect_id },
        { _id: 0, name: 1, business_name: 1, audience: 1, status: 1 }
      ).lean();
      const audienceRow = prospect?.audience ? await AllianceAudiences.findOne({ code: prospect.audience }, { brand: 1 }).lean() : null;
      const context = { rows: prospect ? [{ ...prospect, brand: audienceRow?.brand ?? null }] : [] };
      const inboundReply = latestReplyText(parsed.text) || String(parsed.text || '');
      const prospectMemory = (await loadEmailMemory(correlation.prospect_id)).reverse();
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
    await AllianceReplies.updateOne({ id: reply.id }, { $set: { ai_intent: intent, ai_draft: draft || null, status: 'drafted' } });
    const prospectStatus = intent === 'interested'
      ? 'interested'
      : intent === 'not_interested' ? 'not_interested' : 'in_process';
    await AllianceProspects.updateOne({ id: correlation.prospect_id }, { $set: { status: prospectStatus, updated_at: new Date() } });
    await scoreAllianceProspect(correlation.prospect_id, {
      message: latestReplyText(parsed.text) || String(parsed.text || ''),
      intent,
      channel: 'email',
      eventKey: `inbound:${reply.email_inbound_id || reply.id}`,
    });
    if (intent === 'not_interested') {
      await AllianceTouches.updateMany(
        { campaign_id: correlation.campaign_id, prospect_id: correlation.prospect_id, status: { $in: ['scheduled', 'paused'] }, sent_at: null },
        { $set: { status: 'cancelled', error_message: 'Prospect is not interested; follow-ups stopped.' } }
      );
      await AllianceCampaignProspects.updateMany(
        { campaign_id: correlation.campaign_id, prospect_id: correlation.prospect_id },
        { $set: { enrollment_status: 'stopped', stopped_at: new Date(), stop_reason: 'not_interested', next_touch_at: null } }
      );
      await suppressProspect(correlation.prospect_id, 'not_interested');
    }
    await AllianceEmailInbound.updateOne(
      { id: reply.email_inbound_id },
      { $set: { processing_status: 'processed', processing_error: null } }
    );
    io?.emit('alliance_email_reply', { reply_id: reply.id, prospect_id: correlation.prospect_id, campaign_id: correlation.campaign_id });
  } catch (error) {
    await AllianceEmailInbound.updateOne({ id: reply.email_inbound_id }, { $set: { processing_status: 'processed', processing_error: error.message } });
    console.error('[Alliance email AI reply]', error.message);
  }
}

async function regenerateReplySuggestion(replyId) {
  const replyRow = await AllianceReplies.findOne({ id: replyId }, { _id: 0 }).lean();
  const inbound = replyRow?.email_inbound_id != null
    ? await AllianceEmailInbound.findOne({ id: replyRow.email_inbound_id }, { subject: 1, text_body: 1, html_body: 1, campaign_id: 1, touch_id: 1 }).lean()
    : null;
  if (!replyRow || !inbound) throw new Error('Reply record not found.');
  if (!openRouter.isConfigured) throw new Error('OpenRouter is not configured.');
  const row = {
    ...replyRow,
    subject: inbound.subject,
    text_body: inbound.text_body,
    html_body: inbound.html_body,
    campaign_id: inbound.campaign_id,
    touch_id: inbound.touch_id,
  };
  const parsed = { subject: row.subject, text: row.text_body || String(row.html_body || '') };
  await enrichReply(row, { prospect_id: row.prospect_id, campaign_id: row.campaign_id, touch_id: row.touch_id }, parsed);
  await AllianceReplies.updateOne({ id: replyId }, { $set: { body: latestReplyText(parsed.text) || parsed.text } });
  const updated = await AllianceReplies.findOne({ id: replyId }, { _id: 0, id: 1, ai_intent: 1, ai_draft: 1, status: 1 }).lean();
  if (!updated?.ai_draft) throw new Error('AI could not create a reply suggestion. Please try again.');
  return updated;
}

async function processMessage(parsed, io) {
  const messageId = normalizeMessageId(parsed.messageId) || `generated-${crypto.createHash('sha256').update(`${parsed.from?.text || ''}|${parsed.date || ''}|${parsed.subject || ''}|${parsed.text || ''}`).digest('hex')}`;
  const fromEmail = normalizeEmail(parsed.from?.value?.[0]?.address);
  if (!fromEmail || fromEmail === normalizeEmail(process.env.ALLIANCE_EMAIL_FROM)) return;
  const correlation = await correlateReply(parsed);
  let inboundId;
  try {
    const inserted = await AllianceEmailInbound.create({
      message_id: messageId,
      in_reply_to: normalizeMessageId(parsed.inReplyTo) || null,
      message_references: correlation.references || [],
      from_email: fromEmail,
      from_name: parsed.from?.value?.[0]?.name || null,
      to_email: parsed.to?.value?.[0]?.address || null,
      subject: parsed.subject || null,
      text_body: parsed.text || null,
      html_body: typeof parsed.html === 'string' ? parsed.html : null,
      received_at: parsed.date || new Date(),
      processing_status: 'received',
      raw_headers: JSON.parse(JSON.stringify(Object.fromEntries(parsed.headers || []))),
    });
    inboundId = inserted.id;
  } catch (error) {
    if (error.code !== 11000) throw error; // ON CONFLICT (message_id) DO NOTHING
  }
  if (!inboundId) {
    const existing = await AllianceEmailInbound.findOne({ message_id: messageId }, { id: 1, processing_status: 1 }).lean();
    if (!existing || existing.processing_status === 'processed') return;
    inboundId = existing.id;
  }
  if (Array.isArray(parsed.attachments) && parsed.attachments.length) {
    for (const [index, attachment] of parsed.attachments.entries()) {
      if (!attachment?.content) continue;
      if (await AllianceEmailAttachments.exists({ inbound_id: inboundId, attachment_index: index })) continue;
      await AllianceEmailAttachments.create({
        inbound_id: inboundId,
        attachment_index: index,
        filename: attachment.filename || `attachment-${index + 1}`,
        content_type: attachment.contentType || null,
        content_id: attachment.contentId || null,
        size_bytes: attachment.size || attachment.content.length,
        content: attachment.content,
      }).catch((error) => {
        if (error.code === 11000) return;
        // MongoDB documents are capped at 16MB; skip attachments that cannot be stored.
        if (/too large|BSONObjectTooLarge|exceeds/i.test(error.message)) {
          console.warn(`[Alliance email] Attachment ${index} of inbound ${inboundId} is too large to store; skipped.`);
          return;
        }
        throw error;
      });
    }
  }
  try {
    const reply = await recordCampaignReply(inboundId, correlation, parsed);
    if (!reply) {
      await AllianceEmailInbound.updateOne({ id: inboundId }, { $set: { processing_status: 'unmatched' } });
      return;
    }
    await enrichReply(reply, correlation, parsed, io);
  } catch (error) {
    await AllianceEmailInbound.updateOne({ id: inboundId }, { $set: { processing_status: 'failed', processing_error: error.message } });
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
      const state = await AllianceEmailSyncState.findOne({ mailbox }, { last_uid: 1 }).lean();
      const savedUid = state?.last_uid == null ? null : Number(state.last_uid);
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
    await AllianceEmailSyncState.updateOne(
      { mailbox },
      { $set: {
        last_checked_at: new Date(),
        last_success_at: new Date(),
        last_error: null,
        updated_at: new Date(),
        ...(checkpointUid == null ? {} : { last_uid: checkpointUid }),
      } },
      { upsert: true }
    );
    consecutiveFailures = 0;
    nextAllowedPollAt = 0;
  } catch (error) {
    consecutiveFailures += 1;
    const backoffMs = Math.min(15 * 60 * 1000, 30000 * (2 ** Math.min(consecutiveFailures - 1, 5)));
    nextAllowedPollAt = Date.now() + backoffMs;
    if (mailbox) await AllianceEmailSyncState.updateOne(
      { mailbox },
      { $set: { last_checked_at: new Date(), last_error: error.message, updated_at: new Date() } },
      { upsert: true }
    ).catch(() => {});
    const detail = errorDetail(error);
    if (mailbox) await AllianceEmailSyncState.updateOne({ mailbox }, { $set: { last_error: detail, updated_at: new Date() } }).catch(() => {});
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
