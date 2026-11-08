/**
 * The WhatsApp send queue (plan N1). Every business-initiated message that
 * goes out at volume is a row in `campaign_message_queue` and is sent by this
 * worker from the brand number of its tenant, with:
 *
 *   - the send policy (consent, STOP, marketing pause, 24-hour window) checked
 *     right before the send, not when the row was queued;
 *   - per-number rate limits and a daily cap that grows slowly for new
 *     numbers (services/numberHealth.js);
 *   - retries with exponential backoff for Meta rate limits, 5xx and network
 *     errors, and a permanent failure after WA_QUEUE_MAX_ATTEMPTS.
 *
 * Claiming looks across all tenants (system context, atomic claim); each
 * claimed row is then handled inside its own tenant, so a row can never be
 * sent with another tenant's credentials or see another tenant's contacts.
 *
 *   WA_QUEUE_TICK_MS        how often a batch runs           (default 2000)
 *   WA_QUEUE_BATCH_SIZE     rows claimed per batch           (default 10)
 *   WA_QUEUE_MAX_ATTEMPTS   attempts before a row fails      (default 5)
 *   WA_QUEUE_BACKOFF_MS     first retry delay                (default 30000)
 */
const axios = require('axios');
const {
  CampaignMessageQueue, CampaignLogs, CampaignRateStats, Campaigns, Clients, Conversations, Leads, Messages,
} = require('../models');
const { NO_ID, upsertOne, phoneTailRegex } = require('../db/mongo');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { tenantCanSend } = require('./lifecycle');
const sendPolicy = require('./sendPolicy');
const numberHealth = require('./numberHealth');
const { campaignTemplatePayload, renderCampaignBody } = require('./campaignTemplates');

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const envInt = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};
const settings = () => ({
  tickMs: envInt('WA_QUEUE_TICK_MS', 2000),
  batchSize: envInt('WA_QUEUE_BATCH_SIZE', 10),
  maxAttempts: envInt('WA_QUEUE_MAX_ATTEMPTS', 5),
  backoffMs: envInt('WA_QUEUE_BACKOFF_MS', 30000),
});
const MAX_BACKOFF_MS = 60 * 60 * 1000;
const STALE_CLAIM_MS = 5 * 60 * 1000;
const TERMINAL = ['sent', 'failed', 'skipped', 'cancelled'];

// Live counters for the campaign dashboard (same shape the old limiter exposed).
const rateLimiter = {
  messagesThisMinute: 0, messagesThisHour: 0, messagesThisDay: 0, consecutiveRateLimits: 0, currentDelayMs: 0,
  lastResetMinute: Date.now(), lastResetHour: Date.now(), lastResetDay: Date.now(),
};
function tickCounters() {
  const now = Date.now();
  if (now - rateLimiter.lastResetMinute > 60000) { rateLimiter.messagesThisMinute = 0; rateLimiter.lastResetMinute = now; }
  if (now - rateLimiter.lastResetHour > 3600000) { rateLimiter.messagesThisHour = 0; rateLimiter.lastResetHour = now; }
  if (now - rateLimiter.lastResetDay > 86400000) { rateLimiter.messagesThisDay = 0; rateLimiter.lastResetDay = now; }
}

/** Delay before retry number `attempt` (1-based): base × 2^(attempt-1) with up to 20% jitter, capped at an hour. */
function backoffMs(attempt, { backoffMs: base } = settings()) {
  const exp = Math.min(base * 2 ** Math.max(0, attempt - 1), MAX_BACKOFF_MS);
  return Math.round(exp * (1 + Math.random() * 0.2));
}

const utcToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

async function bumpCampaignRateStat(campaignId, field) {
  if (!campaignId) return;
  const key = { campaign_id: campaignId, date: utcToday() };
  const updated = await CampaignRateStats.updateOne(key, { $inc: { [field]: 1 } });
  if (updated.matchedCount) return;
  try {
    await CampaignRateStats.create({ ...key, [field]: 1 });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await CampaignRateStats.updateOne(key, { $inc: { [field]: 1 } });
  }
}

/** Queues one campaign for its leads. Campaign blasts are marketing by definition. */
async function enqueueCampaign(campaignId, leads, campaign) {
  if (!leads.length) return 0;
  const alreadyQueued = new Set(await CampaignMessageQueue.distinct('lead_id', { campaign_id: campaignId, lead_id: { $in: leads.map((lead) => lead.id) } }));
  const fresh = [];
  for (const lead of leads) {
    if (alreadyQueued.has(Number(lead.id))) continue;
    alreadyQueued.add(Number(lead.id));
    fresh.push(lead);
  }
  if (!fresh.length) return 0;
  const ids = await CampaignMessageQueue.allocIds(fresh.length);
  const now = new Date();
  await CampaignMessageQueue.insertMany(fresh.map((lead, index) => ({
    id: ids[index],
    campaign_id: campaignId,
    lead_id: lead.id,
    phone: lead.phone,
    name: lead.name || '',
    template_name: campaign.template_name,
    template_language: campaign.template_language || 'en',
    template_body: campaign.template_body || '',
    template_header: campaign.template_header || '',
    template_parameters: campaign.template_parameters || {},
    recipient_parameters: lead.template_parameters || {},
    recipient_data: {
      recipient_email: lead.email || '', lead_status: lead.status || '',
      lead_source: lead.source || '', lead_interest: lead.interest || '', lead_score: lead.score ?? '',
    },
    campaign_name: campaign.campaign_name || '',
    brand_name: campaign.brand_name || '',
    phone_number_id: campaign.phone_number_id || '',
    kind: 'marketing',
    msg_type: 'template',
    source: 'campaign',
    status: 'pending',
    next_attempt_at: now,
    created_at: now,
  })));
  return fresh.length;
}

/**
 * Queues one message (not a campaign). `payload` is the Graph API message
 * object without `to` ({ type: 'template', template: {...} }).
 */
async function enqueue({ leadId, phone, phoneNumberId, kind = 'marketing', payload, content = '', msgType = null, source = 'api', sendAt = null }) {
  if (!payload || typeof payload !== 'object' || !payload.type) throw new Error('payload with a message type is required');
  const now = new Date();
  const row = await CampaignMessageQueue.create({
    lead_id: leadId ?? null,
    phone: String(phone || ''),
    phone_number_id: phoneNumberId ? String(phoneNumberId) : '',
    kind: sendPolicy.normaliseKind(kind),
    payload,
    content: String(content || ''),
    msg_type: msgType || payload.type,
    source,
    status: 'pending',
    next_attempt_at: sendAt ? new Date(sendAt) : now,
    created_at: now,
  });
  return row.toObject();
}

/** Resolves the sender for a row: the number it was queued for, else the tenant's brand. */
async function senderFor(row) {
  const projection = { _id: 0, id: 1, name: 1, phone_number_id: 1, wa_access_token: 1, whatsapp_status: 1 };
  const client = row.phone_number_id
    ? await Clients.findOne({ phone_number_id: String(row.phone_number_id) }, projection).lean()
    : await Clients.findOne({}, projection).lean();
  if (!client?.phone_number_id || !client?.wa_access_token) return null;
  return { clientId: client.id, phoneNumberId: String(client.phone_number_id), token: client.wa_access_token, status: client.whatsapp_status };
}

async function leadFor(row) {
  if (row.lead_id != null) {
    const lead = await Leads.findOne({ id: row.lead_id }, NO_ID).lean();
    if (lead) return lead;
  }
  if (row.phone) {
    const lead = await Leads.findOne({ phone: phoneTailRegex(row.phone) }, NO_ID).sort({ created_at: -1 }).lean();
    if (lead) return lead;
  }
  return { id: null, phone: row.phone };
}

function classifyError(err) {
  const status = err.response?.status;
  const meta = err.response?.data?.error;
  const code = meta?.code;
  const message = meta?.error_data?.details || meta?.message || err.message || 'WhatsApp refused the message';
  const retryable = !err.response || status === 429 || (status >= 500 && status < 600) || numberHealth.isRateLimitCode(code);
  return { retryable, code, message: code ? `${message} (Meta error ${code})` : message };
}

async function markDeferred(row, { at, reason }) {
  await CampaignMessageQueue.updateOne({ id: row.id }, {
    $set: { status: 'pending', next_attempt_at: at, error_message: reason },
    $inc: { attempts: -1 },
  });
}

async function markSkipped(row, reason) {
  await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'skipped', skip_reason: reason, processed_at: new Date() } });
  if (row.campaign_id) {
    await CampaignLogs.create({ campaign_id: row.campaign_id, lead_id: row.lead_id, status: 'skipped', error_message: reason, sent_at: new Date() });
  }
}

async function markFailed(row, reason) {
  await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'failed', error_message: reason, processed_at: new Date() } });
  if (row.campaign_id) {
    await CampaignLogs.create({ campaign_id: row.campaign_id, lead_id: row.lead_id, status: 'failed', error_message: reason, sent_at: new Date() });
    await bumpCampaignRateStat(row.campaign_id, 'messages_failed');
  }
}

/** Mirrors a sent row into the inbox. Never retried: Meta already accepted the message. */
async function mirrorToInbox(row, lead, waMessageId, io) {
  try {
    const content = row.campaign_id ? renderCampaignBody(row) : (row.content || `[${row.msg_type || 'message'}]`);
    if (row.campaign_id && !(await Campaigns.exists({ id: row.campaign_id }))) return;
    const phone = String(row.phone || lead?.phone || '').replace(/\D/g, '').slice(-10);
    if (!phone) return;
    const leadId = lead?.id ?? row.lead_id ?? null;
    const conversation = await upsertOne(
      Conversations,
      { phone },
      { $set: { ...(leadId != null ? { lead_id: leadId } : {}), status: 'open', last_message: content, last_message_at: new Date() } },
      { lead_id: leadId, status: 'open', last_message: content, last_message_at: new Date(), created_at: new Date() },
    );
    if (!conversation?.id) return;
    const saved = await Messages.create({
      conversation_id: conversation.id, direction: 'outbound', content, msg_type: row.msg_type || 'template',
      template_name: row.template_name || row.payload?.template?.name || null,
      wa_msg_id: waMessageId, status: 'sent', is_ai: false, sent_at: new Date(),
    });
    if (io && leadId != null) {
      io.emit('outgoing_message', {
        lead_id: Number(leadId),
        message: {
          id: saved.id, conversation_id: saved.conversation_id, direction: 'outbound', content, type: saved.msg_type,
          wa_msg_id: waMessageId, status: 'sent', is_ai: false, timestamp: saved.sent_at, ...(row.campaign_id ? { campaign_id: row.campaign_id } : {}),
        },
      });
    }
  } catch (error) {
    console.error(`[Send Queue] Message ${waMessageId} sent, but inbox sync failed:`, error.message);
  }
}

/** Handles one claimed row inside its tenant. Returns the outcome word for logs. */
async function processRow(row, { io, now = new Date(), maxAttempts } = {}) {
  const config = settings();
  const limit = maxAttempts || config.maxAttempts;
  try {
    if (!(await tenantCanSend(row.tenant_id))) {
      await markDeferred(row, { at: new Date(now.getTime() + 15 * 60 * 1000), reason: 'Workspace cannot send in its current state' });
      return 'deferred';
    }
    const sender = await senderFor(row);
    if (!sender) { await markFailed(row, 'WhatsApp is not connected for this workspace'); return 'failed'; }
    if (sender.status && sender.status !== 'verified') { await markFailed(row, 'WhatsApp is not verified for this brand'); return 'failed'; }

    const lead = await leadFor(row);
    const messageType = row.msg_type || row.payload?.type || 'template';
    const check = await sendPolicy.checkSend({ lead, kind: row.kind || 'marketing', messageType, phoneNumberId: sender.phoneNumberId, now });
    if (!check.ok) {
      if (check.retryable) { await markDeferred(row, { at: check.retryAt || new Date(now.getTime() + 15 * 60 * 1000), reason: check.message }); return 'deferred'; }
      await markSkipped(row, check.message);
      return 'skipped';
    }

    const slot = await numberHealth.reserveSlot(sender.phoneNumberId, { countsTowardDailyCap: messageType === 'template', now });
    if (!slot.ok) {
      await markDeferred(row, { at: slot.retryAt, reason: slot.message });
      if (slot.reason === 'daily_cap' && row.campaign_id) await bumpCampaignRateStat(row.campaign_id, 'rate_limited_count');
      return 'deferred';
    }

    const to = String(row.phone || lead?.phone || '').replace(/\D/g, '');
    const message = row.campaign_id
      ? { type: 'template', template: campaignTemplatePayload(row) }
      : row.payload;
    const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...message };

    let waMessageId = null;
    try {
      const response = await axios.post(
        `https://graph.facebook.com/${GRAPH_VERSION}/${sender.phoneNumberId}/messages`,
        payload,
        { headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
      );
      waMessageId = response.data?.messages?.[0]?.id || null;
    } catch (err) {
      const { retryable, code, message: reason } = classifyError(err);
      if (code) await numberHealth.recordSendError(sender.phoneNumberId, { code, message: reason });
      if (numberHealth.isRateLimitCode(code) || err.response?.status === 429) {
        rateLimiter.consecutiveRateLimits += 1;
        if (row.campaign_id) await bumpCampaignRateStat(row.campaign_id, 'rate_limited_count');
      }
      if (retryable && Number(row.attempts || 0) < limit) {
        const delay = backoffMs(Number(row.attempts || 1), config);
        await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'pending', next_attempt_at: new Date(now.getTime() + delay), error_message: reason } });
        return 'retry';
      }
      await markFailed(row, retryable ? `${reason} — gave up after ${row.attempts} attempts` : reason);
      return 'failed';
    }

    await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'sent', wa_message_id: waMessageId, processed_at: new Date(), error_message: null } });
    if (row.campaign_id) {
      await CampaignLogs.create({ campaign_id: row.campaign_id, lead_id: row.lead_id, wa_message_id: waMessageId, status: 'sent', sent_at: new Date() });
      await bumpCampaignRateStat(row.campaign_id, 'messages_sent');
    }
    await mirrorToInbox(row, lead, waMessageId, io);
    tickCounters();
    rateLimiter.messagesThisMinute += 1; rateLimiter.messagesThisHour += 1; rateLimiter.messagesThisDay += 1; rateLimiter.consecutiveRateLimits = 0;
    return 'sent';
  } catch (err) {
    // The external result is unknown: leave the row claimed for stale-claim
    // recovery rather than risk sending it twice.
    console.error(`[Send Queue] Error processing row ${row.id}:`, err.message);
    await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { error_message: `Worker error after claim: ${err.message}` } }).catch(() => {});
    return 'error';
  }
}

/** Marks a campaign completed or failed once none of its rows are open. */
async function checkCampaignCompletion(campaignId) {
  if (!campaignId) return;
  const [open, sent] = await Promise.all([
    CampaignMessageQueue.countDocuments({ campaign_id: campaignId, status: { $in: ['pending', 'processing'] } }),
    CampaignMessageQueue.countDocuments({ campaign_id: campaignId, status: 'sent' }),
  ]);
  if (open === 0) {
    await Campaigns.updateOne({ id: campaignId, status: 'running' }, { $set: { status: sent > 0 ? 'completed' : 'failed' } });
  }
}

/** One worker pass: recover stale claims, drop duplicates, claim due rows and send them. */
async function processBatch({ io = null, now = new Date() } = {}) {
  const config = settings();
  return runAsSystem(async () => {
    const outcomes = { sent: 0, retry: 0, deferred: 0, skipped: 0, failed: 0, error: 0 };
    try {
      await CampaignMessageQueue.updateMany(
        { status: 'processing', last_attempt_at: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } },
        { $set: { status: 'pending' } },
      );

      // One send per (campaign, lead): quarantine duplicate rows before claiming.
      const openRows = await CampaignMessageQueue.find({ status: { $in: ['pending', 'processing'] }, campaign_id: { $ne: null } }, { id: 1, campaign_id: 1, lead_id: 1 }).sort({ id: 1 }).lean();
      if (openRows.length) {
        const sentPairs = new Set((await CampaignMessageQueue.find(
          { status: 'sent', campaign_id: { $in: [...new Set(openRows.map((row) => row.campaign_id))] } }, { campaign_id: 1, lead_id: 1 },
        ).lean()).map((row) => `${row.campaign_id}:${row.lead_id}`));
        const seen = new Set();
        const duplicates = [];
        for (const row of openRows) {
          const pair = `${row.campaign_id}:${row.lead_id}`;
          if (seen.has(pair) || sentPairs.has(pair)) duplicates.push(row.id);
          seen.add(pair);
        }
        if (duplicates.length) {
          await CampaignMessageQueue.updateMany({ id: { $in: duplicates } }, { $set: { status: 'cancelled', skip_reason: 'Duplicate queue entry', processed_at: now } });
        }
      }

      const claimable = await CampaignMessageQueue.find(
        { status: 'pending', $or: [{ next_attempt_at: null }, { next_attempt_at: { $lte: now } }] },
        { id: 1 },
      ).sort({ next_attempt_at: 1, created_at: 1 }).limit(config.batchSize).lean();
      const claimed = [];
      for (const row of claimable) {
        const doc = await CampaignMessageQueue.findOneAndUpdate(
          { id: row.id, status: 'pending' },
          { $set: { status: 'processing', last_attempt_at: now }, $inc: { attempts: 1 } },
          { new: true, projection: NO_ID },
        ).lean();
        if (doc) claimed.push(doc);
      }
      if (!claimed.length) return outcomes;

      for (const row of claimed) {
        if (!row.tenant_id) {
          await CampaignMessageQueue.updateOne({ id: row.id }, { $set: { status: 'failed', processed_at: now, error_message: 'Queue row has no tenant' } });
          outcomes.failed += 1;
          continue;
        }
        const outcome = await runAsTenant(row.tenant_id, () => processRow(row, { io, now, maxAttempts: config.maxAttempts }));
        outcomes[outcome] = (outcomes[outcome] || 0) + 1;
      }

      const campaigns = new Map(claimed.filter((row) => row.tenant_id && row.campaign_id).map((row) => [row.campaign_id, row.tenant_id]));
      for (const [campaignId, tenantId] of campaigns) {
        await runAsTenant(tenantId, () => checkCampaignCompletion(campaignId));
      }
    } catch (err) {
      console.error('[Send Queue] Batch error:', err.message);
    }
    return outcomes;
  }, 'send-queue');
}

/** Status counts for the current tenant (optionally one campaign). */
async function stats(match = {}) {
  const rows = await CampaignMessageQueue.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const counts = Object.fromEntries(rows.map((row) => [row._id, row.count]));
  const out = { pending: 0, processing: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0, total: 0 };
  for (const [status, count] of Object.entries(counts)) {
    if (status in out) out[status] = count;
    out.total += count;
  }
  return out;
}

let timer = null;
let running = false;
async function initIndexes() {
  await Promise.all([CampaignMessageQueue.createIndexes(), CampaignRateStats.createIndexes()]);
}

/** Starts the periodic worker. `io` is the tenant-scoped socket emitter. */
async function start({ io } = {}) {
  if (timer) return;
  await initIndexes();
  const run = async () => {
    if (running) return;
    running = true;
    try { await processBatch({ io }); } finally { running = false; }
  };
  timer = setInterval(() => { run().catch((err) => console.error('[Send Queue]', err.message)); }, settings().tickMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[Send Queue] Worker started (every ${settings().tickMs}ms, batch ${settings().batchSize})`);
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = {
  TERMINAL,
  settings,
  rateLimiter,
  backoffMs,
  enqueueCampaign,
  enqueue,
  processRow,
  processBatch,
  checkCampaignCompletion,
  stats,
  start,
  stop,
  classifyError,
};
