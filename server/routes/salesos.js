const express = require('express');
// internalAuth: customer users and n8n acting for one tenant (x-tenant-id).
// internalPlatformAuth: cross-tenant reports and maintenance — the internal
// service key or founder/ops platform staff only, never a customer token.
const { internalAuth, internalPlatformAuth, staffAuth, hasInternalKey } = require('../middleware/authMiddleware');
const audit = require('../services/audit');
const { recordTenantWorkflowLog, recordPlatformWorkflowLog, WorkflowLogError } = require('../services/workflowLog');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const {
  Leads,
  Clients,
  Conversations,
  Messages,
  SalesTasks,
  SalesLeadNotes,
  AiDecisions,
  BrainDocs,
  CampaignLogs,
  Campaigns,
  Templates,
  Users,
  WorkflowLogs,
  Payments,
  DemoCallReminders,
  LeadTags,
  AllianceInboxTags,
} = require('../models');
const { NO_ID, ieq, escapeRegex, insertIgnore, phoneTailRegex, withLock } = require('../db/mongo');

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };
const startOfUtcMonth = () => { const d = startOfUtcDay(); d.setUTCDate(1); return d; };
const lower = (value) => String(value ?? '').toLowerCase();
const leadConversationIds = (leadId) => Conversations.distinct('id', { lead_id: leadId });

// SELECT l.*, <client columns> FROM leads l LEFT JOIN clients c ON l.client_id = c.id WHERE l.id = $1
async function leadWithClient(leadId, clientColumns = {}) {
  const lead = await Leads.findOne({ id: leadId }, NO_ID).lean();
  if (!lead) return null;
  const client = lead.client_id != null ? await Clients.findOne({ id: lead.client_id }).lean() : null;
  const extra = Object.fromEntries(Object.entries(clientColumns).map(([alias, column]) => [alias, client ? client[column] ?? null : null]));
  return { ...lead, ...extra };
}

// Messages of every conversation belonging to the lead (JOIN conversations c ON c.lead_id = $1)
async function leadMessages(leadId, filter = {}, { sort = { sent_at: -1 }, limit, projection = NO_ID } = {}) {
  const conversationIds = await leadConversationIds(leadId);
  let query = Messages.find({ conversation_id: { $in: conversationIds }, ...filter }, projection).sort(sort);
  if (limit) query = query.limit(limit);
  return query.lean();
}
const hasText = { content: { $ne: null, $not: /^\s*$/ } };

// Sales task rows shaped like the former SQL join (task + lead + brand + assignee + tags)
async function loadSalesTaskRows(tasks, { includeLatestNote = false } = {}) {
  const leads = new Map((await Leads.find({ id: { $in: tasks.map((t) => t.lead_id) } }, NO_ID).lean()).map((l) => [l.id, l]));
  const clients = new Map((await Clients.find({ id: { $in: [...leads.values()].map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c]));
  const users = new Map((await Users.find({ id: { $in: [...leads.values()].map((l) => l.assigned_to).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((u) => [u.id, u]));
  const leadIds = [...leads.keys()];
  const lastContact = new Map((await Conversations.aggregate([
    { $match: { lead_id: { $in: leadIds } } },
    { $group: { _id: '$lead_id', last: { $max: '$last_message_at' } } },
  ])).map((row) => [row._id, row.last]));
  const tagLinks = await LeadTags.find({ lead_id: { $in: leadIds } }, { lead_id: 1, tag_id: 1 }).lean();
  const tags = new Map((await AllianceInboxTags.find({ id: { $in: tagLinks.map((l) => l.tag_id) } }, { id: 1, name: 1, color: 1 }).lean()).map((t) => [t.id, t]));
  const latestNotes = new Map();
  if (includeLatestNote) {
    const notes = await SalesLeadNotes.find({ lead_id: { $in: leadIds } }, { id: 1, lead_id: 1, note: 1, created_at: 1 }).sort({ created_at: -1 }).lean();
    for (const note of notes) if (!latestNotes.has(note.lead_id)) latestNotes.set(note.lead_id, note);
  }
  return tasks.filter((task) => leads.has(task.lead_id)).map((task) => {
    const l = leads.get(task.lead_id);
    const note = latestNotes.get(l.id);
    return {
      ...task,
      lead_id: l.id, name: l.name, phone: l.phone, email: l.email,
      lead_status: l.status, stage: l.stage, source: l.source, interest: l.interest, score: l.score,
      sales_status: l.sales_status ?? 'new',
      sales_followup_stopped: l.sales_followup_stopped, sales_followup_at: l.sales_followup_at,
      ...(includeLatestNote ? {
        latest_sales_note_id: note?.id ?? null, latest_sales_note: note?.note ?? null, latest_sales_note_at: note?.created_at ?? null,
      } : {}),
      call_booked_at: l.call_booked_at, next_followup_due: l.next_followup_due, booking_status: l.booking_status,
      calendar_event_url: l.calendar_event_url, google_meet_link: l.google_meet_link,
      last_contact: lastContact.get(l.id) ?? null,
      lead_created_at: l.created_at,
      brand_name: clients.get(l.client_id)?.name ?? null,
      assigned_name: users.get(l.assigned_to)?.name ?? null,
      tags: tagLinks.filter((link) => link.lead_id === l.id && tags.has(link.tag_id))
        .map((link) => ({ id: tags.get(link.tag_id).id, name: tags.get(link.tag_id).name, color: tags.get(link.tag_id).color })),
    };
  });
}
const TASK_FIELDS = { _id: 0, id: 1, lead_id: 1, task_type: 1, status: 1, unread: 1, created_at: 1 };
const axios = require('axios');
const { buildBmAcademyCatalog, findBmAcademyCourseFamily, resolveBmAcademyCourseContext } = require('../services/bmAcademySyllabus');
const googleCalendar = require('../services/googleCalendar');
const { sendBookingNotification } = require('../services/bookingNotifications');
const { getLeadOSBrand } = require('../services/leadosBrand');

const APPROVED_BRAIN_DATA_PATH = path.join(__dirname, '..', '..', 'documentation', 'updated-brain-data.md');
let approvedBrainDataCache = { mtimeMs: -1, content: '' };

const getApprovedBrainData = () => {
  const { mtimeMs } = fs.statSync(APPROVED_BRAIN_DATA_PATH);
  if (approvedBrainDataCache.mtimeMs !== mtimeMs) {
    approvedBrainDataCache = {
      mtimeMs,
      content: fs.readFileSync(APPROVED_BRAIN_DATA_PATH, 'utf8'),
    };
  }
  return approvedBrainDataCache.content;
};

const getApprovedBrandData = (brand) => {
  const content = getApprovedBrainData();
  const bmTechxHeading = '2. BM TechX Data Collection Form';
  const splitAt = content.indexOf(bmTechxHeading);
  if (splitAt < 0) throw new Error(`Missing "${bmTechxHeading}" in approved AI Brain data`);
  const normalized = String(brand || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
  return ['bmtechx', 'growwithkamar'].includes(normalized)
    ? content.slice(splitAt).trim()
    : content.slice(0, splitAt).trim();
};

// ==========================================
// WF00 - Lead Integrator Endpoints
// ==========================================

const openRouter = require('../services/openrouter');
const ai = openRouter.isConfigured ? openRouter : null;
// Collections are created on demand by MongoDB; these remain for the awaiting call sites.
const demoReminderReady = Promise.resolve();
const salesTasksReady = Promise.resolve();
const salesTrackingReady = Promise.resolve();

async function emitSalesTaskUpdate(req, event, task = null) {
  const unreadCount = await SalesTasks.countDocuments({ unread: true, status: { $ne: 'completed' } });
  req.app.get('io')?.emit('sales_task_update', { event, task, unread_count: unreadCount });
}

async function ensureSalesTask(req, leadId, taskType) {
  await salesTasksReady;
  if (await SalesTasks.exists({ lead_id: leadId, task_type: String(taskType) })) return null;
  const created = await SalesTasks.create({ lead_id: leadId, task_type: String(taskType), unread: true });
  const task = Object.fromEntries(Object.keys(TASK_FIELDS).filter((k) => k !== '_id').map((k) => [k, created[k]]));
  await emitSalesTaskUpdate(req, 'created', task);
  return task;
}

// Resolve a raw Meta WhatsApp payload synchronously so n8n can continue the
// same execution with the spoken text instead of ending on an audio placeholder.
router.post('/whatsapp/transcribe', internalAuth, async (req, res) => {
  const payload = req.body?.payload || req.body;
  const value = payload?.entry?.[0]?.changes?.[0]?.value;
  const audio = value?.messages?.[0]?.audio;

  if (!audio?.id) {
    return res.json(payload);
  }

  // A failed or slow transcription must never leave the lead with silence.
  // This used to return a bare HTTP error on every failure path (missing
  // token, Meta media fetch failing, empty transcript, or — with no timeout
  // at all on the transcription call itself — simply hanging). Any of those
  // likely killed the n8n run right here with nothing ever sent back to the
  // lead. Instead, degrade to the same "please type it" marker /ai/response
  // already recognizes and replies to warmly, so the workflow always
  // continues and the lead always gets *something*.
  const fallbackToTypedRequest = () => {
    const message = value.messages[0];
    message.type = 'text';
    message.text = { body: '[voice_message]' };
    message.original_type = 'audio';
    delete message.audio;
    return res.json(payload);
  };

  try {
    if (!ai) {
      console.error('[WhatsApp Transcription] OPENROUTER_API_KEY is not configured.');
      return fallbackToTypedRequest();
    }

    const phoneNumberId = value?.metadata?.phone_number_id;
    const tokenClient = phoneNumberId
      ? await Clients.findOne({ phone_number_id: phoneNumberId }, { wa_access_token: 1 }).lean()
      : null;
    const waToken = tokenClient?.wa_access_token;
    if (!waToken) {
      console.error('[WhatsApp Transcription] No WhatsApp access token configured for phone_number_id', phoneNumberId);
      return fallbackToTypedRequest();
    }

    const mediaResponse = await axios.get(`https://graph.facebook.com/v18.0/${audio.id}`, {
      headers: { Authorization: `Bearer ${waToken}` },
      timeout: 10000,
    });
    const mediaUrl = mediaResponse.data?.url;
    if (!mediaUrl) {
      console.error('[WhatsApp Transcription] Meta did not return a media URL for audio id', audio.id);
      return fallbackToTypedRequest();
    }

    const audioResponse = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${waToken}` },
      responseType: 'arraybuffer',
      timeout: 15000,
    });
    const mimeType = mediaResponse.data?.mime_type || audio.mime_type || 'audio/ogg';
    const result = await withTimeout(
      ai.models.generateContent({
        model: openRouter.AUDIO_MODEL,
        contents: [
          {
            text: 'Transcribe this WhatsApp voice note precisely in its original language. Return only the spoken words, without commentary or formatting.',
          },
          {
            inlineData: {
              mimeType,
              data: Buffer.from(audioResponse.data).toString('base64'),
            },
          },
        ],
      }),
      20000,
      'Voice transcription'
    );
    const transcription = String(result?.text || '').trim();
    if (!transcription) {
      console.error('[WhatsApp Transcription] Provider returned an empty transcript for audio id', audio.id);
      return fallbackToTypedRequest();
    }

    // Present the transcript to WF00 exactly like a normal text message so the
    // existing normalization, lead detection and sales-engine nodes continue.
    const message = value.messages[0];
    message.type = 'text';
    message.text = { body: transcription };
    message.original_type = 'audio';
    delete message.audio;
    return res.json(payload);
  } catch (err) {
    console.error('[WhatsApp Transcription Error]', err.response?.data || err.message);
    return fallbackToTypedRequest();
  }
});

const OPENROUTER_MODELS = (process.env.OPENROUTER_MODELS || process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash-lite')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const OPENROUTER_REQUEST_TIMEOUT_MS = Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || 12000);

const withTimeout = (promise, timeoutMs, label) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new OpenRouterServiceError({
          message: `${label} timed out after ${timeoutMs}ms.`,
          status: 504,
          category: 'deadline_exceeded',
          retryable: true,
        }));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

const getOpenRouterStatus = (err) => {
  const value = err?.status ?? err?.code ?? err?.response?.status;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getOpenRouterCategory = (status) => {
  if (status === 429) return 'quota_exceeded';
  if (status === 503) return 'temporarily_unavailable';
  if (status === 504) return 'deadline_exceeded';
  if (status === 401 || status === 403) return 'authentication_or_permission';
  if (status === 404) return 'model_not_found';
  if (status === 400) return 'invalid_request';
  if (status && status >= 500) return 'provider_error';
  return 'network_or_unknown';
};

class OpenRouterServiceError extends Error {
  constructor({ message, status = 502, category, retryable = false, model = null, cause = null }) {
    super(message);
    this.name = 'OpenRouterServiceError';
    this.httpStatus = status;
    this.category = category;
    this.retryable = retryable;
    this.model = model;
    this.cause = cause;
  }
}

const sendAiError = (res, err) => {
  if (!(err instanceof OpenRouterServiceError)) {
    console.error('[AI] Unexpected error:', err);
    return res.status(500).json({
      error: 'AI request failed due to an internal server error.',
      code: 'internal_error',
      retryable: false,
    });
  }

  return res.status(err.httpStatus).json({
    error: err.message,
    code: err.category,
    retryable: err.retryable,
    model: err.model,
  });
};

const BRAND_KEYWORDS = [
  { name: 'BM Academy', pattern: /\b(course|class|syllabus|placement|job[- ]?ready|batch|fees?|academy|training|learn|learning|certification)\b/i },
  // "Digital marketing" alone is intentionally not a TechX switch signal: it is
  // also an Academy course. TechX requires explicit service/business context.
  { name: 'BM TechX', pattern: /\b(bm\s*techx|techx|marketing (service|agency)|digital marketing (service|agency)|run (meta |google )?ads?|grow (my |our )?business|business marketing|website|branding service|generate leads?|lead generation|gmb|seo service|social media service)\b|டெக்\s*எக்ஸ்|பி\.?\s*எம்\.?\s*டெக்\s*எக்ஸ்/iu },
  { name: 'CoreTalents', pattern: /\b(hiring|recruit|candidate|staff|vacancy|resume|coretalents?)\b/i },
  { name: 'Namma Pondy Properties', pattern: /\b(property|plot|villa|land|patta|ec|real estate|jipmer)\b/i },
  { name: 'TravellersNeed', pattern: /\b(trip|tour|package|travel|holiday|pondy tour|travellers?need)\b/i },
  { name: "Dada's Kitchen", pattern: /\b(food|catering|kitchen|order|dada'?s kitchen)\b/i },
  { name: 'EduConsultants', pattern: /\b(study abroad|education abroad|overseas admission|educonsultants?)\b/i },
  { name: 'BM Foundation', pattern: /\b(donation|ngo|charity|volunteer|foundation)\b/i },
];

const BRAND_WEBSITES = {
  'ABM Groups': 'https://abmgroups.in',
  'BM Academy': 'https://thebmacademy.com',
  'BM TechX': 'https://bmtechx.in',
  'Namma Pondy Properties': 'https://nammapondyproperties.com',
  CoreTalents: 'https://coretalents.in',
};
const SHARED_GOOGLE_MAPS_URL = 'https://maps.app.goo.gl/Vc4GAwMjkawSgAyk8';

// Service routing must run before the general brand list. BM Academy is often
// the sticky brand and its course vocabulary may also appear in a business
// owner's request, but these explicit phrases always belong to BM TechX.
const TECHX_SERVICE_PATTERN = /\b(?:bm\s*techx|techx|google\s+(?:my\s+)?business(?:\s+profile)?|google\s+business\s+profile|gmb|marketing\s+(?:service|agency)|digital\s+marketing\s+(?:service|agency)|business\s+services?|run\s+(?:meta\s+|google\s+)?ads?|grow\s+(?:my\s+|our\s+)?business|business\s+marketing|website|branding\s+service|generate\s+leads?|lead\s+generation|seo\s+service|social\s+media\s+service)\b/i;

const detectExplicitBrand = (message = '') => {
  if (TECHX_SERVICE_PATTERN.test(message)) return 'BM TechX';
  return BRAND_KEYWORDS.find(({ pattern }) => pattern.test(message))?.name || null;
};

const resolveActiveBrand = (message = '', history = [], defaultBrand = 'ABM Groups') => {
  const detected = detectExplicitBrand(message);
  if (detected) return detected;
  if (Array.isArray(history)) {
    for (let i = history.length - 1; i >= 0; i--) {
      const turn = history[i];
      const role = turn.role || (turn.direction === 'inbound' ? 'user' : 'assistant');
      if (role === 'user') {
        const txt = turn.text || turn.content || turn.message || '';
        const histDetected = detectExplicitBrand(txt);
        if (histDetected) return histDetected;
      }
    }
  }
  return defaultBrand;
};

// Last-resort brand identification: only reached once keyword matching,
// phone-number lock, and phone_number_id lookup have all failed to find a
// brand. ABM Groups is deliberately excluded as a candidate — it is the
// umbrella company, never a product a lead is actually asking about, so a
// guess of "ABM Groups" is treated the same as "couldn't tell" (null).
const guessBrandWithAI = async (message) => {
  const text = String(message || '').trim();
  if (!text || !ai) return null;
  try {
    const candidates = await Clients.find(
      { status: 'active', name: { $nin: ['ABM Groups', null] } },
      { _id: 0, id: 1, name: 1, type: 1, wa_category: 1, wa_description: 1 }
    ).lean();
    if (candidates.length === 0) return null;

    const brandList = candidates
      .map((c) => `- ${c.name}: ${c.wa_description || c.wa_category || c.type || 'no description'}`)
      .join('\n');
    const prompt = `A WhatsApp lead sent this message to a shared business number covering several unrelated brands:
"${text}"

BRANDS:
${brandList}

Which single brand is this message about? Reply with ONLY the exact brand name from the list above, and nothing else.
If the message is too generic/unclear to confidently tell (e.g. just a greeting, or no brand-specific signal), reply with exactly: UNCLEAR`;

    const raw = (await generateOpenRouterContent(prompt, 0.1)).trim();
    const matched = candidates.find((c) => c.name.toLowerCase() === raw.toLowerCase());
    return matched ? { id: matched.id, name: matched.name } : null;
  } catch (err) {
    console.warn('[Brand Detect] AI guess failed:', err.message);
    return null;
  }
};

const getLeadFirstName = (name) => {
  const cleanName = String(name || '').trim();
  // Empty, numbers only, or too short names return empty to avoid broken greetings
  if (!cleanName || /^\+?\d+$/.test(cleanName) || cleanName.length < 2) return '';
  // Remove special characters and get first valid word
  const sanitized = cleanName.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const firstWord = sanitized.split(/\s+/)[0] || '';
  // Only return if it's a valid name (at least 2 chars, letters only)
  if (firstWord.length >= 2 && /^[a-zA-Z]+$/.test(firstWord)) {
    return firstWord;
  }
  return '';
};

// Romanized Indian languages use the Latin alphabet, so script detection alone
// incorrectly labels messages such as "enaku oru summary pathi therinjikanum"
// as English. Give the reply model an explicit target when the current turn has
// enough strong Tamil markers; the model still mirrors mixed/other languages.
const getResponseLanguageTarget = (message) => {
  const text = String(message || '').trim();
  if (!text) return 'Mirror the language and script style of the current user message.';

  if (/\p{Script=Tamil}/u.test(text)) {
    return 'Tamil in Tamil script. Do not answer in English or romanized Tamil.';
  }

  const words = text.toLowerCase().match(/[a-z]+/g) || [];
  const tamilMarkers = new Set([
    'aama', 'ama', 'enna', 'enaku', 'enakku', 'enga', 'engaluku', 'eppo',
    'epdi', 'eppadi', 'evlo', 'illa', 'illai', 'iruka', 'irukku', 'kanum',
    'konjam', 'kudunga', 'na', 'naan', 'neenga', 'nee', 'oda', 'oru', 'pathi',
    'pannanum', 'pannunga', 'pannuvinga', 'sollunga', 'seri', 'theriji',
    'therinjikanum', 'venam', 'venum', 'vanakkam', 'ungal', 'ungaluku', 'yen'
  ]);
  const markerCount = words.filter((word) => tamilMarkers.has(word)).length;
  if (markerCount >= 2) {
    return 'Romanized Tamil (Tanglish) using Latin letters, matching the user\'s casual spelling. Do not answer in English and do not use Tamil script.';
  }

  return 'Mirror the language, language mix, and script style of the current user message.';
};

const DEFAULT_BOT_BEHAVIOR = `You are the ABM Groups shared WhatsApp assistant.
Use the current contact's first name naturally. For a greeting, reply only:
"Hey {first_name}! 👋 How can I help you today?"
Never recite the ABM Groups brand list as a default greeting.
Keep the detected brand sticky until the user clearly mentions another brand.
"Digital marketing" alone inherits the locked brand: it is an Academy course when
BM Academy is locked. Switch to BM TechX only for explicit service/business intent
such as marketing service, run ads, grow my business, website or lead generation.
Remember information already supplied and never ask for it again.
If a generic family such as digital marketing or full stack has multiple approved
programs or tiers, list the exact options and ask the user to choose. Never invent
an umbrella course, fee, duration or syllabus. Once an exact course is selected,
answer follow-up questions from that same record. A non-greeting question must
never receive the welcome greeting. Treat TechX and Tamil "டெக் எக்ஸ்" as BM TechX.
For bookings, collect missing topic, date, time, name and number. Never claim a
booking, calendar write, reminder or handoff succeeded unless its tool succeeded.
For a voice note, ask the contact to type it. Send exactly one concise reply.`;

// Gemini-only fallback chain (paid key — higher rate limits).
// Tries 4 models in order: if one is busy/overloaded the next kicks in automatically.
// temperature is left undefined (provider default) for creative call sites
// (nurture nudges, objection handling, summaries) so their phrasing keeps
// varying naturally. Only the factual WhatsApp reply path passes a low value.
async function generateOpenRouterContent(prompt, temperature, maxOutputTokens) {
  if (!ai) {
    throw new OpenRouterServiceError({
      message: 'OPENROUTER_API_KEY is not configured on the API server.',
      status: 500,
      category: 'configuration_error',
    });
  }

  let lastFailure = null;
  const errors = [];
  for (const model of OPENROUTER_MODELS) {
    // One bounded attempt per model keeps the entire API request below the
    // reverse-proxy timeout. The next configured model is the retry/fallback.
    for (let attempt = 1; attempt <= 1; attempt += 1) {
      try {
        const generationConfig = {
          ...(temperature !== undefined && { temperature }),
          ...(maxOutputTokens !== undefined && { maxOutputTokens }),
        };
        const aiRes = await withTimeout(
          ai.models.generateContent({
            model,
            contents: prompt,
            ...(Object.keys(generationConfig).length > 0 && { config: generationConfig }),
          }),
          OPENROUTER_REQUEST_TIMEOUT_MS,
          `OpenRouter ${model}`
        );
        const text = aiRes?.text?.trim();
        if (!text) {
          throw new OpenRouterServiceError({
            message: `OpenRouter returned an empty response from ${model}.`,
            status: 502,
            category: 'empty_response',
            retryable: true,
            model,
          });
        }
        console.log(`[AI] ✅ Gemini (${model})`);
        return text;
      } catch (err) {
        const upstreamStatus = getOpenRouterStatus(err);
        const category = err instanceof OpenRouterServiceError
          ? err.category
          : getOpenRouterCategory(upstreamStatus);
        const retryable = err instanceof OpenRouterServiceError
          ? err.retryable
          : upstreamStatus === 429 || upstreamStatus === 503 ||
            upstreamStatus === 504 || (upstreamStatus !== null && upstreamStatus >= 500) ||
            upstreamStatus === null;
        const msg = err?.message || category;
        errors.push(`${model}#${attempt}: ${category} (${upstreamStatus || 'unknown'})`);

        lastFailure = err instanceof OpenRouterServiceError
          ? err
          : new OpenRouterServiceError({
              message: `OpenRouter request failed: ${category}.`,
              status: upstreamStatus === 429 ? 429 : (retryable ? 503 : 502),
              category,
              retryable,
              model,
              cause: err,
            });
        console.warn(`[AI] Gemini (${model}) attempt ${attempt} failed: ${msg}`);
        console.error('[AI] Gemini failure details', { model, attempt, upstreamStatus, category, message: msg });

        // Bad credentials and malformed requests affect every configured model.
        if ([400, 401, 403].includes(upstreamStatus)) throw lastFailure;
        // Do not retry a retired/unknown model; try the next configured model.
        if (upstreamStatus === 404) break;
        if (!retryable || attempt === 1) break;

        const delayMs = (1000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 400);
        await sleep(delayMs);
      }
    }
  }

  console.error('[AI] ❌ All Gemini models exhausted:', errors.join(' | '));
  throw lastFailure || new OpenRouterServiceError({
    message: 'No OpenRouter models are configured.',
    status: 500,
    category: 'configuration_error',
  });
}

// conversations.tenant_id is a foreign key into a legacy `tenants` table that
// was never actually populated per brand — only tenants.id=1 exists. Every
// conversation-creating path in the app (inbound webhook, /api/whatsapp/send,
// campaign sends in server.js) is on this same single seed row. Using a
// lead's clients.id here instead — as this used to, via `client_id as
// tenant_id` — violates that FK for any brand whose id isn't coincidentally
// 1, and even when it didn't error, it silently searched the wrong tenant
// bucket for an existing conversation (real rows all live under tenant_id=1).
const DEFAULT_TENANT_ID = 1;

async function getOrUpsertConversation(lead_id) {
  const existingConversation = await Conversations.findOne({ lead_id }, { id: 1 }).lean();
  if (existingConversation) return existingConversation.id;

  const leadRow = await Leads.findOne({ id: lead_id }, { phone: 1 }).lean();
  const phone = leadRow?.phone || '';
  const tenant_id = DEFAULT_TENANT_ID;
  const leadExists = Boolean(leadRow);
  const safeLeadId = leadExists ? lead_id : null;

  if (phone) {
    const phoneDigits = phone.replace(/\D/g, '');
    const byPhone = await Conversations.findOne({ phone: phoneTailRegex(phoneDigits) }, { id: 1 }).lean();
    if (byPhone) {
      if (safeLeadId) {
        await Conversations.updateOne({ id: byPhone.id }, { $set: { lead_id: safeLeadId } });
      }
      return byPhone.id;
    }
  }

  // ON CONFLICT (phone) DO UPDATE SET lead_id = COALESCE(new, old)
  const samePhone = await Conversations.findOne({ phone }, { id: 1, lead_id: 1 }).lean();
  if (samePhone) {
    if (safeLeadId) await Conversations.updateOne({ id: samePhone.id }, { $set: { lead_id: safeLeadId } });
    return samePhone.id;
  }
  void tenant_id; // tenants were removed from this schema
  const newConv = await Conversations.create({ lead_id: safeLeadId, phone, status: 'open' });
  return newConv.id;
}

// Shared helper: sends a real WhatsApp text to a lead and logs it into
// messages/conversations, same pattern as /communication/send. Used by the
// WF04 journey-action endpoints so each one does real, verifiable work
// instead of returning a bare {success:true} mock.
async function sendWhatsAppText(lead_id, content) {
  const lead = await leadWithClient(lead_id, { phone_number_id: 'phone_number_id', client_wa_token: 'wa_access_token' });
  if (!lead) return { delivered: false, reason: 'lead_not_found' };

  const phoneNumberId = lead.phone_number_id;
  const waAccessToken = lead.client_wa_token;
  if (!phoneNumberId || !waAccessToken) return { delivered: false, reason: 'whatsapp_not_connected' };
  let delivered = false, waMessageId = null;
  if (lead.phone && phoneNumberId && waAccessToken) {
    try {
      const phoneDigits = lead.phone.replace(/\D/g, '');
      const waRes = await axios.post(
        `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
        { messaging_product: 'whatsapp', to: phoneDigits, type: 'text', text: { body: content } },
        { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
      );
      waMessageId = waRes.data?.messages?.[0]?.id || null;
      delivered = true;
    } catch (waErr) {
      console.error('[sendWhatsAppText error]', waErr.response?.data || waErr.message);
    }
  }

  const conversation_id = await getOrUpsertConversation(lead_id);
  await Conversations.updateOne({ id: conversation_id }, { $set: { last_message: content, last_message_at: new Date() } });
  await Messages.create({
    conversation_id, direction: 'outbound', msg_type: 'text', content, wa_msg_id: waMessageId,
    status: delivered ? 'sent' : 'failed', is_ai: false, sent_at: new Date(),
  });

  return { delivered, wa_msg_id: waMessageId };
}

// 1. Deduplicate Lead
router.post('/leads/deduplicate', internalAuth, async (req, res) => {
  const { phone, email } = req.body;
  try {
    const conditions = [];
    if (phone) conditions.push({ phone });
    if (email) conditions.push({ email });

    if (conditions.length === 0) return res.json({ is_duplicate: false });

    const result = { rows: await Leads.find({ $or: conditions }, { _id: 0, id: 1, name: 1, status: 1, score: 1 }).limit(1).lean() };

    if (result.rows.length > 0) {
      res.json({ ...req.body, is_duplicate: true, lead: result.rows[0] });
    } else {
      res.json({ ...req.body, is_duplicate: false });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. Hybrid Brand Detection
router.post('/brand/detect', internalAuth, async (req, res) => {
  const { phone_number_id, phone, message } = req.body;
  try {
    // AllianceOS owns this WhatsApp number. It must never enter LeadOS AI,
    // even if the number also exists in the shared clients configuration.
    if (phone_number_id && String(phone_number_id) === String(process.env.ALLIANCE_WA_PHONE_NUMBER_ID || '')) {
      console.log('[Brand Detect] Blocked AllianceOS callback from LeadOS AI:', phone_number_id);
      return res.status(409).json({ error: 'AllianceOS callback ignored by LeadOS.', ignored: true, owner: 'alliance' });
    }
    if (phone_number_id) {
      let isManaged = false;
      if (phone_number_id === process.env.WA_PHONE_NUMBER_ID) {
        isManaged = true;
      } else {
        if (await Clients.exists({ phone_number_id })) isManaged = true;
      }
      if (!isManaged) {
        console.log('🚫 [Brand Detect] Halted n8n workflow for unmanaged phone_number_id:', phone_number_id);
        return res.status(403).json({ error: 'Unmanaged phone_number_id', ignored: true });
      }
    }

    const leadOSBrand = await getLeadOSBrand();
    let brandId = leadOSBrand.id;
    let brandName = leadOSBrand.name;
    const explicitBrand = null;

    // An explicit keyword is the only reason to switch an existing session.
    if (explicitBrand) {
      const explicitClient = await Clients.findOne({ name: ieq(explicitBrand) }, { id: 1, name: 1 }).lean();
      if (explicitClient) {
        brandId = explicitClient.id;
        brandName = explicitClient.name;
      }
    }

    // Sticky brand: when the message has no switch keyword, retain the brand
    // already assigned to this WhatsApp number.
    if (!brandId && phone) {
      const digits = String(phone).replace(/\D/g, '');
      const phoneLeads = await Leads.find({ phone: phoneTailRegex(digits), client_id: { $ne: null } }, { client_id: 1, updated_at: 1 })
        .sort({ updated_at: -1 }).lean();
      let existingClient = null;
      for (const phoneLead of phoneLeads) {
        existingClient = await Clients.findOne({ id: phoneLead.client_id }, { id: 1, name: 1 }).lean();
        if (existingClient) break;
      }
      if (existingClient) {
        brandId = existingClient.id;
        brandName = existingClient.name;
      }
    }

    if (!brandId && phone_number_id) {
      const numberClient = await Clients.findOne({ phone_number_id }, { id: 1, name: 1 }).lean();
      if (numberClient) {
        brandId = numberClient.id;
        brandName = numberClient.name;
      }
    }

    // Nothing deterministic matched. Ask the model to read the actual message
    // and pick a real brand instead of defaulting straight to the ABM Groups
    // umbrella. If it can't confidently tell either, leave brandId unset —
    // the lead stays unassigned (client_id NULL) rather than getting a
    // placeholder brand baked in. brandName stays 'ABM Groups' purely so the
    // reply-generation prompt still has *some* label to greet with; it is
    // never written to leads.client_id.
    let aiGuessed = false;
    if (!brandId) {
      const guess = await guessBrandWithAI(message);
      if (guess) {
        brandId = guess.id;
        brandName = guess.name;
        aiGuessed = true;
      }
    }

    res.json({
      ...req.body,
      brand_id: brandId,
      brand_name: brandName,
      brand: brandName,
      brand_locked: Boolean(brandId),
      brand_switched: Boolean(explicitBrand) || aiGuessed,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Create or Update Lead
router.post('/leads/createOrUpdate', internalAuth, async (req, res) => {
  const { name, phone, email, source } = req.body;
  try {
    if (!phone) {
      return res.json({ ...req.body, success: true, lead_id: null, ignored: true });
    }

    const brand_id = (await getLeadOSBrand()).id;
    // This runs on every inbound webhook. A plain SELECT-then-INSERT here lets
    // two near-simultaneous events for the same new phone number (a fast
    // follow-up message, or Meta retrying a slow webhook — most likely on the
    // voice-note path, which has real transcription latency) both see "no
    // lead yet" and each create their own lead row for the same person,
    // splitting their conversation across two lead_ids. The second lead_id
    // then has no message history, so it looks like a brand-new contact and
    // gets the welcome message again mid-conversation.
    // leads.phone has no plain UNIQUE constraint (migrate_meta_leads_webhook.js
    // dropped it in favor of a composite UNIQUE(phone, client_id), so one
    // phone can be a separate lead per brand) — and that composite constraint
    // gives no protection here anyway while client_id is still unresolved
    // (NULL), since Postgres never treats two NULLs as conflicting. So this
    // can't be closed with ON CONFLICT; instead take a transaction-scoped
    // advisory lock keyed by the phone number to serialize concurrent
    // requests for the same person before the check-then-insert runs.
    // Serialize concurrent requests for the same phone (replaces pg_advisory_xact_lock)
    const lead_id = await withLock(`lead-phone:${phone}`, async () => {
      const existing = await Leads.findOne({ phone }, { id: 1 }).lean();
      if (existing) {
        const changes = { updated_at: new Date() };
        if (name != null) changes.name = name;
        if (email != null) changes.email = email;
        if (source != null) changes.source = source;
        if (brand_id != null) changes.client_id = brand_id;
        await Leads.updateOne({ id: existing.id }, { $set: changes });
        return existing.id;
      }
      const created = await Leads.create({
        name, phone, email, source, client_id: brand_id, status: 'new', score: 10,
        next_followup_due: new Date(Date.now() + 4 * HOUR_MS),
      });
      return created.id;
    });
    res.json({ ...req.body, success: true, lead_id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// WF01 - Sales Engine Endpoints
// ==========================================

// 1. Intent Detection
router.post('/ai/intent', internalAuth, async (req, res) => {
  const { message, brand, lead_id } = req.body;
  try {
    let effectiveBrand = brand || 'ABM Groups';
    const explicitBrand = null;

    if (lead_id) {
      const currentLead = await leadWithClient(lead_id, { client_name: 'name' });
      const currentBrand = currentLead?.client_name ?? undefined;
      effectiveBrand = currentBrand || effectiveBrand;

      // Persist a switch only for an unambiguous keyword. Phrases such as
      // "digital marketing" have no explicit target and therefore remain in the
      // current locked brand (e.g. the BM Academy course conversation).
      if (explicitBrand && explicitBrand !== currentBrand) {
        const targetClient = await Clients.findOne({ name: ieq(explicitBrand) }, { id: 1, name: 1 }).lean();
        if (targetClient) {
          await Leads.updateOne({ id: lead_id }, { $set: { client_id: targetClient.id, updated_at: new Date() } });
          effectiveBrand = targetClient.name;
        }
      }
    }

    // FIX: Ensure conversation exists safely without constraint errors and log inbound message for bidirectional UI
    if (lead_id && message) {
      const conversation_id = await getOrUpsertConversation(lead_id);
      // The WhatsApp webhook normally persists this message before n8n runs.
      // Insert only when no matching inbound event was saved in the last minute.
      const recentDuplicate = await Messages.exists({
        conversation_id, direction: 'inbound', content: message, sent_at: { $gte: new Date(Date.now() - 60 * 1000) },
      });
      const savedMsg = { rows: [] };
      if (!recentDuplicate) {
        const created = await Messages.create({
          conversation_id, direction: 'inbound', msg_type: 'text', content: message, status: 'delivered', is_ai: false, sent_at: new Date(),
        });
        savedMsg.rows.push({ id: created.id, direction: created.direction, content: created.content, type: created.msg_type, status: created.status, timestamp: created.sent_at });
      }
      if (savedMsg.rows[0]) {
        await Conversations.updateOne(
          { id: conversation_id },
          [{ $set: { last_message: message, last_message_at: '$$NOW', unread_count: { $add: [{ $ifNull: ['$unread_count', 0] }, 1] } } }]
        );
      }
      const io = req.app.get('io');
      if (io && savedMsg.rows[0]) {
        io.emit('incoming_message', { lead_id: Number(lead_id), message: savedMsg.rows[0] });
      }
      await Leads.updateOne(
        { id: lead_id, status: { $nin: ['converted', 'booked', 'opt-out', 'lost', null] }, call_booked_at: null },
        { $set: { touch_count: 0, next_followup_due: new Date(Date.now() + 4 * HOUR_MS), updated_at: new Date() } }
      );
    }

    const prompt = `Analyze this message in the locked brand '${effectiveBrand}'. What is the user's core intent? Choose one: [PRICING, MORE_INFO, BOOK_CALL, NOT_INTERESTED, GENERAL_CHAT, COMPLAINT]. Message: "${message}". Reply ONLY with the intent and confidence score separated by a comma (e.g. PRICING, 95).`;
    const output = await generateOpenRouterContent(prompt);
    const parts = output.split(',');
    const intent = parts[0] ? parts[0].trim() : 'GENERAL';
    const confidence = parts[1] ? parseInt(parts[1].trim()) : 50;

    if (lead_id) {
      await AiDecisions.create({ lead_id, module: 'intent_detection', input: message, output: intent, confidence });
    }
    res.json({ ...req.body, brand: effectiveBrand, brand_locked: true, intent, confidence });
  } catch (err) {
    sendAiError(res, err);
  }
});

// 2. Objection Detection
router.post('/ai/objections', internalAuth, async (req, res) => {
  const { message, brand, lead_id } = req.body;
  try {
    const prompt = `Analyze this message. Does the user have any objections? Choose one: [TOO_EXPENSIVE, NO_TIME, NOT_SURE, USING_COMPETITOR, NONE]. Message: "${message}". Reply ONLY with the objection type.`;
    const objections = await generateOpenRouterContent(prompt);
    res.json({ ...req.body, objections });
  } catch (err) {
    sendAiError(res, err);
  }
});

const KB_MAX_CHARS = Number(process.env.AI_KB_MAX_CHARS || 18000);
const KB_STOP_WORDS = new Set([
  'a', 'all', 'and', 'are', 'available', 'can', 'course', 'courses', 'do',
  'for', 'have', 'i', 'in', 'is', 'list', 'me', 'of', 'please', 'show',
  'tell', 'the', 'to', 'what', 'you', 'your',
]);

const getRecentChatHistory = async (leadId, limit = 12) => {
  if (!leadId) return [];

  const rows = await leadMessages(leadId, hasText, { limit, projection: { _id: 0, direction: 1, content: 1 } });

  return rows.reverse().map((row) => ({
    role: row.direction === 'inbound' ? 'user' : 'assistant',
    text: row.content,
  }));
};

const loadBmAcademyCatalog = async () => {
  return buildBmAcademyCatalog([getApprovedBrandData('BM Academy')]);
};

const normalizeChatHistory = (history) => (
  Array.isArray(history)
    ? history
      .map((item) => ({
        role: item?.role || (item?.direction === 'inbound' ? 'user' : 'assistant'),
        text: String(item?.text ?? item?.content ?? '').trim(),
      }))
      .filter((item) => item.text)
    : []
);

const getRelevantKnowledge = (documents, query = '') => {
  const normalizedQuery = String(query).toLowerCase();
  const wantsCourseList = /\b(all|available|offer|show|what|which)\b.*\b(course|courses|program|programs)\b|\bcourse list\b/i.test(normalizedQuery);
  const queryTerms = [...new Set(
    normalizedQuery
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((term) => term.length > 1 && !KB_STOP_WORDS.has(term))
  )];

  const chunks = documents
    // Support both Markdown modules and the approved BM data-collection form.
    // Course/service records must be independent retrieval chunks; otherwise
    // the 18K cap truncates later records and the model fills gaps from memory.
    .flatMap((document) => String(document || '').split(
      /(?=^#{2,3}\s)|(?=^(?:\d+\.\s*)?Course ID\s*:)|(?=^Service\s+\d+\s*:)|(?=^Service ID\s*:)|(?=^PART\s+\d+\s+[—-])/gmi
    ))
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const ranked = chunks.map((chunk, index) => {
    const lower = chunk.toLowerCase();
    let score = queryTerms.reduce((total, term) => total + (lower.includes(term) ? 5 : 0), 0);
    if (/^## brand_router/im.test(chunk)) score += 2;
    if (wantsCourseList && /PART 2[^\n]*COMPLETE COURSE LIST/i.test(chunk)) score += 100;
    if (wantsCourseList && /Course ID\s*:/i.test(chunk)) score += 1;
    return { chunk, index, score };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const selected = [];
  let length = 0;
  for (const item of ranked) {
    if (item.score <= 0 && selected.length > 0) continue;
    const remaining = KB_MAX_CHARS - length;
    if (remaining <= 0) break;
    const value = item.chunk.slice(0, remaining);
    selected.push(value);
    length += value.length;
    if (selected.length >= 8) break;
  }

  return selected.join('\n\n');
};

// 3. Knowledge Retrieval
router.post('/kb/search', internalAuth, async (req, res) => {
  const { brand, query, lead_id, chat_history } = req.body;
  try {
    // The database is authoritative. Workflow payloads are sometimes empty or
    // contain only the latest turn, which loses the active course/topic.
    let resolvedHistory = lead_id
      ? await getRecentChatHistory(lead_id)
      : normalizeChatHistory(chat_history);
    let targetBrand = brand || 'ABM Groups';
    const normalizedTargetBrandInitial = String(targetBrand).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (normalizedTargetBrandInitial === 'abmgroups') {
      targetBrand = resolveActiveBrand(query, resolvedHistory, targetBrand);
    }
    const normalizedTargetBrand = String(targetBrand).trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    const isBmAcademy = normalizedTargetBrand === 'bmacademy';
    const isBmTechx = ['bmtechx', 'growwithkamar'].includes(normalizedTargetBrand);
    // AIBrainView stores the master multi-brand knowledge under ABM Groups.
    // Load it as a fallback and combine it with any brand-specific documents.
    const brainClients = await Clients.find({ $or: [{ name: ieq(targetBrand) }, { name: /^abm groups$/i }] }, { id: 1, name: 1 }).lean();
    const brainClientById = new Map(brainClients.map((c) => [c.id, c]));
    const docTypeRank = { prompt: 1, product: 2, pricing: 3, training: 4 };
    const docsRes = { rows: (await BrainDocs.find(
      { client_id: { $in: [...brainClientById.keys()] }, doc_type: { $in: ['prompt', 'training', 'product', 'pricing'] } },
      { client_id: 1, doc_type: 1, content: 1 }
    ).lean())
      .map((doc) => ({ client_name: brainClientById.get(doc.client_id).name, doc_type: doc.doc_type, content: doc.content }))
      .sort((a, b) => (lower(a.client_name) === lower(targetBrand) ? 1 : 0) - (lower(b.client_name) === lower(targetBrand) ? 1 : 0)
        || docTypeRank[a.doc_type] - docTypeRank[b.doc_type]) };

    const knowledgeDocs = docsRes.rows
      .filter((doc) => ['prompt', 'product', 'pricing'].includes(doc.doc_type)
        && doc.content
        && (!(isBmAcademy || isBmTechx) || doc.doc_type === 'prompt'))
      .map((doc) => doc.content);
    if (isBmAcademy || isBmTechx) knowledgeDocs.push(getApprovedBrandData(targetBrand));
    const trainingDocs = docsRes.rows
      .filter((doc) => doc.doc_type === 'training' && doc.content)
      .map((doc) => doc.content);
    const courseCatalog = isBmAcademy ? buildBmAcademyCatalog(knowledgeDocs) : [];
    const requestedCourseOptions = isBmAcademy ? findBmAcademyCourseFamily(query, [], courseCatalog) : [];
    const activeCourse = isBmAcademy && requestedCourseOptions.length < 2
      ? resolveBmAcademyCourseContext(query, resolvedHistory, courseCatalog)
      : null;
    // For vague follow-ups ("details", "fees", "duration"), weight the most
    // recently selected course instead of mixing every old course into retrieval.
    const contextualQuery = activeCourse
      ? `${activeCourse.id} ${activeCourse.name} ${activeCourse.name} ${query || ''}`
      : requestedCourseOptions.length > 1
        ? `${requestedCourseOptions.map((course) => course.name).join(' ')} ${query || ''}`
        : [...resolvedHistory.slice(-10).map((item) => item.text), query].filter(Boolean).join(' ');

    // Follow-up questions such as "what is the syllabus?" need the previously
    // selected program in the retrieval query, not only the latest vague turn.
    // BM Academy and BM TechX facts live in one approved markdown file that
    // comfortably fits in the model's context window, so send the whole brand
    // section instead of keyword-scoring it into chunks. Literal word-overlap
    // scoring (e.g. on "google"/"business") is noisy across this document, and
    // folding chat history into the scoring query made two leads asking the
    // identical question retrieve different chunks depending on what they'd
    // said earlier — giving inconsistent answers for the same fact.
    const kb_snippets = (isBmAcademy || isBmTechx)
      ? knowledgeDocs.join('\n\n')
      : getRelevantKnowledge(knowledgeDocs, contextualQuery) || 'No relevant knowledge found.';
    const bmAcademyCourseRule = isBmAcademy
      ? `BM ACADEMY COURSE LIST RULE:
When asked for available courses or the full course list, use every active course and separate tier in PART 2 of the approved BM Academy data collection form. Do not combine Tier 1 and Tier 2, do not invent missing details, and use the matching individual Course ID record as the source of truth. Show course names first, then ask which course needs details.`
      : '';
    const bmAcademySyllabusRule = isBmAcademy
      ? `BM ACADEMY SYLLABUS RULE:
When the user asks for a syllabus, resolve which course(s) they mean from the current message and chat history. Do not type, paraphrase, or invent the syllabus URL yourself — report the matching Course ID(s) in "syllabus_course_ids" as instructed below and the real link is inserted automatically. If no course is identified yet, ask one short course clarification question instead.`
      : '';
    const bmAcademyActiveCourseRule = activeCourse
      ? `ACTIVE BM ACADEMY COURSE: ${activeCourse.name}\nAnswer course-detail follow-ups only about this active course. Do not use details, fees, duration, curriculum, placement claims, or links from any other course. If a requested fact is absent from the knowledge base, say it needs confirmation instead of guessing.`
      : '';
    // Runtime course state goes first for readability. No length cap here:
    // the model's context window is large enough that a silent slice() was
    // just a latent bug waiting for the editable "training" doc in AI Brain
    // to grow past 8k chars and quietly lose rules off the end with no error.
    const system_instructions = [bmAcademyActiveCourseRule, bmAcademySyllabusRule, bmAcademyCourseRule, ...trainingDocs]
      .filter(Boolean)
      .join('\n\n');
    res.json({ ...req.body, chat_history: resolvedHistory, kb_snippets, system_instructions, active_course: activeCourse?.name || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Generate AI Response
router.post('/ai/response', internalAuth, async (req, res) => {
  const { brand, intent, message, kb_snippets, system_instructions, lead_id, chat_history, name } = req.body;
  try {
    let leadName = name || '';
    let leadEmail = '';
    let leadPhone = '';
    let brandAddress = '';
    let persistedBrand = brand || 'ABM Groups';
    let effectiveMessage = String(message || '').trim();
    let isFirstLeadInteraction = false;
    if (lead_id) {
      const contextLead = await leadWithClient(lead_id, { brand_name: 'name', brand_address: 'wa_address' });
      const leadContext = { rows: contextLead ? [{
        name: contextLead.name, email: contextLead.email, phone: contextLead.phone,
        brand_name: contextLead.brand_name, brand_address: contextLead.brand_address,
      }] : [] };
      leadName = leadContext.rows[0]?.name || leadName;
      leadEmail = leadContext.rows[0]?.email || '';
      leadPhone = leadContext.rows[0]?.phone || '';
      brandAddress = leadContext.rows[0]?.brand_address || '';
      persistedBrand = leadContext.rows[0]?.brand_name || persistedBrand;

      // A stale/pinned n8n execution can carry the previous turn (commonly
      // "hi") even after the customer's newer question has been persisted.
      // Prefer that newer inbound text before applying the greeting shortcut.
      const [latestInboundRow] = await leadMessages(lead_id, { direction: 'inbound', ...hasText }, {
        sort: { sent_at: -1, id: -1 }, limit: 1, projection: { _id: 0, content: 1 },
      });
      const latestInbound = String(latestInboundRow?.content || '').trim();

      // Keep the first LeadOS welcome deterministic and contact-aware. This
      // prevents brand training or long form submissions from changing the
      // opening message for each new lead.
      const interactionConversationIds = await leadConversationIds(lead_id);
      const interactionCounts = { rows: [{
        inbound_count: await Messages.countDocuments({ conversation_id: { $in: interactionConversationIds }, direction: 'inbound' }),
        outbound_count: await Messages.countDocuments({ conversation_id: { $in: interactionConversationIds }, direction: 'outbound' }),
      }] };
      isFirstLeadInteraction = Number(interactionCounts.rows[0]?.inbound_count || 0) === 1
        && Number(interactionCounts.rows[0]?.outbound_count || 0) === 0;
      const requestIsGreeting = /^(hi+|hello+|hey+|vanakkam)[\s!.,👋😊🙏]*$/iu.test(effectiveMessage);
      const latestIsGreeting = /^(hi+|hello+|hey+|vanakkam)[\s!.,👋😊🙏]*$/iu.test(latestInbound);
      if (requestIsGreeting && latestInbound && !latestIsGreeting) {
        console.warn('[AI] Replaced stale greeting payload with latest inbound message', {
          lead_id: Number(lead_id),
          stale_message: effectiveMessage,
          latest_message: latestInbound,
        });
        effectiveMessage = latestInbound;
      }

      // Re-evaluate the current turn here as well as in /ai/intent. This keeps
      // brand switching correct even when n8n skips/retries an earlier node.
      // LeadOS conversations remain owned by ABM Groups. Mentions of another
      // business can guide response content, but never mutate lead ownership.
      const explicitBrand = null;
      if (explicitBrand && explicitBrand !== persistedBrand) {
        const targetBrand = await Clients.findOne({ name: ieq(explicitBrand) }, { id: 1, name: 1 }).lean();
        if (targetBrand) {
          persistedBrand = targetBrand.name;
          await Leads.updateOne({ id: lead_id }, { $set: { client_id: targetBrand.id, updated_at: new Date() } });
        }
      }
    }

    const asksForContactNumber = /(?:contact|phone|mobile|whatsapp)\s*(?:number|no\.?\b)|how\s+(?:can|do)\s+i\s+(?:contact|reach|call)|(?:can|could)\s+i\s+(?:get|have)\s+(?:your\s+)?(?:contact|phone|mobile|whatsapp)/i.test(effectiveMessage);
    if (asksForContactNumber) {
      const ai_reply = `You can contact us at ${process.env.PUBLIC_CONTACT_NUMBER}. How else can I help you?`;
      return res.json({ ...req.body, brand: persistedBrand, name: leadName, ai_reply });
    }

    // Deterministic: the very first reply after the Core Talents bulk hiring
    // broadcast (template: hiring_template) always gets the fixed follow-up
    // line below, regardless of content and regardless of the lead's own CRM
    // brand. Campaign CSV imports intentionally never overwrite an existing
    // lead's client_id (see /api/leads/import), so a lead who already existed
    // under another brand keeps that brand's persistedBrand above — relying
    // on the prompt alone to override that "sticky brand" framing was not
    // reliable, so this is enforced here instead of left to the model.
    if (lead_id) {
      const hiringTemplateIds = await Templates.distinct('id', { name: 'hiring_template' });
      const hiringCampaignIds = await Campaigns.distinct('id', { template_id: { $in: hiringTemplateIds } });
      const lastCampaignLog = await CampaignLogs.findOne(
        { lead_id, status: { $nin: ['failed', null] }, campaign_id: { $in: hiringCampaignIds } },
        { sent_at: 1 }
      ).sort({ sent_at: -1 }).lean();

      if (lastCampaignLog) {
        const replyCount = await Messages.countDocuments({
          conversation_id: { $in: await leadConversationIds(lead_id) },
          direction: 'inbound',
          sent_at: { $gt: lastCampaignLog.sent_at },
        });

        if (replyCount === 1) {
          const ai_reply = `For more details, kindly call this number: ${process.env.PUBLIC_CONTACT_NUMBER}.`;
          return res.json({ ...req.body, brand: persistedBrand, name: leadName, ai_reply });
        }
      }
    }

    const firstName = getLeadFirstName(leadName);
    const isSimpleGreeting = /^(hi+|hello+|hey+|vanakkam)[\s!.,👋😊🙏]*$/iu.test(effectiveMessage);

    if (isFirstLeadInteraction && isSimpleGreeting) {
      const wave = '\u{1F44B}';
      const ai_reply = firstName
        ? `Hey ${firstName}! ${wave} How can I help you today?`
        : `Hey! ${wave} How can I help you today?`;
      return res.json({ ...req.body, brand: persistedBrand, name: leadName, ai_reply });
    }

    // Detect voice/audio messages - respond immediately without AI
    const msgContent = effectiveMessage.toLowerCase();
    const isVoiceMessage = msgContent.includes('[voice_message]') ||
                         msgContent.includes('[audio]') ||
                         msgContent.includes('voice note') ||
                         msgContent.includes('🎧');

    if (isVoiceMessage) {
      const voiceReply = "Got your voice note 🎧 — could you type it quickly so I can help right away?";
      return res.json({ ...req.body, ai_reply: voiceReply });
    }

    // Greetings are deterministic so the model can never fall back to the old
    // all-brand recital. This also saves one paid Gemini request.
    if (isSimpleGreeting) {
      const ai_reply = firstName
        ? `Hey ${firstName}! 👋 How can I help you today?`
        : 'Hey! 👋 How can I help you today?';
      return res.json({ ...req.body, brand: persistedBrand, name: leadName, ai_reply });
    }

    let resolvedHistory = lead_id
      ? await getRecentChatHistory(lead_id)
      : normalizeChatHistory(chat_history);

    // Which course(s) a lead means is a language-understanding problem — the
    // model reads the message + chat history and decides that itself (any
    // phrasing, typos, abbreviations, "both"/"all", follow-ups). Code never
    // pattern-matches the request. What code DOES own is the syllabus URL
    // itself: the model reports back which Course ID(s) it resolved to, and
    // the exact URL for those IDs is substituted in below from the approved
    // catalog, so a lead can never receive a link the model typed/invented.
    let effectiveBrand = persistedBrand || 'ABM Groups';
    if (effectiveBrand === 'ABM Groups') {
      effectiveBrand = resolveActiveBrand(effectiveMessage, resolvedHistory, effectiveBrand);
    }
    const isBmAcademy = String(effectiveBrand || '').trim().toLowerCase() === 'bm academy';
    const isBmTechx = ['bmtechx', 'growwithkamar'].includes(String(effectiveBrand || '').trim().toLowerCase().replace(/[^a-z0-9]/g, ''));
    const courseCatalog = isBmAcademy ? await loadBmAcademyCatalog() : [];
    const bmAcademyCourseIndex = isBmAcademy
      ? courseCatalog.map((course) => `${course.id} | ${course.name}`).join('\n')
      : '';
    let historyText = "";
    if (resolvedHistory.length > 0) {
      historyText = "Chat History (oldest to newest):\n" + resolvedHistory.map(h => `${h.role}: ${h.text}`).join("\n") + "\n\n";
    }

    const responseLanguageTarget = getResponseLanguageTarget(effectiveMessage);
    const prompt = `AI BRAIN SYSTEM INSTRUCTIONS (editable in LeadOS):\n${system_instructions || DEFAULT_BOT_BEHAVIOR}\n\n
      NON-NEGOTIABLE ORCHESTRATION RULES:
      - REQUIRED RESPONSE LANGUAGE FOR THIS TURN: ${responseLanguageTarget}
      - Current date/time: ${new Date().toLocaleString('en-US', { timeZone: googleCalendar.TIME_ZONE })} (Local time in ${googleCalendar.TIME_ZONE}). Scheduling timezone: ${googleCalendar.TIME_ZONE}.
      - Reply in the same language the lead's current message is written in, regardless of what language earlier turns used. Judge this by the actual words used, not the script: Tamil/Hindi words typed in English letters (Tanglish/Hinglish, e.g. "eppo course start pannuvinga", "kitna fees hai") are that language, not English — reply in that same romanized Tanglish/Hinglish, not in English and not by switching to Tamil/Devanagari script. If the message is written in native Tamil/Hindi script, reply in that same native script. If the message mixes languages, mirror that mix rather than picking one.
      - Current contact name: "${leadName || 'unknown'}". Current locked brand: "${effectiveBrand}".
      - Address the contact naturally by first name ("${firstName || 'there'}") when useful, but do not repeat their name in every sentence.
      - The brand is sticky. Stay with "${effectiveBrand}" unless the current message explicitly names or clearly keywords another ABM brand.
      - "Digital marketing" alone never switches brands. Under BM Academy it means the course; under BM TechX it means the service.
      - Academy learning signals: course, class, syllabus, batch, fees, training, placement, certification.
      - TechX service signals: marketing service/agency, run ads, business growth, website, branding service, lead generation, GMB or SEO service.
      - For a greeting, reply only: "${firstName ? `Hey ${firstName}! 👋 How can I help you today?` : 'Hey! 👋 How can I help you today?'}"
      - Never recite ABM Groups and its brand list as a default greeting.
      - Never reset the conversation or ask again for information already present in chat history.
      - Use chat history for topic and selection memory only. Previous assistant messages are not a factual source; never reuse an old fee, duration, claim, or URL unless it also appears in the current approved KNOWLEDGE BASE REFERENCE.
      - Resolve follow-up phrases such as "this course", "that course", "it", "details", "fees", "duration", and "the syllabus" to the most recently selected course/topic in chat history.
      - If a course was identified earlier, keep it as the active course until the user explicitly selects a different course. Do not ask "which course?" again for a follow-up about that active course.
      - If the user asks a FAQ (like contact number, timings, or fees) mid-booking, provide the answer inline and immediately resume the booking flow. Do not reset the conversation or ask for information again.
      - When a lead requests a call, meeting, or demo, you MUST ask: "Would you prefer an online video meeting via Google Meet or a normal phone call?"
      - If they choose Google Meet (video meeting): Proceed with Google Calendar booking (collect date, time, name, and email one field at a time). Only ask for email if they choose Google Meet.
      - If they choose a normal phone call: Do NOT ask for email and do NOT trigger calendar booking. Directly reply with the contact number "80725 03693" and tell them to call us directly, or ask for their preferred time so we can call them back.
      - If the lead gave a date in an earlier message and now gives only a time (or vice versa), combine them from chat history into one extracted_booking_time instead of asking for the date again.
      - Send exactly one concise WhatsApp reply for this user message.
      - Never claim a booking, calendar entry, reminder, or handoff succeeded unless the corresponding workflow result confirms it.
      - If the lead clearly wants to cancel or call off their already-booked meeting, set cancel_meeting to true and do not say it's cancelled yourself in "reply" — the real Calendar outcome is reported automatically and overrides your reply text for this case.

      VERIFIED BRAND CONTACT FACTS (use exactly as given if the lead asks for these, whether alone or combined with anything else in the same message — never invent or alter them):
      Office Address: ${brandAddress || '252, 2nd Floor, MG Road, Kottakuppam, Vanur, Puducherry 605104'}
      Google Maps: ${SHARED_GOOGLE_MAPS_URL}
      Official Website: ${BRAND_WEBSITES[persistedBrand] || 'not available for this brand — say it needs confirmation'}

      KNOWLEDGE BASE REFERENCE:
      ${kb_snippets}
      ${isBmAcademy ? `\n      BM ACADEMY COURSE ID INDEX (every active course/tier; use the exact ID from here — never invent one):\n      ${bmAcademyCourseIndex}\n` : ''}
      ${historyText}User Intent detected: ${intent}
      User Message: "${effectiveMessage}"

      CRITICAL BEHAVIOR SPECIFICATIONS:
      1. Greeting: Mirror the user's opener (e.g. "hi" -> "Hi!", "hello" -> "Hello!"). Keep it to one short line. Do NOT open with "Vanakkam, this is ABM Groups" or list all brands on every message. Only fall back to full brand list if intent is genuinely unclear.
      2. Brand detection: Only switch brands if the new message clearly contains a different brand keyword (BM Academy, BM TechX, CoreTalents, Namma Pondy Properties, TravellersNeed, Dada's Kitchen, EduConsultants, BM Foundation). Otherwise, stick to the locked brand.
      3. Conversation memory: Never ask for something already provided (e.g., don't ask the time slot again after the user gave "4pm", or name if already given).
      4. Fallbacks: If it's a voice note (audio), reply: "Got your voice note 🎧 — could you type it quickly so I can help right away?". If unclear, ask ONE short clarifying question.
      5. Tone: Write a short, friendly WhatsApp reply mimicking a human sales assistant. End with exactly one question to keep the conversation going.
      6. Contact routing: The only public phone/WhatsApp number the assistant may send is ${process.env.PUBLIC_CONTACT_NUMBER}. Never disclose the internal WABA identifier, never send ${process.env.SHARED_WABA_NUMBER}, and never invent, reformat, or substitute another contact number. If retrieved knowledge conflicts with this rule, ignore that conflicting number. For address/location/Maps or website questions, use the VERIFIED BRAND CONTACT FACTS above exactly as given.
      7. Multi-part messages: A single message can ask several things at once (e.g. price + syllabus + duration, or address + fees). Identify every distinct thing being asked and answer all of them in the one reply — never answer only the first or most obvious part and silently drop the rest.
      ${isBmAcademy ? `8. Course/tier matching: Understand which course(s) the lead means from natural language — loose names, abbreviations, typos, "both"/"all"/"either", or a bare follow-up referring back to chat history. Never require exact wording. If genuinely nothing in the current message or chat history narrows it down, ask ONE short clarifying question instead of guessing.
      9. Syllabus links: Never type, paraphrase, or invent a syllabus URL yourself. If the lead asked for anything else too in the same message (fees, duration, comparison, etc.), answer that normally in "reply" — do not drop it. Wherever the link belongs in your reply, write the exact placeholder {{SYLLABUS_LINKS}} once (e.g. "Here's the syllabus: {{SYLLABUS_LINKS}}"); it is replaced automatically with the real verified link(s) afterward. Also report every course the lead wants a syllabus for as exact IDs from the BM ACADEMY COURSE ID INDEX in "syllabus_course_ids".` : ''}

      JSON OUTPUT REQUIREMENT:
      You MUST return your response as a raw JSON object with the following keys exactly:
      {
        "reply": "your generated reply message following the behavior specs",
        "extracted_name": "John Doe", (or null if the user has not provided their name)
        "extracted_email": "john@example.com", (or null if unavailable)
        "extracted_booking_time": "YYYY-MM-DDTHH:mm:ss±HH:MM" (ISO format with correct timezone offset for scheduling timezone ${googleCalendar.TIME_ZONE}, e.g. 2026-07-25T16:00:00+05:30, or null if the user has not provided a preferred date/time for a call),
        "cancel_meeting": false (true ONLY if the lead is clearly asking to cancel/call off their already-booked meeting)${isBmAcademy ? `,
        "syllabus_course_ids": ["BMA-CFSD-010"] (array of Course IDs from the BM ACADEMY COURSE ID INDEX the lead wants a syllabus for; empty array [] if this message isn't a syllabus request or no course is identified yet)` : ''}
      }
      Respond ONLY with the JSON object, no markdown formatting, no backticks.`;

    // Low temperature: this reply must state facts (services, fees, links)
    // consistently from the KNOWLEDGE BASE REFERENCE rather than varying
    // wording/hedging between two leads who ask the same factual question.
    // Generous max_tokens: with no cap, the provider's own default applied —
    // small enough that a full BM Academy course listing (a couple dozen
    // course/tier names, wrapped in the required JSON) could get cut off
    // mid-array. That produces invalid JSON, which falls back to the raw,
    // truncated text below — showing up as "half the course list" or a
    // reply that just stops. Longer chat history eats into the same budget,
    // so this got worse the further into a conversation a lead was, which
    // is why some testers saw it and others didn't.
    const rawAiResponse = await generateOpenRouterContent(prompt, 0.2, 3000);
      
    let ai_reply = "I'm sorry, I couldn't process that. Can you repeat?";
    let extractedData = null;

    try {
      const cleanJsonStr = rawAiResponse.replace(/\s*```json\s*/gi, '').replace(/\s*```\s*/g, '').trim();
      extractedData = JSON.parse(cleanJsonStr);
      ai_reply = extractedData.reply || rawAiResponse;

      // Ground truth substitution: the model decided WHICH course(s) the
      // lead means (that's the language-understanding part it's good at);
      // the actual URL sent always comes from our own catalog by exact
      // Course ID, so a hallucinated or stale link can never reach a lead.
      // This only swaps the {{SYLLABUS_LINKS}} placeholder for the verified
      // link(s) — it must NOT replace the whole reply, or anything else the
      // model correctly answered in the same message (fees, comparisons,
      // etc.) gets silently discarded along with it.
      if (isBmAcademy && Array.isArray(extractedData.syllabus_course_ids) && extractedData.syllabus_course_ids.length) {
        const matchedCourses = extractedData.syllabus_course_ids
          .map((id) => courseCatalog.find((course) => course.id === id))
          .filter(Boolean);
        if (matchedCourses.length) {
          const lines = matchedCourses.map((course) => {
            const hasUrl = course.syllabusUrl && !/^(no|nil|needs_confirmation|not_applicable)$/i.test(course.syllabusUrl);
            return hasUrl ? `${course.name}: ${course.syllabusUrl}` : `${course.name}: syllabus needs confirmation`;
          });
          const verifiedLinks = matchedCourses.length > 1
            ? lines.join('\n')
            : lines[0].slice(lines[0].indexOf(': ') + 2);
          // Safety net: if the model forgot the placeholder despite the
          // instruction, append the verified link(s) rather than silently
          // losing them — better shown twice than never sent.
          ai_reply = ai_reply.includes('{{SYLLABUS_LINKS}}')
            ? ai_reply.replaceAll('{{SYLLABUS_LINKS}}', verifiedLinks)
            : `${ai_reply}\n\n${verifiedLinks}`;
        }
      }

      if (lead_id) {
         if (extractedData.extracted_name) {
           await Leads.updateOne({ id: lead_id }, { $set: { name: extractedData.extracted_name } });
         }
         if (extractedData.extracted_email) {
           leadEmail = String(extractedData.extracted_email).trim();
           await Leads.updateOne({ id: lead_id }, { $set: { email: leadEmail, updated_at: new Date() } });
         }

         // The model decided the lead wants to cancel (language understanding);
         // the actual cancellation is a real Calendar delete here, and the
         // reply is overwritten with the true outcome — never the model's own
         // prose — so a lead can never be told "cancelled" when it wasn't.
         if (extractedData.cancel_meeting) {
           try {
             const cancelResult = await googleCalendar.cancelMeeting(lead_id);
             if (cancelResult.cancelled) {
               await Leads.updateOne({ id: lead_id }, { $set: {
                 booking_status: 'cancelled', calendar_event_id: null, calendar_event_url: null,
                 google_meet_link: null, call_booked_at: null, updated_at: new Date(),
               } });
               ai_reply = 'Your meeting has been cancelled.';
             } else {
               ai_reply = "I couldn't find an upcoming meeting booked for you to cancel.";
             }
           } catch (cancelError) {
             console.error('[AI Booking] Calendar cancellation failed:', cancelError.message);
             ai_reply = "I'm unable to reach Calendar right now, so I couldn't cancel your meeting. Please try again shortly.";
           }
           // Only stop here if this message was purely a cancellation. If the
           // lead also gave a new time in the same message, fall through so
           // the block below books it fresh (the old event is now gone, so
           // this creates a new event instead of confusingly rescheduling it).
           if (!extractedData.extracted_booking_time) {
             return res.json({ ...req.body, brand: persistedBrand, name: leadName, ai_reply, booking_status: 'cancelled' });
           }
         }

         if (extractedData.extracted_booking_time) {
           if (!leadEmail) {
             ai_reply = 'Please share your email address so I can check the slot and send the Calendar and Google Meet invitation.';
             await Leads.updateOne({ id: lead_id }, { $set: { booking_status: 'awaiting_email', updated_at: new Date() } });
             return res.json({ ...req.body, ai_reply, booking_status: 'awaiting_email' });
           }
           try {
             const calendarBooking = await googleCalendar.bookMeeting({
               leadId: lead_id,
               brand: persistedBrand,
               name: extractedData.extracted_name || leadName,
               email: leadEmail,
               phone: leadPhone,
               start: extractedData.extracted_booking_time,
               notes: `Booked from the LeadOS WhatsApp AI conversation.`,
             });
             if (calendarBooking.booked) {
               await Leads.updateOne({ id: lead_id }, { $set: {
                 call_booked_at: calendarBooking.start, status: 'booked', booking_status: 'confirmed',
                 calendar_event_id: calendarBooking.event_id, calendar_event_url: calendarBooking.event_url,
                 google_meet_link: calendarBooking.meet_link, updated_at: new Date(),
               } });
               await ensureSalesTask(req, lead_id, 'call');
               try {
                 await sendBookingNotification({
                   eventId: calendarBooking.event_id,
                   brand: persistedBrand,
                   name: extractedData.extracted_name || leadName,
                   email: leadEmail,
                   phone: leadPhone,
                   start: calendarBooking.start,
                   eventUrl: calendarBooking.event_url,
                   meetLink: calendarBooking.meet_link,
                   rescheduled: calendarBooking.rescheduled,
                 });
               } catch (notificationError) {
                 console.error('[AI Booking] Support email notification failed:', notificationError.message);
               }
               ai_reply = `Your meeting is confirmed for ${new Date(calendarBooking.start).toLocaleString('en-IN', { timeZone: googleCalendar.TIME_ZONE, dateStyle: 'medium', timeStyle: 'short' })}.${calendarBooking.meet_link ? ` Google Meet: ${calendarBooking.meet_link}` : ''}`;
               console.log(`[AI Booking] Lead ${lead_id} booked in Google Calendar for ${calendarBooking.start}`);
             } else {
               await Leads.updateOne({ id: lead_id }, { $set: { booking_status: 'slot_unavailable', updated_at: new Date() } });
               ai_reply = 'That time is already occupied. Please share another preferred date and time, and I’ll check availability.';
             }
           } catch (calendarError) {
             const calendarDisconnected = /not connected|oauth is not configured|refresh token/i.test(calendarError.message);
             const failedStatus = calendarDisconnected ? 'calendar_not_connected' : 'calendar_error';
             await Leads.updateOne({ id: lead_id }, { $set: { booking_status: failedStatus, updated_at: new Date() } });
             await ensureSalesTask(req, lead_id, 'hot_lead');
             ai_reply = 'I’m unable to verify Calendar availability right now, so your meeting is not booked yet. Please try again shortly.';
             console.error('[AI Booking] Calendar automation failed:', calendarError.message);
           }
         }
      }
    } catch (parseErr) {
      console.error("Failed to parse Gemini JSON:", parseErr.message, rawAiResponse);
      // A truncated response still has a well-formed "reply" value up to the
      // cut point (only later fields/closing braces are missing) — salvage
      // that instead of showing the lead raw, escaped JSON syntax.
      const replyMatch = rawAiResponse.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)/);
      ai_reply = replyMatch
        ? replyMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        : rawAiResponse;
    }

    // A non-greeting customer question must never be answered with the welcome
    // message. This protects against provider context loss or stale executions.
    const returnedGreeting = /^(hey|hi|hello|vanakkam)\b[^?!.]*(how can i help|what can i help)/i.test(String(ai_reply).trim());
    if (!isSimpleGreeting && returnedGreeting) {
      ai_reply = effectiveBrand === 'BM TechX'
        ? 'Yes, BM TechX provides website development and related digital services. What type of website or web-development support do you need?'
        : 'I have your previous messages and will continue from that topic. What specific detail would you like next?';
    }
    res.json({ ...req.body, brand: effectiveBrand, ai_reply });
  } catch (err) {
    // Keep the WhatsApp workflow moving when every AI model is temporarily
    // slow/unavailable. HTTP 200 prevents an nginx/n8n 504 failure.
    if (err instanceof OpenRouterServiceError && err.retryable) {
      console.error('[AI] Returning safe fallback after provider timeout:', err.message);
      return res.json({
        ...req.body,
        ai_reply: "I'm taking a little longer than usual. Please send that once more, and I'll help you right away.",
        ai_fallback: true,
        ai_error_code: err.category,
      });
    }
    sendAiError(res, err);
  }
});

// 5. Qualify And Score - DETERMINISTIC FORMULA (no LLM involvement)
router.post('/leads/score', internalAuth, async (req, res) => {
  const { lead_id, message, intent, objections } = req.body;
  try {
    let scoreBoost = 0;

    // Intent-based scoring (deterministic)
    if (intent === 'BOOK_CALL' || intent === 'PRICING') scoreBoost = 20;
    else if (intent === 'NOT_INTERESTED') scoreBoost = -20;
    else if (intent === 'MORE_INFO' || intent === 'GENERAL_CHAT') scoreBoost = 5;
    else if (intent === 'COMPLAINT') scoreBoost = -15;
    else scoreBoost = 5; // Default

    // Objection-based scoring (deterministic)
    if (objections) {
      const obj = String(objections).toLowerCase();
      if (obj.includes('too_expensive') || obj.includes('no_time')) scoreBoost -= 10;
      if (obj.includes('not_sure')) scoreBoost -= 5;
      if (obj.includes('using_competitor')) scoreBoost -= 10;
    }

    const scored = await Leads.findOneAndUpdate(
      { id: lead_id },
      [{ $set: { score: { $min: [{ $max: [{ $add: ['$score', Number(scoreBoost)] }, 0] }, 100] }, updated_at: '$$NOW' } }],
      { new: true, projection: { _id: 0, score: 1 } }
    ).lean();
    const result = { rows: scored ? [scored] : [] };

    console.log(`[Lead Scoring] Lead ${lead_id}: intent=${intent}, objections=${objections}, boost=${scoreBoost}, new_score=${result.rows[0]?.score}`);
    res.json({ ...req.body, lead_score: result.rows[0]?.score || 10 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Assign Owner
router.post('/leads/assign-owner', internalAuth, async (req, res) => {
  const { lead_id, brand, lead_score, intent } = req.body;
  try {
    let owner = 'System (AI)';
    if (lead_score >= 75) {
      // For hot leads, try to find a real human user; fallback to 'Sales Team' group
      const salesUser = await Users.findOne({ role: { $in: ['admin', 'agent', 'sales'] }, is_active: true }, { id: 1 }).sort({ created_at: 1 }).lean();
      if (salesUser) {
        owner = String(salesUser.id);
      } else {
        owner = 'Sales Team';
      }
    }

    await Leads.updateOne({ id: lead_id }, { $set: { owner } });
    if (lead_score >= 75) await ensureSalesTask(req, lead_id, 'hot_lead');
    res.json({ ...req.body, owner });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Update CRM
router.post('/leads/update', internalAuth, async (req, res) => {
  const { lead_id, stage, owner, lead_score, intent } = req.body;
  try {
    let status = 'new';
    if (lead_score >= 75) status = 'hot';
    else if (lead_score >= 40) status = 'warm';
    else if (lead_score < 10) status = 'cold';

    await Leads.updateOne({ id: lead_id }, { $set: {
      ...(status != null ? { status } : {}),
      ...(owner != null ? { owner } : {}),
      updated_at: new Date(),
    } });
    if (status === 'hot') await ensureSalesTask(req, lead_id, 'hot_lead');
    res.json({ ...req.body, success: true, status });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// 8. Send Communication
router.post('/communication/send', internalAuth, async (req, res) => {
  const { lead_id, channel, type, content } = req.body;
  try {
    const safeContent = content || "Thank you for reaching out to ABM Groups! We have received your message and will get back to you shortly.";
    const msgType = type || 'text';

    // 1. Fetch lead & client details to get phone number, phone_number_id, and access token for Meta Cloud API
    const lead = await leadWithClient(lead_id, { phone_number_id: 'phone_number_id', client_wa_token: 'wa_access_token' });
    const phoneNumberId = lead?.phone_number_id;
    const waAccessToken = lead?.client_wa_token;
    if (channel === 'whatsapp' && lead && (!phoneNumberId || !waAccessToken)) {
      return res.status(409).json({ error: 'WhatsApp is not connected for this workspace. Connect WhatsApp in Settings first.', code: 'WHATSAPP_NOT_CONNECTED' });
    }

    // 2. Send real outbound message via Meta WhatsApp Cloud API (`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`)
    let waMessageId = null;
    if (channel === 'whatsapp' && lead && lead.phone && phoneNumberId && waAccessToken) {
      try {
        const phoneDigits = lead.phone.replace(/\D/g, '');
        const payload = {
          messaging_product: 'whatsapp',
          to: phoneDigits,
          type: 'text',
          text: { body: safeContent }
        };

        console.log(`[Send Communication] Sending AI WhatsApp response to ${phoneDigits} via Meta API...`);
        const waRes = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          payload,
          { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
        );
        waMessageId = waRes.data?.messages?.[0]?.id || null;
        console.log(`✅ [Send Communication] Meta WhatsApp delivered successfully! Message ID: ${waMessageId}`);
      } catch (waErr) {
        console.error(`⚠️ [Send Communication] Meta Graph API Error:`, waErr.response?.data || waErr.message);
      }
    }

    // 3. Upsert conversation in DB and update last_message timestamp so it jumps to top of LeadOS Inbox!
    const conversation_id = await getOrUpsertConversation(lead_id);
    await Conversations.updateOne({ id: conversation_id }, { $set: { last_message: safeContent, last_message_at: new Date() } });

    // 4. Insert message into messages table
    const savedMessage = await Messages.create({
      conversation_id, direction: 'outbound', msg_type: msgType, content: safeContent, wa_msg_id: waMessageId,
      status: 'sent', is_ai: true, sent_at: new Date(),
    });
    const savedRows = [{
      id: savedMessage.id, direction: savedMessage.direction, content: savedMessage.content, type: savedMessage.msg_type,
      wa_msg_id: savedMessage.wa_msg_id, status: savedMessage.status, is_ai: savedMessage.is_ai, timestamp: savedMessage.sent_at,
    }];

    // 5. Emit real-time Socket.IO event so LeadOS WhatsApp Inbox UI updates instantly without page refresh
    try {
      const io = req.app?.get('io') || global.io;
      if (io) {
        io.emit('outgoing_message', { lead_id: Number(lead_id), message: savedRows[0] });
        io.emit('message_sent', { lead_id: Number(lead_id), message: savedRows[0] });
        io.emit('incoming_message', { lead_id: Number(lead_id), message: savedRows[0] });
        io.emit('ai_typing', { lead_id: String(lead_id), typing: false });
      }
    } catch (ioErr) {
      console.warn('Socket emit warning:', ioErr.message);
    }

    res.json({ ...req.body, success: true, delivered: true, content: safeContent, wa_msg_id: waMessageId });
  } catch (err) {
    console.error('[Send Communication Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── SEND TO FOUNDER (WF06 REPORT) ──────────────────────
router.post('/communication/send-founder', internalAuth, async (req, res) => {
  const { channel, type, content } = req.body;
  try {
    const founderPhone = process.env.FOUNDER_WHATSAPP_PHONE;
    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const waAccessToken = process.env.META_PAGE_ACCESS_TOKEN;

    let waMessageId = null;
    if (channel === 'whatsapp' && founderPhone && phoneNumberId && waAccessToken) {
      try {
        const phoneDigits = founderPhone.replace(/\D/g, '');
        const payload = {
          messaging_product: 'whatsapp',
          to: phoneDigits,
          type: 'text',
          text: { body: content }
        };

        console.log(`[Send Founder Report] Sending to ${phoneDigits} via Meta API...`);
        const waRes = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          payload,
          { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
        );
        waMessageId = waRes.data?.messages?.[0]?.id || null;
        console.log(`✅ [Send Founder Report] Meta WhatsApp delivered successfully! Message ID: ${waMessageId}`);
      } catch (waErr) {
        console.error(`⚠️ [Send Founder Report] Meta Graph API Error:`, waErr.response?.data || waErr.message);
      }
    }

    // Founder reports are platform-level: logged with no workspace (FounderReportsView).
    await recordPlatformWorkflowLog({ workflow: 'WF06', status: 'success', message: content });

    res.json({ success: true, delivered: true, content, wa_msg_id: waMessageId });
  } catch (err) {
    console.error('[Send Founder Report Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 9. Workflow Logger
// Workspace workflows (WF00–WF05): the n8n engine with the service key and
// x-tenant-id, stored in that workspace. Customer sessions cannot write engine
// logs, and platform workflows (WF06/WF07) are refused here.
router.post('/workflows/log', internalAuth, async (req, res) => {
  if (req.identity?.kind !== 'service') {
    return res.status(403).json({ error: 'Workflow logs are written by the workflow engine only', code: 'SERVICE_ONLY' });
  }
  try {
    const log = await recordTenantWorkflowLog(req.body || {});
    res.json({ success: true, id: log.id, scope: 'tenant' });
  } catch (err) {
    if (err instanceof WorkflowLogError) return res.status(err.status).json({ error: err.message, code: err.code });
    res.status(500).json({ error: 'Could not record the workflow log' });
  }
});

// Platform workflows (WF06/WF07): the n8n engine with the service key and no
// workspace. Stored with tenant_id = null so they are never shown as, or mixed
// with, a workspace's events.
router.post('/platform/workflows/log', (req, res, next) => {
  if (!hasInternalKey(req)) return res.status(401).json({ error: 'Service key required', code: 'SERVICE_ONLY' });
  if (req.headers['x-tenant-id']) {
    return res.status(400).json({ error: 'Platform workflow logs do not belong to a workspace; omit x-tenant-id', code: 'PLATFORM_LOG_NO_TENANT' });
  }
  return next();
}, async (req, res) => {
  try {
    const log = await recordPlatformWorkflowLog(req.body || {});
    res.json({ success: true, id: log.id, scope: 'platform' });
  } catch (err) {
    if (err instanceof WorkflowLogError) return res.status(err.status).json({ error: err.message, code: err.code });
    res.status(500).json({ error: 'Could not record the workflow log' });
  }
});

router.get('/workflows/logs', internalPlatformAuth, async (req, res) => {
  try {
    const logs = await WorkflowLogs.find({}, { _id: 0, id: 1, workflow: 1, lead_id: 1, status: 1, message: 1, created_at: 1 })
      .sort({ created_at: -1 }).limit(1000).lean();
    const logLeadIds = [...new Set(logs.map((w) => Number(w.lead_id)).filter(Number.isFinite))];
    const logLeads = new Map((await Leads.find({ id: { $in: logLeadIds } }, {
      id: 1, name: 1, source: 1, campaign_name: 1, campaign_id: 1, ad_name: 1, ad_id: 1, lead_ad_form_id: 1, meta_lead_id: 1, phone: 1, email: 1,
    }).lean()).map((l) => [String(l.id), l]));
    const rows = logs.map((w) => {
      const l = logLeads.get(String(w.lead_id));
      return {
        ...w,
        lead_name: l?.name ?? null, source: l?.source ?? null, campaign_name: l?.campaign_name ?? null, campaign_id: l?.campaign_id ?? null,
        ad_name: l?.ad_name ?? null, ad_id: l?.ad_id ?? null, lead_ad_form_id: l?.lead_ad_form_id ?? null,
        meta_lead_id: l?.meta_lead_id ?? null, phone: l?.phone ?? null, email: l?.email ?? null,
      };
    });
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/workflows/logs/:id', internalPlatformAuth, async (req, res) => {
  try {
    const result = await WorkflowLogs.deleteOne({ id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Log not found' });
    res.json({ success: true, deleted_id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/workflows/telemetry', internalPlatformAuth, async (req, res) => {
  try {
    // 1. Total executions
    const totalExecutions = await WorkflowLogs.countDocuments();

    // 2. Success Rate (null when nothing has run: no rate to report yet)
    const successCount = await WorkflowLogs.countDocuments({ status: 'success' });
    const successRate = totalExecutions > 0 ? Math.round((successCount / totalExecutions) * 100) : null;

    // 3. AI Interventions
    const aiInterventions = await AiDecisions.countDocuments();

    // 4. Workflows that logged at least once in the last 7 days
    const activeWorkflows = (await WorkflowLogs.distinct('workflow', { created_at: { $gte: new Date(Date.now() - 7 * 86400000) } })).length;

    res.json({
      telemetry: {
        totalExecutions,
        successRate,
        aiInterventions,
        activeWorkflows
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// WF03 & WF06 - Reporting & Dashboard
// ==========================================

// Authoritative WF06 snapshot. Starting from clients guarantees that every
// configured brand is present, including brands which currently have no data.
router.get('/reports/founder-dashboard', internalPlatformAuth, async (req, res) => {
  try {
    const today = startOfUtcDay();
    const monthStart = startOfUtcMonth();
    const [allClients, allLeads, allConversations, allCampaigns, allPayments] = await Promise.all([
      Clients.find({}, { id: 1, name: 1, status: 1 }).sort({ name: 1 }).lean(),
      Leads.find({}, { id: 1, client_id: 1, status: 1, created_at: 1, next_followup_due: 1, source: 1 }).lean(),
      Conversations.find({}, { lead_id: 1, created_at: 1 }).lean(),
      Campaigns.find({}, { client_id: 1, status: 1 }).lean(),
      Payments.find({ status: 'captured' }, { lead_id: 1, amount: 1, created_at: 1 }).lean(),
    ]);
    const clientOfLead = new Map(allLeads.map((l) => [l.id, l.client_id]));
    const brandResult = { rows: allClients.map((c) => {
      const leads = allLeads.filter((l) => l.client_id === c.id);
      const conversations = allConversations.filter((cv) => clientOfLead.get(cv.lead_id) === c.id);
      const campaigns = allCampaigns.filter((cp) => cp.client_id === c.id);
      const payments = allPayments.filter((p) => clientOfLead.get(p.lead_id) === c.id);
      const sum = (items) => items.reduce((total, p) => total + (Number(p.amount) || 0), 0);
      return {
        brand_id: c.id, brand: c.name, brand_status: c.status,
        leads: leads.length,
        leads_today: leads.filter((l) => l.created_at >= today).length,
        conversions: leads.filter((l) => lower(l.status) === 'converted').length,
        hot_leads: leads.filter((l) => lower(l.status) === 'hot').length,
        followups_pending: leads.filter((l) => l.next_followup_due != null && !['converted', 'closed', 'lost', 'opt-out'].includes(lower(l.status))).length,
        conversations: conversations.length,
        conversations_today: conversations.filter((cv) => cv.created_at >= today).length,
        campaigns: campaigns.length,
        active_campaigns: campaigns.filter((cp) => ['scheduled', 'running'].includes(cp.status)).length,
        revenue: sum(payments),
        revenue_today: sum(payments.filter((p) => p.created_at >= today)),
        revenue_month: sum(payments.filter((p) => p.created_at >= monthStart)),
      };
    }) };
    const clientNames = new Map(allClients.map((c) => [c.id, c.name]));
    const sourceCounts = new Map();
    for (const l of allLeads) {
      const brand = clientNames.get(l.client_id) ?? 'Unassigned';
      const source = String(l.source ?? '').trim() || 'Unknown';
      const key = `${brand}\u0000${source}`;
      sourceCounts.set(key, (sourceCounts.get(key) || 0) + 1);
    }
    const sourceResult = { rows: [...sourceCounts].map(([key, count]) => {
      const [brand, source] = key.split('\u0000');
      return { brand, source, count };
    }).sort((a, b) => a.brand.localeCompare(b.brand) || b.count - a.count) };

    const brands = brandResult.rows.map(row => ({
      ...row,
      revenue: Number(row.revenue),
      revenue_today: Number(row.revenue_today),
      revenue_month: Number(row.revenue_month),
      conversion_rate: row.leads ? Number(((row.conversions / row.leads) * 100).toFixed(2)) : 0,
      lead_sources: sourceResult.rows.filter(source => source.brand === row.brand),
    }));
    const sum = key => brands.reduce((total, brand) => total + Number(brand[key] || 0), 0);
    const totals = {
      brands: brands.length,
      active_brands: brands.filter(brand => brand.brand_status === 'active').length,
      leads: sum('leads'), leads_today: sum('leads_today'),
      conversations: sum('conversations'), conversations_today: sum('conversations_today'),
      campaigns: sum('campaigns'), active_campaigns: sum('active_campaigns'),
      conversions: sum('conversions'), hot_leads: sum('hot_leads'),
      followups_pending: sum('followups_pending'), revenue: sum('revenue'),
      revenue_today: sum('revenue_today'), revenue_month: sum('revenue_month'),
    };
    totals.conversion_rate = totals.leads
      ? Number(((totals.conversions / totals.leads) * 100).toFixed(2)) : 0;

    res.json({ generated_at: new Date().toISOString(), scope: 'all_brands', totals, brands });
  } catch (err) {
    console.error('[Founder Dashboard Report Error]', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/reports/revenue-today', internalAuth, async (req, res) => {
  try {
    const converted = await Leads.countDocuments({ status: 'converted', updated_at: { $gte: startOfUtcDay() } });
    res.json({ revenue: converted * 500 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/revenue-month', internalAuth, async (req, res) => {
  try {
    const monthStart = startOfUtcMonth();
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const converted = await Leads.countDocuments({ status: 'converted', updated_at: { $gte: monthStart, $lt: nextMonth } });
    res.json({ revenue: converted * 500 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/brand-revenue', internalAuth, async (req, res) => {
  try {
    const convertedByClient = await Leads.aggregate([
      { $match: { status: 'converted', client_id: { $ne: null } } },
      { $group: { _id: '$client_id', count: { $sum: 1 } } },
    ]);
    const revenueClients = new Map((await Clients.find({ id: { $in: convertedByClient.map((r) => r._id) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const byBrand = new Map();
    for (const row of convertedByClient) {
      if (!revenueClients.has(row._id)) continue;
      const brand = revenueClients.get(row._id);
      byBrand.set(brand, (byBrand.get(brand) || 0) + row.count * 500);
    }
    res.json({ data: [...byBrand].map(([brand, revenue]) => ({ brand, revenue })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/lead-sources', internalAuth, async (req, res) => {
  try {
    const sources = await Leads.aggregate([
      { $group: { _id: '$source', count: { $sum: 1 } } },
      { $project: { _id: 0, source: '$_id', count: 1 } },
    ]);
    res.json({ sources });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/conversion-rate', internalAuth, async (req, res) => {
  try {
    const data = await Leads.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $project: { _id: 0, status: '$_id', count: 1 } },
    ]);
    res.json({ data });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/followups-pending', internalAuth, async (req, res) => {
  try {
    const pending = await Leads.countDocuments({ next_followup_due: { $gt: new Date() }, status: { $nin: ['converted', null] } });
    res.json({ pending });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/sla-breaches', internalAuth, async (req, res) => {
  try {
    const breaches = await Leads.countDocuments({ next_followup_due: { $lt: new Date() }, status: { $nin: ['converted', null] } });
    res.json({ breaches });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/ai-performance', internalAuth, async (req, res) => {
  try {
    const [avg] = await AiDecisions.aggregate([{ $group: { _id: null, avg_confidence: { $avg: '$confidence' } } }]);
    res.json({ avg_confidence: parseFloat(avg?.avg_confidence) || 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// WF02 - Followup Engine
// ==========================================
router.get('/followups/due', internalAuth, async (req, res) => {
  try {
    await salesTrackingReady;
    const MAX_FOLLOWUP_ATTEMPTS = 5; // Stop after 5 attempts

    const dueLeads = await Leads.find({
      next_followup_due: { $lte: new Date() },
      status: { $nin: ['converted', 'booked', 'lost', 'opt-out', null] },
      call_booked_at: null,
      sales_followup_stopped: { $ne: true },
      sales_status: { $not: /^(converted|closed|not_interested)$/i },
      $and: [
        { $or: [{ sales_followup_at: null }, { sales_followup_at: { $lte: new Date() } }] },
        { $or: [{ touch_count: null }, { touch_count: { $lt: MAX_FOLLOWUP_ATTEMPTS } }] },
      ],
    }, { id: 1, name: 1, phone: 1, client_id: 1, stage: 1, touch_count: 1 }).lean();
    const dueClients = new Map((await Clients.find({ id: { $in: dueLeads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    res.json({ followups: dueLeads.map((l) => ({
      lead_id: l.id, name: l.name, phone: l.phone, brand: dueClients.get(l.client_id) ?? 'ABM Groups',
      stage: l.stage, touch_count: l.touch_count ?? 0,
    })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Fetch Followup Rule
router.post('/followups/sales-guard', internalAuth, async (req, res) => {
  try {
    await salesTrackingReady;
    const leadRow = await Leads.findOne({ id: req.body.lead_id }, { id: 1, sales_status: 1, sales_followup_stopped: 1, sales_followup_at: 1 }).lean();
    const lead = leadRow ? {
      lead_id: leadRow.id,
      sales_status: leadRow.sales_status ?? 'new',
      sales_followup_stopped: leadRow.sales_followup_stopped ?? false,
      sales_followup_at: leadRow.sales_followup_at ?? null,
      sales_notes: (await SalesLeadNotes.find({ lead_id: leadRow.id }, { _id: 0, note: 1, created_at: 1 }).sort({ created_at: -1 }).limit(5).lean()),
    } : null;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const stoppedByStatus = ['converted', 'closed', 'not_interested'].includes(String(lead.sales_status).toLowerCase());
    const waitingForScheduledTime = lead.sales_followup_at && new Date(lead.sales_followup_at) > new Date();
    const proceed = !lead.sales_followup_stopped && !stoppedByStatus && !waitingForScheduledTime;
    res.json({
      ...req.body,
      ...lead,
      proceed,
      guard_reason: lead.sales_followup_stopped ? 'stopped_by_sales_note'
        : stoppedByStatus ? `stopped_by_status_${lead.sales_status}`
          : waitingForScheduledTime ? 'waiting_for_note_schedule' : 'allowed',
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 2. Fetch Followup Rule
router.post('/followups/rule', internalAuth, async (req, res) => {
  const { touch_count } = req.body;
  try {
    const cadenceHours = [4, 8, 12, 24, 72];
    const currentTouch = Math.max(0, Number(touch_count) || 0);
    const nextDelayHours = cadenceHours[currentTouch + 1] ?? null;
    let base_channel = 'whatsapp';
    let template_id = currentTouch > 1 ? 're_engagement' : 'welcome_followup';
    let payload_template = currentTouch > 1
      ? "Hey! Just checking back in - still interested in learning more?"
      : "Hi there! Following up on your interest with us - any questions I can help with?";
    let ai_prompt_template = `contextual_followup_attempt_${currentTouch + 1}`;

    if (currentTouch >= 5) {
      base_channel = 'internal_note';
      payload_template = 'Lead completed all five staged follow-ups without conversion. Review for a manual call or respectful close.';
    }

    res.json({
      ...req.body,
      current_delay_hours: cadenceHours[currentTouch] ?? 4,
      delay_hours: nextDelayHours,
      base_channel,
      template_id,
      payload_template,
      ai_prompt_template,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Opt-out: Stop follow-ups when lead says "not interested"
router.post('/leads/opt-out', internalAuth, async (req, res) => {
  const { lead_id, reason } = req.body;
  try {
    if (!lead_id) {
      return res.status(400).json({ success: false, error: "Missing lead_id" });
    }

    await Leads.updateOne({ id: lead_id }, { $set: { status: 'opt-out', updated_at: new Date() } });

    console.log(`[Opt-Out] Lead ${lead_id} opted out - follow-ups STOPPED`);
    res.json({ success: true, message: "Lead has been opted out. No more follow-ups will be sent." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. Check 24h Window
router.post('/whatsapp/check-24h', internalAuth, async (req, res) => {
  const { lead_id, base_channel, template_id, payload_template, ai_prompt_template } = req.body;
  try {
    const result = { rows: await leadMessages(lead_id, { direction: 'inbound' }, { limit: 1, projection: { _id: 0, sent_at: 1 } }) };
    let within_24h = false;
    if (result.rows.length > 0) {
      const hours = (new Date() - new Date(result.rows[0].sent_at)) / 36e5;
      if (hours < 24) within_24h = true;
    }

    let action_type = base_channel;
    if (base_channel === 'whatsapp') {
      action_type = within_24h ? 'whatsapp_text' : 'whatsapp_template';
    }

    res.json({
      ...req.body,
      within_24h,
      action: { action_type, template_id, payload_template, ai_prompt_template }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// 4. Generate & Send Followup AI Text
router.post('/ai/followup', internalAuth, async (req, res) => {
  const { lead_id } = req.body;
  try {
    const lead = await leadWithClient(lead_id, { brand_name: 'name', phone_number_id: 'phone_number_id', client_wa_token: 'wa_access_token' });
    const brandName = lead?.brand_name || 'ABM Groups';
    const touchCount = lead?.touch_count ?? 0;
    const leadName = (lead?.name || '').split(' ')[0] || 'there';

    if (!lead || ['converted', 'booked', 'opt-out', 'lost'].includes(lead.status) || lead.call_booked_at
      || lead.sales_followup_stopped || ['converted', 'closed', 'not_interested'].includes(lead.sales_status)
      || (lead.sales_followup_at && new Date(lead.sales_followup_at) > new Date())) {
      return res.json({ ...req.body, success: true, delivered: false, skipped: true, reason: 'stop_condition' });
    }

    const recentHistory = (await leadMessages(lead_id, hasText, { limit: 10, projection: { _id: 0, direction: 1, content: 1, sent_at: 1 } })).reverse();
    const notesRows = await SalesLeadNotes.find({ lead_id }, { _id: 0, note: 1, created_at: 1 }).sort({ created_at: -1 }).limit(5).lean();
    const salesNotes = notesRows.map(item => `${item.created_at.toISOString?.() || item.created_at}: ${item.note}`).join('\n') || 'No sales notes';
    const latestMessage = recentHistory[recentHistory.length - 1];
    if (!latestMessage || latestMessage.direction === 'inbound') {
      return res.json({
        ...req.body,
        success: true,
        delivered: false,
        skipped: true,
        reason: latestMessage ? 'customer_message_awaiting_reply' : 'no_conversation_history',
      });
    }

    let ai_reply = `Hi ${leadName}, are you still interested in our program?`;
    if (ai) {
      const historyText = recentHistory
        .map((item) => `${item.direction === 'inbound' ? 'Customer' : 'Assistant'}: ${item.content}`)
        .join('\n');
      const prompt = `You write conversion-focused WhatsApp follow-ups for ABM Groups.
Brand: ${brandName}
Lead first name: ${leadName}
Follow-up attempt: ${touchCount + 1} of 5
Sales representative status: ${lead.sales_status || 'new'}
Latest sales notes:
${salesNotes}

Latest conversation (oldest to newest):
${historyText}

Write one natural follow-up that continues the unfinished topic. Reference the specific course, service, job, property, trip, food order, admission, or charity topic already discussed. Never ask the lead to repeat information already present. Use a warm human tone, no pressure, no invented price, offer, availability, or deadline, and no more than 3 short sentences. End with exactly one easy question that moves toward the appropriate conversion step. Return only the message text.`;
      ai_reply = await generateOpenRouterContent(prompt);
    }

    let delivered = false;
    let waMessageId = null;
    let outboundMessageType = 'text';
    const phoneNumberId = lead?.phone_number_id;
    const waAccessToken = lead?.client_wa_token;
    if (lead && lead.phone && phoneNumberId && waAccessToken) {
      try {
        const phoneDigits = lead.phone.replace(/\D/g, '');
        const waRes = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to: phoneDigits, type: 'text', text: { body: ai_reply } },
          { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
        );
        waMessageId = waRes.data?.messages?.[0]?.id || null;
        delivered = true;
      } catch (waErr) {
        console.error('[ai/followup send error]', waErr.response?.data || waErr.message);
      }
    }

    if (lead) {
      const conversation_id = await getOrUpsertConversation(lead_id);
      await Conversations.updateOne({ id: conversation_id }, { $set: { last_message: ai_reply, last_message_at: new Date() } });
      await Messages.create({
        conversation_id, direction: 'outbound', msg_type: 'text', content: ai_reply, wa_msg_id: waMessageId,
        status: delivered ? 'sent' : 'failed', is_ai: true, sent_at: new Date(),
      });
    }

    res.json({ ...req.body, success: true, ai_reply, delivered });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Demo-call reminder branch used by WF02. Each reminder is claimed with a
// database uniqueness key, so a repeated n8n execution cannot double-send it.
router.get('/demo-reminders/due', internalAuth, async (req, res) => {
  try {
    await demoReminderReady;
    await salesTrackingReady;
    const bookedLeads = await Leads.find({
        call_booked_at: { $gt: new Date() },
        status: /^booked$/i,
        sales_followup_stopped: { $ne: true },
        sales_status: { $not: /^(converted|closed|not_interested)$/i },
        $or: [{ sales_followup_at: null }, { sales_followup_at: { $lte: new Date() } }],
      }, { id: 1, name: 1, phone: 1, call_booked_at: 1, client_id: 1 })
      .sort({ call_booked_at: 1 }).lean();
    const reminderClients = new Map((await Clients.find({ id: { $in: bookedLeads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const sentReminders = await DemoCallReminders.find(
      { lead_id: { $in: bookedLeads.map((l) => l.id) }, status: { $in: ['processing', 'sent'] } },
      { lead_id: 1, booking_time: 1, reminder_minutes: 1 }
    ).lean();
    const reminders = [];
    for (const l of bookedLeads) {
      const minutesUntil = (new Date(l.call_booked_at).getTime() - Date.now()) / 60000;
      for (const [minutes, lowerMinutes] of [[60, 30], [30, 10], [10, 0]]) {
        if (!(minutesUntil <= minutes && minutesUntil > lowerMinutes)) continue;
        const alreadySent = sentReminders.some((r) => r.lead_id === l.id && r.reminder_minutes === minutes
          && new Date(r.booking_time).getTime() === new Date(l.call_booked_at).getTime());
        if (alreadySent) continue;
        reminders.push({
          lead_id: l.id, name: l.name, phone: l.phone, booking_time: l.call_booked_at,
          brand: reminderClients.get(l.client_id) ?? null, reminder_minutes: minutes,
        });
      }
    }
    res.json({ reminders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/demo-reminders/send', internalAuth, async (req, res) => {
  const { lead_id, booking_time, reminder_minutes } = req.body;
  try {
    await demoReminderReady;
    await salesTrackingReady;
    if (!lead_id || !booking_time || ![60, 30, 10].includes(Number(reminder_minutes))) {
      return res.status(400).json({ error: 'Invalid demo reminder' });
    }

    const eligibleLead = await Leads.exists({ id: lead_id, ...{
        call_booked_at: { $gt: new Date() },
        status: /^booked$/i,
        sales_followup_stopped: { $ne: true },
        sales_status: { $not: /^(converted|closed|not_interested)$/i },
        $or: [{ sales_followup_at: null }, { sales_followup_at: { $lte: new Date() } }],
      }, call_booked_at: { $eq: new Date(booking_time), $gt: new Date() } });
    const lead = eligibleLead
      ? await leadWithClient(lead_id, { brand_name: 'name', phone_number_id: 'phone_number_id', client_wa_token: 'wa_access_token' })
      : null;
    if (!lead) return res.json({ success: true, skipped: true, reason: 'booking_changed_or_completed' });

    const reminderKey = { lead_id, booking_time: new Date(booking_time), reminder_minutes: Number(reminder_minutes) };
    let claimedReminder = await insertIgnore(DemoCallReminders, { ...reminderKey, status: 'processing' });
    if (!claimedReminder) {
      // Retry only a previously failed reminder
      claimedReminder = await DemoCallReminders.findOneAndUpdate(
        { ...reminderKey, status: 'failed' },
        { $set: { status: 'processing' } },
        { new: true, projection: { _id: 0, id: 1 } }
      ).lean();
    }
    const claim = { rows: claimedReminder ? [{ id: claimedReminder.id }] : [] };
    if (!claim.rows.length) return res.json({ success: true, skipped: true, reason: 'already_sent_or_processing' });

    const firstName = (lead.name || '').split(' ')[0] || 'there';
    const brand = lead.brand_name || 'our team';
    const scheduledTime = new Date(lead.call_booked_at).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short',
    });
    const history = (await leadMessages(lead_id, hasText, { limit: 12, projection: { _id: 0, direction: 1, content: 1, sent_at: 1 } })).reverse();
    const demoNotes = await SalesLeadNotes.find({ lead_id }, { _id: 0, note: 1, created_at: 1 }).sort({ created_at: -1 }).limit(5).lean();
    const demoSalesNotes = demoNotes.map(item => `${item.created_at.toISOString?.() || item.created_at}: ${item.note}`).join('\n') || 'No sales notes';
    const latestInbound = [...history].reverse().find(item => item.direction === 'inbound');
    const within24Hours = Boolean(latestInbound)
      && Date.now() - new Date(latestInbound.sent_at).getTime() < 24 * 60 * 60 * 1000;

    let message = `Hi ${firstName}, friendly reminder that your demo call with ${brand} starts in ${reminder_minutes} minutes at ${scheduledTime}. We look forward to speaking with you!`;
    if (within24Hours && ai) {
      try {
        const conversationContext = history
          .map(item => `${item.direction === 'inbound' ? 'Lead' : 'Assistant'}: ${item.content}`)
          .join('\n');
        message = await generateOpenRouterContent(`Write one personalized WhatsApp demo-call reminder using the previous conversation context.
Lead first name: ${firstName}
Brand: ${brand}
Call time: ${scheduledTime}
Time remaining: ${reminder_minutes} minutes
Sales representative status: ${lead.sales_status || 'new'}
Latest sales notes:
${demoSalesNotes}
Previous conversation (oldest to newest):
${conversationContext}

Naturally reference relevant details already discussed when useful. Do not invent facts, prices, offers, links, or meeting details. Be warm and professional, use at most 2 short sentences, and return only the message.`);
      } catch (aiErr) {
        console.error('[Demo Reminder] AI generation fallback:', aiErr.message);
      }
    }

    let delivered = false;
    let waMessageId = null;
    let outboundMessageType = 'text';
    const phoneNumberId = lead.phone_number_id;
    const waAccessToken = lead.client_wa_token;
    if (lead.phone && phoneNumberId && waAccessToken) {
      try {
        let messagePayload;
        if (within24Hours) {
          messagePayload = { messaging_product: 'whatsapp', to: lead.phone.replace(/\D/g, ''), type: 'text', text: { body: message } };
        } else {
          outboundMessageType = 'template';
          const candidateTemplates = await Templates.find({
            status: /^approved$/i,
            category: /^utility$/i,
            client_id: { $in: [lead.client_id ?? null, null] },
            $or: [{ name: /demo|appointment|reminder|followup/i }, { body: /demo|appointment|reminder|call/i }],
          }, { _id: 0, name: 1, language: 1, body: 1, client_id: 1, approved_at: 1, created_at: 1 }).lean();
          const template = candidateTemplates.sort((a, b) => Number(b.client_id === lead.client_id && lead.client_id != null) - Number(a.client_id === lead.client_id && lead.client_id != null)
            || (b.approved_at ? new Date(b.approved_at).getTime() : -Infinity) - (a.approved_at ? new Date(a.approved_at).getTime() : -Infinity)
            || new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
          if (!template) throw new Error('No approved demo/reminder utility template is available for this brand');

          const placeholderNumbers = [...String(template.body || '').matchAll(/\{\{(\d+)\}\}/g)].map(match => Number(match[1]));
          const parameterCount = placeholderNumbers.length ? Math.max(...placeholderNumbers) : 0;
          const baseParameterValues = [firstName, brand, scheduledTime, String(reminder_minutes)];
          const parameterValues = Array.from({ length: parameterCount }, (_, index) => baseParameterValues[index] || scheduledTime);
          message = String(template.body || '').replace(/\{\{(\d+)\}\}/g, (_, number) => parameterValues[Number(number) - 1] || '');
          messagePayload = {
              messaging_product: 'whatsapp',
              to: lead.phone.replace(/\D/g, ''),
              type: 'template',
              template: {
                name: template.name,
                language: { code: template.language || 'en' },
                ...(parameterCount ? { components: [{ type: 'body', parameters: parameterValues.map(text => ({ type: 'text', text })) }] } : {}),
              },
            };
        }
        const waRes = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          messagePayload,
          { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
        );
        waMessageId = waRes.data?.messages?.[0]?.id || null;
        delivered = true;
      } catch (waErr) {
        console.error('[Demo Reminder] WhatsApp send failed:', waErr.response?.data || waErr.message);
      }
    }

    const conversationId = await getOrUpsertConversation(lead_id);
    await Conversations.updateOne({ id: conversationId }, { $set: { last_message: message, last_message_at: new Date() } });
    const reminderMessage = await Messages.create({
      conversation_id: conversationId, direction: 'outbound', msg_type: outboundMessageType, content: message,
      wa_msg_id: waMessageId, status: delivered ? 'sent' : 'failed', is_ai: within24Hours, sent_at: new Date(),
    });
    const savedReminder = { rows: [{
      id: reminderMessage.id, direction: reminderMessage.direction, type: reminderMessage.msg_type, content: reminderMessage.content,
      wa_msg_id: reminderMessage.wa_msg_id, status: reminderMessage.status, is_ai: reminderMessage.is_ai, timestamp: reminderMessage.sent_at,
    }] };
    await DemoCallReminders.updateOne({ id: claim.rows[0].id }, { $set: {
      status: delivered ? 'sent' : 'failed', message, wa_message_id: waMessageId, sent_at: delivered ? new Date() : null,
    } });

    if (savedReminder.rows[0]) {
      req.app.get('io')?.emit('outgoing_message', { lead_id: Number(lead_id), message: savedReminder.rows[0] });
    }

    if (!delivered) return res.status(502).json({ success: false, error: 'WhatsApp reminder could not be delivered' });
    res.json({ success: true, delivered: true, reminder_minutes, message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// WF03 - Reminder Engine
// ==========================================

router.get('/reports/today-calls', internalAuth, async (req, res) => {
  try {
    const today = startOfUtcDay();
    const calls = await Leads.find({ call_booked_at: { $gte: today, $lt: new Date(today.getTime() + DAY_MS) } }, { id: 1, name: 1, call_booked_at: 1 }).lean();
    res.json({ calls: calls.map((l) => ({ lead_id: l.id, name: l.name, time: l.call_booked_at })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/today-followups', internalAuth, async (req, res) => {
  try {
    const today = startOfUtcDay();
    const followups = await Leads.find({ next_followup_due: { $gte: today, $lt: new Date(today.getTime() + DAY_MS) } }, { id: 1, name: 1, stage: 1 }).lean();
    res.json({ followups: followups.map((l) => ({ lead_id: l.id, name: l.name, stage: l.stage })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/hot-leads', internalAuth, async (req, res) => {
  try {
    const hotLeads = await Leads.find({ status: 'hot' }, { _id: 0, id: 1, name: 1, score: 1 }).sort({ score: -1 }).limit(10).lean();
    res.json({ hot_leads: hotLeads });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/ai/report-generator', internalAuth, async (req, res) => {
  const data = req.body.data || req.body.metrics || req.body;
  try {
    if (!ai) return res.json({ summary: "Daily Summary generated." });

    // STRICT rules to prevent hallucination and force INR
    const prompt = `You are a founder-level reporter for an Indian multi-brand business. CRITICAL RULES:
1. ALL currency amounts MUST use Indian Rupees (₹) symbol - NEVER use $ or USD
2. Do NOT invent any numbers, scores, or percentages not present in the data
3. Use ONLY the exact metrics provided below
4. If a metric is missing, state "Not available" - never make it up
5. Start with a CONSOLIDATED ALL-BRANDS section covering leads, conversations, campaigns, conversions, conversion rate, and revenue
6. Then include a BRAND-WISE BREAKDOWN with one clearly labelled bullet for EVERY brand in the brands array, including zero-activity brands
7. Never select, prioritize, or report only one brand
8. Keep the report concise, but never omit a configured brand

Data to summarize:
${JSON.stringify(data, null, 2)}

Use clear headings and bullet points. Use Indian number formatting for all currency values.`;

    let summary = await generateOpenRouterContent(prompt);
    console.log('[report-generator] Raw LLM response:', summary);

    // Post-process: Force INR currency - split on $ and rejoin with ₹
    summary = summary.split('$').join('₹');

    console.log('[report-generator] After replace:', summary);

    res.json({ summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// WF04 - Customer Journey
// ==========================================

router.post('/leads/find-by-invoice', internalAuth, async (req, res) => {
  const { invoice_id, lead_id, link_id } = req.body;
  try {
    let lead = null;
    const cleanLeadId = lead_id && lead_id !== 'null' && lead_id !== 'undefined' && lead_id !== '' ? parseInt(lead_id, 10) : null;
    console.log('[salesos find-by-invoice] received:', { invoice_id, lead_id, link_id, cleanLeadId });

    // 1. Try cleanLeadId first (fastest, from notes.lead_id)
    if (cleanLeadId && !isNaN(cleanLeadId)) {
      const invoiceLead = await leadWithClient(parseInt(cleanLeadId, 10), { brand: 'name', brand_id: 'id' });
      if (invoiceLead) {
        lead = { lead_id: invoiceLead.id, name: invoiceLead.name, phone: invoiceLead.phone, brand: invoiceLead.brand, brand_id: invoiceLead.brand_id };
        // Capture payment & mark lead converted
        if (invoice_id) {
          await Payments.updateMany(
            { lead_id: cleanLeadId, razorpay_payment_id: null },
            { $set: { razorpay_payment_id: invoice_id, status: 'captured' } }
          ).catch(() => {});
          await Leads.updateOne({ id: cleanLeadId }, { $set: { status: 'converted', score: 100 } }).catch(() => {});
          console.log(`[salesos find-by-invoice] ✅ Lead ${cleanLeadId} marked converted, payment ${invoice_id} saved`);
        }
      }
    }

    // 2. Try by link_id (payment link ID plink_xxx)
    if (!lead && link_id && link_id !== 'null' && link_id !== 'undefined' && link_id !== '') {
      const linkPayments = await Payments.find({ razorpay_link_id: link_id }, { lead_id: 1 }).lean();
      for (const payment of linkPayments) {
        const paymentLead = await leadWithClient(payment.lead_id, { brand: 'name', brand_id: 'id' });
        if (paymentLead) {
          lead = { lead_id: paymentLead.id, name: paymentLead.name, phone: paymentLead.phone, brand: paymentLead.brand, brand_id: paymentLead.brand_id };
          break;
        }
      }
      if (lead) {
        if (invoice_id) {
          await Payments.updateMany({ razorpay_link_id: link_id }, { $set: { razorpay_payment_id: invoice_id, status: 'captured' } }).catch(() => {});
          await Leads.updateOne({ id: lead.lead_id }, { $set: { status: 'converted', score: 100 } }).catch(() => {});
        }
      }
    }

    // 3. Try fallback by invoice_id
    if (!lead && invoice_id && invoice_id !== 'null') {
      lead = null;
      const invoicePayments = await Payments.find({ razorpay_payment_id: invoice_id }, { lead_id: 1 }).sort({ created_at: -1 }).lean();
      for (const payment of invoicePayments) {
        const paymentLead = await leadWithClient(payment.lead_id, { brand: 'name', brand_id: 'id' });
        if (paymentLead) {
          lead = { lead_id: paymentLead.id, name: paymentLead.name, phone: paymentLead.phone, brand: paymentLead.brand, brand_id: paymentLead.brand_id };
          break;
        }
      }
    }

    // 4. Ultimate fallback: most recently won lead (for manual tests)
    if (!lead) {
      const recentWin = await Leads.findOne({ status: 'converted' }, { id: 1 }).sort({ updated_at: -1 }).lean();
      const winLead = recentWin ? await leadWithClient(recentWin.id, { brand: 'name' }) : null;
      lead = winLead ? { lead_id: winLead.id, name: winLead.name, phone: winLead.phone, brand: winLead.brand, brand_id: winLead.client_id ?? null } : null;
    }

    res.json({
      ...req.body,
      lead_id: lead?.lead_id || null,
      name: lead?.name || null,
      phone: lead?.phone || null,
      brand: lead?.brand || 'ABM Groups',
      brand_id: lead?.brand_id || null
    });
  } catch (err) {
    console.error('[salesos find-by-invoice] error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Immediate post-payment onboarding sequence. Action values must match the
// Execute Journey Step switch in WF04 exactly. There's no journey_steps table
// yet, so this is a fixed sequence rather than per-brand configurable - the
// delayed nurture steps (feedback/review/referral, sent days/weeks later)
// need a scheduled trigger like WF02's follow-up engine and aren't included here.
router.post('/journey/steps', internalAuth, async (req, res) => {
  try {
    const steps = [
      { action: 'send_invoice' },
      { action: 'send_welcome' },
      { action: 'add_to_whatsapp_group' },
      { action: 'grant_access' },
      { action: 'trigger_orientation' }
    ];
    res.json({ ...req.body, steps });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Journey Actions
router.post('/invoices/send', internalAuth, async (req, res) => {
  const { lead_id } = req.body;
  try {
    const payment = await Payments.findOne({ lead_id, status: 'captured' }, { _id: 0, amount: 1, currency: 1 }).sort({ created_at: -1 }).lean();
    const amountText = payment ? `${payment.currency || 'INR'} ${payment.amount}` : 'your payment';
    const content = `Thank you for your payment of ${amountText}! Your invoice has been recorded. If you need a formal receipt, reply here and our team will send one over.`;
    const sendResult = await sendWhatsAppText(lead_id, content);
    res.json({ ...req.body, success: true, ...sendResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NOTE: Meta's WhatsApp Cloud API has no endpoint to programmatically add a
// user to a WhatsApp group - that's not something the Business API supports.
// This sends a real message; an actual group invite link would need to be
// configured per-client (no such field exists in `clients` yet) and pasted in.
router.post('/whatsapp/add-to-group', internalAuth, async (req, res) => {
  const { lead_id } = req.body;
  try {
    const content = `Welcome aboard! We'll be sharing your community group invite link shortly - keep an eye on this chat.`;
    const sendResult = await sendWhatsAppText(lead_id, content);
    await WorkflowLogs.create({ workflow: 'WF04', lead_id: lead_id == null ? lead_id : String(lead_id), status: 'success', message: 'WhatsApp group invite requested (manual link send required - no group-invite API in Meta Cloud API)' });
    res.json({ ...req.body, success: true, ...sendResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/access/grant', internalAuth, async (req, res) => {
  const { lead_id } = req.body;
  try {
    await Leads.updateOne({ id: lead_id }, { $set: { payment_status: 'access_granted', updated_at: new Date() } });
    const content = `You're all set! Your access has been granted - check your email for login details, or reply here if you need help getting started.`;
    const sendResult = await sendWhatsAppText(lead_id, content);
    res.json({ ...req.body, success: true, ...sendResult });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// NOTE: no dedicated tasks table exists - logged into workflow_logs so it's
// visible on the Workflow Logs page, same pattern as WF02's internal-note.
router.post('/tasks/create', internalAuth, async (req, res) => {
  const { lead_id, type } = req.body;
  try {
    await WorkflowLogs.create({ workflow: 'WF04', lead_id: lead_id == null ? lead_id : String(lead_id), status: 'pending', message: `Task created: ${type || 'general'}` });
    res.json({ ...req.body, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/log-event', internalAuth, async (req, res) => {
  const { lead_id, event } = req.body;
  try {
    await WorkflowLogs.create({ workflow: 'WF04', lead_id: lead_id == null ? lead_id : String(lead_id), status: 'success', message: `Event: ${event || 'unknown'}` });
    res.json({ ...req.body, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// WF05 - Marketing Automation
// ==========================================

router.get('/campaigns/active', internalAuth, async (req, res) => {
  try {
    // Due = scheduled to run and either unscheduled (run ASAP) or its time has passed.
    // 'running'/'completed'/'failed' are excluded so a campaign is only ever executed once.
    const dueCampaigns = await Campaigns.find(
      { status: 'scheduled', $or: [{ scheduled_at: null }, { scheduled_at: { $lte: new Date() } }] },
      { id: 1, name: 1, client_id: 1 }
    ).lean();
    res.json({ campaigns: dueCampaigns.map((c) => ({ campaign_id: c.id, name: c.name, client_id: c.client_id })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/select-leads', internalAuth, async (req, res) => {
  const { campaign_id, status_filter } = req.body;
  try {
    const projection = { _id: 0, id: 1, phone: 1, name: 1 };
    if (status_filter) {
      const leads = await Leads.find({ status: status_filter, phone: { $ne: null } }, projection).limit(500).lean();
      return res.json({ leads });
    }
    const leads = await Leads.find({ status: { $nin: ['converted', null] }, phone: { $ne: null } }, projection).limit(500).lean();
    res.json({ leads });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/check-frequency', internalAuth, async (req, res) => {
  const { lead_id } = req.body;
  try {
    const firstConversation = await Conversations.findOne({ lead_id }, { id: 1 }).lean();
    if (!firstConversation) return res.json({ allowed: true });
    const conversation_id = firstConversation.id;

    const result = { rows: await Messages.find(
      { conversation_id, direction: 'outbound', msg_type: 'campaign' },
      { _id: 0, sent_at: 1 }
    ).sort({ sent_at: -1 }).limit(1).lean() };
    let allowed = true;
    if (result.rows.length > 0) {
      const days = (new Date() - new Date(result.rows[0].sent_at)) / (36e5 * 24);
      if (days < 7) allowed = false; // Cap at 1 marketing message per 7 days
    }
    res.json({ allowed });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/campaigns/log', internalAuth, (req, res) => res.json({ success: true }));

// ==========================================
// WF07 - Admin & Maintenance
// ==========================================

// Maintenance operations (retry, cleanup):
//  - One workspace: the internal service key with x-tenant-id (n8n acting for
//    that tenant); the tenant scope limits the operation to that workspace.
//  - All workspaces: founder/ops platform staff only, recorded in the audit log.
// The service key alone is not enough for a cross-tenant operation, and
// customer tokens are refused.
const maintenanceAuth = (operation, code) => (req, res, next) => {
  if (hasInternalKey(req)) {
    if (!req.headers['x-tenant-id']) {
      return res.status(403).json({
        error: `Cross-tenant ${operation} needs platform staff. Send x-tenant-id to ${operation} one workspace.`,
        code,
      });
    }
    return internalAuth(req, res, next);
  }
  return staffAuth('platform.tenants.manage')(req, res, next);
};
const maintenanceTenant = (req) => (req.identity?.kind === 'service' ? req.identity.tenantId : null);

router.post('/admin/retry', maintenanceAuth('retry', 'CROSS_TENANT_RETRY_FORBIDDEN'), async (req, res) => {
  try {
    const tenantId = maintenanceTenant(req);
    const result = await Messages.updateMany({ status: 'failed' }, { $set: { status: 'pending' } });
    if (!tenantId) {
      await audit.record(audit.EVENTS.PLATFORM_MAINTENANCE, {
        req, targetType: 'messages', meta: { operation: 'retry_failed_messages', scope: 'all_tenants', retried_count: result.modifiedCount },
      });
    }
    res.json({ retried_count: result.modifiedCount, scope: tenantId ? 'tenant' : 'all_tenants' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deletes workflow logs older than the 30-day retention period. In a tenant
// context the tenant scope adds tenant_id to the filter, so only that
// workspace's logs can match; platform staff clean up every workspace.
const WORKFLOW_LOG_RETENTION_DAYS = 30;
router.post('/admin/cleanup', maintenanceAuth('cleanup', 'CROSS_TENANT_CLEANUP_FORBIDDEN'), async (req, res) => {
  try {
    const tenantId = maintenanceTenant(req);
    const cutoff = new Date(Date.now() - WORKFLOW_LOG_RETENTION_DAYS * DAY_MS);
    const result = await WorkflowLogs.deleteMany({ created_at: { $lt: cutoff } });
    if (!tenantId) {
      await audit.record(audit.EVENTS.PLATFORM_MAINTENANCE, {
        req, targetType: 'workflow_logs', meta: { operation: 'cleanup_workflow_logs', scope: 'all_tenants', retention_days: WORKFLOW_LOG_RETENTION_DAYS, deleted_logs: result.deletedCount },
      });
    }
    res.json({ deleted_logs: result.deletedCount, scope: tenantId ? 'tenant' : 'all_tenants' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/refresh-embeddings', internalPlatformAuth, async (req, res) => {
  try {
    // In a real system, you'd trigger a vector DB sync here
    res.json({ success: true, embeddings_updated: 0 });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ==========================================
// Missing Workflows Endpoints Implementation
// ==========================================

router.post('/communication/send-email', internalAuth, (req, res) => {
  // Mock endpoint for sending emails (could integrate SendGrid here)
  res.json({ ...req.body, success: true, delivered: true, channel: 'email' });
});

router.post('/communication/send-template', internalAuth, async (req, res) => {
  try {
    await salesTrackingReady;
    if (req.body.lead_id) {
      const lead = await Leads.findOne({ id: req.body.lead_id }, { _id: 0, sales_status: 1, sales_followup_stopped: 1, sales_followup_at: 1 }).lean();
      if (!lead || lead.sales_followup_stopped || ['converted', 'closed', 'not_interested'].includes(lead.sales_status)
        || (lead.sales_followup_at && new Date(lead.sales_followup_at) > new Date())) {
        return res.json({ ...req.body, success: true, delivered: false, skipped: true, reason: 'sales_status_or_note_stop' });
      }
    }
    // Mock endpoint for sending WhatsApp templates (could integrate Meta API here)
    res.json({ ...req.body, success: true, delivered: true, channel: 'whatsapp_template' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/internal-note', internalAuth, async (req, res) => {
  const { lead_id, note } = req.body;
  try {
    await WorkflowLogs.create({ workflow: 'WF02', lead_id: lead_id == null ? lead_id : String(lead_id), status: 'success', message: `Internal Note: ${note}` });
    res.json({ ...req.body, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/leads/update-followup', internalAuth, async (req, res) => {
  const { lead_id, touch_count_increment } = req.body;
  try {
    const increment = touch_count_increment || 1;
    const newTouchCount = { $add: [{ $ifNull: ['$touch_count', 0] }, Number(increment)] };
    const delayHours = (hours) => ({ $add: ['$$NOW', hours * HOUR_MS] });
    const updated = await Leads.findOneAndUpdate(
      {
        id: lead_id,
        status: { $nin: ['converted', 'booked', 'opt-out', 'lost', null] },
        call_booked_at: null,
        sales_followup_stopped: { $ne: true },
        sales_status: { $not: /^(converted|closed|not_interested)$/i },
      },
      [{ $set: {
        touch_count: newTouchCount,
        next_followup_due: { $switch: {
          branches: [
            { case: { $eq: [newTouchCount, 1] }, then: delayHours(8) },
            { case: { $eq: [newTouchCount, 2] }, then: delayHours(12) },
            { case: { $eq: [newTouchCount, 3] }, then: delayHours(24) },
            { case: { $eq: [newTouchCount, 4] }, then: delayHours(72) },
          ],
          default: null,
        } },
        updated_at: '$$NOW',
      } }],
      { new: true, projection: { next_followup_due: 1 } }
    ).lean();
    if (updated?.next_followup_due) await ensureSalesTask(req, lead_id, 'followup');
    res.json({ ...req.body, success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/overdue-followups', internalAuth, async (req, res) => {
  try {
    const overdue = await Leads.find(
      { next_followup_due: { $lt: new Date() }, status: { $nin: ['converted', null] } },
      { _id: 0, id: 1, name: 1, next_followup_due: 1 }
    ).limit(50).lean();
    res.json({ overdue });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/reports/pending-payments', internalAuth, async (req, res) => {
  try {
    // We don't have an invoice table, so we fallback to a mock for now
    res.json({ pending: [] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Combines all 5 WF03 metrics server-side in one call, so the n8n workflow
// doesn't need a Merge node to reassemble 5 parallel branches.
// NOTE: leads.owner only ever holds the generic bucket 'human_sales' or 'ai_bot' -
// there is no per-individual sales-rep assignment in the schema today, so this
// produces one combined "human sales team" summary rather than per-person lists.
router.get('/reports/reminder-bundle', internalAuth, async (req, res) => {
  try {
    const todayStart = startOfUtcDay();
    const todayRange = { $gte: todayStart, $lt: new Date(todayStart.getTime() + DAY_MS) };
    const asRows = async (query) => ({ rows: await query });
    const [calls, followups, payments, overdue, hot] = await Promise.all([
      asRows(Leads.find({ call_booked_at: todayRange }, { id: 1, name: 1, call_booked_at: 1, owner: 1 }).lean()
        .then((rows) => rows.map((l) => ({ lead_id: l.id, name: l.name, time: l.call_booked_at, owner: l.owner })))),
      asRows(Leads.find({ next_followup_due: todayRange }, { id: 1, name: 1, stage: 1, owner: 1 }).lean()
        .then((rows) => rows.map((l) => ({ lead_id: l.id, name: l.name, stage: l.stage, owner: l.owner })))),
      Promise.resolve({ rows: [] }), // no invoice table yet - mirrors /reports/pending-payments
      asRows(Leads.find({ next_followup_due: { $lt: new Date() }, status: { $nin: ['converted', null] } }, { _id: 0, id: 1, name: 1, next_followup_due: 1, owner: 1 }).limit(50).lean()),
      asRows(Leads.find({ status: 'hot' }, { _id: 0, id: 1, name: 1, score: 1, owner: 1 }).sort({ score: -1 }).limit(10).lean()),
    ]);

    const metrics = {
      calls: calls.rows, followups: followups.rows, pending_payments: payments.rows,
      overdue: overdue.rows, hot_leads: hot.rows
    };

    const humanTaskCount = calls.rows.filter(r => r.owner === 'human_sales').length
      + followups.rows.filter(r => r.owner === 'human_sales').length
      + overdue.rows.filter(r => r.owner === 'human_sales').length
      + hot.rows.filter(r => r.owner === 'human_sales').length;

    // Sync tasks to sales_tasks table
    const insertTask = async (lead_id, type) => {
       const todayStart = startOfUtcDay();
       const exists = await SalesTasks.exists({ lead_id, task_type: type, created_at: { $gte: todayStart, $lt: new Date(todayStart.getTime() + DAY_MS) } });
       if (!exists) {
         await ensureSalesTask(req, lead_id, type);
       }
    };
    for (const c of calls.rows) await insertTask(c.lead_id || c.id, 'call');
    for (const f of followups.rows) await insertTask(f.lead_id || f.id, 'followup');
    for (const o of overdue.rows) await insertTask(o.lead_id || o.id, 'overdue');
    for (const h of hot.rows) await insertTask(h.lead_id || h.id, 'hot_lead');

    const salesperson_summaries = [{
      owner: 'human_sales',
      text: `Today's Tasks: ${followups.rows.length} Follow-ups, ${calls.rows.length} Calls, ${payments.rows.length} Payments, ${hot.rows.length} HOT Leads, ${overdue.rows.length} Overdue. (${humanTaskCount} assigned to the human sales team.)`
    }];

    let founder_summary = `Daily Summary - Calls: ${calls.rows.length}, Followups: ${followups.rows.length}, Pending Payments: ${payments.rows.length}, Overdue: ${overdue.rows.length}, Hot Leads: ${hot.rows.length}.`;
    if (ai) {
      try {
        const prompt = `Summarize these daily sales metrics for a Founder Dashboard:\n${JSON.stringify(metrics)}\nWrite 3 short bullet points highlighting wins and risks (like SLA breaches or pending payments).`;
        founder_summary = await generateOpenRouterContent(prompt);
      } catch (e) { console.error('[reminder-bundle] Gemini summary failed:', e.message); }
    }

    res.json({ success: true, metrics, salesperson_summaries, founder_summary });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Direct staff/founder notification - does NOT touch leads/conversations tables,
// since this isn't lead messaging. Requires FOUNDER_WHATSAPP_PHONE (or an explicit
// `phone`) to actually deliver; otherwise it no-ops with delivered:false so callers
// can see nothing was sent instead of silently failing.
router.post('/communication/notify-staff', internalAuth, async (req, res) => {
  const { phone, content, label } = req.body;
  try {
    const targetPhone = phone || process.env.FOUNDER_WHATSAPP_PHONE;
    if (!targetPhone) {
      console.warn(`[notify-staff] No phone configured for "${label || 'recipient'}" - skipping. Set FOUNDER_WHATSAPP_PHONE in .env or pass phone explicitly.`);
      return res.json({ ...req.body, success: true, delivered: false, reason: 'no_phone_configured' });
    }

    const phoneNumberId = process.env.WA_PHONE_NUMBER_ID;
    const waAccessToken = process.env.META_PAGE_ACCESS_TOKEN;
    let delivered = false, waMessageId = null;
    if (phoneNumberId && waAccessToken) {
      try {
        const phoneDigits = targetPhone.replace(/\D/g, '');
        const waRes = await axios.post(
          `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
          { messaging_product: 'whatsapp', to: phoneDigits, type: 'text', text: { body: content } },
          { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
        );
        waMessageId = waRes.data?.messages?.[0]?.id || null;
        delivered = true;
      } catch (waErr) {
        console.error('[notify-staff send error]', waErr.response?.data || waErr.message);
      }
    }
    res.json({ ...req.body, success: true, delivered, wa_msg_id: waMessageId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});



// ==========================================
// Sales Person Tasks API
// ==========================================
router.get('/sales-tasks', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    await salesTrackingReady;
    // Keep one persistent task for every lead that currently needs sales action.
    // Completed tasks are intentionally not recreated for the same lead/type.
    const allLeads = await Leads.find({}, { id: 1, status: 1, call_booked_at: 1, next_followup_due: 1 }).lean();
    const existingTasks = new Set((await SalesTasks.find({}, { lead_id: 1, task_type: 1 }).lean()).map((t) => `${t.lead_id}:${t.task_type}`));
    for (const l of allLeads) {
      const status = lower(l.status);
      const wanted = [
        l.call_booked_at != null && status === 'booked' ? 'call' : null,
        status === 'hot' ? 'hot_lead' : null,
        l.next_followup_due != null && !['converted', 'booked', 'lost', 'opt-out'].includes(status) ? 'followup' : null,
      ].filter(Boolean);
      for (const taskType of wanted) {
        if (existingTasks.has(`${l.id}:${taskType}`)) continue;
        const created = await SalesTasks.create({ lead_id: l.id, task_type: taskType });
        existingTasks.add(`${l.id}:${taskType}`);
        await emitSalesTaskUpdate(req, 'created', {
          id: created.id, lead_id: created.lead_id, task_type: created.task_type, status: created.status, unread: created.unread, created_at: created.created_at,
        });
      }
    }

    const taskRows = await loadSalesTaskRows(
      await SalesTasks.find({}, NO_ID).sort({ created_at: -1, id: -1 }).lean(),
      { includeLatestNote: true }
    );
    const tasks = taskRows.filter((t) => {
      if (t.status === 'completed') return true;
      if (t.sales_followup_stopped === true) return false;
      if (['converted', 'closed', 'not_interested'].includes(lower(t.sales_status))) return false;
      const leadStatus = lower(t.lead_status);
      return (t.task_type === 'call' && t.call_booked_at != null && leadStatus === 'booked')
        || (t.task_type === 'hot_lead' && leadStatus === 'hot')
        || (['followup', 'overdue'].includes(t.task_type) && t.next_followup_due != null && !['converted', 'booked', 'lost', 'opt-out'].includes(leadStatus));
    });
    res.json({ success: true, tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sales-tasks/export', internalAuth, async (req, res) => {
  try {
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))]
      : [];
      
    if (ids.length === 0) {
      return res.status(400).json({ error: 'No task IDs provided for export' });
    }

    const result = { rows: await loadSalesTaskRows(
      await SalesTasks.find({ id: { $in: ids } }, NO_ID).sort({ created_at: -1, id: -1 }).lean()
    ) };

    const xlsx = require('xlsx');
    const exportData = result.rows.map(t => {
      const formatDateTime = (value) => value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '';
      return {
        'Task Type': t.task_type === 'hot_lead' ? 'Hot Lead' : t.task_type === 'call' ? 'Scheduled Call' : t.task_type === 'followup' ? 'Follow-up' : t.task_type,
        'Task Status': t.status,
        'Lead Name': t.name || 'Unknown',
        'Brand': t.brand_name || '',
        'Phone': t.phone || '',
        'Email': t.email || '',
        'Tags': (t.tags || []).map(tag => tag.name).join(', '),
        'Lead Stage': t.lead_status || 'New',
        'Sales Status': t.sales_status,
        'Assigned To': t.assigned_name || 'Unassigned',
        'Lead Score': t.score || 0,
        'Interest': t.interest || '',
        'Task Created At': formatDateTime(t.created_at),
        'Lead Created At': formatDateTime(t.lead_created_at),
        'Last Contact': formatDateTime(t.last_contact)
      };
    });

    const worksheet = xlsx.utils.json_to_sheet(exportData);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Sales Tasks');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', 'attachment; filename="Sales_Tasks_Export.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.put('/sales-tasks/:id/status', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    const status = String(req.body.status || '').toLowerCase();
    if (!['pending', 'processing', 'completed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid task status' });
    }
    const task = await SalesTasks.findOneAndUpdate(
      { id: req.params.id },
      { $set: { status, updated_at: new Date(), completed_at: status === 'completed' ? new Date() : null } },
      { new: true, projection: NO_ID }
    ).lean();
    await emitSalesTaskUpdate(req, 'status_changed', task || undefined);
    res.json({ success: true, task: task || undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sales-tasks/unread-count', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    const count = await SalesTasks.countDocuments({ unread: true, status: { $ne: 'completed' } });
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sales-tasks/lead/:leadId/read', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    await SalesTasks.updateMany({ lead_id: req.params.leadId, unread: true }, { $set: { unread: false, updated_at: new Date() } });
    await emitSalesTaskUpdate(req, 'read', { lead_id: Number(req.params.leadId) });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sales-tasks/lead/:leadId/sales-status', internalAuth, async (req, res) => {
  try {
    await salesTrackingReady;
    const allowed = ['new', 'contacted', 'processing', 'follow_up', 'converted', 'not_interested', 'closed'];
    const status = String(req.body.status || '').toLowerCase();
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid sales status' });
    const shouldStop = ['converted', 'not_interested', 'closed'].includes(status);
    const statusLead = await Leads.findOneAndUpdate(
      { id: req.params.leadId },
      { $set: {
        sales_status: status,
        sales_followup_stopped: shouldStop,
        ...(shouldStop ? { sales_followup_at: null, next_followup_due: null } : {}),
        updated_at: new Date(),
      } },
      { new: true, projection: { _id: 0, id: 1, sales_status: 1, sales_followup_stopped: 1, sales_followup_at: 1 } }
    ).lean();
    const result = { rows: statusLead ? [statusLead] : [] };
    if (!result.rows.length) return res.status(404).json({ error: 'Lead not found' });
    await emitSalesTaskUpdate(req, 'lead_status_changed', { lead_id: Number(req.params.leadId), ...result.rows[0] });
    res.json({ success: true, lead: result.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sales-tasks/lead/:leadId/notes', internalAuth, async (req, res) => {
  try {
    await salesTrackingReady;
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });

    const stopPattern = /(already\s+(enrolled|joined|purchased)|not\s+interested|do\s+not\s+contact|don['’]?t\s+contact|stop\s+(all\s+)?follow[- ]?ups?|no\s+more\s+(calls|messages))/i;
    let shouldStop = stopPattern.test(note);
    let followupAt = null;
    if (ai) {
      try {
        const analysis = await generateOpenRouterContent(`Analyze this sales representative note. Current time is ${new Date().toISOString()} (Asia/Kolkata business timezone).
Note: ${JSON.stringify(note)}
Return only JSON: {"stop_followups":boolean,"followup_at":string|null}. Set stop_followups true for enrolled/converted/not interested/do-not-contact intent. Convert an explicit future callback time such as tomorrow at 5 PM to an ISO timestamp. Do not invent a time.`);
        const parsed = JSON.parse(analysis.replace(/```json|```/gi, '').trim());
        shouldStop = shouldStop || parsed.stop_followups === true;
        if (parsed.followup_at && !Number.isNaN(new Date(parsed.followup_at).getTime()) && new Date(parsed.followup_at) > new Date()) {
          followupAt = new Date(parsed.followup_at).toISOString();
        }
      } catch (analysisError) {
        console.error('[Sales Note] AI analysis fallback:', analysisError.message);
      }
    }

    const noteResult = { rows: [(await SalesLeadNotes.create({ lead_id: req.params.leadId, note })).toObject()] };
    const followupDate = followupAt ? new Date(followupAt) : null;
    const notedLead = await Leads.findOneAndUpdate(
      { id: req.params.leadId },
      { $set: {
        sales_followup_stopped: shouldStop,
        sales_followup_at: followupDate,
        ...(shouldStop ? { next_followup_due: null } : followupDate ? { next_followup_due: followupDate } : {}),
        ...(shouldStop && lower(note).includes('not interested') ? { sales_status: 'not_interested' } : {}),
        updated_at: new Date(),
      } },
      { new: true, projection: { _id: 0, id: 1, sales_status: 1, sales_followup_stopped: 1, sales_followup_at: 1, next_followup_due: 1 } }
    ).lean();
    const leadResult = { rows: notedLead ? [notedLead] : [] };
    await emitSalesTaskUpdate(req, 'note_added', { lead_id: Number(req.params.leadId), note: noteResult.rows[0], ...leadResult.rows[0] });
    res.json({ success: true, note: noteResult.rows[0], lead: leadResult.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/sales-tasks/notes/:noteId', internalAuth, async (req, res) => {
  try {
    const note = String(req.body.note || '').trim();
    if (!note) return res.status(400).json({ error: 'Note is required' });
    const updatedNote = await SalesLeadNotes.findOneAndUpdate({ id: req.params.noteId }, { $set: { note } }, { new: true, projection: NO_ID }).lean();
    if (!updatedNote) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true, note: updatedNote });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/sales-tasks/notes/:noteId', internalAuth, async (req, res) => {
  try {
    const deletedNote = await SalesLeadNotes.findOneAndDelete({ id: req.params.noteId }, { projection: { lead_id: 1 } }).lean();
    if (!deletedNote) return res.status(404).json({ error: 'Note not found' });
    const leadId = deletedNote.lead_id;
    const latestNote = await SalesLeadNotes.findOne({ lead_id: leadId }, { _id: 0, id: 1, note: 1, created_at: 1 }).sort({ created_at: -1 }).lean();
    res.json({ success: true, latest_note: latestNote || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/sales-tasks/bulk-delete', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    const ids = Array.isArray(req.body.ids)
      ? [...new Set(req.body.ids.map(Number).filter(Number.isInteger))]
      : [];
    const from = String(req.body.from || '');
    const to = String(req.body.to || '');
    const validDate = /^\d{4}-\d{2}-\d{2}$/;
    let result;

    if (ids.length) {
      const doomed = await SalesTasks.find({ id: { $in: ids } }, { _id: 0, id: 1, lead_id: 1, task_type: 1 }).lean();
      await SalesTasks.deleteMany({ id: { $in: doomed.map((t) => t.id) } });
      result = { rows: doomed, rowCount: doomed.length };
    } else {
      if (!validDate.test(from) || !validDate.test(to) || from > to) {
        return res.status(400).json({ error: 'A valid inclusive from/to date range is required' });
      }
      const rangeStart = new Date(`${from}T00:00:00.000Z`);
      const rangeEnd = new Date(new Date(`${to}T00:00:00.000Z`).getTime() + DAY_MS);
      const doomed = await SalesTasks.find({ created_at: { $gte: rangeStart, $lt: rangeEnd } }, { _id: 0, id: 1, lead_id: 1, task_type: 1 }).lean();
      await SalesTasks.deleteMany({ id: { $in: doomed.map((t) => t.id) } });
      result = { rows: doomed, rowCount: doomed.length };
    }

    for (const task of result.rows) await emitSalesTaskUpdate(req, 'deleted', task);
    res.json({ success: true, deletedCount: result.rowCount, deletedIds: result.rows.map(task => task.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sales-tasks/:id', internalAuth, async (req, res) => {
  try {
    await salesTasksReady;
    const deletedTask = await SalesTasks.findOneAndDelete({ id: req.params.id }, { projection: { _id: 0, id: 1, lead_id: 1, task_type: 1 } }).lean();
    await emitSalesTaskUpdate(req, 'deleted', deletedTask || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ==========================================
// Bot Integration: Book a Call - STOPS FOLLOW-UPS
// ==========================================
router.get('/auth/google', (req, res) => {
  try {
    res.redirect(googleCalendar.getAuthorizationUrl());
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

router.get('/auth/google/callback-calender', async (req, res) => {
  try {
    if (!req.query.code) return res.status(400).send('Google authorization code is missing.');
    const email = await googleCalendar.exchangeAndStoreCode(String(req.query.code));
    res.send(`Google Calendar connected successfully for ${email}. You may close this window.`);
  } catch (error) {
    res.status(500).send(`Google Calendar connection failed: ${error.message}`);
  }
});

router.get('/calendar/status', internalAuth, async (req, res) => {
  res.json(await googleCalendar.getConnectionStatus());
});

router.post('/calendar/availability', internalAuth, async (req, res) => {
  try {
    const start = new Date(req.body.start);
    const durationMinutes = Math.min(Math.max(Number(req.body.duration_minutes) || 30, 15), 180);
    if (Number.isNaN(start.getTime())) return res.status(400).json({ success: false, error: 'A valid start time is required' });
    const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
    const available = await googleCalendar.isSlotAvailable(start, end);
    res.json({ success: true, available, start: start.toISOString(), end: end.toISOString(), time_zone: googleCalendar.TIME_ZONE });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

router.post('/leads/book-call', internalAuth, async (req, res) => {
  try {
    const { lead_id, booking_time, duration_minutes, notes } = req.body;

    if (!lead_id || !booking_time) {
      return res.status(400).json({ success: false, error: "Missing lead_id or booking_time" });
    }

    const detailedLead = await leadWithClient(lead_id, { brand_name: 'name' });
    if (!detailedLead) return res.status(404).json({ success: false, error: 'Lead not found' });

    const lead = { id: detailedLead.id, name: detailedLead.name, phone: detailedLead.phone, email: detailedLead.email, brand_name: detailedLead.brand_name };
    const calendarBooking = await googleCalendar.bookMeeting({
      leadId: lead_id,
      brand: lead.brand_name,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      start: booking_time,
      durationMinutes: duration_minutes,
      notes,
    });
    if (!calendarBooking.booked) {
      return res.status(409).json({ success: false, reason: calendarBooking.reason, error: 'The selected Google Calendar slot is unavailable' });
    }

    // Mark booked only after Google confirms the event, preventing false CRM bookings.
    const bookedLead = await Leads.findOneAndUpdate(
      { id: lead_id },
      { $set: {
        call_booked_at: calendarBooking.start, status: 'booked', booking_status: 'confirmed',
        calendar_event_id: calendarBooking.event_id, calendar_event_url: calendarBooking.event_url,
        google_meet_link: calendarBooking.meet_link, updated_at: new Date(),
      } },
      { new: true, projection: { _id: 0, id: 1, call_booked_at: 1, status: 1, booking_status: 1, calendar_event_url: 1, google_meet_link: 1 } }
    ).lean();
    const result = { rows: bookedLead ? [bookedLead] : [] };

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Lead not found" });
    }

    await salesTasksReady;
    if (!(await SalesTasks.exists({ lead_id, task_type: 'call' }))) {
      const callTask = await SalesTasks.create({ lead_id, task_type: 'call', unread: true });
      await emitSalesTaskUpdate(req, 'created', {
        id: callTask.id, lead_id: callTask.lead_id, task_type: callTask.task_type, status: callTask.status, unread: callTask.unread, created_at: callTask.created_at,
      });
    }

    let support_notification = { sent: false };
    try {
      support_notification = await sendBookingNotification({
        eventId: calendarBooking.event_id,
        brand: lead.brand_name,
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        start: calendarBooking.start,
        eventUrl: calendarBooking.event_url,
        meetLink: calendarBooking.meet_link,
        rescheduled: calendarBooking.rescheduled,
      });
    } catch (notificationError) {
      console.error('[Book Call] Support email notification failed:', notificationError.message);
      support_notification = { sent: false, error: notificationError.message };
    }

    console.log(`[Book Call] Lead ${lead_id} booked for ${booking_time} - follow-ups will STOP`);
    res.json({ success: true, lead: result.rows[0], calendar: calendarBooking, support_notification, message: "Meeting booked in Google Calendar and follow-ups stopped." });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
