/**
 * AI Brain reply engine. n8n sends only a lead id and a message id; everything
 * else (brain, knowledge, checks, sending, logging) happens here, so a brain
 * change never needs a workflow edit and a workflow mistake cannot bypass a
 * check. All functions run inside the caller's tenant context.
 */
const openRouter = require('./openrouter');
const ai = require('./aiAutomation');
const prompts = require('./brainPrompt');
const brandRouter = require('./brandRouter');
const booking = require('./brainBooking');
const appointments = require('./appointments');
const appointmentFlow = require('./appointmentFlow');
const followupDate = require('./followupDate');
const orderFlow = require('./orderFlow');
const shopOrders = require('./shopOrders');
const orderText = require('./orderText');
const appointmentRules = require('./appointmentRules');
const { say } = require('./appointmentText');
const { systemLanguage, detectLanguage } = require('./replyLanguage');
const { costOf } = require('./aiCost');
const { AiReplyLogs, BrainDocs, BrainProfiles, Clients, Conversations, Leads, Messages } = require('../models');
const aiAllowance = require('./billing/aiAllowance');

// The same model the older reply workflow (WF1) uses.
const BRAIN_MODEL = process.env.AI_BRAIN_MODEL || 'openai/gpt-4o-mini';
const HISTORY_LIMIT = 10;
const WINDOW_MS = 24 * 3600 * 1000;
const AFTER_HOURS_REPEAT_MS = 8 * 3600 * 1000;
const OPT_OUT_MESSAGE = /^\s*(stop|unsubscribe|opt[\s-]?out)[\s.!]*$/i;
const ANSWERED_FROM = ['business_info', 'greeting', 'booking', 'handoff', 'general_knowledge'];
// Phone numbers: 10 or more digits, spaces and dashes allowed (dates and prices are shorter).
const PHONE = /(?:\+?\d[\s-]?){10,}/g;
const PRICE = /(?:₹|\brs\.?|\binr|\$)\s*(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s*(?:rupees|lakhs?|crores?|\/-)/gi;

/** Whether this workspace answers through the AI Brain instead of the older flow. */
async function brainActive() {
  return Boolean(await BrainProfiles.exists({ ai_enabled: true }));
}

const activeDocs = (clientId) => (clientId == null ? [] : BrainDocs.find(
  { client_id: clientId, doc_type: /^(faq|product|policy|brochure|other):/, is_active: { $ne: false } },
  { _id: 0, id: 1, doc_type: 1, title: 1, content: 1 },
).lean());

// Plan allowance and wallet (services/billing/aiAllowance.js): replies left
// on the plan, whether one more may go out, and what it costs the wallet.
async function quotaLeft(tenant, now = new Date()) {
  return aiAllowance.check(tenant, now);
}

function parseOutput(raw) {
  const match = String(raw || '').match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw);
  if (!parsed || typeof parsed !== 'object' || typeof parsed.reply !== 'string') throw new Error('The AI returned an unexpected format');
  return {
    reply: parsed.reply.trim().slice(0, 4096),
    handoff: parsed.handoff === true,
    handoff_reason: parsed.handoff_reason ? String(parsed.handoff_reason).slice(0, 300) : null,
    // A bare "safety:" with nothing after it is not a safety signal (the model
    // sometimes adds it to an ordinary reply): it is dropped, never escalated.
    ...(/^safety:?\s*$/i.test(String(parsed.handoff_reason || '').trim()) && { handoff: false, handoff_reason: null }),
    lead_updates: parsed.lead_updates && typeof parsed.lead_updates === 'object' && !Array.isArray(parsed.lead_updates) ? parsed.lead_updates : {},
    opt_out: parsed.opt_out === true,
    meeting: booking.cleanMeeting(parsed.meeting),
    appointment: appointmentFlow.cleanProposal(parsed.appointment),
    order: orderFlow.cleanProposal(parsed.order),
    follow_up_on: followupDate.cleanProposal(parsed.follow_up_on),
    answered_from: ANSWERED_FROM.includes(parsed.answered_from) ? parsed.answered_from : null,
    // Only an explicit false leaves the chat alone; anything else is answered.
    in_scope: parsed.in_scope !== false,
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

const digitsOf = (value) => String(value || '').replace(/\D/g, '');

/** True when the reply gives a phone number that is not in the business's own information. */
function inventsPhoneNumber(reply, source) {
  const known = digitsOf(source);
  return (String(reply || '').match(PHONE) || []).map(digitsOf).some((digits) => digits.length >= 10 && !known.includes(digits));
}

async function draft({ brain, docs, lead, history, message, businessOpen, left, bookingContext = null, appointmentContext = null, orderContext = null, firstContact = false, now }) {
  const prompt = prompts.assemblePrompt({ brain, docs, lead, history, message, businessOpen, quotaLeft: left, booking: bookingContext, appointments: appointmentContext, orders: orderContext, firstContact, now });
  const lang = systemLanguage(message);
  const holding = say('holding', lang);
  const started = Date.now();
  const response = await openRouter.models.generateContent({
    model: BRAIN_MODEL,
    contents: prompt.user,
    config: { system: prompt.system, temperature: 0.2, maxOutputTokens: 600, responseMimeType: 'application/json' },
  });
  const usage = response.usage || {};
  let output;
  try {
    output = parseOutput(response.text);
  } catch (err) {
    // The provider already charged for this call: keep its usage for the log.
    err.usage = usage;
    err.latency = Date.now() - started;
    throw err;
  }
  const source = `${prompt.user.split('<runtime_context>')[0]}`;
  const same = (value) => String(value || '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (!output.opt_out && same(output.reply) === same(message)) {
    Object.assign(output, { reply: holding, handoff: true, handoff_reason: 'The AI could not answer this message' });
  }
  if (breaksPriceRule(output.reply, brain, source)) {
    Object.assign(output, { reply: holding, handoff: true, handoff_reason: 'AI tried to state a price it does not have' });
  }
  // Facts come only from the business's own saved information.
  if (!output.opt_out && output.answered_from === 'general_knowledge') {
    Object.assign(output, { reply: holding, handoff: true, handoff_reason: 'The answer is not in the business information: a person should answer' });
  } else if (!output.opt_out && inventsPhoneNumber(output.reply, source)) {
    Object.assign(output, { reply: holding, handoff: true, handoff_reason: 'AI tried to give a phone number it does not have' });
  }
  if (output.handoff && !output.reply) output.reply = holding;
  // Closed: the business's own message replaces the answer, except for a
  // handoff or opt-out, which still get their reply.
  const afterHours = !businessOpen && !output.handoff && !output.opt_out && Boolean(brain.profile?.after_hours_message);
  if (afterHours) output.reply = brain.profile.after_hours_message;
  return { output, afterHours, prompt, latency: Date.now() - started, usage, lang };
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

  // Which brain answers: the only one, or the brand the router picks (no model call).
  const earlierInbound = await Messages.find(
    { conversation_id: { $in: conversationIds }, direction: 'inbound', id: { $lt: message.id } },
    { _id: 0, content: 1 },
  ).sort({ id: -1 }).limit(10).lean();
  const route = await brandRouter.routeLead({ lead, message: message.content, earlierInbound: earlierInbound.map((m) => m.content || '') });
  const routed = route.mode === 'routed';
  if (!routed && !route.brand?.brain?.ai_enabled) return { sent: false, reason: 'AI Brain is not turned on for this workspace' };
  if (routed && !(await BrainProfiles.exists({ ai_enabled: true }))) return { sent: false, reason: 'AI Brain is not turned on for this workspace' };
  const blocked = await ai.aiBlockReason(tenant, lead);
  if (blocked) return { sent: false, reason: blocked };
  const brand = route.brand || null;
  const brain = brand?.brain || null;

  // A retry of a message already taken stops here, before anything is sent.
  let log;
  try {
    log = await AiReplyLogs.create({
      lead_id: lead.id, conversation_id: message.conversation_id, message_id: message.id,
      brain_version: brain?.brain_version ?? null, layer1_version: prompts.LAYER1_VERSION,
      ...(routed && { brand_client_id: brand?.client_id ?? null, brand_route: route.reason }),
    });
  } catch (err) {
    if (err.code === 11000) return { sent: false, reason: 'This message was already answered', duplicate: true };
    throw err;
  }
  const finish = (changes) => AiReplyLogs.updateOne({ id: log.id }, { $set: changes });

  const language = detectLanguage(message.content);
  const finishWithoutSend = async (reason, mode = 'notify', extra = {}) => {
    await ai.handover(io, { leadId: lead.id, reason, mode });
    await finish({ status: 'no_send', handoff: true, handoff_reason: reason, language: language.code, ...extra });
    return { sent: false, reason };
  };
  const NO_COST = { model: null, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost_usd: 0, cost_basis: 'none' };

  if (OPT_OUT_MESSAGE.test(message.content || '')) {
    const sentId = await send(say('optOut', systemLanguage(message.content)));
    await markOptedOut(lead.id, now);
    // No model call, so no tokens and no cost.
    await finish({ status: 'sent', sent_message_id: sentId, opt_out: true, language: language.code, ...NO_COST });
    return { sent: true, opt_out: true };
  }

  if (routed) {
    // Not clear which brand: one fixed question, asked once per chat.
    if (route.question) {
      const askedBefore = await Messages.exists({ conversation_id: { $in: conversationIds }, direction: 'outbound', content: route.question });
      const lastIn = new Date(lead.last_inbound_at || message.sent_at || 0).getTime();
      if (askedBefore || now.getTime() - lastIn >= WINDOW_MS) {
        await finish({ status: 'no_send', handoff: false, handoff_reason: 'Left alone: not clear which brand this chat is for', language: language.code, ...NO_COST });
        return { sent: false, reason: 'Not clear which brand this chat is for: left for the team', out_of_scope: true };
      }
      let questionId;
      try {
        questionId = await send(route.question);
      } catch (err) {
        await finish({ status: 'failed', language: language.code, ...NO_COST });
        return { sent: false, reason: err.message };
      }
      await finish({ status: 'sent', sent_message_id: questionId, answered_from: 'greeting', language: language.code, ...NO_COST });
      return { sent: true, brand_question: true };
    }
    if (route.persist && brand) await brandRouter.fixBrand(lead.id, brand.client_id);
    // The brand has no brain yet or its AI is off: people answer, at no cost.
    if (!brain?.ai_enabled) {
      const reason = brand ? `Left alone: AI is off for ${brand.name}` : 'Left alone: no brand on this number has AI on';
      await finish({ status: 'no_send', handoff: false, handoff_reason: reason, language: language.code, ...NO_COST });
      return { sent: false, reason: `${brand ? `This chat is for ${brand.name}` : 'No brand'}, which has AI off: left for the team`, out_of_scope: true, brand_client_id: brand?.client_id ?? null };
    }
  }

  // Shared number with one brain (or only one brand switched on): the fixed
  // keyword rule leaves another brand's chat to people before any model call.
  if ((!routed || route.fallback) && brain.profile?.brand_skip_keywords?.length) {
    const aiRepliedBefore = await Messages.exists({ conversation_id: { $in: conversationIds }, direction: 'outbound', is_ai: true });
    const decision = prompts.brandDecision(brain.profile, {
      message: message.content,
      earlierInbound: earlierInbound.map((m) => m.content || ''),
      adText: [lead.campaign_name, lead.ad_name].filter(Boolean).join(' '),
      aiRepliedBefore: Boolean(aiRepliedBefore),
    });
    if (decision === 'skip') {
      await finish({ status: 'no_send', handoff: false, handoff_reason: 'Left alone: another brand on this number (keyword rule)', language: language.code, ...NO_COST });
      return { sent: false, reason: 'This chat is for another brand on this number: left for the team', out_of_scope: true };
    }
  }

  const lastInbound = new Date(lead.last_inbound_at || message.sent_at || 0).getTime();
  if (now.getTime() - lastInbound >= WINDOW_MS) {
    return finishWithoutSend('Outside the WhatsApp 24-hour window: send an approved template');
  }
  const gate = await quotaLeft(tenant, now);
  if (!gate.allowed) {
    await aiAllowance.notifyBlocked(gate);
    return finishWithoutSend(gate.reason);
  }
  const left = gate.left;

  // A routed brand reads only its own documents; otherwise as before.
  const client = routed ? brand.client_id : (brain.client_id ?? (lead.client_id != null ? lead.client_id : (await Clients.findOne({}, { _id: 0, id: 1 }).lean())?.id));
  const allDocs = await activeDocs(client);
  const docs = prompts.selectDocs(allDocs, message.content);
  const history = (await Messages.find(
    { conversation_id: { $in: conversationIds }, id: { $lt: message.id } },
    { _id: 0, direction: 1, content: 1 },
  ).sort({ id: -1 }).limit(HISTORY_LIMIT).lean()).reverse();
  const businessOpen = prompts.isOpenNow(brain.profile, now);
  // Clinics and schools book appointments in our own calendar; everyone else
  // keeps the Google Meet flow.
  const appointmentMode = brain.profile?.booking_mode === 'appointments';
  const appointmentSettings = appointmentMode ? appointmentRules.settingsFromProfile(brain.profile) : null;
  const bookingContext = appointmentMode ? null : await booking.context(lead);
  let appointmentContext = null;
  if (appointmentMode) {
    const next = await appointments.nextFor(lead.id, now);
    appointmentContext = {
      settings: appointmentSettings,
      draft: appointmentFlow.freshDraft(lead.booking_draft, now),
      upcoming: next ? `${next.service} on ${new Date(next.start_at).toLocaleString('en-IN', { timeZone: appointmentSettings.timeZone, dateStyle: 'medium', timeStyle: 'short' })}` : null,
    };
  }
  // Workspaces that sell through the AI keep a price list; the AI takes orders only when it is on and has products.
  const orderProducts = brain.profile?.orders_enabled === true ? await shopOrders.listProducts({ activeOnly: true }) : [];
  const orderMode = orderProducts.length > 0;
  const orderContext = orderMode ? { products: orderProducts, draft: orderFlow.freshDraft(lead.order_draft, now) } : null;
  const firstContact = !history.some((m) => m.direction === 'outbound');

  let result;
  try {
    result = await draft({ brain, docs, lead, history, message: message.content, businessOpen, left, bookingContext, appointmentContext, orderContext, firstContact, now });
  } catch (err) {
    console.error(`[AI Brain] Could not draft a reply for lead ${lead.id}:`, err.message);
    return finishWithoutSend('The AI could not answer: please reply yourself', 'notify', err.usage ? { model: BRAIN_MODEL, ...costOf(err.usage), latency_ms: err.latency ?? null } : {});
  }
  const { output, prompt, latency, usage, lang } = result;
  // A shared number: a chat for another brand is left unanswered for people
  // (no reply and no handover alert). Opt-outs and safety replies still go out.
  if (brain.profile?.brand_scope && !output.in_scope && !output.opt_out && !/^safety\b/i.test(output.handoff_reason || '')) {
    await finish({ status: 'no_send', handoff: false, handoff_reason: 'Left alone: this chat is for another brand on this number', language: language.code, model: BRAIN_MODEL, ...costOf(usage), latency_ms: latency });
    return { sent: false, reason: 'This chat is for another brand on this number: left for the team', out_of_scope: true };
  }
  let { afterHours } = result;
  let bookedAppointment = null;
  let draftToSave;
  let orderDraftToSave;
  let placedOrder = null;

  const safetyHandoff = /^safety\b/i.test(output.handoff_reason || '');
  // The model only proposes an appointment; the booking flow checks the
  // calendar, asks for what is missing and writes the reply from the real outcome.
  if (appointmentMode && output.appointment && !output.opt_out && !safetyHandoff) {
    let outcome;
    try {
      outcome = await appointmentFlow.advance({ lead, proposal: output.appointment, lang, settings: appointmentSettings, store: appointments.store, now });
    } catch (err) {
      console.error(`[AI Brain booking] Appointment step failed for lead ${lead.id}:`, err.message);
      outcome = { reply: say('bookingError', lang), draft: null, handoffReason: 'Appointment booking failed: please contact the customer' };
    }
    output.reply = outcome.reply;
    output.answered_from = 'booking';
    afterHours = false;
    bookedAppointment = outcome.booked || null;
    draftToSave = outcome.draft;
    if (outcome.handoffReason && !output.handoff) Object.assign(output, { handoff: true, handoff_reason: outcome.handoffReason, handoff_mode: 'notify' });
  }

  // The model only proposes an order; the order flow matches products, adds up the
  // total, asks for confirmation and writes the reply from the real outcome.
  if (orderMode && output.order && !output.appointment && !output.opt_out && !safetyHandoff) {
    let outcome;
    try {
      outcome = await orderFlow.advance({ lead, proposal: output.order, lang, products: orderProducts, payment: brain.profile?.payment_instructions || '', store: shopOrders.store, now });
    } catch (err) {
      console.error(`[AI Brain orders] Order step failed for lead ${lead.id}:`, err.message);
      outcome = { reply: orderText.say('orderError', lang), draft: null, handoffReason: 'Order could not be placed: please contact the customer' };
    }
    output.reply = outcome.reply;
    output.answered_from = 'booking';
    afterHours = false;
    placedOrder = outcome.placed || null;
    orderDraftToSave = outcome.draft;
    if (outcome.handoffReason && !output.handoff) Object.assign(output, { handoff: true, handoff_reason: outcome.handoffReason, handoff_mode: 'notify' });
  }

  // The model only proposes a meeting; the real Calendar outcome writes the reply.
  if (!appointmentMode && output.meeting && !output.opt_out && !safetyHandoff) {
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
    appointment: output.appointment,
    appointment_id: bookedAppointment?.id ?? null,
    order_id: placedOrder?.id ?? null,
    answered_from: output.answered_from,
    language: detectLanguage(message.content).code,
    model: BRAIN_MODEL,
    ...costOf(usage),
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
  // Saved only once the customer has seen the question, so a "yes" always answers what was shown.
  if (draftToSave === null) await Leads.updateOne({ id: lead.id }, { $unset: { booking_draft: '' } });
  else if (draftToSave) await Leads.updateOne({ id: lead.id }, { $set: { booking_draft: draftToSave } });
  if (orderDraftToSave === null) await Leads.updateOne({ id: lead.id }, { $unset: { order_draft: '' } });
  else if (orderDraftToSave) await Leads.updateOne({ id: lead.id }, { $set: { order_draft: orderDraftToSave } });
  if (output.opt_out) await markOptedOut(lead.id, now);
  // The customer named a day to come back: follow up then (checked and moved
  // into sending hours by the server), not on the usual day 2.
  else if (output.follow_up_on && !safetyHandoff) {
    const tz = appointmentSettings?.timeZone || brain.profile?.timezone || tenant?.timezone || 'Asia/Kolkata';
    const at = followupDate.resolve(output.follow_up_on, { now, tz });
    if (at) await ai.setPromisedFollowup(lead.id, at);
  }
  if (output.handoff) {
    const reason = output.handoff_reason || 'The AI asked for a person';
    await ai.handover(io, { leadId: lead.id, reason, ...(output.handoff_mode && { mode: output.handoff_mode }) });
    if (/^safety\b/i.test(reason)) await Leads.updateOne({ id: lead.id }, { $set: { handover_priority: true } });
  }
  await finish({ ...trace, status: 'sent', sent_message_id: sentId });
  // Overage is paid from the wallet per sent reply; the 20 percent notices go out here.
  await aiAllowance.settle(gate, { referenceType: 'message', referenceId: sentId, now });
  return { sent: true, handoff: output.handoff, opt_out: output.opt_out, ...(routed && { brand_client_id: brand.client_id }) };
}

const markOptedOut = (leadId, at) => Leads.updateOne({ id: leadId }, {
  $set: { opted_out: true, opted_out_at: at, whatsapp_opt_out: true, whatsapp_opt_out_at: at, ai_followup_due: null, updated_at: at },
});

/** Brain screen sandbox: drafts a reply and never sends or stores anything. */
async function sandbox({ brain, clientId, message, history = [], keywordRule = true, now = new Date() }) {
  if (keywordRule && brain.profile?.brand_skip_keywords?.length) {
    const decision = prompts.brandDecision(brain.profile, {
      message,
      earlierInbound: history.filter((m) => m.direction !== 'outbound').map((m) => String(m.content || '')),
      aiRepliedBefore: history.some((m) => m.direction === 'outbound'),
    });
    if (decision === 'skip') {
      return { reply: '', handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, in_scope: false, left_alone: 'keyword rule', retrieved: [], latency_ms: 0 };
    }
  }
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

/**
 * Brain screen test for a workspace: picks the brain the way a live chat would
 * (brandRouter) unless a brand is named, then drafts with that brand's profile
 * and documents only. mode 'router' only shows which brand would answer and
 * why (no model call). `profile` (unsaved edits) applies to the brand
 * `profileClientId` names, or to the only brain. Never sends or stores anything.
 */
async function testReply({ clientId = null, mode = 'auto', profile = null, profileClientId = null, message, history = [], now = new Date() }) {
  const { brands, client } = await brandRouter.loadBrands();
  const earlierInbound = history.filter((m) => m.direction !== 'outbound').map((m) => String(m.content || '')).reverse();
  let route;
  if (clientId != null) {
    const brand = brands.find((b) => b.client_id === Number(clientId))
      || (Number(clientId) === client?.id && !brands.length ? { client_id: client.id, name: client.name, brain: null } : null);
    if (!brand) return { error: 'Brand not found', status: 404 };
    route = { mode: brands.length > 1 ? 'routed' : 'single', brand, reason: 'chosen in the test' };
  } else {
    route = brandRouter.decide(brands, { message, earlierInbound });
    if (route.mode === 'single' && !route.brand) route.brand = { client_id: client?.id ?? null, name: client?.name || '', brain: null };
  }
  const routed = route.mode === 'routed';
  const summary = {
    client_id: route.brand?.client_id ?? null,
    name: route.brand?.name || null,
    reason: route.reason,
    why: brandRouter.REASONS[route.reason] || route.reason,
    ai_enabled: Boolean(route.brand?.brain?.ai_enabled),
    ...(route.question && { question: route.question }),
  };
  if (mode === 'router') return { router: summary, brands: brands.length };
  if (route.question) {
    return { reply: route.question, handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, in_scope: true, brand_question: true, retrieved: [], latency_ms: 0, ...(routed && { router: summary }) };
  }
  if (!route.brand) {
    return { reply: '', handoff: false, handoff_reason: null, lead_updates: {}, opt_out: false, in_scope: false, left_alone: 'no brand has AI on', retrieved: [], latency_ms: 0, router: summary };
  }
  const saved = route.brand.brain || {};
  const useEdits = profile && (!routed || Number(profileClientId) === route.brand.client_id);
  const brain = { ...saved, profile: prompts.cleanProfile(useEdits ? profile : saved.profile), version_type: saved.version_type || 'client' };
  const missing = prompts.missingRequired(brain.profile);
  if (brain.version_type !== 'nera' && missing.length) {
    return { error: `Fill these first${routed ? ` for ${route.brand.name}` : ''}: ${missing.join(', ')}`, missing, status: 400, ...(routed && { router: summary }) };
  }
  const docsClient = routed ? route.brand.client_id : (saved.client_id ?? client?.id ?? null);
  const out = await sandbox({ brain, clientId: docsClient, message, history, keywordRule: !routed || Boolean(route.fallback), now });
  return { ...out, ...(routed && { router: summary }) };
}

module.exports = { brainActive, respond, sandbox, testReply, parseOutput, breaksPriceRule, inventsPhoneNumber };
