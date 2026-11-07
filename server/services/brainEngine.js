/**
 * AI Brain reply engine. n8n sends only a lead id and a message id; everything
 * else (brain, knowledge, checks, sending, logging) happens here, so a brain
 * change never needs a workflow edit and a workflow mistake cannot bypass a
 * check. All functions run inside the caller's tenant context.
 */
const openRouter = require('./openrouter');
const ai = require('./aiAutomation');
const prompts = require('./brainPrompt');
const booking = require('./brainBooking');
const { AiReplyLogs, BrainDocs, BrainProfiles, Clients, Conversations, Leads, Messages } = require('../models');

// The same model the older reply workflow (WF1) uses.
const BRAIN_MODEL = process.env.AI_BRAIN_MODEL || 'openai/gpt-4o-mini';
const HISTORY_LIMIT = 10;
const WINDOW_MS = 24 * 3600 * 1000;
const AFTER_HOURS_REPEAT_MS = 8 * 3600 * 1000;
const HOLDING_REPLY = 'I will check this with the team and get back to you.';
const OPT_OUT_REPLY = 'You will not get further messages from us here.';
const OPT_OUT_MESSAGE = /^\s*(stop|unsubscribe|opt[\s-]?out)[\s.!]*$/i;
const PRICE = /(?:₹|\brs\.?|\binr|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:rupees|lakhs?|crores?|\/-)/gi;

/** Whether this workspace answers through the AI Brain instead of the older flow. */
async function brainActive() {
  return Boolean(await BrainProfiles.exists({ ai_enabled: true }));
}

const activeDocs = (clientId) => (clientId == null ? [] : BrainDocs.find(
  { client_id: clientId, doc_type: /^(faq|product|policy|brochure|other):/, is_active: { $ne: false } },
  { _id: 0, id: 1, doc_type: 1, title: 1, content: 1 },
).lean());

async function quotaLeft(tenant, now = new Date()) {
  const limit = Number(tenant?.ai_reply_quota_month);
  if (!Number.isFinite(limit) || limit <= 0) return null;
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const used = await AiReplyLogs.countDocuments({ status: 'sent', created_at: { $gte: from } });
  return Math.max(limit - used, 0);
}

function parseOutput(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string') throw new Error('The AI returned an unexpected format');
  return {
    reply: parsed.reply.trim().slice(0, 4096),
    handoff: parsed.handoff === true,
    handoff_reason: parsed.handoff_reason ? String(parsed.handoff_reason).slice(0, 300) : null,
    lead_updates: parsed.lead_updates && typeof parsed.lead_updates === 'object' && !Array.isArray(parsed.lead_updates) ? parsed.lead_updates : {},
    opt_out: parsed.opt_out === true,
    meeting: booking.cleanMeeting(parsed.meeting),
  };
}

const priceValues = (value) => [...String(value || '').matchAll(PRICE)].map((m) => (m[1] || m[2]).replace(/,/g, ''));

/**
 * True when the reply states a price it may not state: any price under "never
 * share" (or Nera's own brain, which has no plan data), otherwise any amount
 * that is not in the workspace's own brain or documents.
 */
function breaksPriceRule(reply, brain, source) {
  const prices = priceValues(reply);
  if (!prices.length) return false;
  if (brain.version_type === 'nera' || brain.profile?.pricing_policy === 'never_share') return true;
  const known = new Set(priceValues(source));
  return prices.some((price) => !known.has(price));
}

async function draft({ brain, docs, lead, history, message, businessOpen, left, bookingContext = null, now }) {
  const prompt = prompts.assemblePrompt({ brain, docs, lead, history, message, businessOpen, quotaLeft: left, booking: bookingContext, now });
  const started = Date.now();
  const response = await openRouter.models.generateContent({
    model: BRAIN_MODEL,
    contents: prompt.user,
    config: { system: prompt.system, temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
  });
  const output = parseOutput(response.text);
  const source = `${prompt.user.split('<runtime_context>')[0]}`;
  const same = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!output.opt_out && same(output.reply) === same(message)) {
    Object.assign(output, { reply: HOLDING_REPLY, handoff: true, handoff_reason: 'The AI could not answer this message' });
  }
  if (breaksPriceRule(output.reply, brain, source)) {
    Object.assign(output, { reply: HOLDING_REPLY, handoff: true, handoff_reason: 'AI tried to state a price it does not have' });
  }
  if (output.handoff && !output.reply) output.reply = HOLDING_REPLY;
  // Closed: the business's own message replaces the answer, except for a
  // handoff or opt-out, which still get their reply.
  const afterHours = !businessOpen && !output.handoff && !output.opt_out && Boolean(brain.profile?.after_hours_message);
  if (afterHours) output.reply = brain.profile.after_hours_message;
  return { output, afterHours, prompt, latency: Date.now() - started, usage: response.usage || {} };
}

// Answers saved to lead fields: name and interest when the AI found them,
// everything else under ai_qualification.
function leadChanges(updates) {
  const set = {};
  const answers = {};
  for (const [key, value] of Object.entries(updates).slice(0, 20)) {
    const clean = String(value ?? '').trim().slice(0, 300);
    if (!clean) continue;
    if (key === 'interest') set.interest = clean;
    else answers[String(key).replace(/[.$]/g, ' ').slice(0, 120)] = clean;
  }
  for (const [key, value] of Object.entries(answers)) set[`ai_qualification.${key}`] = value;
  return set;
}

/**
 * Handles one customer message. `send(text)` delivers it to the lead and
 * returns the stored message id. Returns { sent, reason, ... }.
 */
async function respond({ io, tenant, leadId, messageId, send, now = new Date() }) {
  const lead = await Leads.findOne({ id: leadId }, { _id: 0 }).lean();
  if (!lead) return { status: 404, error: 'Lead not found' };
  const conversationIds = await Conversations.distinct('id', { lead_id: lead.id });
  const message = await Messages.findOne(
    { id: messageId, direction: 'inbound', conversation_id: { $in: conversationIds } },
    { _id: 0, id: 1, conversation_id: 1, content: 1, sent_at: 1 },
  ).lean();
  if (!message) return { status: 404, error: 'Message not found on this lead' };

  const brain = await BrainProfiles.findOne({}, { _id: 0 }).lean();
  if (!brain?.ai_enabled) return { sent: false, reason: 'AI Brain is not turned on for this workspace' };
  const blocked = await ai.aiBlockReason(tenant, lead);
  if (blocked) return { sent: false, reason: blocked };

  // A retry of a message already taken stops here, before anything is sent.
  let log;
  try {
    log = await AiReplyLogs.create({
      lead_id: lead.id, conversation_id: message.conversation_id, message_id: message.id,
      brain_version: brain.brain_version, layer1_version: prompts.LAYER1_VERSION,
    });
  } catch (err) {
    if (err.code === 11000) return { sent: false, reason: 'This message was already answered', duplicate: true };
    throw err;
  }
  const finish = (changes) => AiReplyLogs.updateOne({ id: log.id }, { $set: changes });

  const finishWithoutSend = async (reason, mode = 'notify') => {
    await ai.handover(io, { leadId: lead.id, reason, mode });
    await finish({ status: 'no_send', handoff: true, handoff_reason: reason });
    return { sent: false, reason };
  };

  if (OPT_OUT_MESSAGE.test(message.content || '')) {
    const sentId = await send(OPT_OUT_REPLY);
    await markOptedOut(lead.id, now);
    await finish({ status: 'sent', sent_message_id: sentId, opt_out: true });
    return { sent: true, opt_out: true };
  }

  const lastInbound = new Date(lead.last_inbound_at || message.sent_at || 0).getTime();
  if (now.getTime() - lastInbound >= WINDOW_MS) {
    return finishWithoutSend('Outside the WhatsApp 24-hour window: send an approved template');
  }
  const left = await quotaLeft(tenant, now);
  if (left === 0) return finishWithoutSend('AI reply limit reached for this month: please reply yourself');

  const client = lead.client_id != null ? lead.client_id : (await Clients.findOne({}, { _id: 0, id: 1 }).lean())?.id;
  const allDocs = await activeDocs(client);
  const docs = prompts.selectDocs(allDocs, message.content);
  const history = (await Messages.find(
    { conversation_id: { $in: conversationIds }, id: { $lt: message.id } },
    { _id: 0, direction: 1, content: 1 },
  ).sort({ id: -1 }).limit(HISTORY_LIMIT).lean()).reverse();
  const businessOpen = prompts.isOpenNow(brain.profile, now);
  const bookingContext = await booking.context(lead);

  let result;
  try {
    result = await draft({ brain, docs, lead, history, message: message.content, businessOpen, left, bookingContext, now });
  } catch (err) {
    console.error(`[AI Brain] Could not draft a reply for lead ${lead.id}:`, err.message);
    return finishWithoutSend('The AI could not answer: please reply yourself');
  }
  const { output, prompt, latency, usage } = result;
  let { afterHours } = result;

  // The model only proposes a meeting; the real Calendar outcome writes the reply.
  if (output.meeting && !output.opt_out && !/^safety\b/i.test(output.handoff_reason || '')) {
    const outcome = await booking.apply({ lead, meeting: output.meeting, booking: bookingContext, brandName: brain.profile?.business_name || tenant?.name });
    if (outcome?.reply) {
      output.reply = outcome.reply;
      afterHours = false;
    }
    // Tells the team (a booking needs no takeover, so the AI is not paused).
    if (outcome?.handoffReason && !output.handoff) Object.assign(output, { handoff: true, handoff_reason: outcome.handoffReason, handoff_mode: 'notify' });
  }
  const trace = {
    retrieved_doc_ids: docs.map((d) => d.id),
    prompt: `${prompt.user}`.slice(0, 20000),
    handoff: output.handoff,
    handoff_reason: output.handoff_reason,
    opt_out: output.opt_out,
    meeting: output.meeting,
    prompt_tokens: usage.prompt_tokens ?? null,
    completion_tokens: usage.completion_tokens ?? null,
    latency_ms: latency,
  };

  // The after-hours message goes out once per closed period, not per message.
  if (afterHours) {
    const since = new Date(now.getTime() - AFTER_HOURS_REPEAT_MS);
    const already = await Messages.exists({ conversation_id: { $in: conversationIds }, direction: 'outbound', content: output.reply, sent_at: { $gte: since } });
    if (already) {
      await finish({ ...trace, status: 'no_send' });
      return { sent: false, reason: 'After-hours message was already sent' };
    }
  }

  let sentId;
  try {
    sentId = await send(output.reply);
  } catch (err) {
    await ai.handover(io, { leadId: lead.id, reason: 'WhatsApp did not accept the AI reply: please reply yourself', draft: output.reply, mode: 'notify' });
    await finish({ ...trace, status: 'failed' });
    return { sent: false, reason: err.message };
  }

  const changes = leadChanges(output.lead_updates);
  if (Object.keys(changes).length) await Leads.updateOne({ id: lead.id }, { $set: { ...changes, updated_at: new Date() } });
  if (output.opt_out) await markOptedOut(lead.id, now);
  if (output.handoff) {
    const reason = output.handoff_reason || 'The AI asked for a person';
    await ai.handover(io, { leadId: lead.id, reason, ...(output.handoff_mode && { mode: output.handoff_mode }) });
    if (/^safety\b/i.test(reason)) await Leads.updateOne({ id: lead.id }, { $set: { handover_priority: true } });
  }
  await finish({ ...trace, status: 'sent', sent_message_id: sentId });
  return { sent: true, handoff: output.handoff, opt_out: output.opt_out };
}

const markOptedOut = (leadId, at) => Leads.updateOne({ id: leadId }, {
  $set: { opted_out: true, opted_out_at: at, whatsapp_opt_out: true, whatsapp_opt_out_at: at, ai_followup_due: null, updated_at: at },
});

/** Brain screen sandbox: drafts a reply and never sends or stores anything. */
async function sandbox({ brain, clientId, message, history = [], now = new Date() }) {
  const docs = prompts.selectDocs(await activeDocs(clientId), message);
  const { output, latency } = await draft({
    brain,
    docs,
    lead: { name: 'Test customer', status: 'new' },
    history: history.slice(-HISTORY_LIMIT).map((m) => ({ direction: m.direction === 'outbound' ? 'outbound' : 'inbound', content: String(m.content || '').slice(0, 1000) })),
    message,
    businessOpen: prompts.isOpenNow(brain.profile, now),
    left: null,
    bookingContext: await booking.context(null),
    now,
  });
  return { ...output, retrieved: docs.map((d) => d.title || d.doc_type), latency_ms: latency };
}

module.exports = { brainActive, respond, sandbox, parseOutput, breaksPriceRule };
