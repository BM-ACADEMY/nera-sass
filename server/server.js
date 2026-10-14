/**
 * LeadOS — ABM Groups Backend API
 * Domain: leados-api.abmgroups.org
 * Port: 3000
 */

const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const axios = require('axios');
const cron = require('node-cron');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { convertToWhatsAppVoiceNote } = require('./services/voice-note-encoder');
const xlsx = require('xlsx');
const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const openRouter = require('./services/openrouter');
const cryptoHelper = require('./utils/crypto');
require('dotenv').config({ path: path.join(__dirname, '.env'), override: true });
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3600;

// ── SOCKET.IO ─────────────────────────────────────────────
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: function (origin, callback) { callback(null, origin || true); },
    methods: ['GET', 'POST'],
    credentials: true
  }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ── DB CONNECTION ─────────────────────────────────────────
const { connectMongo, mongoose } = require('./db/connection');
const {
  NO_ID, ieq, escapeRegex, upsertOne, insertIgnore, withLock, phoneTailRegex, allocIds,
} = require('./db/mongo');
const { deleteCascade, updateKeyCascade } = require('./db/cascade');
const models = require('./models');
const {
  Users, Clients, Leads, Conversations, Messages, Templates, Campaigns, CampaignLogs, CampaignMessageQueue,
  CampaignRateStats, CampaignImportRecipients, LeadExportJobs, LeadNotes, LeadTags, Payments, Brands, BrainDocs,
  MetaWhatsappAccounts, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates, MetaWhatsappSyncRuns, FailedWebhooks,
  AllianceInboxTags, SalesTasks, WorkflowLogs, AiDecisions, Tenants,
} = models;
// Collections need no ALTER/CREATE migrations in MongoDB; these remain for awaiting call sites.
const templateParameterDefinitionsReady = Promise.resolve();
const clientsWhatsAppStatusReady = Promise.resolve();
const metaInventoryReady = Promise.resolve();

const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v19.0';
const profileLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, callback) => callback(null, ['image/jpeg', 'image/png'].includes(file.mimetype))
});
const graphPageData = async (url, token, params = {}) => {
  const rows = [];
  let next = url;
  let nextParams = params;
  while (next) {
    const response = await axios.get(next, { params: nextParams, headers: { Authorization: `Bearer ${token}` } });
    rows.push(...(response.data?.data || []));
    next = response.data?.paging?.next || null;
    nextParams = {};
  }
  return rows;
};

const META_PROFILE_FIELDS = ['wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website'];
const META_VERTICALS = {
  'Matrimonial service': 'MATRIMONIAL',
  'Finance and banking': 'FINANCE',
  'Food and groceries': 'GROCERY',
  'Alcoholic drinks': 'ALCOHOL',
  Government: 'GOVT',
  'Hotel and lodging': 'HOTEL',
  'Medical and health': 'HEALTH',
  'Over-the-counter medicine': 'MEDICAL',
  Charity: 'NONPROFIT',
  'Professional services': 'PROF_SERVICES',
  'Shopping and retail': 'RETAIL',
  'Travel and transportation': 'TRAVEL',
  Restaurant: 'RESTAURANT',
  OTHER: 'OTHER',
};

const metaProfilePayload = client => ({
  messaging_product: 'whatsapp',
  vertical: META_VERTICALS[client.wa_category] || client.wa_category || 'OTHER',
  address: client.wa_address || '',
  description: client.wa_description || '',
  email: client.wa_email || '',
  websites: client.wa_website ? [client.wa_website] : [],
});

const resolveClientMetaConfig = client => ({
  wabaId: client.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID,
  // Phone Number IDs are unique per Meta phone asset and must never fall back
  // to the platform's default number for a different brand.
  phoneId: client.phone_number_id || null,
  token: client.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN,
});

const normalizedPhoneDigits = value => String(value || '').replace(/\D/g, '');

async function assertPhoneBelongsToWaba(client) {
  const config = resolveClientMetaConfig(client);
  if (!config.wabaId || !config.phoneId || !config.token) {
    throw new Error('WABA ID, Phone Number ID, and System User Token are required for Meta synchronization');
  }
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  const phones = await graphPageData(`${base}/${config.wabaId}/phone_numbers`, config.token, {
    fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status,name_status,new_name_status'
  });
  const phone = phones.find(item => String(item.id) === String(config.phoneId));
  if (!phone) {
    throw new Error(`Phone Number ID ${config.phoneId} does not exist under WABA ${config.wabaId}. Add and verify the number in Meta first, then sync it to LeadOS.`);
  }
  const savedDigits = normalizedPhoneDigits(client.whatsapp_number);
  const metaDigits = normalizedPhoneDigits(phone.display_phone_number);
  if (savedDigits && metaDigits && savedDigits !== metaDigits) {
    throw new Error(`The WhatsApp number does not match Phone Number ID ${config.phoneId} in WABA ${config.wabaId}`);
  }
  return { ...config, phone };
}

async function updateWhatsAppBusinessProfile(client) {
  const config = await assertPhoneBelongsToWaba(client);
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  await axios.post(
    `${base}/${config.phoneId}/whatsapp_business_profile`,
    metaProfilePayload(client),
    { headers: { Authorization: `Bearer ${config.token}` } }
  );

  // Refresh the cached Meta values used by the expanded client panel.
  const profileResponse = await axios.get(`${base}/${config.phoneId}/whatsapp_business_profile`, {
    params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
    headers: { Authorization: `Bearer ${config.token}` }
  });
  const profileRow = profileResponse.data?.data?.[0] || {};
  const profile = profileRow.business_profile || profileRow;
  await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: String(config.phoneId) }, { $set: {
    profile_picture_url: profile.profile_picture_url || null, profile_about: profile.about || null,
    profile_address: profile.address || null, profile_description: profile.description || null,
    profile_email: profile.email || null, profile_websites: profile.websites || [], profile_vertical: profile.vertical || null,
    'raw_data.business_profile': profile, last_synced_at: new Date(),
  } });
  if (client.id) {
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: String(config.phoneId) }, { $set: { client_id: client.id } });
  }
  return { profile, phone: config.phone };
}

async function cacheMetaBusinessProfile(phoneId, token) {
  const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  const response = await axios.get(`${base}/${phoneId}/whatsapp_business_profile`, {
    params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
    headers: { Authorization: `Bearer ${token}` }
  });
  const row = response.data?.data?.[0] || {};
  const profile = row.business_profile || row;
  await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: String(phoneId) }, { $set: {
    profile_picture_url: profile.profile_picture_url || null, profile_about: profile.about || null,
    profile_address: profile.address || null, profile_description: profile.description || null,
    profile_email: profile.email || null, profile_websites: profile.websites || [], profile_vertical: profile.vertical || null,
    'raw_data.business_profile': profile, last_synced_at: new Date(),
  } });
  return profile;
}

async function syncMetaWhatsAppInventory() {
  await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
  const businessId = process.env.META_BUSINESS_ID || process.env.WA_META_BUSINESS_ID;
  const configuredWabaId = process.env.WA_BUSINESS_ACCOUNT_ID;
  const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
  if (!businessId && !configuredWabaId) {
    throw new Error('Configure META_BUSINESS_ID for all WABAs, or WA_BUSINESS_ACCOUNT_ID for single-WABA sync');
  }
  if (!token) throw new Error('META_SYSTEM_USER_ACCESS_TOKEN or META_PAGE_ACCESS_TOKEN is required');
  const runDoc = await MetaWhatsappSyncRuns.create({ status: 'running' });
  const run = { rows: [{ id: runDoc.id }] };
  try {
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    let owned;
    let client;
    if (businessId) {
      [owned, client] = await Promise.all([
        graphPageData(`${base}/${businessId}/owned_whatsapp_business_accounts`, token),
        graphPageData(`${base}/${businessId}/client_whatsapp_business_accounts`, token).catch(() => []),
      ]);
    } else {
      // A WABA ID cannot be sent to the Business Portfolio discovery edges.
      // When only WA_BUSINESS_ACCOUNT_ID is configured, fetch that WABA
      // directly so phone/template sync remains usable in single-WABA mode.
      const wabaResponse = await axios.get(`${base}/${configuredWabaId}`, {
        params: { fields: 'id,name,currency,timezone_id,message_template_namespace' },
        headers: { Authorization: `Bearer ${token}` },
      });
      owned = [wabaResponse.data];
      client = [];
    }
    const wabaMap = new Map();
    owned.forEach(item => wabaMap.set(String(item.id), { ...item, ownership_type: 'owned' }));
    client.forEach(item => wabaMap.set(String(item.id), { ...item, ownership_type: 'client' }));
    let phoneCount = 0;
    let templateCount = 0;
    for (const waba of wabaMap.values()) {
      const wabaFields = {
        business_id: businessId || null, name: waba.name ?? null, currency: waba.currency ?? null, timezone_id: waba.timezone_id ?? null,
        template_namespace: waba.message_template_namespace ?? null, ownership_type: waba.ownership_type, raw_data: waba, last_synced_at: new Date(),
      };
      await upsertOne(MetaWhatsappAccounts, { waba_id: String(waba.id) }, { $set: wabaFields }, wabaFields);
      const [phones, templates] = await Promise.all([
        graphPageData(`${base}/${waba.id}/phone_numbers`, token,
          { fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status,name_status,new_name_status' })
          .catch(() => graphPageData(`${base}/${waba.id}/phone_numbers`, token)),
        graphPageData(`${base}/${waba.id}/message_templates`, token),
      ]);
      for (const phone of phones) {
        let profile = {};
        try {
          const profileResponse = await axios.get(`${base}/${phone.id}/whatsapp_business_profile`, {
            params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
            headers: { Authorization: `Bearer ${token}` }
          });
          const profileRow = profileResponse.data?.data?.[0] || {};
          profile = profileRow.business_profile || profileRow;
        } catch (profileError) {
          console.warn(`[Meta Inventory] Profile unavailable for phone ${phone.id}:`, profileError.response?.data?.error?.message || profileError.message);
        }
        const phoneFields = {
          waba_id: String(waba.id), display_phone_number: phone.display_phone_number ?? null, verified_name: phone.verified_name ?? null,
          verification_status: phone.code_verification_status ?? null, connection_status: phone.status ?? null,
          quality_rating: phone.quality_rating ?? null, platform_type: phone.platform_type ?? null,
          profile_picture_url: profile.profile_picture_url ?? null, profile_about: profile.about ?? null,
          profile_address: profile.address ?? null, profile_description: profile.description ?? null,
          profile_email: profile.email ?? null, profile_websites: profile.websites || [], profile_vertical: profile.vertical ?? null,
          raw_data: { ...phone, business_profile: profile }, last_synced_at: new Date(),
        };
        await upsertOne(MetaWhatsappPhoneNumbers, { phone_number_id: String(phone.id) }, { $set: phoneFields }, phoneFields);
      }
      for (const template of templates) {
        const templateFields = {
          waba_id: String(waba.id), name: template.name ?? null, language: template.language ?? null, status: template.status ?? null,
          category: template.category ?? null, components: template.components || [], raw_data: template, last_synced_at: new Date(),
        };
        await upsertOne(MetaWhatsappTemplates, { template_id: String(template.id) }, { $set: templateFields }, templateFields);
      }
      phoneCount += phones.length;
      templateCount += templates.length;
    }
    if (businessId) {
      // Portfolio discovery is authoritative. Remove cached WABAs that Meta no
      // longer returns (for example, an account removed from the portfolio).
      // Do not do this in single-WABA fallback mode because that response says
      // nothing about the portfolio's other valid WABAs.
      const activeWabaIds = [...wabaMap.keys()];
      const staleWabaIds = await MetaWhatsappAccounts.distinct('waba_id', { business_id: businessId, waba_id: { $nin: activeWabaIds } });
      await MetaWhatsappTemplates.deleteMany({ waba_id: { $in: staleWabaIds } });
      await deleteCascade('meta_whatsapp_accounts', { business_id: businessId, waba_id: { $nin: activeWabaIds } });
    }
    for (const phone of await MetaWhatsappPhoneNumbers.find({ client_id: { $ne: null } }).lean()) {
      const verified = String(phone.connection_status ?? '').toUpperCase() === 'CONNECTED'
        || String(phone.verification_status ?? '').toUpperCase() === 'VERIFIED';
      const linkedClient = await Clients.findOne({ id: phone.client_id }, { whatsapp_verified_at: 1 }).lean();
      if (!linkedClient) continue;
      await Clients.updateOne({ id: phone.client_id }, { $set: {
        wa_business_id: phone.waba_id, phone_number_id: phone.phone_number_id, whatsapp_number: phone.display_phone_number,
        whatsapp_status: verified ? 'verified' : 'verification_pending',
        whatsapp_verified_at: verified ? (linkedClient.whatsapp_verified_at ?? new Date()) : null,
        updated_at: new Date(),
      } });
    }
    await MetaWhatsappSyncRuns.updateOne({ id: run.rows[0].id }, { $set: {
      status: 'success', wabas_count: wabaMap.size, phones_count: phoneCount, templates_count: templateCount, completed_at: new Date(),
    } });
    return { wabas: wabaMap.size, phone_numbers: phoneCount, templates: templateCount };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    await MetaWhatsappSyncRuns.updateOne({ id: run.rows[0].id }, { $set: { status: 'failed', error: message, completed_at: new Date() } });
    throw new Error(message);
  }
}

cron.schedule('*/15 * * * *', () => syncMetaWhatsAppInventory().catch(err =>
  console.error('[Meta Inventory Sync]', err.message)));
const { evaluateLeadBrandAndSchedule, evaluateStuckLeads } = require('./services/aiBrain');
const { getLeadOSBrand } = require('./services/leadosBrand');
const { checkNewDriveVideos, publishPost } = require("./controllers/contentController");

// ═══════════════════════════════════════════════════════════════════
// CAMPAIGN MESSAGE QUEUE SYSTEM
// Persistent queue with intelligent rate limiting to prevent
// WhatsApp/Meta rate limits ("healthy ecosystem" errors)
// ═══════════════════════════════════════════════════════════════════

// Queue settings - safe defaults to avoid rate limiting
const QUEUE_SETTINGS = {
  MESSAGES_PER_MINUTE: 15,      // Max 15 messages per minute (Meta recommends 250/24h for new numbers)
  MESSAGES_PER_HOUR: 500,        // Max 500 per hour
  MESSAGES_PER_DAY: 5000,        // Max 5000 per day (well under Meta's 250k limit)
  RETRY_DELAY_MS: 5000,         // Wait 5s before retry on rate limit
  MAX_RETRIES: 3,               // Max 3 retries for failed messages
  BATCH_SIZE: 10                 // Process 10 messages at a time
};

// Adaptive rate limiter state
let rateLimiter = {
  messagesThisMinute: 0,
  messagesThisHour: 0,
  messagesThisDay: 0,
  lastResetMinute: Date.now(),
  lastResetHour: Date.now(),
  lastResetDay: Date.now(),
  consecutiveRateLimits: 0,
  currentDelayMs: 1000          // Start with 1s delay between messages
};

// Reset counters periodically
function resetRateCounters() {
  const now = Date.now();
  if (now - rateLimiter.lastResetMinute > 60000) {
    rateLimiter.messagesThisMinute = 0;
    rateLimiter.lastResetMinute = now;
  }
  if (now - rateLimiter.lastResetHour > 3600000) {
    rateLimiter.messagesThisHour = 0;
    rateLimiter.lastResetHour = now;
  }
  if (now - rateLimiter.lastResetDay > 86400000) {
    rateLimiter.messagesThisDay = 0;
    rateLimiter.lastResetDay = now;
  }
}

// Check if we can send a message
function canSendMessage() {
  resetRateCounters();

  // Check all limits
  if (rateLimiter.messagesThisMinute >= QUEUE_SETTINGS.MESSAGES_PER_MINUTE) return false;
  if (rateLimiter.messagesThisHour >= QUEUE_SETTINGS.MESSAGES_PER_HOUR) return false;
  if (rateLimiter.messagesThisDay >= QUEUE_SETTINGS.MESSAGES_PER_DAY) return false;

  return true;
}

// Get recommended delay based on rate limit status
function getRecommendedDelay() {
  resetRateCounters();

  // If we're hitting rate limits, increase delay
  if (rateLimiter.consecutiveRateLimits > 0) {
    // Exponential backoff: 2s, 4s, 8s, 16s...
    return Math.min(rateLimiter.currentDelayMs * Math.pow(2, rateLimiter.consecutiveRateLimits), 30000);
  }

  // If we're close to limits, slow down
  const minutePercent = rateLimiter.messagesThisMinute / QUEUE_SETTINGS.MESSAGES_PER_MINUTE;
  if (minutePercent > 0.8) return 5000;
  if (minutePercent > 0.6) return 3000;

  // Default safe delay
  return rateLimiter.currentDelayMs;
}

// Record a successful send
function recordSendSuccess() {
  rateLimiter.messagesThisMinute++;
  rateLimiter.messagesThisHour++;
  rateLimiter.messagesThisDay++;
  rateLimiter.consecutiveRateLimits = 0;

  // Gradually reduce delay if things are working well
  if (rateLimiter.currentDelayMs > 1000 && rateLimiter.messagesThisMinute % 50 === 0) {
    rateLimiter.currentDelayMs = Math.max(1000, rateLimiter.currentDelayMs - 100);
  }
}

// Record a rate limit hit
function recordRateLimit() {
  rateLimiter.consecutiveRateLimits++;
  // Increase delay significantly on rate limit
  rateLimiter.currentDelayMs = Math.min(rateLimiter.currentDelayMs * 2, 30000);
}

// Prepare campaign queue collections (indexes only — MongoDB needs no table DDL)
async function initCampaignQueue() {
  await connectMongo();
  await Promise.all([CampaignMessageQueue.createIndexes(), CampaignRateStats.createIndexes()]);
  await CampaignMessageQueue.collection.createIndex({ status: 1 }).catch(() => {});
  await CampaignMessageQueue.collection.createIndex({ campaign_id: 1, lead_id: 1 }).catch(() => {});
  console.log('[Campaign Queue] Database collections initialized');
}

const utcToday = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

// INSERT INTO campaign_rate_stats ... ON CONFLICT (campaign_id, date) DO UPDATE SET <field> = <field> + 1
async function bumpCampaignRateStat(campaignId, field) {
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

// Add messages to queue
async function addToCampaignQueue(campaign_id, leads, campaign) {
  if (leads.length > 0) {
    const alreadyQueued = new Set(await CampaignMessageQueue.distinct('lead_id', { campaign_id, lead_id: { $in: leads.map((lead) => lead.id) } }));
    const fresh = [];
    for (const lead of leads) {
      if (alreadyQueued.has(Number(lead.id))) continue;
      alreadyQueued.add(Number(lead.id));
      fresh.push(lead);
    }
    if (!fresh.length) return;
    const ids = await CampaignMessageQueue.allocIds(fresh.length);
    await CampaignMessageQueue.insertMany(fresh.map((lead, index) => ({
      id: ids[index],
      campaign_id,
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
      wa_token: campaign.wa_access_token || '',
      phone_number_id: campaign.phone_number_id || '',
    })));
  }
}

// Process queue - runs continuously
async function processCampaignQueue() {
  try {
    // Recover jobs abandoned by a crashed/restarted worker. A normal send has
    // a 15-second HTTP timeout, so five minutes safely indicates a stale claim.
    await CampaignMessageQueue.updateMany(
      { status: 'processing', last_attempt_at: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
      { $set: { status: 'pending' } }
    );

    // Quarantine duplicate queue rows left by older executions before any
    // recipient is claimed. Keep the oldest row as the canonical send.
    const openRows = await CampaignMessageQueue.find({ status: { $in: ['pending', 'processing'] } }, { id: 1, campaign_id: 1, lead_id: 1 })
      .sort({ id: 1 }).lean();
    if (openRows.length) {
      const sentPairs = new Set((await CampaignMessageQueue.find(
        { status: 'sent', campaign_id: { $in: [...new Set(openRows.map((row) => row.campaign_id))] } },
        { campaign_id: 1, lead_id: 1 }
      ).lean()).map((row) => `${row.campaign_id}:${row.lead_id}`));
      const seenPairs = new Set();
      const duplicateIds = [];
      for (const row of openRows) {
        const pair = `${row.campaign_id}:${row.lead_id}`;
        if (seenPairs.has(pair) || sentPairs.has(pair)) duplicateIds.push(row.id);
        seenPairs.add(pair);
      }
      if (duplicateIds.length) {
        await CampaignMessageQueue.updateMany(
          { id: { $in: duplicateIds } },
          { $set: { status: 'failed', processed_at: new Date(), error_message: 'Duplicate queue entry skipped before send' } }
        );
      }
    }

    // Atomically claim rows before doing any network work. FOR UPDATE SKIP
    // LOCKED prevents overlapping queue intervals (or multiple API instances)
    // from sending the same recipient at the same time.
    // Atomically claim rows before doing any network work (replaces FOR UPDATE SKIP LOCKED)
    const claimable = await CampaignMessageQueue.find(
      { status: 'pending', $or: [{ attempts: null }, { attempts: { $lt: QUEUE_SETTINGS.MAX_RETRIES } }] },
      { id: 1 }
    ).sort({ created_at: 1 }).limit(QUEUE_SETTINGS.BATCH_SIZE).lean();
    const pending = [];
    for (const row of claimable) {
      const claimed = await CampaignMessageQueue.findOneAndUpdate(
        { id: row.id, status: 'pending' },
        { $set: { status: 'processing', last_attempt_at: new Date() }, $inc: { attempts: 1 } },
        { new: true, projection: NO_ID }
      ).lean();
      if (claimed) pending.push(claimed);
    }

    if (pending.length === 0) return;

    // Wait for rate limit if needed
    while (!canSendMessage()) {
      const delay = getRecommendedDelay();
      console.log(`[Campaign Queue] Rate limited, waiting ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
      resetRateCounters();
    }

    // Process each message
    for (const msg of pending) {
      try {
        // Check if we can send (rate limit check)
        if (!canSendMessage()) {
          await new Promise(r => setTimeout(r, getRecommendedDelay()));
        }

        const result = await sendWhatsAppMessage(msg);

        if (result.success) {
          // Mark as sent
          await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { status: 'sent', processed_at: new Date(), error_message: null } });

          // Update campaign log
          await CampaignLogs.create({ campaign_id: msg.campaign_id, lead_id: msg.lead_id, wa_message_id: result.messageId, status: 'sent', sent_at: new Date() });

          // Mirror the successful WhatsApp send into the LeadOS Inbox. Keep
          // this non-retryable: Meta has already accepted the message, so a CRM
          // persistence error must never cause the recipient to receive it
          // again.
          try {
            const parameterMappings = typeof msg.template_parameters === 'string'
              ? JSON.parse(msg.template_parameters)
              : (msg.template_parameters || {});
            const renderedBody = getTemplateVariableNumbers(msg.template_body).reduce(
              (body, number) => body.replace(
                new RegExp(`\\{\\{\\s*${number}\\s*\\}\\}`, 'g'),
                resolveCampaignParameter(parameterMappings.body?.[String(number)], msg)
              ),
              String(msg.template_body || '')
            );
            let conversationId = null;
            if (await Campaigns.exists({ id: msg.campaign_id })) {
              // One conversation per phone number (ON CONFLICT (phone) DO UPDATE)
              const conversation = await upsertOne(
                Conversations,
                { phone: msg.phone },
                { $set: { lead_id: msg.lead_id, status: 'open', last_message: renderedBody, last_message_at: new Date() } },
                { lead_id: msg.lead_id, status: 'open', last_message: renderedBody, last_message_at: new Date(), created_at: new Date() }
              );
              conversationId = conversation?.id;
            }
            if (conversationId) {
              const savedMessage = await Messages.create({
                conversation_id: conversationId, direction: 'outbound', content: renderedBody, msg_type: 'template',
                wa_msg_id: result.messageId, status: 'sent', is_ai: false, sent_at: new Date(),
              });
              const messageResult = { rows: [{
                id: savedMessage.id, conversation_id: savedMessage.conversation_id, direction: savedMessage.direction,
                content: savedMessage.content, type: savedMessage.msg_type, wa_msg_id: savedMessage.wa_msg_id,
                status: savedMessage.status, is_ai: savedMessage.is_ai, timestamp: savedMessage.sent_at,
              }] };

              io.emit('outgoing_message', {
                lead_id: Number(msg.lead_id),
                message: {
                  ...messageResult.rows[0],
                  campaign_id: msg.campaign_id,
                },
              });
            }
          } catch (crmErr) {
            console.error(
              `[Campaign Queue] WhatsApp message ${result.messageId} sent, but Inbox sync failed:`,
              crmErr.message
            );
          }

          // Update stats
          await bumpCampaignRateStat(msg.campaign_id, 'messages_sent');

          recordSendSuccess();
        } else if (result.rateLimited) {
          // Release the claim so a later queue pass can retry it.
          await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { status: 'pending', error_message: result.error ?? null } });
          recordRateLimit();

          // Update rate limit stat
          await bumpCampaignRateStat(msg.campaign_id, 'rate_limited_count');

          console.warn(`[Campaign Queue] Rate limited: ${result.error}`);
        } else {
          // Permanent failure
          await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { status: 'failed', processed_at: new Date(), error_message: result.error ?? null } });

          // Log failure
          await CampaignLogs.create({ campaign_id: msg.campaign_id, lead_id: msg.lead_id, status: 'failed', error_message: result.error ?? null, sent_at: new Date() });

          // Update stats
          await bumpCampaignRateStat(msg.campaign_id, 'messages_failed');
        }

        // Wait between messages
        const delay = getRecommendedDelay();
        await new Promise(r => setTimeout(r, delay));

      } catch (err) {
        console.error(`[Campaign Queue] Error processing message ${msg.id}:`, err.message);
        // The external result is unknown for unexpected errors. Do not
        // immediately release the row and risk a duplicate send; leave it
        // claimed for stale-job review/recovery.
        await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { error_message: `Worker error after claim: ${err.message}` } }).catch(() => {});
      }
    }

    // A queue batch can contain more than one campaign.
    for (const campaignId of [...new Set(pending.map((item) => item.campaign_id))]) {
      await checkCampaignCompletion(campaignId);
    }

  } catch (err) {
    console.error('[Campaign Queue] Queue processing error:', err.message);
  }
}

function getTemplateVariableNumbers(value) {
  const numbers = [...String(value || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)]
    .map((match) => Number(match[1]));
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function validateCampaignTemplate(template) {
  const bodyVariables = getTemplateVariableNumbers(template.body);
  const headerVariables = getTemplateVariableNumbers(template.header);
  const expectedBodyVariables = bodyVariables.length
    ? Array.from({ length: bodyVariables.at(-1) }, (_, index) => index + 1)
    : [];

  if (bodyVariables.some((value, index) => value !== expectedBodyVariables[index])) {
    return 'Template body variables must be consecutive and start at {{1}}.';
  }
  if (headerVariables.some((value, index) => value !== index + 1)) {
    return 'Template header variables must be consecutive and start at {{1}}.';
  }
  return null;
}

function resolveCampaignParameter(mapping, msg) {
  const source = mapping?.source;
  if (source === 'recipient_name') return String(msg.name || 'Friend');
  if (source === 'recipient_phone') return String(msg.phone || '');
  if (source === 'campaign_name') return String(msg.campaign_name || '');
  if (source === 'brand_name') return String(msg.brand_name || '');
  if (source === 'custom') return String(mapping?.value || '');
  if (['recipient_email', 'lead_status', 'lead_source', 'lead_interest', 'lead_score'].includes(source)) {
    const data = typeof msg.recipient_data === 'string' ? JSON.parse(msg.recipient_data) : (msg.recipient_data || {});
    return String(data[source] ?? '');
  }
  if (source === 'excel_parameter') {
    const values = typeof msg.recipient_parameters === 'string'
      ? JSON.parse(msg.recipient_parameters)
      : (msg.recipient_parameters || {});
    return String(values?.[mapping.section || 'body']?.[String(mapping.number)] || '');
  }
  return '';
}

function validateCampaignParameterMappings(template, mappings) {
  for (const [section, content] of [['body', template.body], ['header', template.header]]) {
    for (const number of getTemplateVariableNumbers(content)) {
      const mapping = mappings?.[section]?.[String(number)];
      if (!mapping || !['recipient_name', 'recipient_phone', 'recipient_email', 'lead_status', 'lead_source', 'lead_interest', 'lead_score', 'campaign_name', 'brand_name', 'custom', 'excel_parameter'].includes(mapping.source)) {
        return `Choose a value for ${section} parameter {{${number}}}.`;
      }
      if (mapping.source === 'custom' && !String(mapping.value || '').trim()) {
        return `Enter a custom value for ${section} parameter {{${number}}}.`;
      }
    }
  }
  return null;
}

// Send single WhatsApp message
async function sendWhatsAppMessage(msg) {
  try {
    const digits = (msg.phone || '').replace(/\D/g, '');
    if (digits.length < 10) {
      return { success: false, error: 'Invalid phone number' };
    }

    const waToken = msg.wa_token || process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = msg.phone_number_id || process.env.WA_PHONE_NUMBER_ID;

    if (!waToken || !phoneId) {
      return { success: false, error: 'Missing WhatsApp credentials' };
    }

    // Build template payload
    const templatePayload = {
      name: msg.template_name,
      language: { code: msg.template_language || 'en' }
    };

    const bodyVariables = getTemplateVariableNumbers(msg.template_body);
    const headerVariables = getTemplateVariableNumbers(msg.template_header);
    const mappings = typeof msg.template_parameters === 'string'
      ? JSON.parse(msg.template_parameters)
      : (msg.template_parameters || {});
    const components = [];
    if (headerVariables.length) {
      components.push({
        type: 'header',
        parameters: headerVariables.map((number) => ({
          type: 'text', text: resolveCampaignParameter(mappings.header?.[String(number)], msg)
        }))
      });
    }
    if (bodyVariables.length) {
      components.push({
        type: 'body',
        parameters: bodyVariables.map((number) => ({
          type: 'text', text: resolveCampaignParameter(mappings.body?.[String(number)], msg)
        }))
      });
    }
    if (components.length > 0) {
      templatePayload.components = components;
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: digits,
      type: 'template',
      template: templatePayload
    };

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${waToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 15000
      }
    );

    return {
      success: true,
      messageId: response.data.messages?.[0]?.id
    };

  } catch (err) {
    const status = err.response?.status;
    const errorMsg = err.response?.data?.error?.message || err.message;

    // Check for rate limit (429)
    if (status === 429) {
      return { success: false, rateLimited: true, error: errorMsg };
    }

    // Check for other retryable errors
    if (status >= 500 && status < 600) {
      return { success: false, rateLimited: true, error: errorMsg };
    }

    return { success: false, error: errorMsg };
  }
}

// Check if campaign is complete
async function checkCampaignCompletion(campaign_id) {
  if (!campaign_id) return;

  const [pendingCount, sentCount, failedCount] = await Promise.all([
    CampaignMessageQueue.countDocuments({ campaign_id, status: { $in: ['pending', 'processing'] } }),
    CampaignMessageQueue.countDocuments({ campaign_id, status: 'sent' }),
    CampaignMessageQueue.countDocuments({ campaign_id, status: 'failed' }),
  ]);

  if (pendingCount === 0) {
    const finalStatus = sentCount > 0 ? 'completed' : 'failed';
    await Campaigns.updateOne({ id: campaign_id }, { $set: { status: finalStatus } });
    console.log(`[Campaign ${campaign_id}] Completed: ${sentCount} sent, ${failedCount} failed`);
  }
}

// Start queue processor
let queueProcessorInterval;
let queueProcessorRetryTimeout;

function startCampaignQueueProcessor() {
  if (queueProcessorInterval || queueProcessorRetryTimeout) return;

  initCampaignQueue()
    .then(() => {
      // Run every 2 seconds
      queueProcessorInterval = setInterval(processCampaignQueue, 2000);
      console.log('[Campaign Queue] Processor started - running every 2s');
    })
    .catch((err) => {
      // Queue processing is a background feature. A temporarily unavailable DB
      // must not terminate the HTTP server and turn every request into an nginx 502.
      console.error('[Campaign Queue] Initialization failed; retrying in 30 seconds:', err.message);
      queueProcessorRetryTimeout = setTimeout(() => {
        queueProcessorRetryTimeout = null;
        startCampaignQueueProcessor();
      }, 30000);
    });
}

// Stop queue processor
function stopCampaignQueueProcessor() {
  if (queueProcessorInterval) {
    clearInterval(queueProcessorInterval);
    queueProcessorInterval = null;
    console.log('[Campaign Queue] Processor stopped');
  }
  if (queueProcessorRetryTimeout) {
    clearTimeout(queueProcessorRetryTimeout);
    queueProcessorRetryTimeout = null;
  }
}

// ── MIDDLEWARE ────────────────────────────────────────────
app.use(morgan('dev')); // ← must be first so every request is logged
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: false
}));
app.use(cors({
  origin: function (origin, callback) {
    callback(null, origin || true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-internal-key', 'x-data-mode']
}));
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// ── ALLIANCE OS ROUTES ────────────────────────────────────
const knowledgeRoutes = require('./routes/knowledge');
const uploadRoutes = require('./routes/upload');
const allianceRoutes = require('./routes/alliance');
const createAllianceInboxRouter = require('./routes/alliance-inbox-v2');
const createAllianceAutomationRouter = require('./routes/alliance-automation');
const { startAllianceEmailWorker } = require('./services/alliance-email-worker');
const { startAllianceEmailReplyPoller } = require('./services/alliance-email-replies');
const { startAllianceWhatsAppCampaignWorker } = require('./services/alliance-whatsapp-campaign-worker');
const { startAllianceAiNudgeWorker } = require('./services/alliance-ai-nudge-worker');
const pipelineRoutes = require('./routes/pipeline');
const analyzeRoutes = require('./routes/analyze');
const contentOsRoutes = require('./routes/contentos');
const chatbotRoutes = require('./routes/chatbot');

const contentRoutes = require('./routes/contentRoutes');
const integrationsRoutes = require('./routes/integrationsRoutes');

const salesosRoutes = require('./routes/salesos');

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api', salesosRoutes);
app.use('/api/knowledge', knowledgeRoutes); // We should use auth but let's check auth middleware later
app.use('/api/upload', uploadRoutes);
app.use('/api/pipeline', pipelineRoutes);
app.use('/api/analyze', analyzeRoutes);
app.use('/api/chatbot', chatbotRoutes);
// ── AUTH MIDDLEWARE ───────────────────────────────────────
const auth = (req, res, next) => {
  // Bypass JWT auth for OAuth redirect routes where the browser doesn't send a token
  if (
    req.path.includes('/auth/google') ||
    req.path.includes('/auth/callback') ||
    req.path.includes('/youtube/auth') ||
    req.path.includes('/youtube/callback') ||
    req.path.includes('/linkedin/auth') ||
    req.path.includes('/linkedin/callback')
  ) {
    return next();
  }

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
};

const internalAuth = (req, res, next) => {
  if (req.headers['x-internal-key'] === process.env.INTERNAL_API_KEY) return next();
  return auth(req, res, next);
};

app.use('/api/alliance', auth, allianceRoutes);
app.use('/api/alliance-inbox', createAllianceInboxRouter({ auth, io }));
app.use('/api/internal/alliance', internalAuth, createAllianceAutomationRouter({ io }));

// conversations.tenant_id is a foreign key into a legacy `tenants` table from
// an earlier multi-tenant schema that was never actually populated per brand —
// only tenants.id=1 exists. Every conversation-creating path in this app
// relies on that same single seed row, whether intentionally (the inbound
// webhook's `lead.tenant_id || 1`) or previously by accident (a query that
// never selected tenant_id, so it fell through to `undefined`/`|| 1`).
// Passing a brand's clients.id here instead violates that FK for any brand
// whose id isn't coincidentally 1 — use this constant everywhere a
// conversation row is created so the whole app stays on the same tenant.
const DEFAULT_TENANT_ID = 1;

// ── CONTENT OS ROUTES ─────────────────────────────────────
app.use('/api/content', internalAuth, contentRoutes);
app.use('/api/integrations', internalAuth, integrationsRoutes);
app.use('/api/content-os', internalAuth, contentOsRoutes);



// ── MAFIYA OS ROUTES ──────────────────────────────────────
const mafiyaClientsRoutes = require('./routes/mafiya-clients');
const { router: mafiyaGmbRoutes, handleGoogleCallback } = require('./routes/mafiya-gmb');
const mafiyaTurfRoutes = require('./routes/mafiya-turf');
const mafiyaReviewsRoutes = require('./routes/mafiya-reviews');
const mafiyaInsightsRoutes = require('./routes/mafiya-insights');
const mafiyaRivalsRoutes = require('./routes/mafiya-rivals');
const mafiyaUsageRoutes = require('./routes/mafiya-usage');
const citationRoutes = require('./routes/citation.routes');

const mafiyaPlansRoutes = require('./routes/mafiya-plans');
const mafiyaOrdersRoutes = require('./routes/mafiya-orders');

app.use('/api/mafiya/plans', auth, mafiyaPlansRoutes);
app.use('/api/mafiya/clients', auth, mafiyaClientsRoutes);
app.use('/api/mafiya/gmb', mafiyaGmbRoutes); // No auth — email links are clicked by external clients
app.use('/api/mafiya/turf', auth, mafiyaTurfRoutes);
app.use('/api/mafiya/rivals', auth, mafiyaRivalsRoutes);
app.use('/api/mafiya/usage', auth, mafiyaUsageRoutes);
app.use('/api/mafiya/orders', auth, mafiyaOrdersRoutes);
app.use('/api/citations', auth, citationRoutes);

// Public route for Google to download GMB Post images (bypassing the 'auth' middleware on the main reviews router)
app.get('/api/mafiya/reviews/image/:filename', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filepath = path.join(__dirname, 'uploads', 'gmb_posts', req.params.filename);
  if (fs.existsSync(filepath)) res.sendFile(filepath);
  else res.status(404).send('Image not found');
});

app.use('/api/mafiya/reviews', auth, mafiyaReviewsRoutes);
app.use('/api/mafiya/insights', auth, mafiyaInsightsRoutes);
app.get('/api/auth/google/callback', handleGoogleCallback); // Map the standard OAuth callback to Mafiya GMB handler
// Public route for WhatsApp Media Proxy
app.get('/api/whatsapp-media/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { leadId } = req.query;

    // Resolve the token for the LeadOS client that owns this media, same
    // fallback pattern used everywhere else (client's own token first,
    // the shared env token only as a default for clients without one).
    let waToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (leadId) {
      const tokenLead = await Leads.findOne({ id: leadId }, { client_id: 1 }).lean();
      const tokenClient = tokenLead?.client_id != null ? await Clients.findOne({ id: tokenLead.client_id }, { wa_access_token: 1 }).lean() : null;
      waToken = tokenClient?.wa_access_token || waToken;
    }

    // 1. Get the actual download URL from Meta
    const metaRes = await axios.get(`https://graph.facebook.com/v18.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${waToken}` }
    });
    
    if (metaRes.data && metaRes.data.url) {
      // 2. Fetch the binary data as a buffer
      const streamRes = await axios.get(metaRes.data.url, {
        headers: { Authorization: `Bearer ${waToken}` },
        responseType: 'arraybuffer'
      });
      
      // 3. Forward the content type and send the data
      res.setHeader('Content-Type', metaRes.data.mime_type || streamRes.headers['content-type'] || 'application/octet-stream');
      // Set caching headers so it doesn't repeatedly download from Meta
      res.setHeader('Cache-Control', 'public, max-age=31536000');
      
      res.send(Buffer.from(streamRes.data));
    } else {
      res.status(404).send('Media URL not found');
    }
  } catch (err) {
    console.error('[Media Proxy Error]', err.message);
    res.status(500).send('Failed to proxy media');
  }
});


// ══════════════════════════════════════════════════════════
// HEALTH
// ══════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ABM LeadOS API', ts: new Date().toISOString() });
});

// ══════════════════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await Users.findOne({ email: email.toLowerCase(), is_active: true }, NO_ID).lean();
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await Users.updateOne({ id: user.id }, { $set: { last_login: new Date() } });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/auth/change-password
app.post('/api/auth/change-password', auth, async (req, res) => {
  try {
    const { current, newPassword } = req.body;
    const currentUser = await Users.findOne({ id: req.user.id }, { password_hash: 1 }).lean();
    const valid = await bcrypt.compare(current, currentUser.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await Users.updateOne({ id: req.user.id }, { $set: { password_hash: hash } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// INBOX ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/inbox
app.get('/api/inbox', auth, async (req, res) => {
  try {
    // Fetch latest message per lead
    // Latest conversation per lead — matched by lead_id, or by phone (last 10 digits) for unlinked conversations
    const phoneTail = (value) => (value == null ? null : String(value).replace(/[^0-9]/g, '').slice(-10));
    const conversations = await Conversations.find({}, { lead_id: 1, phone: 1, last_message: 1, last_message_at: 1, unread_count: 1 }).lean();
    const byLead = new Map();
    const byTail = new Map();
    for (const cv of conversations) {
      if (cv.lead_id != null) {
        if (!byLead.has(cv.lead_id)) byLead.set(cv.lead_id, []);
        byLead.get(cv.lead_id).push(cv);
      } else if (phoneTail(cv.phone) != null) {
        if (!byTail.has(phoneTail(cv.phone))) byTail.set(phoneTail(cv.phone), []);
        byTail.get(phoneTail(cv.phone)).push(cv);
      }
    }
    const leads = await Leads.find({}, { id: 1, name: 1, client_id: 1, status: 1, phone: 1 }).lean();
    const clientNames = new Map((await Clients.find({}, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const rows = [];
    for (const l of leads) {
      const matched = [...(byLead.get(l.id) || []), ...(phoneTail(l.phone) != null ? byTail.get(phoneTail(l.phone)) || [] : [])];
      if (!matched.length) continue;
      const latest = [...matched].sort((a, b) => (b.last_message_at ? new Date(b.last_message_at).getTime() : -Infinity)
        - (a.last_message_at ? new Date(a.last_message_at).getTime() : -Infinity))[0];
      rows.push({
        id: l.id,
        name: l.name,
        brand: clientNames.get(l.client_id) ?? null,
        status: l.status,
        last: latest.last_message ?? null,
        time: latest.last_message_at ?? null,
        unread: matched.reduce((sum, cv) => sum + (Number(cv.unread_count) || 0), 0),
      });
    }
    rows.sort((a, b) => (b.time ? new Date(b.time).getTime() : -Infinity) - (a.time ? new Date(a.time).getTime() : -Infinity));
    res.json(rows);
  } catch (err) {
    console.error('Inbox fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/conversations/:lead_id/read
app.put('/api/conversations/:lead_id/read', auth, async (req, res) => {
  try {
    const readLead = await Leads.findOne({ id: req.params.lead_id }, { phone: 1 }).lean();
    const readFilter = [{ lead_id: req.params.lead_id }];
    if (readLead && readLead.phone != null) readFilter.push({ phone: phoneTailRegex(readLead.phone) });
    await Conversations.updateMany({ $or: readFilter }, { $set: { unread_count: 0 } });
    res.json({ success: true });
  } catch (err) {
    console.error('Mark read error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// MESSAGES ROUTES (CRM-SIDE)
// ══════════════════════════════════════════════════════════

// PUT /api/messages/:id/edit
app.put('/api/messages/:id/edit', auth, async (req, res) => {
  try {
    const { content } = req.body;
    const msgId = req.params.id;
    // Do not attempt to update optimistic UI messages on the backend
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot edit an unsaved message' });
    }
    const edited = await Messages.findOneAndUpdate({ id: msgId }, { $set: { content } }, { new: true, projection: NO_ID }).lean();
    if (edited) {
      io.emit('message_edited', edited);
    }
    res.json({ success: true, message: edited || undefined });
  } catch (err) {
    console.error('Edit message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/delete
app.put('/api/messages/:id/delete', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot delete an unsaved message' });
    }
    const deletedMessage = await Messages.findOneAndUpdate({ id: msgId }, { $set: { is_deleted: true } }, { new: true, projection: NO_ID }).lean();
    if (deletedMessage) {
      io.emit('message_deleted', deletedMessage);
    }
    res.json({ success: true, message: deletedMessage || undefined });
  } catch (err) {
    console.error('Delete message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/pin
app.put('/api/messages/:id/pin', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { duration, unpin } = req.body; // duration in hours: 24, 168 (7 days), 720 (30 days)

    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot pin an unsaved message' });
    }

    const pinnedUntil = unpin ? null : new Date(Date.now() + (Number(duration) || 24) * 60 * 60 * 1000);
    const pinned = await Messages.findOneAndUpdate({ id: msgId }, { $set: { pinned_until: pinnedUntil } }, { new: true, projection: NO_ID }).lean();
    if (pinned) {
      io.emit('message_edited', pinned); // reuse message_edited or create message_pinned event
    }
    res.json({ success: true, message: pinned || undefined });
  } catch (err) {
    console.error('Pin message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/star
app.put('/api/messages/:id/star', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { is_starred } = req.body;

    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot star an unsaved message' });
    }

    const starred = await Messages.findOneAndUpdate({ id: msgId }, { $set: { is_starred: Boolean(is_starred) } }, { new: true, projection: NO_ID }).lean();
    const rows = starred ? [starred] : [];

    if (rows.length) {
      io.emit('message_edited', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('Star message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/messages/:id/react
// Body: { emoji: "👍", action: "add" | "remove" }
app.put('/api/messages/:id/react', auth, async (req, res) => {
  try {
    const msgId = req.params.id;
    const { emoji, action } = req.body;

    if (!emoji) return res.status(400).json({ error: 'emoji is required' });
    if (String(msgId).startsWith('optimistic-')) {
      return res.status(400).json({ error: 'Cannot react to an unsaved message' });
    }

    // Get current message details, lead, and client credentials
    const reactMessage = await Messages.findOne({ id: msgId }, { reactions: 1, wa_msg_id: 1, conversation_id: 1 }).lean();
    const reactConversation = reactMessage ? await Conversations.findOne({ id: reactMessage.conversation_id }, { lead_id: 1 }).lean() : null;
    const reactLead = reactConversation?.lead_id != null ? await Leads.findOne({ id: reactConversation.lead_id }, { phone: 1, client_id: 1 }).lean() : null;
    if (!reactMessage || !reactLead) return res.status(404).json({ error: 'Message not found' });
    const reactClient = reactLead.client_id != null ? await Clients.findOne({ id: reactLead.client_id }, { phone_number_id: 1, wa_access_token: 1 }).lean() : null;
    const msgData = {
      reactions: reactMessage.reactions, wa_msg_id: reactMessage.wa_msg_id, phone: reactLead.phone,
      phone_number_id: reactClient?.phone_number_id ?? null, wa_access_token: reactClient?.wa_access_token ?? null,
    };

    const reactions = msgData.reactions || {};
    if (action === 'remove') {
      if (reactions[emoji] && reactions[emoji] > 1) {
        reactions[emoji] = reactions[emoji] - 1;
      } else {
        delete reactions[emoji];
      }
    } else {
      reactions[emoji] = (reactions[emoji] || 0) + 1;
    }

    const reacted = await Messages.findOneAndUpdate({ id: msgId }, { $set: { reactions } }, { new: true, projection: NO_ID }).lean();
    const rows = reacted ? [reacted] : [];

    // Send the reaction to Meta API if we have a WhatsApp message ID (wa_msg_id)
    if (msgData.wa_msg_id) {
      const phoneNumberId = msgData.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
      const waAccessToken = msgData.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

      if (phoneNumberId && waAccessToken) {
        try {
          const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: (msgData.phone || '').replace(/\D/g, ''),
            type: 'reaction',
            reaction: {
              message_id: msgData.wa_msg_id,
              emoji: action === 'remove' ? '' : emoji
            }
          };

          await axios.post(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            payload,
            { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
          );
          console.log(`✅ Reaction sent to WhatsApp for message ID: ${msgData.wa_msg_id}`);
        } catch (waErr) {
          console.error('❌ Meta Reaction Send Error:', waErr.response?.data || waErr.message);
        }
      }
    }

    if (rows.length) {
      io.emit('message_edited', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
  } catch (err) {
    console.error('React message error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/messages/upload
const mediaStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads', 'media');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname) || '';
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});
const mediaUpload = multer({ storage: mediaStorage });

app.post('/api/messages/upload', auth, mediaUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let uploadedFile = req.file;

  // MediaRecorder in Chrome produces audio/webm (or sometimes video/webm), which WhatsApp Cloud API does
  // not accept. Convert browser-recorded voice notes to mono OGG/Opus before
  // exposing the URL that Meta downloads.
  const isWebm = req.file.mimetype?.toLowerCase().includes('webm') || req.file.originalname.toLowerCase().endsWith('.webm');
  if (isWebm) {
    const outputFilename = `${path.parse(req.file.filename).name}.ogg`;
    const outputPath = path.join(req.file.destination, outputFilename);

    try {
      await convertToWhatsAppVoiceNote(req.file.path, outputPath);

      await fs.promises.unlink(req.file.path).catch(() => {});
      uploadedFile = { ...req.file, filename: outputFilename, path: outputPath, mimetype: 'audio/ogg; codecs=opus' };
    } catch (err) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      await fs.promises.unlink(outputPath).catch(() => {});
      console.error('[Media Upload] Voice-note conversion failed:', err.message);
      return res.status(500).json({ error: 'Unable to prepare this voice note for WhatsApp. Please try recording it again.' });
    }
  }

  const fileUrl = `/uploads/media/${uploadedFile.filename}`;
  res.json({ success: true, fileUrl, mimeType: uploadedFile.mimetype });
});

// ══════════════════════════════════════════════════════════
// LEADS ROUTES
// ══════════════════════════════════════════════════════════

// GET /api/leads/sources — distinct source values
// Public campaign import template. Keep this static route before
// `/api/leads/:id`, otherwise Express treats "template" as a lead ID.
app.get('/api/leads/template', (req, res) => {
  const ws = xlsx.utils.json_to_sheet([
    { Name: 'John Doe', Phone: '919876543210' },
    { Name: 'Jane Smith', Phone: '919876543211' }
  ]);
  ws['!cols'] = [{ wch: 20 }, { wch: 20 }];

  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, 'Template');
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Disposition', 'attachment; filename="leados_campaign_template.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buffer);
});

// Template-specific recipient sheet. Variable columns are positional because
// Meta matches values to {{1}}, {{2}}, etc., not to CRM field names.
app.get('/api/templates/:id/campaign-sheet', async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const template = await Templates.findOne({ id: req.params.id }, { _id: 0, name: 1, body: 1, header: 1, parameter_definitions: 1 }).lean();
    if (!template) return res.status(404).json({ error: 'Template not found' });
    let requestedMappings = null;
    try {
      requestedMappings = req.query.mappings ? JSON.parse(req.query.mappings) : null;
    } catch { requestedMappings = null; }
    const isExcelSourced = (section, number) => {
      if (!requestedMappings) return true;
      return requestedMappings?.[section]?.[String(number)]?.source === 'excel_parameter';
    };
    const headers = ['Name', 'Phone'];
    for (const number of getTemplateVariableNumbers(template.header)) {
      if (!isExcelSourced('header', number)) continue;
      const label = template.parameter_definitions?.header?.[String(number)]?.label;
      headers.push(`Header {{${number}}}${label ? ` - ${label}` : ''}`);
    }
    for (const number of getTemplateVariableNumbers(template.body)) {
      if (!isExcelSourced('body', number)) continue;
      const label = template.parameter_definitions?.body?.[String(number)]?.label;
      headers.push(`Body {{${number}}}${label ? ` - ${label}` : ''}`);
    }
    const example = Object.fromEntries(headers.map((header) => [header, '']));
    example.Name = 'John Doe';
    example.Phone = '919876543210';
    const sheet = xlsx.utils.json_to_sheet([example], { header: headers });
    sheet['!cols'] = headers.map((header) => ({ wch: Math.max(18, header.length + 3) }));
    const instructions = xlsx.utils.aoa_to_sheet([
      ['Template', template.name],
      ['Instructions'],
      ['Keep the column names unchanged. Enter phone numbers with country code.'],
      ['Fill every Header {{n}} and Body {{n}} cell for every recipient.'],
      ['The values are sent to Meta in numeric order.']
    ]);
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, sheet, 'Recipients');
    xlsx.utils.book_append_sheet(workbook, instructions, 'Instructions');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    const safeName = String(template.name || 'template').replace(/[^a-z0-9_-]+/gi, '_');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_campaign_recipients.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (error) {
    res.status(500).json({ error: 'Unable to generate template recipient sheet.' });
  }
});

// DEBUG: Check campaign import recipients
app.get('/api/debug/campaign-imports', auth, async (req, res) => {
  try {
    const { batch_id } = req.query;

    const importRows = await CampaignImportRecipients.find(batch_id ? { batch_id } : {}, { _id: 0, batch_id: 1, lead_id: 1, created_at: 1 })
      .sort({ created_at: -1 }).lean();
    const importLeads = new Map((await Leads.find({ id: { $in: importRows.map((r) => r.lead_id) } }, { id: 1, name: 1, phone: 1, client_id: 1, status: 1 }).lean())
      .map((l) => [l.id, l]));
    const result = { rows: importRows.filter((r) => importLeads.has(r.lead_id)).slice(0, 50).map((r) => {
      const l = importLeads.get(r.lead_id);
      return { batch_id: r.batch_id, lead_id: r.lead_id, created_at: r.created_at, name: l.name, phone: l.phone, client_id: l.client_id, status: l.status };
    }) };

    res.json({
      count: result.rows.length,
      recipients: result.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leads/sources', auth, async (req, res) => {
  try {
    const rows = (await Leads.distinct('source', { source: { $nin: [null, ''] } })).sort().map((source) => ({ source }));
        
    let rawSources = rows.map(r => r.source)
                         .filter(s => !s.startsWith('Csv_') && !s.startsWith('={{') && s.toLowerCase() !== 'test');
    
    const uniqueSources = [];
    const seen = new Set();
    for (const s of rawSources) {
      const lower = s.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        
        // Custom formatting for common sources
        if (lower === 'whatsapp') {
          uniqueSources.push('WhatsApp');
        } else if (lower === 'meta_ads') {
          uniqueSources.push('Meta Ads');
        } else if (lower === 'instagram dm') {
          uniqueSources.push('Instagram DM');
        } else {
          uniqueSources.push(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
        }
      }
    }
    
    res.json({ sources: uniqueSources.sort() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ═══════════════════════════════════════════════════════════════════
// FOLLOWUP ENGINE APIs (WF02)
// ═══════════════════════════════════════════════════════════════════

// GET /api/followups/due - Get leads due for follow-up
app.get('/api/followups/due', auth, async (req, res) => {
  try {
    const dueLeads = await Leads.find(
      { next_follow_up: { $ne: null, $lte: new Date() }, status: { $nin: ['lost', 'converted', null] } },
      { id: 1, name: 1, phone: 1, email: 1, status: 1, client_id: 1, touch_count: 1, next_follow_up: 1, last_contact: 1 }
    ).sort({ next_follow_up: 1 }).limit(100).lean();
    const dueClients = new Map((await Clients.find({ id: { $in: dueLeads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const rows = dueLeads.map((l) => ({
      lead_id: l.id, name: l.name, phone: l.phone, email: l.email, lead_status: l.status, client_id: l.client_id,
      touch_count: l.touch_count, next_follow_up: l.next_follow_up, last_contact: l.last_contact ?? null,
      brand: dueClients.get(l.client_id) ?? null,
    }));
    res.json({ followups: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/followups/rule - Get follow-up rule for a lead
app.post('/api/followups/rule', auth, async (req, res) => {
  try {
    const { lead_id, brand, stage, touch_count } = req.body;

    // Get follow-up rules for this brand and stage
    const ruleLead = await Leads.findOne({ id: lead_id }, { client_id: 1 }).lean();
    const rows = ruleLead?.client_id != null ? await models.FollowupRules.find(
      { client_id: ruleLead.client_id, stage: stage || 'new', touch_count: { $lte: Number(touch_count) || 0 } },
      NO_ID
    ).sort({ touch_count: -1 }).limit(1).lean() : [];

    if (rows.length === 0) {
      // Return default rule
      return res.json({
        action_type: 'whatsapp_text',
        delay_hours: 24,
        ai_prompt_template: 'Follow up with this lead about our services. Keep it brief and professional.'
      });
    }

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/whatsapp/check-24h - Check if 24h passed since last message
app.post('/api/whatsapp/check-24h', auth, async (req, res) => {
  try {
    const { lead_id } = req.body;

    // Get last message time for this lead
    const lastOutbound = await Messages.findOne(
      { conversation_id: { $in: await Conversations.distinct('id', { lead_id }) }, direction: 'outbound', sent_at: { $ne: null } },
      { sent_at: 1 }
    ).sort({ sent_at: -1 }).lean();

    const lastMessageAt = lastOutbound?.sent_at;
    const canSend = !lastMessageAt || (Date.now() - new Date(lastMessageAt).getTime()) > 24 * 60 * 60 * 1000;

    res.json({ can_send: canSend, last_message_at: lastMessageAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communication/send-template - Send WhatsApp template
app.post('/api/communication/send-template', auth, async (req, res) => {
  try {
    const { lead_id, template_name, template_params } = req.body;

    // Get lead details
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!leadRow) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    const leadClient = leadRow.client_id != null ? await Clients.findOne({ id: leadRow.client_id }, { wa_access_token: 1, phone_number_id: 1, whatsapp_status: 1 }).lean() : null;
    const lead = {
      ...leadRow,
      wa_access_token: leadClient?.wa_access_token ?? null,
      phone_number_id: leadClient?.phone_number_id ?? null,
      whatsapp_status: leadClient?.whatsapp_status ?? null,
    };
    if (lead.client_id && lead.whatsapp_status !== 'verified') {
      return res.status(403).json({ error: 'WhatsApp is disabled for this brand until verification succeeds' });
    }
    const waToken = lead.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = lead.phone_number_id || process.env.WA_PHONE_NUMBER_ID;

    if (!waToken || !phoneId) {
      return res.status(400).json({ error: 'WhatsApp credentials not configured' });
    }

    // Build template payload
    const digits = (lead.phone || '').replace(/\D/g, '');
    const templatePayload = { name: template_name, language: { code: 'en' } };

    const components = [];
    if (template_params && typeof template_params === 'object') {
      Object.values(template_params).forEach(val => {
        components.push({ type: 'body', parameters: [{ type: 'text', text: val }] });
      });
    }
    if (components.length > 0) templatePayload.components = components;

    const payload = {
      messaging_product: 'whatsapp',
      to: digits,
      type: 'template',
      template: templatePayload
    };

    const response = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    res.json({ success: true, message_id: response.data.messages?.[0]?.id });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error?.message || err.message });
  }
});

// POST /api/ai/followup - Generate and send AI follow-up text
app.post('/api/ai/followup', auth, async (req, res) => {
  try {
    const { lead_id, prompt } = req.body;

    // Get lead details
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    const leadRes = { rows: leadRow ? [leadRow] : [] };
    if (!leadRes.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadRes.rows[0];

    // Generate AI response
    const fullPrompt = `${prompt}\n\nLead Name: ${lead.name}\nLead Status: ${lead.status}\nBrand: ${lead.client_id}`;

    let aiMessage = '';
    if (openRouter.isConfigured) {
      const result = await openRouter.models.generateContent({
        model: openRouter.DEFAULT_MODEL,
        contents: fullPrompt,
      });
      aiMessage = result.text;
    } else {
      aiMessage = `Hi ${lead.name || 'there'}, just checking in on our conversation. Would love to hear from you!`;
    }

    // Send WhatsApp text
    const waToken = process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = process.env.WA_PHONE_NUMBER_ID;

    if (waToken && phoneId && lead.phone) {
      const digits = lead.phone.replace(/\D/g, '');
      await axios.post(
        `https://graph.facebook.com/v18.0/${phoneId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: digits,
          type: 'text',
          text: { body: aiMessage }
        },
        { headers: { Authorization: `Bearer ${waToken}`, 'Content-Type': 'application/json' }, timeout: 15000 }
      );
    }

    res.json({ success: true, message: aiMessage });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/communication/send-email - Send follow-up email
app.post('/api/communication/send-email', auth, async (req, res) => {
  try {
    const { lead_id, template_id } = req.body;

    // Get lead details
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    const leadRes = { rows: leadRow ? [leadRow] : [] };
    if (!leadRes.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    // For now, just log - email sending would need SMTP configuration
    console.log(`[Followup] Would send email to lead ${lead_id} using template ${template_id}`);

    res.json({ success: true, message: 'Email queued' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/internal-note - Create internal note
app.post('/api/leads/internal-note', auth, async (req, res) => {
  try {
    const { lead_id, note } = req.body;

    await LeadNotes.create({ lead_id, user_id: req.user.id, note, created_at: new Date() });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/leads/update-followup - Update lead follow-up info
app.post('/api/leads/update-followup', auth, async (req, res) => {
  try {
    const { lead_id, touch_count_increment, delay_hours } = req.body;

    // Increment touch count
    if (touch_count_increment) {
      await Leads.updateOne({ id: lead_id }, [{ $set: { touch_count: { $add: [{ $ifNull: ['$touch_count', 0] }, 1] }, updated_at: '$$NOW' } }]);
    }

    // Set next follow-up
    if (delay_hours) {
      await Leads.updateOne({ id: lead_id }, { $set: {
        next_follow_up: new Date(Date.now() + Number(delay_hours) * 60 * 60 * 1000), last_contact: new Date(), updated_at: new Date(),
      } });
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/workflows/log - Log workflow execution
app.post('/api/workflows/log', auth, async (req, res) => {
  try {
    const { workflow, lead_id, status, error } = req.body;

    console.log(`[Workflow ${workflow}] Lead ${lead_id}: ${status}${error ? ` - ${error}` : ''}`);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const LEAD_EXPORT_DIR = path.join(__dirname, 'uploads', 'lead-exports');
const activeLeadExports = new Set();
const leadExportReady = LeadExportJobs.createIndexes();

const FACEBOOK_SOURCE = /(facebook|instagram|meta[_ ]?ads)/i;
// Mongo filter for a lead export (source / created_at range)
function leadExportFilter(filter) {
  const query = {};
  const source = String(filter.source || '').toLowerCase();
  if (source === 'facebook') {
    query.source = FACEBOOK_SOURCE;
  } else if (source === 'whatsapp') {
    query.source = /whatsapp/i;
  } else if (source === 'website') {
    query.source = /(website|web site)/i;
  } else if (source === 'xls_sheet') {
    query.source = /^\s*((xls sheet|xlsx sheet|excel sheet|csv import)\s*$|csv_)/i;
  }
  if (filter.from || filter.to) {
    query.created_at = {};
    if (filter.from) query.created_at.$gte = new Date(filter.from);
    if (filter.to) query.created_at.$lte = new Date(filter.to);
  }
  return query;
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function formatLeadExportDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(date);
}

async function processLeadExportJob(jobId) {
  if (activeLeadExports.has(jobId)) return;
  activeLeadExports.add(jobId);
  let stream;
  try {
    await leadExportReady;
    const job = await LeadExportJobs.findOne({ id: jobId }, NO_ID).lean();
    if (!job || job.status !== 'queued') return;

    await LeadExportJobs.updateOne({ id: jobId }, { $set: { status: 'processing', started_at: new Date() } });
    fs.mkdirSync(LEAD_EXPORT_DIR, { recursive: true });
    const filePath = path.join(LEAD_EXPORT_DIR, `${jobId}.csv`);
    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    stream.write('\uFEFFName,Phone,Source,Brand,Status,Score,Assigned,Interest,Created At\n');

    const filter = job.filters || {};
    let lastId = 0;
    let processed = 0;
    const batchSize = 2000;
    while (true) {
      const batchLeads = await Leads.find(
        { ...leadExportFilter(filter), id: { $gt: lastId } },
        { id: 1, name: 1, phone: 1, source: 1, client_id: 1, status: 1, score: 1, assigned_to: 1, interest: 1, created_at: 1 }
      ).sort({ id: 1 }).limit(batchSize).lean();
      const batchClients = new Map((await Clients.find({ id: { $in: batchLeads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
      const batchUsers = new Map((await Users.find({ id: { $in: batchLeads.map((l) => l.assigned_to).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((u) => [u.id, u.name]));
      const batch = { rows: batchLeads.map((l) => ({
        id: l.id, name: l.name, phone: l.phone, source: l.source, brand_name: batchClients.get(l.client_id) ?? null, status: l.status,
        score: l.score, assigned_name: batchUsers.get(l.assigned_to) ?? null, interest: l.interest, created_at: l.created_at,
      })) };
      if (!batch.rows.length) break;

      for (const lead of batch.rows) {
        stream.write([
          lead.name, lead.phone, lead.source, lead.brand_name, lead.status, lead.score,
          lead.assigned_name, lead.interest, formatLeadExportDate(lead.created_at),
        ].map(csvCell).join(',') + '\n');
      }
      if (stream.writableNeedDrain) {
        await new Promise((resolve, reject) => {
          stream.once('drain', resolve);
          stream.once('error', reject);
        });
      }
      processed += batch.rows.length;
      lastId = batch.rows[batch.rows.length - 1].id;
      await LeadExportJobs.updateOne({ id: jobId }, { $set: { processed_records: processed } });
      await new Promise(resolve => setImmediate(resolve));
    }

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.end(resolve);
    });
    stream = null;
    await LeadExportJobs.updateOne({ id: jobId }, { $set: { status: 'completed', processed_records: processed, file_path: filePath, completed_at: new Date() } });
  } catch (err) {
    if (stream) stream.destroy();
    console.error(`[Lead Export ${jobId}]`, err);
    await LeadExportJobs.updateOne({ id: jobId }, { $set: { status: 'failed', error_message: err.message, completed_at: new Date() } }).catch(() => {});
  } finally {
    activeLeadExports.delete(jobId);
  }
}

app.post('/api/leads/exports', auth, async (req, res) => {
  try {
    await leadExportReady;
    const { mode = 'all', source, from, to } = req.body || {};
    if (!['all', 'source', 'date'].includes(mode)) return res.status(400).json({ error: 'Invalid export mode' });
    if (mode === 'source' && !['facebook', 'whatsapp', 'website', 'xls_sheet'].includes(source)) return res.status(400).json({ error: 'Invalid source' });
    if (mode === 'date' && (!from || !to || Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime()) || new Date(from) > new Date(to))) {
      return res.status(400).json({ error: 'Invalid date range' });
    }
    const filters = mode === 'source' ? { source } : mode === 'date' ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : {};
    const totalRecords = await Leads.countDocuments(leadExportFilter(filters));
    const userId = req.user.id || req.user.user_id || null;
    const createdJob = await LeadExportJobs.create({ user_id: userId, mode, filters, total_records: totalRecords });
    const job = { id: createdJob.id, status: createdJob.status, total_records: createdJob.total_records };
    setImmediate(() => processLeadExportJob(job.id));
    res.status(202).json(job);
  } catch (err) {
    console.error('Create lead export error:', err);
    res.status(500).json({ error: 'Could not start export' });
  }
});

app.get('/api/leads/exports/:id', auth, async (req, res) => {
  await leadExportReady;
  const userId = req.user.id || req.user.user_id || null;
  const exportJob = await LeadExportJobs.findOne(
    { id: req.params.id, user_id: userId ?? null },
    { _id: 0, id: 1, status: 1, total_records: 1, processed_records: 1, error_message: 1, created_at: 1, completed_at: 1 }
  ).lean();
  if (!exportJob) return res.status(404).json({ error: 'Export not found' });
  res.json(exportJob);
});

app.get('/api/leads/exports/:id/download', auth, async (req, res) => {
  await leadExportReady;
  const userId = req.user.id || req.user.user_id || null;
  const job = await LeadExportJobs.findOne({ id: req.params.id, user_id: userId ?? null }, { _id: 0, status: 1, file_path: 1, mode: 1 }).lean();
  if (!job) return res.status(404).json({ error: 'Export not found' });
  if (job.status !== 'completed' || !job.file_path || !fs.existsSync(job.file_path)) return res.status(409).json({ error: 'Export is not ready' });
  res.download(job.file_path, `leads_export_${job.mode}_${new Date().toISOString().slice(0, 10)}.csv`);
});

// Resume interrupted jobs after a server restart.
leadExportReady.then(async () => {
  await LeadExportJobs.updateMany({ status: 'processing' }, { $set: { status: 'queued', error_message: null } });
  const queuedJobs = await LeadExportJobs.find({ status: 'queued' }, { id: 1 }).sort({ created_at: 1 }).lean();
  for (const row of queuedJobs) setImmediate(() => processLeadExportJob(row.id));
}).catch(err => console.error('[Lead Export] Startup recovery failed:', err.message));

// Export files are temporary. Clean up completed/failed jobs after 48 hours.
cron.schedule('17 */6 * * *', async () => {
  try {
    await leadExportReady;
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const oldJobs = await LeadExportJobs.find({ created_at: { $lt: cutoff } }, { id: 1, file_path: 1 }).lean();
    for (const job of oldJobs) {
      if (job.file_path && fs.existsSync(job.file_path)) fs.unlinkSync(job.file_path);
    }
    await LeadExportJobs.deleteMany({ created_at: { $lt: cutoff } });
  } catch (err) {
    console.error('[Lead Export] Cleanup failed:', err.message);
  }
});

// GET /api/leads
app.get('/api/leads/facebook-filter-options', auth, async (req, res) => {
  try {
    const nullsLast = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : String(a).localeCompare(String(b)));
    const blank = (value) => value == null || String(value).trim() === '';
    const fbLeads = await Leads.find({ source: FACEBOOK_SOURCE }, { campaign_name: 1, ad_name: 1 }).lean();
    const optionKeys = new Map();
    for (const l of fbLeads) {
      if (blank(l.campaign_name) && blank(l.ad_name)) continue;
      const option = { campaign_name: l.campaign_name ?? null, ad_name: l.ad_name ?? null };
      optionKeys.set(JSON.stringify(option), option);
    }
    const options = [...optionKeys.values()].sort((a, b) => nullsLast(a.campaign_name, b.campaign_name) || nullsLast(a.ad_name, b.ad_name));
    const firstFilled = (...values) => values.find((value) => value != null && value !== '') ?? null;
    const pageKeys = new Map();
    for (const account of await models.BrandSocialAccounts.find({ is_active: true, platform: /^(facebook|instagram)$/i }).lean()) {
      if (blank(account.account_name)) continue;
      const page = {
        platform: account.platform,
        page_name: account.account_name,
        brand_name: account.brand_name,
        page_id: String(account.platform).toLowerCase() === 'instagram'
          ? firstFilled(account.instagram_business_id, account.account_id, account.facebook_page_id)
          : firstFilled(account.facebook_page_id, account.account_id, account.instagram_business_id),
      };
      pageKeys.set(JSON.stringify(page), page);
    }
    const pages = [...pageKeys.values()].sort((a, b) => String(a.platform).localeCompare(String(b.platform)) || String(a.page_name).localeCompare(String(b.page_name)));
    res.json({ options, pages: pages.filter(page => page.page_id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// pg_trgm-compatible trigram similarity (used for fuzzy lead-name search)
function trigrams(value) {
  const grams = new Set();
  for (const word of String(value ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)) {
    const padded = `  ${word} `;
    for (let i = 0; i < padded.length - 2; i += 1) grams.add(padded.slice(i, i + 3));
  }
  return grams;
}
function trigramSimilarity(a, b) {
  const left = trigrams(a);
  const right = trigrams(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

// Page id of a connected Facebook/Instagram account (Instagram prefers its business id)
const socialPageId = (account) => {
  const pick = (...values) => values.find((value) => value != null && value !== '') ?? null;
  return String(account.platform).toLowerCase() === 'instagram'
    ? pick(account.instagram_business_id, account.account_id, account.facebook_page_id)
    : pick(account.facebook_page_id, account.account_id, account.instagram_business_id);
};

// Adds brand/assignee/page/unread/last contact/last message/tags to lead rows
async function enrichLeadRows(leads) {
  const ids = leads.map((l) => l.id);
  const clients = new Map((await Clients.find({ id: { $in: leads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
  const users = new Map((await Users.find({ id: { $in: leads.map((l) => l.assigned_to).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((u) => [u.id, u.name]));
  const facebookPages = await models.BrandSocialAccounts.find({ platform: /^facebook$/i, is_active: true, brand_name: { $in: [...clients.values()] } }, { id: 1, brand_name: 1, account_name: 1 }).sort({ id: 1 }).lean();
  const conversations = await Conversations.find({ lead_id: { $in: ids } }, { id: 1, lead_id: 1, unread_count: 1, last_message_at: 1 }).lean();
  const lastMessages = new Map();
  const latest = await Messages.aggregate([
    { $match: { conversation_id: { $in: conversations.map((cv) => cv.id) } } },
    { $sort: { sent_at: -1, id: -1 } },
    { $group: { _id: '$conversation_id', content: { $first: '$content' }, msg_type: { $first: '$msg_type' }, media_url: { $first: '$media_url' }, is_deleted: { $first: '$is_deleted' }, sent_at: { $first: '$sent_at' }, id: { $first: '$id' } } },
  ]);
  const latestByConversation = new Map(latest.map((m) => [m._id, m]));
  for (const cv of conversations) {
    const message = latestByConversation.get(cv.id);
    if (!message) continue;
    const current = lastMessages.get(cv.lead_id);
    const newer = !current || new Date(message.sent_at || 0) > new Date(current.sent_at || 0)
      || (new Date(message.sent_at || 0).getTime() === new Date(current.sent_at || 0).getTime() && message.id > current.id);
    if (newer) lastMessages.set(cv.lead_id, message);
  }
  const tagLinks = await LeadTags.find({ lead_id: { $in: ids } }, { lead_id: 1, tag_id: 1 }).lean();
  const tags = new Map((await AllianceInboxTags.find({ id: { $in: tagLinks.map((t) => t.tag_id) } }, { id: 1, name: 1, color: 1 }).lean()).map((t) => [t.id, t]));
  return leads.map((l) => {
    const brandName = clients.get(l.client_id) ?? null;
    const own = conversations.filter((cv) => cv.lead_id === l.id);
    const contactTimes = own.map((cv) => cv.last_message_at).filter(Boolean).map((at) => new Date(at).getTime());
    const message = lastMessages.get(l.id);
    return {
      ...l,
      brand_name: brandName,
      assigned_name: users.get(l.assigned_to) ?? null,
      facebook_page_name: facebookPages.find((page) => page.brand_name === brandName && String(page.account_name ?? '').trim() !== '')?.account_name ?? null,
      unread: own.reduce((sum, cv) => sum + (Number(cv.unread_count) || 0), 0),
      last_contact: contactTimes.length ? new Date(Math.max(...contactTimes)) : null,
      last_msg: message ? { content: message.content ?? null, msg_type: message.msg_type ?? null, media_url: message.media_url ?? null, is_deleted: message.is_deleted ?? null } : null,
      tags: tagLinks.filter((link) => link.lead_id === l.id && tags.has(link.tag_id))
        .map((link) => ({ id: link.tag_id, name: tags.get(link.tag_id).name, color: tags.get(link.tag_id).color })),
    };
  });
}

app.get('/api/leads', auth, async (req, res) => {
  try {
    const { status, brand, search, source, campaign_name, ad_name, meta_page_id, from, to, tag_id, limit = 100, offset = 0 } = req.query;
    const and = [];

    if (status && status !== 'all') {
      if (String(status).toLowerCase() === 'cold') {
        // Legacy leads with no status have always been displayed as Cold in the
        // UI, so include them in the Cold tab as well.
        and.push({ $or: [{ status: null }, { status: /^\s*$/ }, { status: /^\s*cold\s*$/i }] });
      } else {
        and.push({ status: new RegExp(`^\\s*${escapeRegex(String(status))}\\s*$`, 'i') });
      }
    }
    if (brand && brand !== 'All Brands') {
      const brandIds = await Clients.distinct('id', { name: new RegExp(escapeRegex(brand), 'i') });
      and.push({ client_id: { $in: brandIds } });
    }
    if (source && source !== 'all') {
      const normalizedSource = String(source).toLowerCase();
      if (['facebook', 'whatsapp', 'website', 'xls_sheet'].includes(normalizedSource)) {
        and.push(leadExportFilter({ source: normalizedSource }));
      } else {
        and.push({ source: new RegExp(`^\\s*${escapeRegex(String(source).trim())}\\s*$`, 'i') });
      }
    }
    if (campaign_name) and.push({ source: FACEBOOK_SOURCE }, { campaign_name });
    if (ad_name) and.push({ source: FACEBOOK_SOURCE }, { ad_name });
    if (meta_page_id) {
      const pageAccounts = (await models.BrandSocialAccounts.find({ is_active: true }).lean())
        .filter((account) => socialPageId(account) === String(meta_page_id));
      const pageClientIds = await Clients.distinct('id', { name: { $in: pageAccounts.map((account) => account.brand_name) } });
      and.push({ source: FACEBOOK_SOURCE }, { client_id: { $in: pageClientIds } });
    }
    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) return res.status(400).json({ error: 'Invalid from date' });
      and.push({ created_at: { $gte: fromDate } });
    }
    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) return res.status(400).json({ error: 'Invalid to date' });
      and.push({ created_at: { $lte: toDate } });
    }
    if (tag_id) {
      and.push({ id: { $in: await LeadTags.distinct('lead_id', { tag_id }) } });
    }

    const candidates = await Leads.find(and.length ? { $and: and } : {}, { id: 1, name: 1, phone: 1, created_at: 1 }).lean();
    let ordered;
    if (search) {
      const term = String(search);
      const pattern = new RegExp(escapeRegex(term), 'i');
      const digits = term.replace(/[^0-9]/g, '');
      const phoneMatches = (lead) => digits !== '' && String(lead.phone ?? '').replace(/[^0-9]/g, '').includes(digits);
      ordered = candidates
        .map((lead) => ({ lead, nameScore: trigramSimilarity(lead.name, term), phoneScore: trigramSimilarity(lead.phone ?? '', term), phoneHit: phoneMatches(lead) }))
        .filter(({ lead, nameScore, phoneHit }) => pattern.test(lead.name ?? '') || pattern.test(lead.phone ?? '') || nameScore > 0.3 || phoneHit)
        .sort((a, b) => Number(b.phoneHit) - Number(a.phoneHit) || b.nameScore - a.nameScore || b.phoneScore - a.phoneScore)
        .map(({ lead }) => lead);
    } else {
      const lastMessageAt = new Map((await Conversations.aggregate([
        { $match: { lead_id: { $in: candidates.map((l) => l.id) } } },
        { $group: { _id: '$lead_id', last: { $max: '$last_message_at' } } },
      ])).map((row) => [row._id, row.last]));
      const activity = (lead) => new Date(lastMessageAt.get(lead.id) ?? lead.created_at ?? 0).getTime();
      ordered = [...candidates].sort((a, b) => activity(b) - activity(a));
    }
    const pageIds = ordered.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 100)).map((lead) => lead.id);
    const pageLeads = new Map((await Leads.find({ id: { $in: pageIds } }, NO_ID).lean()).map((lead) => [lead.id, lead]));
    const filteredTotal = pageIds.length ? ordered.length : 0;
    const rows = (await enrichLeadRows(pageIds.map((id) => pageLeads.get(id)).filter(Boolean)))
      .map((row) => ({ ...row, filtered_total: filteredTotal }));
    res.json({ leads: rows, total: filteredTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Lead conversation messages shaped for the CRM inbox (with reply previews)
async function leadInboxMessages(conversationIds, { sort = { sent_at: 1 }, skip = 0, limit = 0 } = {}) {
  let query = Messages.find({ conversation_id: { $in: conversationIds } }, NO_ID).sort(sort).skip(skip);
  if (limit) query = query.limit(limit);
  const rows = await query.lean();
  const replyIds = [...new Set(rows.map((m) => m.reply_to_wa_id).filter(Boolean))];
  const replies = new Map((replyIds.length ? await Messages.find({ wa_msg_id: { $in: replyIds } }, { wa_msg_id: 1, direction: 1, media_url: 1, content: 1, msg_type: 1 }).lean() : [])
    .map((r) => [r.wa_msg_id, r]));
  return rows.map((m) => {
    const reply = m.reply_to_wa_id ? replies.get(m.reply_to_wa_id) : null;
    return {
      id: m.id, direction: m.direction, content: m.content, type: m.msg_type, media_url: m.media_url, wa_msg_id: m.wa_msg_id,
      status: m.status, is_ai: m.is_ai, timestamp: m.sent_at, read_at: m.read_at, is_deleted: m.is_deleted, is_forwarded: m.is_forwarded,
      pinned_until: m.pinned_until, is_starred: m.is_starred, reactions: m.reactions,
      reply_to: reply ? { direction: reply.direction, media_url: reply.media_url, content: reply.content, msg_type: reply.msg_type } : null,
    };
  });
}

// GET /api/leads/:id
app.get('/api/leads/:id', auth, async (req, res) => {
  try {
    const leadRow = await Leads.findOne({ id: req.params.id }, NO_ID).lean();
    if (!leadRow) return res.status(404).json({ error: 'Lead not found' });
    const leadClient = leadRow.client_id != null ? await Clients.findOne({ id: leadRow.client_id }, { name: 1, phone_number_id: 1, wa_access_token: 1 }).lean() : null;
    const [enriched] = await enrichLeadRows([leadRow]);
    const lead = {
      ...leadRow,
      brand_name: leadClient?.name ?? null,
      phone_number_id: leadClient?.phone_number_id ?? null,
      wa_access_token: leadClient?.wa_access_token ?? null,
      assigned_name: enriched.assigned_name,
      tags: enriched.tags,
    };

    // Join conversations (thread) → messages (individual) for this lead
    const conversations = await leadInboxMessages(await Conversations.distinct('id', { lead_id: leadRow.id }));

    res.json({ lead, conversations });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id/messages
app.get('/api/leads/:id/messages', auth, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const messageLead = await Leads.findOne({ id: req.params.id }, { phone: 1 }).lean();
    const conversationFilter = [{ lead_id: req.params.id }];
    if (messageLead && messageLead.phone != null) conversationFilter.push({ lead_id: null, phone: phoneTailRegex(messageLead.phone) });
    const conversationIds = await Conversations.distinct('id', { $or: conversationFilter });
    const messages = await leadInboxMessages(conversationIds, { sort: { sent_at: -1 }, skip: parseInt(offset) || 0, limit: parseInt(limit) || 100 });

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads
app.post('/api/leads', auth, async (req, res) => {
  try {
    const { name, phone, source, interest, assigned_to } = req.body;
    const leadOSBrand = await getLeadOSBrand();
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    // Strip formatting (spaces/dashes/parens) so this matches the digits-only format
    // every phone-matching query in the app expects. Does not add/assume a country code.
    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (!normalizedPhone) return res.status(400).json({ error: 'Enter a valid phone number' });

    const createdLead = await Leads.create({
      name, phone: normalizedPhone, source: source || 'Manual', client_id: leadOSBrand.id, interest: interest || '',
      assigned_to: assigned_to || null, status: 'new', score: 0, created_at: new Date(),
    });
    const rows = [createdLead.toObject()];

    // Trigger n8n webhook for new leads to send welcome template.
    // Prefer this brand's own WhatsApp credentials (kept current via the
    // integrations/reconnect flow) over the static .env pair, which can go
    // stale — matches the lookup already done for bulk import (see /api/leads/import).
    if (process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
      Clients.findOne({ id: rows[0].client_id }, { phone_number_id: 1, wa_access_token: 1 }).lean()
        .then(webhookClient => {
          const phoneNumberId = webhookClient?.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
          const waAccessToken = webhookClient?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
          return axios.post(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
            lead_id: rows[0].id,
            name: rows[0].name,
            phone: rows[0].phone,
            client_id: rows[0].client_id,
            phone_number_id: phoneNumberId,
            wa_access_token: waAccessToken
          });
        })
        .catch(e => console.error('[n8n Webhook Error]', e.message));
    }

    evaluateLeadBrandAndSchedule(rows[0].id).catch(console.error);

    res.status(201).json({ lead: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/leads/:id
app.patch('/api/leads/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, status, score, assigned_to, interest, notes } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = String(phone).replace(/\D/g, '');
    if (email !== undefined) updates.email = email;
    if (status !== undefined) updates.status = status;
    if (score !== undefined) updates.score = score;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (interest !== undefined) updates.interest = interest;
    if (notes !== undefined) updates.notes = notes;

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const lead = await Leads.findOneAndUpdate({ id: req.params.id }, { $set: { ...updates, updated_at: new Date() } }, { new: true, projection: NO_ID }).lean();
    res.json({ lead: lead || undefined });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await Messages.deleteMany({ conversation_id: { $in: await Conversations.distinct('id', { lead_id: id }) } });
    await Conversations.deleteMany({ lead_id: id });
    await Payments.deleteMany({ lead_id: id });
    // sales_tasks has no ON DELETE CASCADE (unlike every other lead_id FK), so it
    // would block the delete below if left out.
    await SalesTasks.deleteMany({ lead_id: id });

    const deleted = await deleteCascade('leads', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Lead not found' });

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/tags', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { tagId } = req.body;
    await insertIgnore(LeadTags, { lead_id: id, tag_id: tagId, assigned_at: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error('Add lead tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/leads/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const { id, tagId } = req.params;
    await LeadTags.deleteMany({ lead_id: id, tag_id: tagId });
    res.json({ success: true });
  } catch (err) {
    console.error('Remove lead tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/migrate-flow-step — one-time migration
app.post('/api/leads/migrate-flow-step', auth, async (req, res) => {
  try {
    // 1. Add flow_step to leads
    await Leads.updateMany({ flow_step: null }, { $set: { flow_step: 'welcome' } });

    // 2. brain_docs has no doc_type constraint in MongoDB, so nothing else to migrate
    
    res.json({ success: true, message: 'DB migration successful! flow_step added and constraints updated.' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ══════════════════════════════════════════════════════════
// WHATSAPP ROUTES
// ══════════════════════════════════════════════════════════

// POST /api/whatsapp/send — manual send from CRM portal
app.post('/api/whatsapp/send', auth, async (req, res) => {
  try {
    const { lead_id, message, media_url, msg_type, reply_to_wa_id, is_forwarded } = req.body;

    // Admin manually intervened: cancel any pending AI reply for this lead
    if (aiReplyQueue.has(lead_id)) {
      clearTimeout(aiReplyQueue.get(lead_id));
      aiReplyQueue.delete(lead_id);
      io.emit('ai_typing', { lead_id: String(lead_id), typing: false });
      console.log(`[AI Queue] Cancelled AI reply for lead ${lead_id} due to manual admin message.`);
    }

    const sendLead = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!sendLead) return res.status(404).json({ error: 'Lead not found.' });
    const sendClient = sendLead.client_id != null ? await Clients.findOne({ id: sendLead.client_id }, { phone_number_id: 1, wa_access_token: 1, whatsapp_status: 1 }).lean() : null;
    const lead = {
      ...sendLead,
      phone_number_id: sendClient?.phone_number_id ?? null,
      wa_access_token: sendClient?.wa_access_token ?? null,
      whatsapp_status: sendClient?.whatsapp_status ?? null,
    };

    if (lead.client_id && lead.whatsapp_status !== 'verified') {
      return res.status(403).json({ error: 'WhatsApp is disabled for this brand until verification succeeds' });
    }

    const phoneNumberId = lead.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
    const waAccessToken = lead.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

    if (!phoneNumberId || !waAccessToken) {
      return res.status(400).json({ error: 'WhatsApp not configured for this brand. Please add phone_number_id and wa_access_token in Clients settings or server .env file.' });
    }

    // --- Check 24-hour window ---
    const windowConversationFilter = [{ lead_id }];
    if (lead.phone != null) windowConversationFilter.push({ phone: phoneTailRegex(lead.phone) });
    const windowConversationIds = await Conversations.distinct('id', { $or: windowConversationFilter });
    const isWindowOpen = Boolean(await Messages.exists({
      conversation_id: { $in: windowConversationIds }, direction: 'inbound', sent_at: { $gt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }));

    if (!isWindowOpen) {
      // Check if we already sent a wakeup template in the last 30 minutes to avoid spamming
      const recentTemplate = await Messages.exists({
        conversation_id: { $in: await Conversations.distinct('id', { lead_id }) },
        direction: 'outbound', msg_type: 'template', sent_at: { $gt: new Date(Date.now() - 30 * 60 * 1000) },
      });

      if (!recentTemplate) {
        // Send the common_welcome_message template to reopen the 24-hour window
        try {
          const templateRes = await axios.post(
            `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
            {
              messaging_product: 'whatsapp',
              to: (lead.phone || '').replace(/\D/g, ''),
              type: 'template',
              template: {
                name: 'common_welcome_message',
                language: { code: 'en' }
              }
            },
            { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
          );
          const waMsgId = templateRes.data?.messages?.[0]?.id;
          console.log('[Template Wakeup] Sent common_welcome_message to', lead.phone, waMsgId);

          // Save template message to DB so it appears in inbox
          const convCheck = await Conversations.findOne({ lead_id }, { id: 1 }).lean();
          if (convCheck) {
            const convId = convCheck.id;
            const existingTemplateMsg = waMsgId ? await Messages.exists({ wa_msg_id: waMsgId }) : null;
            if (!existingTemplateMsg) {
              await Messages.create({
                conversation_id: convId, direction: 'outbound', content: 'common_welcome_message', msg_type: 'template',
                wa_msg_id: waMsgId, status: 'sent', is_ai: false, sent_at: new Date(),
              });
            }
            // Push to inbox in real-time
            io.emit('outgoing_message', { lead_id: String(lead.id), message: { direction: 'outbound', content: '[Template] common_welcome_message', msg_type: 'template', sent_at: new Date() } });
          }
        } catch (err) {
          console.error('[Template Wakeup Error]', JSON.stringify(err.response?.data) || err.message);
        }
      } else {
        console.log('[Template Wakeup] Skipped — already sent in last 30 min for lead', lead_id);
      }

      // Return 200 OK so the frontend stays silent — the template was already sent
      return res.status(200).json({ 
        window_closed: true,
        message: 'Template sent to reopen chat window. Please wait for the customer to reply.'
      });
    }
    // ----------------------------

    const type = msg_type && msg_type !== 'text' ? msg_type : 'text';
    const payload = {
      messaging_product: 'whatsapp',
      to: (lead.phone || '').replace(/\D/g, ''),
      type: type,
    };

    if (reply_to_wa_id) {
      payload.context = { message_id: reply_to_wa_id };
    }

    let waMediaId = null;
    if (type !== 'text' && media_url && media_url.startsWith('/uploads/')) {
      try {
        const filePath = path.join(__dirname, media_url);
        const fileBuffer = fs.readFileSync(filePath);
        const fd = new FormData();
        fd.append('messaging_product', 'whatsapp');
        const ext = path.extname(media_url).toLowerCase();
        let mimeType = 'application/octet-stream';
        // WhatsApp explicitly rejects bare "audio/ogg" for voice notes — it requires the
        // codecs parameter or the upload is rejected during processing (error 131053).
        if (ext === '.ogg') mimeType = 'audio/ogg; codecs=opus';
        else if (ext === '.mp4') mimeType = 'video/mp4';
        else if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
        else if (ext === '.png') mimeType = 'image/png';
        else if (ext === '.pdf') mimeType = 'application/pdf';
        
        fd.append('file', new Blob([fileBuffer], { type: mimeType }), path.basename(media_url));
        const uploadRes = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${waAccessToken}` },
          body: fd,
        });
        const uploadData = await uploadRes.json();
        if (uploadRes.ok && uploadData.id) {
          waMediaId = uploadData.id;
          fs.appendFileSync(path.join(__dirname, 'uploads', 'media_upload.log'), `[SUCCESS] ID: ${waMediaId}\n`);
        } else {
          console.warn('[WhatsApp Send] Direct media upload failed:', uploadData);
          fs.appendFileSync(path.join(__dirname, 'uploads', 'media_upload.log'), `[FAILED API] ${JSON.stringify(uploadData)}\n`);
        }
      } catch (e) {
        console.warn('[WhatsApp Send] Failed to upload media directly:', e.message);
        fs.appendFileSync(path.join(__dirname, 'uploads', 'media_upload.log'), `[FAILED EXCEPTION] ${e.message}\n`);
      }
    }

    if (type === 'text') {
      payload.text = { body: message };
    } else {
      if (waMediaId) {
        payload[type] = { id: waMediaId };
      } else {
        const fullMediaUrl = media_url && media_url.startsWith('http') ? media_url : `${process.env.API_URL || 'https://leados-api.abmgroups.org'}${media_url}`;
        payload[type] = { link: fullMediaUrl };
      }
      if (message && type !== 'audio') payload[type].caption = message; // Audio doesn't support caption
    }

    const waRes = await axios.post(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
      payload,
      { headers: { Authorization: `Bearer ${waAccessToken}`, 'Content-Type': 'application/json' } }
    );

    const waMessageId = waRes.data.messages?.[0]?.id;
    // Same normalization the inbound webhook uses (server.js ~2991) — conversations.phone
    // must always be the last 10 digits, or a lead whose phone has a country-code prefix
    // gets a second, orphaned conversations row the next time they message in.
    const phone = lead.phone?.replace(/\D/g, '').slice(-10);

    // Upsert the conversation thread (unique per phone+tenant)
    const conversation = await upsertOne(
      Conversations,
      { phone },
      { $set: { lead_id, last_message: message, last_message_at: new Date() } },
      { lead_id, status: 'open', last_message: message, last_message_at: new Date(), created_at: new Date() }
    );
    const conversationId = conversation.id;

    // Insert message into messages table
    const sentMessage = await Messages.create({
      conversation_id: conversationId, direction: 'outbound', content: message, msg_type: type, media_url: media_url || null,
      wa_msg_id: waMessageId, status: 'sent', sent_at: new Date(), reply_to_wa_id: reply_to_wa_id || null, is_forwarded: is_forwarded || false,
    });
    const savedRows = [{
      id: sentMessage.id, direction: sentMessage.direction, content: sentMessage.content, type: sentMessage.msg_type,
      media_url: sentMessage.media_url, wa_msg_id: sentMessage.wa_msg_id, status: sentMessage.status, timestamp: sentMessage.sent_at,
      is_deleted: sentMessage.is_deleted, reply_to_wa_id: sentMessage.reply_to_wa_id, is_forwarded: sentMessage.is_forwarded,
    }];

    // Emit real-time event to all CRM clients
    io.emit('outgoing_message', { lead_id: Number(lead_id), message: savedRows[0] });

    res.json({ success: true, message: savedRows[0] });
  } catch (err) {
    console.error('WA send error:', err.response?.data || err.message, err.stack);
    
    res.status(500).json({
      error: 'Failed to send message',
      detail: err.message,
      meta_response: err.response?.data || null,
      stack: err.stack
    });
  }
});

// ── WHATSAPP WEBHOOK ──────────────────────────────────────
const aiReplyQueue = new Map(); // Store timeouts for delayed AI replies

// GET — Meta webhook verification
app.get('/webhook/whatsapp', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) {
    console.log('WhatsApp webhook verified');
    return res.send(challenge);
  }
  res.sendStatus(403);
});

// POST — incoming WhatsApp messages + template status updates
app.post('/webhook/whatsapp', async (req, res) => {
  res.sendStatus(200); // Always respond 200 immediately to Meta

  try {
    const body = req.body;
    fs.appendFileSync(path.join(__dirname, 'uploads', 'incoming_payloads.log'), `[${new Date().toISOString()}] ${JSON.stringify(body, null, 2)}\n\n`);
    
    if (!body.object || body.object !== 'whatsapp_business_account') return;

    // n8n may relay every Meta callback through this legacy LeadOS endpoint.
    // Route Alliance events into the isolated Alliance webhook before any
    // LeadOS contacts, conversations, messages, or campaign logs are touched.
    const alliancePhoneNumberId = String(process.env.ALLIANCE_WA_PHONE_NUMBER_ID || '');
    const isAllianceEvent = alliancePhoneNumberId && (body.entry || []).some((entry) =>
      (entry.changes || []).some((change) =>
        String(change.value?.metadata?.phone_number_id || '') === alliancePhoneNumberId
      )
    );
    if (isAllianceEvent) {
      const localPort = Number(process.env.PORT) || 3600;
      await require('axios').post(
        `http://127.0.0.1:${localPort}/api/alliance-inbox/webhook`,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'x-internal-key': process.env.INTERNAL_API_KEY || '',
          },
          timeout: 10000,
        }
      );
      console.log('[Alliance Webhook] Routed n8n callback to isolated Alliance Inbox');
      return;
    }

    // ── FILTER UNMANAGED PHONE NUMBERS ─────────────────────
    let hasValidPhoneNumber = true; // Default true for non-message events
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        if (change.field === 'messages') {
          hasValidPhoneNumber = false;
          const phoneNumberId = change.value?.metadata?.phone_number_id;
          if (phoneNumberId) {
            if (phoneNumberId === process.env.WA_PHONE_NUMBER_ID) {
              hasValidPhoneNumber = true;
            } else {
              if (await Clients.exists({ phone_number_id: phoneNumberId })) {
                hasValidPhoneNumber = true;
              }
            }
          }
        } else {
          hasValidPhoneNumber = true; // Let template updates pass
        }
      }
    }

    if (!hasValidPhoneNumber) {
      console.log('🚫 Ignored webhook for unmanaged phone_number_id');
      return;
    }

    // FORWARD TO N8N WEBHOOK
    // This allows the Node server to act as a proxy if needed.
    // If the request is already coming from n8n (source=n8n), we SKIP forwarding to prevent an infinite loop.
    if (req.query.source !== 'n8n') {
      try {
        const n8nUrl = 'https://leados-n8n.abmgroups.org/webhook/whatsapp-inbound';
        await require('axios').post(n8nUrl, body);
        console.log('✅ Successfully forwarded payload to n8n Lead Integrator (WF00)');
      } catch (n8nErr) {
        console.error('⚠️ Failed to forward payload to n8n:', n8nErr.message);
      }
    }

    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {

        // ── TEMPLATE STATUS UPDATES ──────────────────────────
        if (change.field === 'message_template_status_update') {
          const { event, message_template_id, message_template_name } = change.value;
          console.log(`📋 Template status update: ${message_template_name} → ${event}`);

          let newStatus = null;
          if (event === 'APPROVED') newStatus = 'approved';
          else if (['REJECTED', 'PAUSED', 'DISABLED'].includes(event)) newStatus = 'rejected';
          else if (event === 'PENDING_DELETION') newStatus = 'draft';

          if (newStatus) {
            const templateStatusUpdate = { status: newStatus };
            if (newStatus === 'approved') templateStatusUpdate.approved_at = new Date();
            const updateResult = await Templates.updateMany(
              { $or: [{ meta_template_id: String(message_template_id) }, { name: message_template_name }] },
              { $set: templateStatusUpdate }
            );

            if (updateResult.matchedCount) {
              console.log(`✅ Template "${message_template_name}" updated to ${newStatus}`);
            } else {
              console.warn(`⚠️  Could not find template: ${message_template_name} (id: ${message_template_id})`);
            }
          }
          continue;
        }

        // ── INCOMING MESSAGES & DELIVERY STATUSES ────────────
        if (change.field !== 'messages') continue;
        const value = change.value;

        // Handle delivery/read status receipts
        if (value.statuses) {
          for (const s of value.statuses) {
            const wamid = s.id;
            const newStatus = s.status; // 'sent', 'delivered', 'read', 'failed'
            const errorMsg = s.errors ? s.errors[0].title : null;
            if (!wamid) continue;

                      // Update status in messages table (using wa_msg_id)
            await Messages.updateMany({ wa_msg_id: wamid }, { $set: { status: newStatus } });
            if (newStatus === 'failed' && errorMsg) {
              await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus, error_message: errorMsg } });
            } else {
              await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus } });
            }

            // Emit real-time status update to CRM
            io.emit('message_status', { wa_message_id: wamid, status: newStatus });
            if (newStatus === 'failed') {
              console.log(`[Webhook Status] ${wamid} → ${newStatus} (Error: ${errorMsg})`);
            } else {
              console.log(`[Webhook Status] ${wamid} → ${newStatus}`);
            }
          }
        }

        // Handle ALL incoming messages from customers (text, image, audio, video, document)
        for (const msg of value.messages || []) {
          const phone = msg.from;       // e.g. '919876543210'
          const phoneNumberId = value.metadata.phone_number_id;
          const isForwarded = msg.context?.forwarded || msg.context?.frequently_forwarded || false;
          const waMessageId = msg.id;
          const referralAdId = msg.referral?.source_id ? String(msg.referral.source_id) : null;
          let referralCampaign = null;

          // Click-to-WhatsApp ads include the originating ad in msg.referral.
          // Reuse campaign metadata already learned from Meta lead-form sync for that ad.
          if (referralAdId) {
            referralCampaign = (await Leads.find({ ad_id: referralAdId }, { _id: 0, campaign_id: 1, campaign_name: 1, ad_id: 1, ad_name: 1, client_id: 1, updated_at: 1 }).lean())
              .sort((a, b) => Number(a.campaign_name == null) - Number(b.campaign_name == null) || new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
              .map(({ updated_at, ...row }) => row)[0] || null;
          }

          // Extract text and media info based on message type
          let text = '';
          let mediaUrl = null;
          let msgType = msg.type || 'text';

          if (msg.type === 'text') {
            text = msg.text?.body || '';
          } else if (msg.type === 'image') {
            text = msg.image?.caption || '[Image]';
            mediaUrl = msg.image?.id ? `https://graph.facebook.com/v18.0/${msg.image.id}` : null;
          } else if (msg.type === 'audio') {
            text = '[Voice Message]';
            mediaUrl = msg.audio?.id ? `https://graph.facebook.com/v18.0/${msg.audio.id}` : null;
          } else if (msg.type === 'video') {
            text = msg.video?.caption || '[Video]';
            mediaUrl = msg.video?.id ? `https://graph.facebook.com/v18.0/${msg.video.id}` : null;
          } else if (msg.type === 'document') {
            text = msg.document?.filename || '[Document]';
            mediaUrl = msg.document?.id ? `https://graph.facebook.com/v18.0/${msg.document.id}` : null;
          } else if (msg.type === 'button') {
            text = msg.button?.text || '[Button Reply]';
          } else if (msg.type === 'interactive') {
            text = msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Interactive Reply]';
          } else {
            console.log(`[Webhook] Message type: ${msg.type} from ${phone}`);
            text = `[${msg.type}]`;
          }

          // Find matching client by phone_number_id
          const client = await Clients.findOne({ phone_number_id: phoneNumberId }, NO_ID).lean();

          // Find or auto-create lead by phone number
          const phoneDigits = phone.replace(/\D/g, '');
          let lead = await Leads.findOne({ phone: phoneTailRegex(phoneDigits) }, NO_ID).sort({ created_at: -1 }).lean();
          if (lead) {
            const leadClient = lead.client_id != null ? await Clients.findOne({ id: lead.client_id }, { wa_access_token: 1, phone_number_id: 1 }).lean() : null;
            lead = { ...lead, client_wa_token: leadClient?.wa_access_token ?? null, client_phone_number_id: leadClient?.phone_number_id ?? null };
          }

          if (!lead) {
            const newLead = await Leads.create({
              name: value.contacts?.[0]?.profile?.name || phone,
              phone,
              source: referralAdId ? 'facebook' : 'WhatsApp',
              client_id: (await getLeadOSBrand()).id,
              status: 'new', score: 10, flow_step: 'welcome', created_at: new Date(),
              campaign_id: referralCampaign?.campaign_id || null,
              campaign_name: referralCampaign?.campaign_name || null,
              ad_id: referralAdId,
              ad_name: referralCampaign?.ad_name || msg.referral?.headline || null,
            });
            lead = newLead.toObject();
            lead.client_wa_token = client?.wa_access_token;
            lead.client_phone_number_id = client?.phone_number_id;
            console.log(`[Webhook] Auto-created lead for phone: ${phone}`);
          } else {
            if (lead.phone !== phone) {
              await Leads.updateOne({ id: lead.id }, { $set: { phone } });
              lead.phone = phone;
            }
            if (referralAdId) {
              const referralUpdate = { source: 'facebook', ad_id: referralAdId, updated_at: new Date() };
              const leadOSBrandId = (await getLeadOSBrand()).id;
              if (leadOSBrandId != null) referralUpdate.client_id = leadOSBrandId;
              if (referralCampaign?.campaign_id) referralUpdate.campaign_id = referralCampaign.campaign_id;
              if (referralCampaign?.campaign_name) referralUpdate.campaign_name = referralCampaign.campaign_name;
              if (referralCampaign?.ad_name || msg.referral?.headline) referralUpdate.ad_name = referralCampaign?.ad_name || msg.referral?.headline;
              const updatedLead = await Leads.findOneAndUpdate({ id: lead.id }, { $set: referralUpdate }, { new: true, projection: NO_ID }).lean();
              lead = { ...lead, ...(updatedLead || {}) };
            }
          }

          // ── AUDIO TRANSCRIPTION ──────────────────────────────
          console.log(`[DEBUG] Audio check: msg.type=${msg.type}, msg.audio?.id=${msg.audio?.id}, OPENROUTER_KEY=${openRouter.isConfigured}`);
          if (msg.type === 'audio' && msg.audio?.id && openRouter.isConfigured) {
            try {
              const waToken = lead.client_wa_token || client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
              if (waToken) {
                console.log(`[Audio] Fetching media URL for ${msg.audio.id}`);
                const mediaRes = await axios.get(`https://graph.facebook.com/v18.0/${msg.audio.id}`, {
                  headers: { Authorization: `Bearer ${waToken}` }
                });
                
                if (mediaRes.data && mediaRes.data.url) {
                  console.log(`[Audio] Downloading audio from WhatsApp...`);
                  const audioRes = await axios.get(mediaRes.data.url, {
                    headers: { Authorization: `Bearer ${waToken}` },
                    responseType: 'arraybuffer'
                  });
                  
                  const mimeType = mediaRes.data.mime_type || msg.audio?.mime_type || 'audio/ogg';
                  console.log('[Audio] Transcribing with OpenRouter...');
                  const transcription = await openRouter.models.generateContent({
                    model: openRouter.AUDIO_MODEL,
                    contents: [
                      {
                        text: 'Transcribe this WhatsApp voice note precisely in its original language. Return only the spoken words, without commentary or formatting.',
                      },
                      {
                        inlineData: {
                          mimeType,
                          data: Buffer.from(audioRes.data).toString('base64'),
                        },
                      },
                    ],
                  });
                  const transcriptionText = transcription?.text;
                  
                  if (transcriptionText) {
                    console.log(`[Audio] Transcription success: ${transcriptionText}`);
                    // Send only the spoken words to the sales AI. Keeping the
                    // voice marker here would trigger the old "please type it"
                    // fallback in /api/ai/response.
                    text = transcriptionText.trim();
                  }
                }
              }
            } catch (err) {
              console.error('[Audio Transcription Error]', err.response?.data || err.message);
              fs.appendFileSync(path.join(__dirname, 'uploads', 'audio_error.txt'), `[${new Date().toISOString()}] ${err.message}\n${err.stack}\n`);
            }
          }

          // ── Normalize phone to 10 digits to avoid duplicate conversations ──
          // Meta sends full international format e.g. "917339017112" but leads DB stores "7339017112"
          const normalizedPhone = phoneDigits.slice(-10);

          // Upsert conversation thread
          const conversation = await upsertOne(
            Conversations,
            { phone: normalizedPhone },
            { $set: { lead_id: lead.id, last_message: text, last_message_at: new Date() } },
            { lead_id: lead.id, status: 'open', last_message: text, last_message_at: new Date(), created_at: new Date() }
          );
          const conversationId = conversation.id;

          // Save incoming message to messages table (avoid duplicate wa_msg_id from retried webhooks)
          const existingMsg = waMessageId ? await Messages.exists({ wa_msg_id: waMessageId }) : null;

          if (existingMsg) {
            console.log(`[Webhook] Duplicate message skipped (wa_msg_id: ${waMessageId})`);
          } else {
            const inbound = await Messages.create({
              conversation_id: conversationId, direction: 'inbound', content: text, msg_type: msgType, media_url: mediaUrl,
              wa_msg_id: waMessageId, status: 'delivered', is_ai: false, sent_at: new Date(), is_forwarded: isForwarded,
            });
            const savedRows = [{
              id: inbound.id, direction: inbound.direction, content: inbound.content, type: inbound.msg_type, media_url: inbound.media_url,
              wa_msg_id: inbound.wa_msg_id, status: inbound.status, timestamp: inbound.sent_at, is_forwarded: inbound.is_forwarded,
            }];

            // ── REAL-TIME: push to CRM Inbox immediately ─────────
            // Count only messages that passed the duplicate webhook check.
            await Conversations.updateOne({ id: conversationId }, [{ $set: { unread_count: { $add: [{ $ifNull: ['$unread_count', 0] }, 1] } } }]);

            io.emit('incoming_message', { lead_id: String(lead.id), message: savedRows[0] });
            console.log(`[Webhook] ✅ Saved inbound ${msgType} from ${phone} → lead ${lead.id}, msg_id ${savedRows[0].id}`);

            // ── Forward to n8n for AI auto-reply (only for text/button/interactive/audio) ──
            const shouldTriggerAI = ['text', 'button', 'interactive', 'audio'].includes(msg.type);
            // WF00 continues through its synchronous transcription request.
            // Do not call it again and create a duplicate AI response.
            if (shouldTriggerAI && process.env.N8N_WEBHOOK_URL && req.query.source !== 'n8n') {
              // Clear any existing waiting queue for this lead
              if (aiReplyQueue.has(lead.id)) {
                clearTimeout(aiReplyQueue.get(lead.id));
              }

              // Let the Inbox show a waiting indicator while the AI is in queue
              io.emit('ai_typing', { lead_id: String(lead.id), typing: true, status: 'waiting' });

              // Queue the new message with a 60 second wait period
              const timer = setTimeout(() => {
                aiReplyQueue.delete(lead.id);
                // Update indicator to 'composing' once we actually forward to n8n
                io.emit('ai_typing', { lead_id: String(lead.id), typing: true, status: 'composing' });
                
                axios.post(process.env.N8N_WEBHOOK_URL, {
                  lead_id: lead.id,
                  phone,
                  message: text,
                  phone_number_id: lead.client_phone_number_id || phoneNumberId,
                  wa_access_token: lead.client_wa_token || process.env.META_PAGE_ACCESS_TOKEN
                }).catch(e => console.error('[n8n forward error]', e.message));
              }, 60000); // 60 seconds delay

              aiReplyQueue.set(lead.id, timer);
            }
          }
        }
      }
    }
  } catch (err) {
    console.error('WA webhook error:', err);
  }
});


// ── META LEADS WEBHOOK ────────────────────────────────────

app.get('/webhook/meta-leads', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === process.env.WA_VERIFY_TOKEN) return res.send(challenge);
  res.sendStatus(403);
});

app.post('/webhook/meta-leads', async (req, res) => {
  res.sendStatus(200);
  try {
    const { entry } = req.body;
    for (const e of entry || []) {
      for (const change of e.changes || []) {
        if (change.field !== 'leadgen') continue;
        const leadgenId = change.value.leadgen_id;
        const pageId = change.value.page_id;

        // 1. Lookup dynamic access token and client mapping
        const accountRows = [];
        for (const account of await models.BrandSocialAccounts.find({ $or: [{ facebook_page_id: pageId }, { account_id: pageId }] }, { access_token: 1, brand_name: 1 }).lean()) {
          const pageClient = await Clients.findOne({ name: account.brand_name }, { id: 1 }).lean();
          if (pageClient) { accountRows.push({ access_token: account.access_token, client_id: pageClient.id }); break; }
        }

        if (!accountRows.length || !accountRows[0].access_token) {
          console.error(`[Meta Leads] No access token found for page_id: ${pageId}. Cannot fetch leadgen_id: ${leadgenId}`);
          await FailedWebhooks.create({ page_id: pageId, leadgen_id: leadgenId, payload: change.value, error_message: 'No access token found for this page in database.' });
          continue;
        }

        const { access_token, client_id } = accountRows[0];
        
        let decryptedToken;
        try {
          decryptedToken = cryptoHelper.decrypt(access_token);
        } catch (e) {
          console.error(`[Meta Leads] Failed to decrypt token for page ${pageId}:`, e.message);
          continue;
        }

        // 2. Fetch full lead from Meta
        let metaLead;
        try {
          metaLead = await axios.get(
            `https://graph.facebook.com/v18.0/${leadgenId}`,
            { params: { access_token: decryptedToken } }
          );
        } catch (apiErr) {
          console.error(`[Meta Leads] Graph API Error for leadgen_id ${leadgenId}:`, apiErr.response?.data || apiErr.message);
          await FailedWebhooks.create({
            page_id: pageId, leadgen_id: leadgenId, payload: change.value,
            error_message: apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message,
          });
          continue;
        }

        const fields = {};
        for (const f of metaLead.data.field_data || []) {
          fields[f.name] = f.values[0];
        }

        const name = fields.full_name || fields.name || 'Unknown';
        const phone = (fields.phone_number || fields.phone || '').replace(/\D/g, '');
        const email = fields.email || null;

        if (!phone) continue;

        // 3. Deduplicate using leadgen_id
        const existing = await Leads.exists({ leadgen_id: leadgenId });
        if (existing) {
          console.log(`[Meta Leads] Lead ${leadgenId} already exists. Skipping.`);
          continue;
        }

        // 4. Insert lead properly assigned to client
        let newLead;
        try {
          newLead = (await Leads.create({
            name, phone, email, source: 'Meta Ads', status: 'new', score: 20, client_id: (await getLeadOSBrand()).id,
            leadgen_id: leadgenId, created_at: new Date(),
          })).toObject();
        } catch (insertErr) {
          console.error(`[Meta Leads] Error inserting lead: ${insertErr.message}. Attempting update on conflict.`);
          // Fallback if there is a conflict on (phone, client_id)
          newLead = await Leads.findOneAndUpdate(
            { phone, client_id: (await getLeadOSBrand()).id },
            { $set: { leadgen_id: leadgenId, name, email, source: 'Meta Ads' } },
            { new: true, projection: NO_ID }
          ).lean();
          if (!newLead) continue;
        }

        // Trigger n8n webhook for Meta leads to send welcome template
        if (process.env.N8N_NEW_LEAD_WEBHOOK_URL && newLead) {
          axios.post(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
            lead_id: newLead.id,
            name: newLead.name,
            phone: newLead.phone,
            client_id: newLead.client_id || null,
            phone_number_id: process.env.WA_PHONE_NUMBER_ID,
            wa_access_token: process.env.META_PAGE_ACCESS_TOKEN
          }).catch(e => console.error('[n8n Webhook Error - Meta Lead]', e.message));
        }
      }
    }
  } catch (err) {
    console.error('Meta leads webhook error:', err.message);
  }
});

// ── META PAGE SUBSCRIPTION ──────────────────────────────────
app.post('/api/meta/pages/:page_id/subscribe', auth, async (req, res) => {
  try {
    const { page_id } = req.params;
    
    // 1. Lookup dynamic access token
    const accountRows = await models.BrandSocialAccounts.find(
      { $or: [{ facebook_page_id: page_id }, { account_id: page_id }], access_token: { $ne: null } },
      { _id: 0, access_token: 1 }
    ).limit(1).lean();

    if (!accountRows.length) {
      return res.status(404).json({ error: 'Page access token not found in database. Please reconnect the page.' });
    }

    const { access_token } = accountRows[0];
    
    let decryptedToken;
    try {
      decryptedToken = cryptoHelper.decrypt(access_token);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to decrypt access token' });
    }

    // 2. Exchange system user token for Page Access Token
    const pageTokenRes = await axios.get(
      `https://graph.facebook.com/v18.0/${page_id}`,
      { params: { fields: 'access_token', access_token: decryptedToken } }
    );
    
    if (!pageTokenRes.data.access_token) {
      throw new Error("Could not retrieve Page Access Token using the provided token.");
    }
    
    const pageAccessToken = pageTokenRes.data.access_token;

    // 3. Make subscription call to Meta using Page Access Token
    const metaRes = await axios.post(
      `https://graph.facebook.com/v18.0/${page_id}/subscribed_apps`,
      { subscribed_fields: ['leadgen'] },
      { params: { access_token: pageAccessToken } }
    );

    res.json({ success: true, message: 'Successfully subscribed to page webhooks.', meta_response: metaRes.data });
  } catch (err) {
    console.error('[Meta Webhook Subscription Error]:', err.response?.data || err.message);
    res.status(500).json({ 
      error: 'Failed to subscribe to page webhooks', 
      details: err.response?.data || err.message 
    });
  }
});

// ── RAZORPAY WEBHOOK ──────────────────────────────────────
app.post('/webhook/razorpay', async (req, res) => {
  res.sendStatus(200);
  try {
    if (process.env.RAZORPAY_WEBHOOK_SECRET) {
      const signature = req.headers['x-razorpay-signature'];
      const expected = crypto.createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET).update(req.rawBody).digest('hex');
      if (!signature || signature !== expected) {
        console.warn('[Razorpay webhook] Signature mismatch - rejecting');
        return;
      }
    }

    const event = req.body;
    if (event.event === 'payment.captured') {
      const { amount, notes } = event.payload.payment.entity;
      const leadId = notes?.lead_id;
      const paymentId = event.payload.payment.entity.id;
      if (leadId) {
        await Payments.create({ lead_id: leadId, amount: amount / 100, status: 'captured', razorpay_payment_id: paymentId, created_at: new Date() });
        await Leads.updateOne({ id: leadId }, { $set: { status: 'converted', score: 100 } });

        // Hand off to n8n's WF04 (Customer Journey) - same forwarding pattern as the WhatsApp webhook.
        try {
          // Fetch lead data to pass full context to WF04
          const leadData = await Leads.findOne({ id: leadId }, { _id: 0, id: 1, name: 1, phone: 1, client_id: 1 }).lean() || {};
          const clientData = leadData.client_id
            ? await Clients.findOne({ id: leadData.client_id }, { _id: 0, id: 1, name: 1 }).lean() || {}
            : {};

          await axios.post('https://leados-n8n.abmgroups.org/webhook/payment-success', {
            invoice_id:  paymentId,
            lead_id:     leadId,
            name:        leadData.name   || null,
            phone:       leadData.phone  || null,
            brand_id:    clientData.id   || null,
            brand:       clientData.name || null,
            amount:      amount / 100,
          });
          console.log(`✅ Forwarded payment ${paymentId} to n8n WF04 (lead_id=${leadId})`);
        } catch (n8nErr) {
          console.error('⚠️ Failed to forward payment to n8n WF04:', n8nErr.message);
        }
      }
    }
  } catch (err) {
    console.error('Razorpay webhook error:', err.message);
  }
});

// ══════════════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════════════
app.post('/api/payments/create-link', auth, async (req, res) => {
  try {
    const { lead_id, amount, description } = req.body;
    const lead = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const rzpRes = await axios.post(
      'https://api.razorpay.com/v1/payment_links',
      {
        amount: amount * 100,
        currency: 'INR',
        description,
        customer: { name: lead.name, contact: lead.phone },
        notes: { lead_id: lead_id.toString() },
        callback_url: `${process.env.PORTAL_URL}/payment-success`,
        callback_method: 'get',
      },
      {
        auth: { username: process.env.RAZORPAY_KEY_ID, password: process.env.RAZORPAY_SECRET }
      }
    );

    await Payments.create({ lead_id, amount, status: 'pending', razorpay_link_id: rzpRes.data.id, payment_link: rzpRes.data.short_url, created_at: new Date() });

    res.json({ payment_link: rzpRes.data.short_url, link_id: rzpRes.data.id });
  } catch (err) {
    console.error('Payment link error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

app.get('/api/payments', auth, async (req, res) => {
  try {
    const { lead_id } = req.query;
    const paymentRows = await Payments.find(lead_id ? { lead_id } : {}, NO_ID).sort({ created_at: -1 }).lean();
    const paymentLeads = new Map((await Leads.find({ id: { $in: paymentRows.map((p) => p.lead_id) } }, { id: 1, name: 1 }).lean()).map((l) => [l.id, l.name]));
    const rows = paymentRows.filter((p) => paymentLeads.has(p.lead_id)).map((p) => ({ ...p, lead_name: paymentLeads.get(p.lead_id) }));
    res.json({ payments: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// TEMPLATES
// ══════════════════════════════════════════════════════════
app.get('/api/templates', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const templateRows = await Templates.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const templateClients = new Map((await Clients.find({ id: { $in: templateRows.map((t) => t.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    res.json({ templates: templateRows.map((t) => ({ ...t, brand_name: templateClients.get(t.client_id) ?? null })) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/templates/bulk-scope', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const ids = [...new Set((req.body.template_ids || []).map(Number).filter(Number.isInteger))];
    const scope = String(req.body.template_scope || '').toLowerCase();
    if (!ids.length) return res.status(400).json({ error: 'Select at least one template.' });
    if (!['leados', 'alliance', 'shared'].includes(scope)) {
      return res.status(400).json({ error: 'Workspace must be LeadOS, AllianceOS, or Shared.' });
    }
    const result = await Templates.updateMany({ id: { $in: ids } }, { $set: { template_scope: scope, updated_at: new Date() } });
    res.json({ success: true, updated: result.matchedCount, template_scope: scope });
  } catch (error) {
    console.error('Bulk template workspace update error:', error);
    res.status(500).json({ error: 'Unable to update selected templates.' });
  }
});

app.post('/api/templates/sync-all', auth, async (req, res) => {
  try {
    const { client_id } = req.body;
    const client = client_id ? await Clients.findOne({ id: client_id }, NO_ID).lean() : null;
    const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

    if (!waBusinessId || !waToken) {
      return res.status(400).json({ error: 'Meta Business ID or Access Token is missing' });
    }

    console.log(`[Templates Sync] Fetching from Meta for business account: ${waBusinessId}`);
    
    // Fetch templates from Meta API (limit 100)
    const metaRes = await axios.get(
      `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates?limit=100`,
      { headers: { Authorization: `Bearer ${waToken}` } }
    );

    const metaTemplates = metaRes.data.data || [];
    let imported = 0;
    let updated = 0;

    for (const t of metaTemplates) {
      const bodyComp = t.components?.find(c => c.type === 'BODY') || {};
      const headerComp = t.components?.find(c => c.type === 'HEADER');
      const footerComp = t.components?.find(c => c.type === 'FOOTER');
      const buttonsComp = t.components?.find(c => c.type === 'BUTTONS');

      const bodyText = bodyComp.text || '';
      const headerFormat = headerComp ? (headerComp.format || 'TEXT') : 'NONE';
      const headerText = headerComp ? (headerComp.text || headerComp.example?.header_handle?.[0] || null) : null;
      const footerText = footerComp ? footerComp.text : null;
      const buttonsVal = buttonsComp ? JSON.stringify(buttonsComp.buttons || []) : '[]';

      const status = (t.status || 'DRAFT').toLowerCase();
      const metaId = String(t.id);

      // Check if template exists locally by name and language
      const localTpl = await Templates.findOne({ name: t.name, language: t.language }, { id: 1, status: 1, meta_template_id: 1 }).lean();

      if (localTpl) {
        const approvedAt = (status === 'approved' && !localTpl.approved_at) ? new Date() : localTpl.approved_at;
        await Templates.updateOne({ id: localTpl.id }, { $set: {
          status, meta_template_id: metaId, approved_at: approvedAt ?? null, category: t.category, header_format: headerFormat,
          header: headerText, body: bodyText, footer: footerText, buttons: JSON.parse(buttonsVal), updated_at: new Date(),
        } });
        updated++;
      } else {
        const approvedAt = status === 'approved' ? new Date() : null;
        await Templates.create({
          name: t.name, category: t.category, language: t.language, header_format: headerFormat, header: headerText, body: bodyText,
          footer: footerText, buttons: JSON.parse(buttonsVal), client_id: client_id || null, status, meta_template_id: metaId,
          approved_at: approvedAt, created_at: new Date(),
        });
        imported++;
      }
    }

    res.json({ success: true, imported, updated, total: metaTemplates.length });
  } catch (err) {
    console.error('[Templates Sync Error]', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error?.message || err.message || 'Failed to sync templates from Meta' });
  }
});

app.post('/api/templates', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const { name, category, language, header_format, header, body, footer, buttons, client_id, samples, parameter_definitions = {}, template_scope = 'leados' } = req.body;
    const created = await Templates.create({
      name, category, language: language || 'en', header_format: header_format || 'TEXT', header: header || null, body,
      footer: footer || null, buttons: buttons || [], client_id: client_id || null, status: 'draft', created_at: new Date(),
      samples: samples || [], parameter_definitions,
      template_scope: ['leados', 'alliance', 'shared'].includes(template_scope) ? template_scope : 'leados',
    });
    res.status(201).json({ template: created.toObject() });
  } catch (err) {
    console.error('Create template err:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/:id/submit — submit to Meta for approval
app.post('/api/templates/:id/submit', auth, async (req, res) => {
  try {
    const tpl = await Templates.findOne({ id: req.params.id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const client = tpl.client_id
      ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean()
      : null;

    const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

    // Construct Meta components
    const components = [];
    if (tpl.header_format && tpl.header_format !== 'TEXT' && tpl.header_format !== 'NONE') {
      const comp = { type: 'HEADER', format: tpl.header_format };
      if (tpl.header) comp.example = { header_handle: [tpl.header] };
      components.push(comp);
    } else if (tpl.header) {
      components.push({ type: 'HEADER', format: 'TEXT', text: tpl.header });
    }

    const bodyComp = { type: 'BODY', text: tpl.body };
    if (tpl.samples && Array.isArray(tpl.samples) && tpl.samples.length > 0) {
      bodyComp.example = { body_text: [tpl.samples] };
    }
    components.push(bodyComp);
    if (tpl.footer) components.push({ type: 'FOOTER', text: tpl.footer });
    if (tpl.buttons && tpl.buttons.length > 0) {
      components.push({ type: 'BUTTONS', buttons: tpl.buttons });
    }

    const metaRes = await axios.post(
      `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates`,
      {
        name: tpl.name,
        language: tpl.language || 'en',
        category: tpl.category || 'UTILITY',
        allow_category_change: true,
        components,
      },
      { headers: { Authorization: `Bearer ${waToken}` } }
    );

    await Templates.updateOne({ id: req.params.id }, { $set: { status: 'pending', submitted_at: new Date(), meta_template_id: metaRes.data.id } });

    res.json({ success: true, meta_id: metaRes.data.id });
  } catch (err) {
    console.error('Template submit error:', err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const errMsg = metaErr
      ? `Meta API Error (${metaErr.code}): ${metaErr.message}`
      : err.message || 'Failed to submit template';
    res.status(500).json({ error: errMsg, meta_error: metaErr || null });
  }
});

// POST /api/templates/upload-media — upload sample media to Meta and get a handle
const templateMediaMulter = multer({ dest: 'uploads/temp/' });
app.post('/api/templates/upload-media', auth, templateMediaMulter.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { client_id } = req.body;
  let waToken = process.env.META_PAGE_ACCESS_TOKEN;
  
  try {
    if (client_id && client_id !== 'null' && client_id !== 'undefined') {
      const tokenClient = await Clients.findOne({ id: client_id }, { wa_access_token: 1 }).lean();
      if (tokenClient && tokenClient.wa_access_token) waToken = tokenClient.wa_access_token;
    }

    // 1. Get App ID from the token
    const appRes = await axios.get(`https://graph.facebook.com/v18.0/app?access_token=${waToken}`);
    const appId = appRes.data.id;
    if (!appId) throw new Error('Could not resolve App ID from token');

    // 2. Initialize Resumable Upload Session
    const fileStats = require('fs').statSync(req.file.path);
    const sessionRes = await axios.post(
      `https://graph.facebook.com/v18.0/${appId}/uploads?file_length=${fileStats.size}&file_type=${encodeURIComponent(req.file.mimetype)}`,
      null,
      { headers: { Authorization: `Bearer ${waToken}` } }
    );
    const sessionId = sessionRes.data.id;

    // 3. Upload file data to session
    const fileData = require('fs').readFileSync(req.file.path);
    const uploadRes = await axios.post(
      `https://graph.facebook.com/v18.0/${sessionId}`,
      fileData,
      {
        headers: {
          Authorization: `OAuth ${waToken}`,
          'file_offset': '0',
          'Content-Type': 'application/octet-stream'
        }
      }
    );
    
    // Cleanup local file
    require('fs').unlinkSync(req.file.path);
    
    res.json({ success: true, handle: uploadRes.data.h });
  } catch (err) {
    console.error('Meta Upload Error:', err.response?.data || err.message);
    if (req.file && require('fs').existsSync(req.file.path)) {
      require('fs').unlinkSync(req.file.path);
    }
    const metaErr = err.response?.data?.error;
    res.status(500).json({ 
      error: metaErr ? `Meta Error: ${metaErr.message}` : 'Failed to upload media to Meta'
    });
  }
});

// GET /api/templates/:id/sync — sync status from Meta
app.get('/api/templates/:id/sync', auth, async (req, res) => {
  try {
    const tpl = await Templates.findOne({ id: req.params.id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    const client = tpl.client_id ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean() : null;
    const sharedWaToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    const isAllianceTemplate = ['alliance', 'shared'].includes(String(tpl.template_scope || '').toLowerCase());
    const waToken = isAllianceTemplate ? (sharedWaToken || client?.wa_access_token) : (client?.wa_access_token || sharedWaToken);
    const waBusinessId = isAllianceTemplate ? (process.env.WA_BUSINESS_ACCOUNT_ID || client?.wa_business_id) : (client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID);

    if (!waToken) {
      return res.status(409).json({
        error: 'Meta access token is not configured. Add a client WhatsApp token, META_SYSTEM_USER_ACCESS_TOKEN, or META_PAGE_ACCESS_TOKEN and restart the backend.',
        code: 'META_TOKEN_MISSING',
      });
    }
    if (!tpl.meta_template_id && !waBusinessId) {
      return res.status(409).json({
        error: 'This template has no Meta template ID and no WhatsApp Business Account ID is configured.',
        code: 'META_TEMPLATE_AND_WABA_MISSING',
      });
    }

    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    let metaTpl = null;
    if (tpl.meta_template_id) {
      const metaRes = await axios.get(`${base}/${tpl.meta_template_id}`, {
        params: { fields: 'id,name,status,language,category,components' },
        headers: { Authorization: `Bearer ${waToken}` },
        timeout: 20000,
      });
      metaTpl = metaRes.data;
    } else {
      const metaRes = await axios.get(`${base}/${waBusinessId}/message_templates`, {
        params: { name: tpl.name, limit: 100 },
        headers: { Authorization: `Bearer ${waToken}` },
        timeout: 20000,
      });
      metaTpl = (metaRes.data?.data || []).find(
        (item) => item.name === tpl.name && item.language === (tpl.language || 'en')
      );
    }

    if (metaTpl) {
      const status = metaTpl.status.toLowerCase();
      const bodyComp = metaTpl.components?.find((component) => component.type === 'BODY') || {};
      const headerComp = metaTpl.components?.find((component) => component.type === 'HEADER');
      const footerComp = metaTpl.components?.find((component) => component.type === 'FOOTER');
      const buttonsComp = metaTpl.components?.find((component) => component.type === 'BUTTONS');
      const syncedTemplate = await Templates.findOneAndUpdate(
        { id: tpl.id },
        [{ $set: {
          status, meta_template_id: metaTpl.id,
          approved_at: status === 'approved' ? { $ifNull: ['$approved_at', '$$NOW'] } : '$approved_at',
          category: metaTpl.category ?? null, header_format: headerComp?.format || 'NONE',
          header: headerComp?.text || headerComp?.example?.header_handle?.[0] || null,
          body: bodyComp.text || '', footer: footerComp?.text || null, buttons: { $literal: buttonsComp?.buttons || [] }, updated_at: '$$NOW',
        } }],
        { new: true, projection: NO_ID }
      ).lean();
      return res.json({ template: syncedTemplate });
    }

    return res.status(404).json({
      error: `Meta did not return template "${tpl.name}" (${tpl.language || 'en'}) for the configured WhatsApp Business Account. Verify its WABA, language, and Meta template ID.`,
      code: 'META_TEMPLATE_NOT_FOUND',
    });
  } catch (err) {
    const metaError = err.response?.data?.error;
    const message = metaError
      ? `Meta API error${metaError.code ? ` (${metaError.code})` : ''}: ${metaError.message}`
      : err.code === 'ECONNABORTED'
        ? 'Meta status check timed out. Please try again.'
        : err.message || 'Failed to sync template status.';
    console.error('Template sync error:', metaError || err.message);
    // Do not return 401 here: that status is reserved for the LeadOS login
    // session and would incorrectly log the administrator out.
    const status = err.response?.status >= 400 && err.response?.status < 500 ? 502 : 500;
    res.status(status).json({ error: message, code: metaError?.code || err.code || 'TEMPLATE_SYNC_FAILED' });
  }
});

// PUT /api/templates/:id
app.put('/api/templates/:id', auth, async (req, res) => {
  try {
    await templateParameterDefinitionsReady;
    const { name, category, language, header_format, header, body, footer, buttons, client_id, samples, parameter_definitions, template_scope } = req.body;
    const { id } = req.params;

    const current = await Templates.findOne({ id }, NO_ID).lean();
    if (!current) return res.status(404).json({ error: 'Template not found' });

    // Build components for Meta
    const components = [];
    const finalHeaderFmt = header_format !== undefined ? header_format : current.header_format;
    const finalHeader = header !== undefined ? header : current.header;

    if (finalHeaderFmt && finalHeaderFmt !== 'TEXT' && finalHeaderFmt !== 'NONE') {
      const comp = { type: 'HEADER', format: finalHeaderFmt };
      if (finalHeader) comp.example = { header_handle: [finalHeader] };
      components.push(comp);
    } else if (finalHeader) {
      components.push({ type: 'HEADER', format: 'TEXT', text: finalHeader });
    }

    const bodyComp = { type: 'BODY', text: body || current.body };
    const finalSamples = samples !== undefined ? samples : current.samples;
    if (finalSamples && Array.isArray(finalSamples) && finalSamples.length > 0) {
      bodyComp.example = { body_text: [finalSamples] };
    }
    components.push(bodyComp);

    if (footer !== undefined ? footer : current.footer) components.push({ type: 'FOOTER', text: footer !== undefined ? footer : current.footer });
    const finalBtns = buttons !== undefined ? buttons : current.buttons;
    if (finalBtns && finalBtns.length > 0) {
      components.push({ type: 'BUTTONS', buttons: finalBtns });
    }

    if (current.status !== 'draft' && current.meta_template_id) {
      const client = current.client_id ? await Clients.findOne({ id: current.client_id }, NO_ID).lean() : null;
      const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

      await axios.post(
        `https://graph.facebook.com/v18.0/${current.meta_template_id}`,
        { components },
        { headers: { Authorization: `Bearer ${waToken}` } }
      );
    }

    const changes = {
      header: header !== undefined ? header : (current.header ?? null),
      footer: footer !== undefined ? footer : (current.footer ?? null),
      status: current.status !== 'draft' && current.status != null ? 'pending' : current.status,
      updated_at: new Date(),
    };
    if (name != null) changes.name = name;
    if (category != null) changes.category = category;
    if (language != null) changes.language = language;
    if (header_format != null) changes.header_format = header_format;
    if (body != null) changes.body = body;
    if (buttons) changes.buttons = buttons;
    if (client_id) changes.client_id = client_id;
    if (samples) changes.samples = samples;
    if (parameter_definitions) changes.parameter_definitions = parameter_definitions;
    if (['leados', 'alliance', 'shared'].includes(template_scope)) changes.template_scope = template_scope;
    const updatedTemplate = await Templates.findOneAndUpdate({ id }, { $set: changes }, { new: true, projection: NO_ID }).lean();

    res.json({ template: updatedTemplate || undefined });
  } catch (err) {
    console.error('Template update error:', err.response?.data || err.message);
    const metaErr = err.response?.data?.error;
    const errMsg = metaErr
      ? `Meta API Error (${metaErr.code}): ${metaErr.message}`
      : err.message || 'Failed to update template';
    res.status(500).json({ error: errMsg, meta_error: metaErr || null });
  }
});

// DELETE /api/templates/:id
app.delete('/api/templates/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const tpl = await Templates.findOne({ id }, NO_ID).lean();
    if (!tpl) return res.status(404).json({ error: 'Template not found' });

    if (tpl.status !== 'draft') {
      const client = tpl.client_id ? await Clients.findOne({ id: tpl.client_id }, NO_ID).lean() : null;
      const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
      const waBusinessId = client?.wa_business_id || process.env.WA_BUSINESS_ACCOUNT_ID;

      try {
        await axios.delete(
          `https://graph.facebook.com/v18.0/${waBusinessId}/message_templates`,
          {
            params: { name: tpl.name },
            headers: { Authorization: `Bearer ${waToken}` }
          }
        );
      } catch (metaErr) {
        console.error('Meta template delete error:', metaErr.response?.data || metaErr.message);
      }
    }

    await deleteCascade('templates', { id });
    res.json({ success: true });
  } catch (err) {
    console.error('Template delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// CLIENTS
// ══════════════════════════════════════════════════════════
app.get('/api/meta/embedded-signup/config', auth, (req, res) => {
  const appId = process.env.META_APP_ID || '';
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || '';
  res.json({ enabled: Boolean(appId && configId), app_id: appId, config_id: configId,
    waba_id: process.env.WA_BUSINESS_ACCOUNT_ID || '', graph_version: META_GRAPH_VERSION });
});

app.post('/api/clients/:id/meta-embedded-signup/complete', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const { waba_id: wabaId, phone_number_id: phoneId, expected_whatsapp_number: expectedNumber,
      name, wa_category: waCategory, wa_description: waDescription } = req.body;
    if (!wabaId || !phoneId) return res.status(400).json({ error: 'Meta did not return a WABA ID and Phone Number ID' });
    const configuredWaba = process.env.WA_BUSINESS_ACCOUNT_ID;
    if (configuredWaba && String(wabaId) !== String(configuredWaba)) {
      return res.status(400).json({ error: `Select WABA ${configuredWaba} in Meta Embedded Signup` });
    }
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: 'META_PAGE_ACCESS_TOKEN is not configured' });
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const phones = await graphPageData(`${base}/${wabaId}/phone_numbers`, token, {
      fields: 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,status'
    });
    const phone = phones.find(item => String(item.id) === String(phoneId));
    if (!phone) return res.status(400).json({ error: 'The new phone number is not accessible under the selected WABA' });
    if (expectedNumber && normalizedPhoneDigits(phone.display_phone_number) !== normalizedPhoneDigits(expectedNumber)) {
      return res.status(400).json({ error: 'The number verified in Meta does not match the number entered in LeadOS' });
    }
    const duplicate = await Clients.findOne({ phone_number_id: phoneId, id: { $ne: Number(req.params.id) } }, { id: 1, name: 1 }).lean();
    if (duplicate) return res.status(409).json({ error: `This phone is already assigned to ${duplicate.name}` });
    const connected = String(phone.status || '').toUpperCase() === 'CONNECTED';
    const previousClient = await Clients.findOne({ id: req.params.id }, { name: 1 }).lean();
    const clientChanges = {
      wa_business_id: wabaId, phone_number_id: phoneId, whatsapp_number: normalizedPhoneDigits(phone.display_phone_number),
      whatsapp_status: connected ? 'verified' : 'verification_pending', whatsapp_verified_at: connected ? new Date() : null,
      wa_description: waDescription || null, whatsapp_verification_error: null, updated_at: new Date(),
    };
    if (String(name ?? '').trim()) clientChanges.name = name;
    if (waCategory) clientChanges.wa_category = waCategory;
    const updatedClient = await Clients.findOneAndUpdate({ id: req.params.id }, { $set: clientChanges }, { new: true, projection: NO_ID }).lean();
    const updated = { rows: updatedClient ? [updatedClient] : [] };
    if (!updated.rows.length) return res.status(404).json({ error: 'Client not found' });
    if (previousClient && clientChanges.name) await updateKeyCascade('clients', 'name', previousClient.name, clientChanges.name);
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phoneId }, { $set: { client_id: Number(req.params.id) } });
    let profileSynced = false;
    try {
      await updateWhatsAppBusinessProfile(updated.rows[0]);
      profileSynced = true;
    } catch (profileError) {
      console.warn(`[Clients] New Meta phone mapped but profile sync is pending for client ${req.params.id}:`, profileError.response?.data?.error?.message || profileError.message);
    }
    res.json({ success: true, client: updated.rows[0], meta_phone: phone, profile_synced: profileSynced });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Embedded Signup completion failed';
    console.error(`[Clients] Embedded Signup completion failed for client ${req.params.id}:`, message);
    res.status(400).json({ error: message });
  }
});

app.post('/api/clients/:id/meta-profile-logo', auth, profileLogoUpload.single('logo'), async (req, res) => {
  try {
    await metaInventoryReady;
    if (!req.file) return res.status(400).json({ error: 'Select a JPEG or PNG logo image' });
    if (!process.env.META_APP_ID) {
      return res.status(503).json({ error: 'META_APP_ID is required in server/.env to upload a Meta profile logo' });
    }
    const client = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.phone_number_id) {
      return res.status(400).json({ error: 'Add this brand’s real Meta Phone Number ID before uploading its profile logo' });
    }
    const config = await assertPhoneBelongsToWaba(client);
    const duplicatePhone = await Clients.findOne({ phone_number_id: config.phoneId, id: { $ne: client.id } }, { id: 1, name: 1 }).lean();
    if (duplicatePhone) {
      return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.name}` });
    }

    const image = await Jimp.read(req.file.buffer);
    const logoBuffer = await image.cover(640, 640).quality(90).getBufferAsync(Jimp.MIME_JPEG);
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const sessionResponse = await axios.post(`${base}/${process.env.META_APP_ID}/uploads`, null, {
      params: { file_name: `client-${client.id}-logo.jpg`, file_length: logoBuffer.length, file_type: 'image/jpeg' },
      headers: { Authorization: `Bearer ${config.token}` }
    });
    const uploadId = sessionResponse.data?.id;
    if (!uploadId) throw new Error('Meta did not return an upload session ID');
    const uploadResponse = await axios.post(`${base}/${uploadId}`, logoBuffer, {
      headers: { Authorization: `Bearer ${config.token}`, file_offset: '0', 'Content-Type': 'image/jpeg' },
      maxBodyLength: 6 * 1024 * 1024
    });
    const handle = uploadResponse.data?.h;
    if (!handle) throw new Error('Meta did not return a profile-picture handle');
    await axios.post(`${base}/${config.phoneId}/whatsapp_business_profile`, {
      messaging_product: 'whatsapp', profile_picture_handle: handle
    }, { headers: { Authorization: `Bearer ${config.token}` } });
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: config.phoneId }, { $set: { client_id: client.id } });
    const profile = await cacheMetaBusinessProfile(config.phoneId, config.token);
    res.json({ success: true, profile_picture_url: profile.profile_picture_url || null });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Meta logo upload failed';
    console.error(`[Clients] Meta logo upload failed for client ${req.params.id}:`, message);
    res.status(400).json({ error: `Meta logo upload failed: ${message}` });
  }
});

app.get('/api/meta/whatsapp/inventory', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const [accounts, phoneRows, templates, lastRun, inventoryClients] = await Promise.all([
      MetaWhatsappAccounts.find({}, NO_ID).sort({ name: 1 }).lean(),
      MetaWhatsappPhoneNumbers.find({}, NO_ID).lean(),
      MetaWhatsappTemplates.find({}, { _id: 0, template_id: 1, waba_id: 1, name: 1, language: 1, status: 1, category: 1, components: 1, last_synced_at: 1 }).sort({ name: 1, language: 1 }).lean(),
      MetaWhatsappSyncRuns.findOne({}, NO_ID).sort({ id: -1 }).lean(),
      Clients.find({}, { id: 1, name: 1 }).lean(),
    ]);
    const accountNames = new Map(accounts.map((a) => [a.waba_id, a.name]));
    const clientNames = new Map(inventoryClients.map((c) => [c.id, c.name]));
    const wabas = accounts.map((a) => ({ ...a, phone_count: phoneRows.filter((p) => p.waba_id === a.waba_id).length }));
    const phones = phoneRows
      .filter((p) => accountNames.has(p.waba_id))
      .map((p) => ({ ...p, waba_name: accountNames.get(p.waba_id), client_name: clientNames.get(p.client_id) ?? null }))
      .sort((a, b) => (a.client_id == null ? -1 : 0) - (b.client_id == null ? -1 : 0)
        || (a.client_id ?? 0) - (b.client_id ?? 0)
        || String(a.verified_name || '').localeCompare(String(b.verified_name || '')));
    const summary = new Map();
    for (const t of templates) {
      const s = summary.get(t.waba_id) || { waba_id: t.waba_id, total: 0, approved: 0, other: 0 };
      s.total++;
      if (t.status === 'APPROVED') s.approved++; else if (t.status != null) s.other++;
      summary.set(t.waba_id, s);
    }
    res.json({ wabas, phone_numbers: phones, templates, template_summary: [...summary.values()], last_sync: lastRun || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/meta/whatsapp/sync', auth, async (req, res) => {
  try { res.json({ success: true, ...(await syncMetaWhatsAppInventory()) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/meta/whatsapp/cache/wabas/:wabaId', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const account = await MetaWhatsappAccounts.findOne({ waba_id: req.params.wabaId }, { _id: 0, waba_id: 1, name: 1 }).lean();
    if (!account) {
      return res.status(404).json({ error: 'Cached WABA not found' });
    }
    const mappedPhones = await MetaWhatsappPhoneNumbers.find({ waba_id: req.params.wabaId, client_id: { $ne: null } }, { client_id: 1 }).lean();
    const mappedClient = mappedPhones.length
      ? await Clients.findOne({ id: { $in: mappedPhones.map((p) => p.client_id) } }, { name: 1 }).lean()
      : null;
    if (mappedClient) {
      return res.status(409).json({
        error: `Cannot clear this cache because a phone number is mapped to ${mappedClient.name}`
      });
    }
    await deleteCascade('meta_whatsapp_templates', { waba_id: req.params.wabaId });
    await deleteCascade('meta_whatsapp_accounts', { waba_id: req.params.wabaId });
    res.json({ success: true, waba_id: account.waba_id, name: account.name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/meta/whatsapp/phone-numbers/:phoneId/register', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit two-step verification PIN' });
    const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, { _id: 0, phone_number_id: 1, waba_id: 1 }).lean();
    if (!phone) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
    const token = process.env.META_SYSTEM_USER_ACCESS_TOKEN || process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) return res.status(503).json({ error: 'Meta system-user access token is not configured' });
    const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
    const currentPhones = await graphPageData(`${base}/${phone.waba_id}/phone_numbers`, token, { fields: 'id' });
    if (!currentPhones.some(item => String(item.id) === String(phone.phone_number_id))) {
      return res.status(409).json({ error: `Phone Number ID does not belong to WABA ${phone.waba_id}` });
    }
    await axios.post(`${base}/${phone.phone_number_id}/register`, {
      messaging_product: 'whatsapp', pin,
    }, { headers: { Authorization: `Bearer ${token}` } });
    await axios.post(`${base}/${phone.waba_id}/subscribed_apps`, null, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const syncResult = await syncMetaWhatsAppInventory();
    res.json({ success: true, phone_number_id: phone.phone_number_id, waba_id: phone.waba_id, ...syncResult });
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message || 'Meta phone registration failed';
    console.error('[Meta Phone Registration]', message);
    res.status(400).json({ error: message });
  }
});

app.patch('/api/meta/whatsapp/phone-numbers/:phoneId/map', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { client_id } = req.body;
    const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: req.params.phoneId }, NO_ID).lean();
    if (!phone) return res.status(404).json({ error: 'Meta phone number not found' });
    if (client_id === null || client_id === undefined || client_id === '') {
      await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: req.params.phoneId }, { $set: { client_id: null } });
      return res.json({ success: true });
    }
    const clientId = Number(client_id);
    if (!(await Clients.exists({ id: clientId }))) return res.status(404).json({ error: 'Brand not found' });
    await MetaWhatsappPhoneNumbers.updateMany({ client_id: clientId }, { $set: { client_id: null } });
    await MetaWhatsappPhoneNumbers.updateOne({ phone_number_id: phone.phone_number_id }, { $set: { client_id: clientId } });
    const metaVerified = String(phone.connection_status || '').toUpperCase() === 'CONNECTED' || String(phone.verification_status || '').toUpperCase() === 'VERIFIED';
    await Clients.updateOne({ id: clientId }, { $set: {
      wa_business_id: phone.waba_id, phone_number_id: phone.phone_number_id, whatsapp_number: phone.display_phone_number,
      whatsapp_status: metaVerified ? 'verified' : 'verification_pending', whatsapp_verified_at: metaVerified ? new Date() : null,
      whatsapp_verification_error: null, updated_at: new Date(),
    } });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/clients', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { tenant_id } = req.query;
    const clientRows = await Clients.find(tenant_id ? { tenant_id: Number(tenant_id) } : {}, NO_ID).sort({ created_at: -1 }).lean();
    const clientIds = clientRows.map((c) => c.id);
    const [metaPhones, leadCounts] = await Promise.all([
      MetaWhatsappPhoneNumbers.find({ client_id: { $in: clientIds } }, NO_ID).lean(),
      Leads.aggregate([
        { $match: { client_id: { $in: clientIds } } },
        { $group: { _id: '$client_id', lead_count: { $sum: 1 }, converted_count: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } } } },
      ]),
    ]);
    const countsByClient = new Map(leadCounts.map((c) => [c._id, c]));
    const rows = [];
    for (const c of clientRows) {
      const phonesForClient = metaPhones.filter((p) => p.client_id === c.id);
      for (const metaPhone of phonesForClient.length ? phonesForClient : [null]) {
        rows.push({
          ...c,
          meta_profile_picture_url: metaPhone?.profile_picture_url ?? null,
          meta_verified_name: metaPhone?.verified_name ?? null,
          meta_profile_about: metaPhone?.profile_about ?? null,
          meta_profile_address: metaPhone?.profile_address ?? c.wa_address ?? null,
          meta_profile_description: metaPhone?.profile_description ?? c.wa_description ?? null,
          meta_profile_email: metaPhone?.profile_email ?? c.wa_email ?? null,
          meta_profile_websites: metaPhone?.profile_websites ?? (c.wa_website != null ? [c.wa_website] : null),
          meta_profile_vertical: metaPhone?.profile_vertical ?? c.wa_category ?? null,
          meta_quality_rating: metaPhone?.quality_rating ?? null,
          meta_connection_status: metaPhone?.connection_status ?? null,
          lead_count: countsByClient.get(c.id)?.lead_count || 0,
          converted_count: countsByClient.get(c.id)?.converted_count || 0,
        });
      }
    }
    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const { name, wa_category, wa_description, wa_address, wa_email, wa_website, tenant_id } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Business name is required' });
    const created = await Clients.create({
      name: name.trim(), wa_category: wa_category || 'OTHER', wa_description: wa_description || null, wa_address: wa_address || null,
      wa_email: wa_email || null, wa_website: wa_website || null, status: 'active', whatsapp_status: 'not_configured',
      tenant_id: tenant_id || DEFAULT_TENANT_ID, created_at: new Date(),
    });
    res.status(201).json({ client: created.toObject() });
  } catch (err) {
    console.error('[Clients] POST /api/clients failed:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.patch('/api/clients/:id', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    if (req.body.whatsapp_number !== undefined && String(req.body.whatsapp_number).trim()) {
      const rawPhone = String(req.body.whatsapp_number).trim();
      const parsedPhone = parsePhoneNumberFromString(rawPhone.startsWith('+') ? rawPhone : `+${rawPhone}`);
      if (!/^\+?[\d\s().-]+$/.test(rawPhone) || !parsedPhone?.isValid()) {
        return res.status(400).json({ error: 'Enter a valid WhatsApp number with country calling code, for example +91 98765 43210' });
      }
      req.body.whatsapp_number = parsedPhone.number.slice(1);
    }
    const existing = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!existing) return res.status(404).json({ error: 'Client not found' });

    const allowed = ['name', 'phone_number_id', 'wa_access_token',
      'wa_business_id', 'whatsapp_number', 'wa_category', 'wa_description', 'wa_address', 'wa_email',
      'wa_website', 'status'];
    const entries = allowed.filter(field => req.body[field] !== undefined).map(field => [field, req.body[field]]);
    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }
    if (!entries.length) return res.json({ success: true, client: existing });

    const credentialFields = ['phone_number_id', 'wa_access_token', 'wa_business_id', 'whatsapp_number'];
    const credentialsChanged = credentialFields.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    const next = { ...existing, ...Object.fromEntries(entries) };
    const nextMetaConfig = resolveClientMetaConfig(next);
    const metaProfileChanged = META_PROFILE_FIELDS.some(field =>
      req.body[field] !== undefined && String(req.body[field] || '') !== String(existing[field] || '')
    );
    let metaProfile = null;
    if (metaProfileChanged && nextMetaConfig.phoneId) {
      try {
        const duplicatePhone = await Clients.findOne({ phone_number_id: nextMetaConfig.phoneId, id: { $ne: Number(req.params.id) } }, { id: 1, name: 1 }).lean();
        if (duplicatePhone) {
          return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.name}` });
        }
        const metaResult = await updateWhatsAppBusinessProfile(next);
        metaProfile = metaResult.profile;
      } catch (metaError) {
        const message = metaError.response?.data?.error?.message || metaError.message || 'Meta profile update failed';
        console.error(`[Clients] Meta profile update failed for client ${req.params.id}:`, message);
        return res.status(400).json({ error: `Meta profile update failed: ${message}` });
      }
    }
    const hasRequiredCredentials = nextMetaConfig.phoneId && nextMetaConfig.token && next.whatsapp_number;
    if (credentialsChanged) {
      entries.push(['whatsapp_status', hasRequiredCredentials ? 'verification_pending' : 'not_configured']);
      entries.push(['whatsapp_verified_at', null]);
      entries.push(['whatsapp_verification_error', null]);
    }
    const clientChanges = Object.fromEntries(entries.map(([field, value]) => [field, value === '' ? null : value]));
    const updatedClient = await Clients.findOneAndUpdate(
      { id: req.params.id },
      { $set: { ...clientChanges, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    if (clientChanges.name !== undefined && clientChanges.name !== existing.name) {
      await updateKeyCascade('clients', 'name', existing.name, clientChanges.name);
    }
    res.json({
      success: true,
      client: updatedClient,
      meta_profile_synced: Boolean(metaProfile),
      meta_profile_pending: metaProfileChanged && !nextMetaConfig.phoneId,
      meta_profile: metaProfile
    });
  } catch (err) {
    console.error(`[Clients] PATCH /api/clients/${req.params.id} failed:`, err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const client = await Clients.findOne({ id }, NO_ID).lean();
    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Deregister from Meta WhatsApp Cloud API
    if (client.phone_number_id && client.wa_access_token) {
      try {
        await axios.post(
          `https://graph.facebook.com/v19.0/${client.phone_number_id}/deregister`,
          {},
          { headers: { Authorization: `Bearer ${client.wa_access_token}` } }
        );
        console.log(`[Meta] Successfully deregistered phone_number_id: ${client.phone_number_id}`);
      } catch (metaErr) {
        // Log but do not block local DB deletion
        console.warn(`[Meta] Deregistration failed for client ${id}:`, metaErr.response?.data || metaErr.message);
      }
    }

    await deleteCascade('clients', { id: client.id });

    res.json({ success: true, message: 'Client deleted and deregistered successfully' });
  } catch (err) {
    console.error(`[Delete Client API] Error deleting client ${req.params.id}:`, err);
    res.status(500).json({ error: 'Server error during deletion' });
  }
});

// POST /api/clients/:id/whatsapp-setup
app.post('/api/clients/:id/whatsapp-setup', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const client = await Clients.findOne({ id: req.params.id }, NO_ID).lean();
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const metaConfig = resolveClientMetaConfig(client);
    if (!metaConfig.phoneId || !metaConfig.token || !metaConfig.wabaId || !client.whatsapp_number) {
      return res.status(400).json({ error: 'Real WhatsApp number and its Meta Phone Number ID are required before verification' });
    }

    await Clients.updateOne({ id: client.id }, { $set: { whatsapp_status: 'verification_pending', whatsapp_verified_at: null, whatsapp_verification_error: null } });

    const ownership = await assertPhoneBelongsToWaba(client);
    const phoneResponse = { data: ownership.phone };
    const savedDigits = String(client.whatsapp_number).replace(/\D/g, '');
    const metaDigits = String(phoneResponse.data?.display_phone_number || '').replace(/\D/g, '');
    if (!metaDigits || (savedDigits !== metaDigits && !savedDigits.endsWith(metaDigits) && !metaDigits.endsWith(savedDigits))) {
      throw new Error('The WhatsApp number does not match the supplied Meta Phone Number ID');
    }

    // 1. Update Business Profile
    try {
      await updateWhatsAppBusinessProfile(client);
    } catch (profileError) {
      // Profile fields are optional and must not invalidate ownership/registration.
      console.warn('[WhatsApp Profile Update]', profileError.response?.data || profileError.message);
    }

    // 2. Register only assets that Meta has not already connected.
    if (String(ownership.phone.status || '').toUpperCase() !== 'CONNECTED') {
      if (!process.env.WA_REGISTRATION_PIN) {
        throw new Error('WA_REGISTRATION_PIN is required to register this phone number with Cloud API');
      }
      await axios.post(
        `https://graph.facebook.com/${META_GRAPH_VERSION}/${metaConfig.phoneId}/register`,
        { messaging_product: 'whatsapp', pin: process.env.WA_REGISTRATION_PIN },
        { headers: { Authorization: `Bearer ${metaConfig.token}` } }
      );
    }

    const verified = await Clients.findOneAndUpdate(
      { id: client.id },
      { $set: { whatsapp_status: 'verified', whatsapp_verified_at: new Date(), whatsapp_verification_error: null, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    res.json({ success: true, message: 'WhatsApp verified and enabled successfully', client: verified });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message || 'WhatsApp verification failed';
    await Clients.updateOne(
      { id: req.params.id },
      { $set: { whatsapp_status: 'verification_failed', whatsapp_verified_at: null, whatsapp_verification_error: message, updated_at: new Date() } }
    ).catch(() => {});
    console.error('[WhatsApp Verification]', err.response?.data || err);
    res.status(400).json({ error: message });
  }
});

// ══════════════════════════════════════════════════════════
// AI BRAIN (brain_docs table)
// ══════════════════════════════════════════════════════════
app.get('/api/brain', auth, async (req, res) => {
  try {
    const { client_id } = req.query;
    const rows = client_id
      ? await BrainDocs.find({ client_id }, NO_ID).sort({ doc_type: 1 }).lean()
      : await BrainDocs.find({}, NO_ID).sort({ client_id: 1, doc_type: 1 }).lean();
    res.json({ docs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain', auth, async (req, res) => {
  try {
    const { client_id, doc_type, content } = req.body;
    const doc = await upsertOne(
      BrainDocs,
      { client_id, doc_type },
      { $set: { content, updated_at: new Date() } },
      { client_id, doc_type, content, updated_at: new Date() }
    );
    res.json({ doc });
  } catch (err) {
    console.error('Brain Doc Save Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── LEADS IMPORT ──────────────────────────────────────────
const upload = multer({ dest: 'uploads/' });

app.post('/api/leads/import', auth, upload.single('file'), async (req, res) => {
  try {
    const { client_id } = req.body;
    const leadOSBrand = await getLeadOSBrand();
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    const isCampaignBatch = String(req.body.force_source || '').startsWith('csv_');

    if (isCampaignBatch && req.body.template_id) {
      const importTemplate = await Templates.findOne({ id: req.body.template_id }, { _id: 0, body: 1, header: 1 }).lean();
      const templateResult = { rows: importTemplate ? [importTemplate] : [] };
      if (!templateResult.rows.length) return res.status(400).json({ error: 'Selected template was not found.' });
      let requestedMappings = {};
      try {
        requestedMappings = req.body.template_parameters ? JSON.parse(req.body.template_parameters) : {};
      } catch { requestedMappings = {}; }
      const isExcelSourced = (section, number) => {
        const mapping = requestedMappings?.[section]?.[String(number)];
        // No mapping info supplied (older client) — fall back to requiring every column.
        return !requestedMappings || Object.keys(requestedMappings).length === 0 || mapping?.source === 'excel_parameter';
      };
      const requiredColumns = [
        ...getTemplateVariableNumbers(templateResult.rows[0].header)
          .filter((number) => isExcelSourced('header', number))
          .map((number) => `Header {{${number}}}`),
        ...getTemplateVariableNumbers(templateResult.rows[0].body)
          .filter((number) => isExcelSourced('body', number))
          .map((number) => `Body {{${number}}}`),
      ];
      const headerRow = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, blankrows: false })[0] || [];
      const availableColumns = new Set(headerRow.map((value) => String(value).trim().toLowerCase()));
      const hasParameterColumn = (column) => {
        const prefix = column.toLowerCase();
        return [...availableColumns].some((available) => available === prefix || available.startsWith(`${prefix} - `));
      };
      const missingColumns = requiredColumns.filter((column) => !hasParameterColumn(column));
      if (missingColumns.length) {
        return res.status(400).json({ error: `Excel sheet is missing required columns: ${missingColumns.join(', ')}. Download the sheet for the selected template and keep its headings unchanged.` });
      }
      const incompleteRow = results.findIndex((row) => requiredColumns.some((column) => {
        const actualKey = Object.keys(row).find((key) => key.toLowerCase() === column.toLowerCase() || key.toLowerCase().startsWith(`${column.toLowerCase()} - `));
        return !actualKey || !String(row[actualKey] ?? '').trim();
      }));
      if (incompleteRow !== -1) {
        return res.status(400).json({ error: `Excel row ${incompleteRow + 2} has an empty template parameter. Fill every ${requiredColumns.join(', ')} value.` });
      }
    }

    const [importClients, importUsers] = await Promise.all([
      Clients.find({}, { _id: 0, id: 1, name: 1 }).lean(),
      Users.find({}, { _id: 0, id: 1, name: 1, email: 1 }).lean(),
    ]);
    const clientsMap = Object.fromEntries(
      importClients.filter((client) => client.name).map((client) => [client.name.toLowerCase(), client.id])
    );
    const usersMap = {};
    importUsers.forEach((user) => {
      if (user.name) usersMap[user.name.toLowerCase()] = user.id;
      if (user.email) usersMap[user.email.toLowerCase()] = user.id;
    });

    // Process each row
    let imported = 0;
    let inserted = 0;
    let existing = 0;
    let duplicateRows = 0;
    let failed = 0;
    const importErrors = [];
    const seenPhones = new Set();

    console.log(`[Campaign Import] Starting - isCampaignBatch: ${isCampaignBatch}, force_source: ${req.body.force_source}, client_id: ${client_id}`);

    for (const row of results) {
      try {
        const name = row.name || row.Name || row['First Name'] || 'Unknown';

        let phone = row.phone || row.Phone || row.whatsapp || row['Phone Number'] || row['phone number'] || '';
        let countryCode = row.country_code || row['country code'] || row['Country Code'] || '';

        // Excel may display large phone numbers in scientific notation, while
        // XLSX still gives us the correct raw numeric value. A cell stored as a
        // literal "9.195E+11" has already lost digits, so reject it rather than
        // risk messaging the wrong number.
        const phoneText = phone.toString().replace(/=/g, '').replace(/"/g, '').trim();
        if (/^\d+(?:\.\d+)?e\+\d+$/i.test(phoneText)) {
          phone = '';
        } else {
          phone = phoneText;
        }
        phone = phone.replace(/\D/g, '');
        countryCode = countryCode.toString().replace(/\D/g, '');

        if (countryCode && !phone.startsWith(countryCode)) {
          phone = countryCode + phone;
        }

        const status = req.body.force_status || (row.status || row.Status || 'new').toLowerCase();
        // Campaign imports use force_source as an internal recipient batch ID;
        // expose their actual lead source consistently as XLS Sheet.
        const source = isCampaignBatch
          ? 'XLS Sheet'
          : (req.body.force_source || row.source || row.Source || 'XLS Sheet');
        const score = parseInt(row.score || row.Score) || 0;
        const interest = row.interest || row.Interest || null;

        // Brand
        const rowClientId = leadOSBrand.id;

        // Assigned To
        let assignedTo = null;
        const assignedName = row.assigned || row.Assigned || row.assigned_to;
        if (assignedName && usersMap[assignedName.toLowerCase()]) {
          assignedTo = usersMap[assignedName.toLowerCase()];
        }

        // Last Contact
        let lastContact = null;
        const lc = row.last_contact || row['Last Contact'] || row.lastContact;
        if (lc) {
          const parsed = new Date(lc);
          if (!isNaN(parsed.getTime())) lastContact = parsed.toISOString();
        }

        const email = row.email || row.Email || null;

        if ((!phone && !email) || (phone && (phone.length < 10 || phone.length > 15))) {
          failed++;
          if (importErrors.length < 20) {
            importErrors.push({
              row: imported + duplicateRows + failed + 1,
              name,
              phone: phoneText,
              error: phoneText
                ? 'Phone number must contain 10 to 15 digits'
                : 'Phone number is missing or stored as unsafe scientific-notation text',
            });
          }
          continue;
        }

        const phoneDigits = phone ? phone.replace(/\D/g, '').slice(-10) : '';
        if (phoneDigits && seenPhones.has(phoneDigits)) {
          duplicateRows++;
          continue;
        }
        if (phoneDigits) seenPhones.add(phoneDigits);

        // Check for existing lead by email or 10-digit phone
        let existingLead = null;
        if (phoneDigits || email) {
           if (phoneDigits) {
             existingLead = await Leads.findOne({ phone: phoneTailRegex(phoneDigits) }, { _id: 0, id: 1 }).lean();
           } else if (email != null) {
             existingLead = await Leads.findOne({ email: ieq(email) }, { _id: 0, id: 1 }).lean();
           }
        }

        let importedLeadId;
        const isCampaignImport = isCampaignBatch;

        if (existingLead) {
          importedLeadId = existingLead.id;
          existing++;
          if (!isCampaignImport) {
            // Normal CRM imports may refresh an existing lead. A campaign list
            // only references it and must not alter its CRM fields.
            const importChanges = { updated_at: new Date() };
            for (const [field, value] of Object.entries({ name, phone, email, status, client_id: rowClientId, source, score, interest, assigned_to: assignedTo })) {
              if (value != null) importChanges[field] = value;
            }
            await Leads.updateOne({ id: existingLead.id }, { $set: importChanges });
          }
        } else {
          // Insert new
          const insertedLead = await Leads.create({
            client_id: rowClientId, name, phone, email, status, source, score, interest, assigned_to: assignedTo, created_at: new Date(),
          });
          importedLeadId = insertedLead.id;
          inserted++;

          // ── Send welcome template for newly inserted leads (not existing ones) ──
          if (!isCampaignImport && process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
            // Stagger by 1s per lead to avoid WhatsApp rate limits on bulk import
            const delay = inserted * 1000;
            setTimeout(() => {
              // Fetch client-specific credentials for this lead (if client_id set)
              Clients.findOne({ id: rowClientId }, { _id: 0, phone_number_id: 1, wa_access_token: 1 }).lean().then(clientRow => {
                const phoneNumberId = clientRow?.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
                const waAccessToken = clientRow?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
                axios.post(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
                  lead_id: importedLeadId,
                  name,
                  phone,
                  client_id: rowClientId,
                  phone_number_id: phoneNumberId,
                  wa_access_token: waAccessToken,
                }).catch(e => console.error(`[Import Welcome] Failed for lead ${importedLeadId}:`, e.message));
              }).catch(() => {
                // fallback to default credentials
                axios.post(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
                  lead_id: importedLeadId,
                  name,
                  phone,
                  client_id: rowClientId,
                  phone_number_id: process.env.WA_PHONE_NUMBER_ID,
                  wa_access_token: process.env.META_PAGE_ACCESS_TOKEN,
                }).catch(e => console.error(`[Import Welcome Fallback] Failed for lead ${importedLeadId}:`, e.message));
              });
            }, delay);
          }
        }

        if (isCampaignImport) {
          const rowTemplateParameters = { header: {}, body: {} };
          for (const [column, value] of Object.entries(row)) {
            const match = String(column).match(/^(Header|Body)\s*\{\{\s*(\d+)\s*\}\}(?:\s*-.*)?$/i);
            if (match) rowTemplateParameters[match[1].toLowerCase()][match[2]] = String(value ?? '').trim();
          }
          console.log(`[Campaign Import] Linking lead ${importedLeadId} to batch ${req.body.force_source}`);
          await CampaignImportRecipients.updateOne(
            { batch_id: req.body.force_source, lead_id: importedLeadId },
            { $set: { template_parameters: rowTemplateParameters }, $setOnInsert: { created_at: new Date() } },
            { upsert: true }
          );
        }

        imported++;
        if (imported % 10 === 0) {
          console.log(`[Campaign Import] Progress: ${imported} imported, ${failed} failed`);
        }
      } catch (e) {
        console.error('Row import error for', row, e.message);
        failed++;
        if (importErrors.length < 5) {
          importErrors.push({
            row: imported + failed + 1,
            name: row.name || row.Name || row['First Name'] || '',
            phone: row.phone || row.Phone || row.whatsapp || row['Phone Number'] || row['phone number'] || '',
            error: e.message,
          });
        }
      }
    }

    fs.unlinkSync(req.file.path); // cleanup
    if (imported === 0 && failed > 0) {
      return res.status(400).json({
        success: false,
        imported,
        failed,
        error: importErrors[0]?.error || 'No valid contacts could be imported',
        errors: importErrors,
      });
    }
    res.json({
      success: true,
      imported,
      inserted,
      existing,
      duplicate_rows: duplicateRows,
      failed,
      errors: importErrors,
    });

  } catch (err) {
    console.error('Import error:', err);
    if (req.file?.path) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Failed to import leads' });
  }
});

// ══════════════════════════════════════════════════════════
// META WHATSAPP WEBHOOKS
// ══════════════════════════════════════════════════════════

// Verification Challenge
app.get('/api/webhooks/meta', (req, res) => {
  const verify_token = process.env.WA_VERIFY_TOKEN;
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verify_token) {
      console.log('Meta Webhook Verified!');
      return res.status(200).send(challenge);
    }
    return res.sendStatus(403);
  }
  res.sendStatus(400);
});

// Receive Live Status Updates
app.post('/api/webhooks/meta', async (req, res) => {
  try {
    const { object, entry } = req.body;

    if (object === 'whatsapp_business_account' && entry && entry[0].changes) {
      const value = entry[0].changes[0].value;

      // Handle message statuses (Delivered, Read, Failed)
      if (value.statuses && value.statuses.length > 0) {
        const statusObj = value.statuses[0];
        const wamid = statusObj.id;
        const newStatus = statusObj.status; // 'delivered', 'read', 'failed'
        const error = statusObj.errors ? statusObj.errors[0].title : null;

        console.log(`[Webhook] Update: ${wamid} -> ${newStatus}`);

        // Update campaign_logs directly
        await CampaignLogs.updateMany({ wa_message_id: wamid }, { $set: { status: newStatus, error_message: error } });
      }

      // Handle incoming replied messages
      if (value.messages && value.messages.length > 0) {
        const msg = value.messages[0];
        const incomingPhone = msg.from;
        const msgId = msg.id;
        const text = msg.text ? msg.text.body : '';

        // Find if this user was part of a campaign
        const repliedLead = await Leads.findOne(
          { phone: new RegExp(`${escapeRegex(incomingPhone.substring(incomingPhone.length - 10))}$`) },
          { _id: 0, id: 1, phone: 1 }
        ).lean();
        if (repliedLead) {
          await CampaignLogs.updateMany({ lead_id: repliedLead.id }, { $set: { status: 'replied' } });

          // Insert into messages table
          const repliedConversation = await Conversations.findOne({ lead_id: repliedLead.id }, { id: 1 }).sort({ last_message_at: -1 }).lean();
          if (repliedConversation && !(msgId && await Messages.exists({ wa_msg_id: msgId }))) {
            await Messages.create({
              conversation_id: repliedConversation.id, direction: 'inbound', content: text, msg_type: 'text',
              wa_msg_id: msgId, status: 'delivered', is_ai: false, sent_at: new Date(),
            });
          }
        }
      }
    }

    // Always return 200 OK to Meta
    res.status(200).send('EVENT_RECEIVED');
  } catch (err) {
    console.error('Webhook processing error:', err);
    res.sendStatus(500);
  }
});

// ══════════════════════════════════════════════════════════
// CAMPAIGNS
// ══════════════════════════════════════════════════════════
app.get('/api/campaigns', auth, async (req, res) => {
  try {
    const campaignRows = await Campaigns.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const [campaignClients, campaignTemplates, logCounts] = await Promise.all([
      Clients.find({ id: { $in: campaignRows.map((c) => c.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      Templates.find({ id: { $in: campaignRows.map((c) => c.template_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      CampaignLogs.aggregate([
        { $match: { campaign_id: { $in: campaignRows.map((c) => c.id) }, status: { $in: ['sent', 'delivered', 'read', 'replied'] } } },
        { $group: { _id: { campaign_id: '$campaign_id', status: '$status' }, count: { $sum: 1 } } },
      ]),
    ]);
    const clientNames = new Map(campaignClients.map((c) => [c.id, c.name]));
    const templateNames = new Map(campaignTemplates.map((t) => [t.id, t.name]));
    const logCount = (campaignId, status) => logCounts.find((c) => c._id.campaign_id === campaignId && c._id.status === status)?.count || 0;
    const rows = campaignRows.map((camp) => ({
      ...camp,
      brand_name: clientNames.get(camp.client_id) ?? null,
      template_name: templateNames.get(camp.template_id) ?? null,
      sent_count: logCount(camp.id, 'sent'),
      delivered_count: logCount(camp.id, 'delivered'),
      read_count: logCount(camp.id, 'read'),
      replied_count: logCount(camp.id, 'replied'),
    }));
    res.json({ campaigns: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});
app.post('/api/campaigns', auth, async (req, res) => {
  try {
    const { name, client_id, template_id, target_status, scheduled_at, send_immediately, template_parameters = {} } = req.body;

    if (!name || !client_id || !template_id || !target_status) {
      return res.status(400).json({ error: 'Campaign name, brand, template, and target audience are required.' });
    }

    const selectedTemplate = await Templates.findOne(
      { id: template_id },
      { _id: 0, id: 1, name: 1, status: 1, body: 1, header: 1, client_id: 1, parameter_definitions: 1 }
    ).lean();
    if (!selectedTemplate) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    if (!['approved', 'active'].includes(String(selectedTemplate.status).toLowerCase())) {
      return res.status(400).json({ error: 'Only Meta-approved templates can be used for live campaigns.' });
    }
    if (selectedTemplate.client_id && Number(selectedTemplate.client_id) !== Number(client_id)) {
      return res.status(400).json({ error: 'The selected template does not belong to this brand.' });
    }
    const templateError = validateCampaignTemplate(selectedTemplate);
    if (templateError) {
      return res.status(400).json({ error: templateError });
    }
    const parameterError = validateCampaignParameterMappings(selectedTemplate, template_parameters);
    if (parameterError) return res.status(400).json({ error: parameterError });
    const usesExcelParameters = ['header', 'body'].some((section) =>
      Object.values(template_parameters?.[section] || {}).some((mapping) => mapping?.source === 'excel_parameter')
    );
    if (usesExcelParameters && !String(target_status).startsWith('csv_')) {
      return res.status(400).json({ error: 'Excel parameter columns can only be used with an uploaded custom list.' });
    }

    // Determine initial status
    const initialStatus = scheduled_at && new Date(scheduled_at) > new Date() ? 'scheduled' : 'scheduled';

    const campaign = (await Campaigns.create({
      name, client_id, template_id, target_status, scheduled_at: scheduled_at || null, status: initialStatus,
      created_by: req.user.id, created_at: new Date(), template_parameters,
    })).toObject();

    // If send_immediately is true or no scheduled_at, trigger execution immediately
    if (send_immediately || !scheduled_at) {
      // Execute with delay to ensure campaign is created first
      setTimeout(() => {
        executeCampaign(campaign.id).catch(err => {
          console.error('Auto-execute campaign error:', err);
        });
      }, 500);
    }

    res.status(201).json({ campaign });
  } catch (err) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: 'Unable to create campaign.' });
  }
});

app.delete('/api/campaigns/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteCascade('campaign_logs', { campaign_id: Number(id) });
    const deleted = await deleteCascade('campaigns', { id: Number(id) });
    if (deleted.length === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Background Campaign Execution Function - Now uses queue system
async function executeCampaign(campaign_id) {
  console.log(`[executeCampaign] Starting for campaign ${campaign_id}`);
  try {
    const campaignRow = await Campaigns.findOne({ id: campaign_id }, NO_ID).lean();
    const campaignTemplate = campaignRow ? await Templates.findOne({ id: campaignRow.template_id }, NO_ID).lean() : null;

    if (!campaignRow || !campaignTemplate) {
      console.log(`[executeCampaign] Campaign ${campaign_id} not found`);
      return;
    }
    const campaignClient = campaignRow.client_id != null ? await Clients.findOne({ id: campaignRow.client_id }, NO_ID).lean() : null;
    const campaign = {
      ...campaignRow,
      template_body: campaignTemplate.body, template_header: campaignTemplate.header, template_name: campaignTemplate.name,
      template_language: campaignTemplate.language, brand_name: campaignClient?.name ?? null,
      wa_access_token: campaignClient?.wa_access_token ?? null, phone_number_id: campaignClient?.phone_number_id ?? null,
      whatsapp_status: campaignClient?.whatsapp_status ?? null,
    };

    const templateError = validateCampaignTemplate({
      body: campaign.template_body,
      header: campaign.template_header,
    });
    if (templateError) {
      await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
      console.error(`Campaign ${campaign_id}: ${templateError}`);
      return;
    }
    const parameterError = validateCampaignParameterMappings(
      { body: campaign.template_body, header: campaign.template_header },
      campaign.template_parameters || {}
    );
    if (parameterError) {
      await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
      console.error(`Campaign ${campaign_id}: ${parameterError}`);
      return;
    }

    if (campaign.client_id && campaign.whatsapp_status !== 'verified') {
      await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
      console.error(`Campaign ${campaign_id}: WhatsApp is not verified for this brand`);
      return;
    }

    console.log(`[executeCampaign] Campaign: ${campaign.name}, target_status: ${campaign.target_status}, client_id: ${campaign.client_id}`);

    // Atomically claim the campaign: only proceed if it's still 'scheduled' or 'failed'.
    const claimRes = await Campaigns.updateOne({ id: campaign_id, status: { $in: ['scheduled', 'failed'] } }, { $set: { status: 'running' } });
    if (claimRes.modifiedCount === 0) {
      console.warn(`Campaign ${campaign_id}: skipped, already running/completed (not in 'scheduled' or 'failed' state).`);
      return;
    }

    console.log(`[executeCampaign] Campaign claimed, finding leads...`);

    // Build leads query
    let leadsQuery = {};
    const queryParams = [];
    const leadFields = { _id: 0, id: 1, phone: 1, name: 1, email: 1, status: 1, source: 1, interest: 1, score: 1 };
    let leads;

    if (campaign.target_status && campaign.target_status.startsWith('csv_')) {
      // A custom upload is an exact audience. Existing leads may belong to a
      // different CRM brand, but the selected campaign brand supplies the
      // WhatsApp credentials used for this send.
      queryParams.push(campaign.target_status);
      const recipients = await CampaignImportRecipients.find({ batch_id: campaign.target_status }, NO_ID).lean();
      leadsQuery = { batch_id: campaign.target_status };
      const recipientLeads = new Map((await Leads.find({ id: { $in: recipients.map((r) => r.lead_id) } }, leadFields).lean()).map((l) => [l.id, l]));
      leads = recipients
        .filter((r) => recipientLeads.has(r.lead_id) && String(recipientLeads.get(r.lead_id).phone ?? '').trim() !== '')
        .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || a.lead_id - b.lead_id)
        .map((r) => ({ ...recipientLeads.get(r.lead_id), template_parameters: r.template_parameters }));
    } else {
      // Regular target status (new, warm, cold, etc.) or all leads
      leadsQuery = { client_id: campaign.client_id };
      queryParams.push(campaign.client_id);

      if (campaign.target_status && campaign.target_status !== 'all') {
        leadsQuery.status = campaign.target_status;
        queryParams.push(campaign.target_status);
      }
      leads = await Leads.find(leadsQuery, leadFields).lean();
    }

    const excelMappings = ['header', 'body'].flatMap((section) =>
      Object.entries(campaign.template_parameters?.[section] || {})
        .filter(([, mapping]) => mapping?.source === 'excel_parameter')
        .map(([number]) => ({ section, number }))
    );
    if (excelMappings.length) {
      if (!campaign.target_status?.startsWith('csv_')) {
        await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
        console.error(`Campaign ${campaign_id}: Excel parameter mappings require a custom Excel audience.`);
        return;
      }
      const incomplete = leads.find((lead) => excelMappings.some(({ section, number }) =>
        !String(lead.template_parameters?.[section]?.[number] || '').trim()
      ));
      if (incomplete) {
        await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
        console.error(`Campaign ${campaign_id}: recipient ${incomplete.id} has missing Excel parameter values.`);
        return;
      }
    }

    console.log(`[Campaign ${campaign_id}] Query: ${JSON.stringify(leadsQuery)}`);
    console.log(`[Campaign ${campaign_id}] Params: ${JSON.stringify(queryParams)}`);
    console.log(`[Campaign ${campaign_id}] Found: ${leads.length} leads`);

    if (leads.length === 0) {
      // Debug: check what's in the campaign_import_recipients table
      let debugInfo = '';
      if (campaign.target_status && campaign.target_status.startsWith('csv_')) {
        const recipientsCount = await CampaignImportRecipients.countDocuments({ batch_id: campaign.target_status });
        debugInfo = ` (batch_id: ${campaign.target_status}, found: ${recipientsCount} recipients in campaign_import_recipients)`;
      }

      await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
      console.warn(`Campaign ${campaign_id} has no recipients matching its target.${debugInfo}`);
      return;
    }

    const waToken = campaign.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = campaign.phone_number_id || process.env.WA_PHONE_NUMBER_ID;

    // Validate credentials
    if (!waToken || !phoneId) {
      await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
      console.error(`Campaign ${campaign_id}: missing WhatsApp credentials`);
      return;
    }

    // Add all messages to the queue - the queue processor will send them with rate limiting
    await addToCampaignQueue(campaign_id, leads, {
      template_name: campaign.template_name,
      template_language: campaign.template_language,
      template_body: campaign.template_body,
      template_header: campaign.template_header,
      template_parameters: campaign.template_parameters,
      campaign_name: campaign.name,
      brand_name: campaign.brand_name,
      wa_access_token: waToken,
      phone_number_id: phoneId
    });

    console.log(`Campaign ${campaign_id}: Added ${leads.length} messages to queue`);
    console.log(`[Campaign Queue] Processing started - messages will be sent with rate limiting`);

  } catch (err) {
    console.error('Campaign execution error:', err);
    await Campaigns.updateOne({ id: campaign_id }, { $set: { status: 'failed' } });
  }
}

// POST /api/campaigns/execute
app.post('/api/campaigns/execute', internalAuth, async (req, res) => {
  try {
    const { campaign_id } = req.body;
    // Execute asynchronously without blocking
    executeCampaign(campaign_id);
    res.json({ success: true, message: 'Campaign execution started in background' });
  } catch (err) {
    console.error('Campaign execution trigger error:', err);
    res.status(500).json({ error: 'Failed to trigger campaign' });
  }
});

// POST /api/campaigns/:id/retry - Retry a failed/stuck campaign
app.post('/api/campaigns/:id/retry', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign details
    const campaign = await Campaigns.findOne({ id }, NO_ID).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if there are already messages in queue for this campaign
    const queuedCount = await CampaignMessageQueue.countDocuments({ campaign_id: Number(id) });

    if (queuedCount > 0) {
      // Messages already in queue, just reset status to running
      await Campaigns.updateOne({ id }, { $set: { status: 'running' } });
      return res.json({ success: true, message: 'Campaign already has messages in queue, status reset to running' });
    }

    // Re-execute the campaign (will add fresh messages to queue)
    await Campaigns.updateOne({ id }, { $set: { status: 'scheduled' } });

    // Execute and wait for result
    try {
      await executeCampaign(id);
      res.json({ success: true, message: 'Campaign retry initiated' });
    } catch (execErr) {
      console.error('Execute campaign error:', execErr);
      // Reset status to failed
      await Campaigns.updateOne({ id }, { $set: { status: 'failed' } });
      res.status(500).json({ error: 'Failed to execute campaign: ' + execErr.message });
    }
  } catch (err) {
    console.error('Campaign retry error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/:id/queue - Get queue status for specific campaign
app.get('/api/campaigns/:id/queue', auth, async (req, res) => {
  try {
    const { id } = req.params;
    res.json({ queue: await campaignQueueStats({ campaign_id: Number(id) }) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/:id/debug - Debug campaign recipients
app.get('/api/campaigns/:id/debug', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign details
    const c = await Campaigns.findOne({ id }, NO_ID).lean();
    if (!c) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check campaign_import_recipients
    let recipients = [];
    if (c.target_status && c.target_status.startsWith('csv_')) {
      const batchRecipients = await CampaignImportRecipients.find({ batch_id: c.target_status }, NO_ID).lean();
      const batchLeads = new Map((await Leads.find({ id: { $in: batchRecipients.map((r) => r.lead_id) } }, { id: 1, name: 1, phone: 1, client_id: 1 }).lean()).map((l) => [l.id, l]));
      recipients = batchRecipients
        .filter((r) => batchLeads.has(r.lead_id))
        .map((r) => ({ ...r, name: batchLeads.get(r.lead_id).name, phone: batchLeads.get(r.lead_id).phone, client_id: batchLeads.get(r.lead_id).client_id }));
    }

    // Check leads for this client
    const leadsRes = { rows: await Leads.find({ client_id: c.client_id }, { _id: 0, id: 1, name: 1, phone: 1, client_id: 1, status: 1 }).limit(10).lean() };

    res.json({
      campaign: {
        id: c.id,
        name: c.name,
        client_id: c.client_id,
        target_status: c.target_status,
      },
      csvRecipientsCount: recipients.length,
      sampleRecipients: recipients.slice(0, 5),
      leadsForClientCount: leadsRes.rows.length,
      sampleLeads: leadsRes.rows.slice(0, 5)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/queue/status - Get overall queue processing status
app.get('/api/campaigns/queue/status', auth, async (req, res) => {
  try {
    res.json({
      queue: await campaignQueueStats({}),
      rateLimiter: {
        messagesThisMinute: rateLimiter.messagesThisMinute,
        messagesThisHour: rateLimiter.messagesThisHour,
        messagesThisDay: rateLimiter.messagesThisDay,
        consecutiveRateLimits: rateLimiter.consecutiveRateLimits,
        currentDelayMs: rateLimiter.currentDelayMs
      }
    });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/:id/logs
app.get('/api/campaigns/:id/logs', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const logRows = await CampaignLogs.find({ campaign_id: Number(id) }, NO_ID).lean();
    const logLeads = new Map((await Leads.find({ id: { $in: logRows.map((l) => l.lead_id) } }, { id: 1, name: 1, phone: 1 }).lean()).map((l) => [l.id, l]));
    const rows = logRows
      .filter((log) => logLeads.has(log.lead_id))
      // PostgreSQL DESC puts NULL sent_at first.
      .sort((a, b) => (a.sent_at == null ? Infinity : new Date(a.sent_at).getTime()) < (b.sent_at == null ? Infinity : new Date(b.sent_at).getTime()) ? 1 : -1)
      .map((log) => ({ ...log, name: logLeads.get(log.lead_id).name, phone: logLeads.get(log.lead_id).phone }));
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════

async function campaignQueueStats(match) {
  const [stats] = await CampaignMessageQueue.aggregate([
    { $match: match },
    { $group: {
      _id: null,
      pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
      sent: { $sum: { $cond: [{ $eq: ['$status', 'sent'] }, 1, 0] } },
      failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
      total: { $sum: 1 },
    } },
  ]);
  return { pending: stats?.pending || 0, sent: stats?.sent || 0, failed: stats?.failed || 0, total: stats?.total || 0 };
}

const REPORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const REPORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const dayKey = (date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
// Mirrors the PostgreSQL TO_CHAR formats used by the dashboard.
const formatReportDay = (date, format) => {
  if (format === 'Dy') return REPORT_WEEKDAYS[date.getDay()];
  if (format === 'Mon') return REPORT_MONTHS[date.getMonth()];
  return `${String(date.getDate()).padStart(2, '0')} ${REPORT_MONTHS[date.getMonth()]}`;
};

// Sum captured payments in [from, to), optionally restricted to one brand's leads.
async function sumCapturedPayments(from, to, brandLeadIds) {
  const match = { status: 'captured', created_at: { $gte: from, $lt: to } };
  if (brandLeadIds) match.lead_id = { $in: brandLeadIds };
  const [row] = await Payments.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: { $toDouble: '$amount' } } } }]);
  return Number(row?.total || 0);
}

// Per-day lead / converted counts between two local dates (inclusive).
async function dailyLeadBuckets(fromDay, toDay, format, brandFilter) {
  const leads = await Leads.find(
    { ...brandFilter, created_at: { $gte: fromDay, $lt: addDays(toDay, 1) } },
    { _id: 0, created_at: 1, status: 1 }
  ).lean();
  const buckets = new Map();
  for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
    buckets.set(dayKey(day), { day: formatReportDay(day, format), leads: 0, converted: 0 });
  }
  for (const lead of leads) {
    const bucket = buckets.get(dayKey(new Date(lead.created_at)));
    if (!bucket) continue;
    bucket.leads++;
    if (lead.status === 'converted') bucket.converted++;
  }
  return [...buckets.values()];
}

async function leadSourceCounts(filter, otherLabel) {
  const rows = await Leads.aggregate([
    { $match: filter },
    { $group: { _id: '$source', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 6 },
  ]);
  return rows.map((row) => ({ source: row._id ?? otherLabel, count: row.count }));
}

async function leadFunnel(filter) {
  const [row] = await Leads.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      total: { $sum: 1 },
      contacted: { $sum: { $cond: [{ $and: [{ $ne: [{ $ifNull: ['$status', null] }, null] }, { $ne: ['$status', 'new'] }] }, 1, 0] } },
      qualified: { $sum: { $cond: [{ $and: [{ $isNumber: '$score' }, { $gte: ['$score', 40] }] }, 1, 0] } },
      hot: { $sum: { $cond: [{ $eq: ['$status', 'hot'] }, 1, 0] } },
      converted: { $sum: { $cond: [{ $eq: ['$status', 'converted'] }, 1, 0] } },
    } },
  ]);
  return { total: row?.total || 0, contacted: row?.contacted || 0, qualified: row?.qualified || 0, hot: row?.hot || 0, converted: row?.converted || 0 };
}

// GET /api/reports/summary — dashboard stats
app.get('/api/reports/summary', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const client_id = req.query.client_id;
    const filterBrand = client_id && client_id !== 'all' && client_id !== 'All Brands' && client_id !== 'undefined';
    const brandId = filterBrand ? Number(client_id) : null;
    const brandFilter = filterBrand ? { client_id: brandId } : {};
    const brandLeadIds = filterBrand ? await Leads.distinct('id', brandFilter) : null;
    const countLeads = (filter) => Leads.countDocuments({ ...brandFilter, ...filter });

    if (range === 'custom') {
      const from = req.query.from;
      const to = req.query.to;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
        return res.status(400).json({ error: 'Invalid custom date range' });
      }
      const [fy, fm, fd] = from.split('-').map(Number);
      const [ty, tm, td] = to.split('-').map(Number);
      const fromDay = new Date(fy, fm - 1, fd);
      const toDay = new Date(ty, tm - 1, td);
      const toEnd = addDays(toDay, 1);
      const span = Math.round((toDay - fromDay) / 86400000) + 1;
      const previousFrom = addDays(fromDay, -span);
      const inRange = { $gte: fromDay, $lt: toEnd };

      const [currentLeads, previousLeads, hot, convertedCurrent, convertedPrevious, revenueCurrent, revenuePrevious,
        weekly, sources, funnel, payments, brandClients, brandLeadCounts] = await Promise.all([
        countLeads({ created_at: inRange }),
        countLeads({ created_at: { $gte: previousFrom, $lt: fromDay } }),
        countLeads({ status: 'hot', created_at: inRange }),
        countLeads({ status: 'converted', updated_at: inRange }),
        countLeads({ status: 'converted', updated_at: { $gte: previousFrom, $lt: fromDay } }),
        sumCapturedPayments(fromDay, toEnd, brandLeadIds),
        sumCapturedPayments(previousFrom, fromDay, brandLeadIds),
        dailyLeadBuckets(fromDay, toDay, 'DD Mon', brandFilter),
        leadSourceCounts({ ...brandFilter, created_at: inRange }, 'Other'),
        leadFunnel({ ...brandFilter, created_at: inRange }),
        Payments.find({ status: 'captured', created_at: inRange, ...(brandLeadIds ? { lead_id: { $in: brandLeadIds } } : {}) }, { _id: 0, amount: 1, created_at: 1 }).lean(),
        Clients.find(filterBrand ? { id: brandId } : {}, { _id: 0, id: 1, name: 1 }).lean(),
        Leads.aggregate([{ $match: { ...brandFilter, created_at: inRange } }, { $group: { _id: '$client_id', count: { $sum: 1 } } }]),
      ]);

      const revenueByDay = new Map();
      for (const payment of payments) {
        const key = dayKey(new Date(payment.created_at));
        revenueByDay.set(key, (revenueByDay.get(key) || 0) + Number(payment.amount || 0));
      }
      const revenueTrend = [];
      for (let day = fromDay; day <= toDay; day = addDays(day, 1)) {
        revenueTrend.push({ m: formatReportDay(day, 'DD Mon'), r: revenueByDay.get(dayKey(day)) || 0 });
      }
      const leadCountByBrand = new Map(brandLeadCounts.map((row) => [row._id, row.count]));
      const brands = brandClients
        .map((client) => ({ id: client.id, name: client.name, lead_count: leadCountByBrand.get(client.id) || 0 }))
        .sort((a, b) => b.lead_count - a.lead_count);

      return res.json({
        leads_today: currentLeads, leads_yesterday: previousLeads,
        hot_leads: hot, converted_today: convertedCurrent,
        converted_yesterday: convertedPrevious, revenue_month: revenueCurrent,
        revenue_last_month: revenuePrevious, weekly, sources,
        funnel, revenue_trend: revenueTrend, brands,
        date_range: { from, to },
      });
    }

    let days = 30;
    let dateFormat = 'DD Mon';
    if (range === '7d') {
      days = 7;
      dateFormat = 'Dy';
    } else if (range === '90d') {
      days = 90;
      dateFormat = 'DD Mon';
    }

    const today = startOfDay(new Date());
    const tomorrow = addDays(today, 1);
    const yesterday = addDays(today, -1);
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);

    const [leadsToday, leadsYesterday, hot, converted, convertedYesterday, revenue, revenueLastMonth, weekly, sources, funnel] = await Promise.all([
      countLeads({ created_at: { $gte: today, $lt: tomorrow } }),
      countLeads({ created_at: { $gte: yesterday, $lt: today } }),
      countLeads({ status: 'hot' }),
      countLeads({ status: 'converted', updated_at: { $gte: today, $lt: tomorrow } }),
      countLeads({ status: 'converted', updated_at: { $gte: yesterday, $lt: today } }),
      sumCapturedPayments(monthStart, nextMonthStart, brandLeadIds),
      sumCapturedPayments(lastMonthStart, monthStart, brandLeadIds),
      dailyLeadBuckets(addDays(today, -(days - 1)), today, dateFormat, brandFilter),
      leadSourceCounts(brandFilter, null),
      leadFunnel(brandFilter),
    ]);

    const revenueTrend = [];
    for (let offset = 5; offset >= 0; offset--) {
      const month = new Date(today.getFullYear(), today.getMonth() - offset, 1);
      const nextMonth = new Date(today.getFullYear(), today.getMonth() - offset + 1, 1);
      revenueTrend.push({ m: formatReportDay(month, 'Mon'), r: await sumCapturedPayments(month, nextMonth, brandLeadIds) });
    }

    res.json({
      leads_today: leadsToday,
      leads_yesterday: leadsYesterday,
      hot_leads: hot,
      converted_today: converted,
      converted_yesterday: convertedYesterday,
      revenue_month: revenue,
      revenue_last_month: revenueLastMonth,
      weekly,
      sources,
      funnel,
      revenue_trend: revenueTrend,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/reports/leads — for reports page
app.get('/api/reports/leads', auth, async (req, res) => {
  try {
    const { from, to, brand } = req.query;
    const filter = {};
    if (from || to) filter.created_at = {};
    if (from) filter.created_at.$gte = new Date(from);
    if (to) filter.created_at.$lte = new Date(to);
    const reportClients = await Clients.find(
      brand && brand !== 'All Brands' ? { name: { $regex: escapeRegex(brand), $options: 'i' } } : {},
      { id: 1, name: 1 }
    ).lean();
    if (brand && brand !== 'All Brands') filter.client_id = { $in: reportClients.map((c) => c.id) };
    const brandNames = new Map(reportClients.map((c) => [c.id, c.name]));
    const rows = (await Leads.find(filter, NO_ID).sort({ created_at: -1 }).limit(500).lean())
      .map((lead) => ({ ...lead, brand_name: brandNames.get(lead.client_id) ?? null }));
    res.json({ leads: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// USERS / TEAM
// ══════════════════════════════════════════════════════════
app.get('/api/users', auth, async (req, res) => {
  try {
    const rows = await Users.find({}, { _id: 0, id: 1, name: 1, email: 1, role: 1, is_active: 1, last_login: 1, created_at: 1 }).sort({ created_at: 1 }).lean();
    res.json({ users: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/users', auth, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const { name, email, password, role } = req.body;
    const hash = await bcrypt.hash(password, 12);
    const created = await Users.create({ name, email: email.toLowerCase(), password_hash: hash, role: role || 'user', is_active: true, created_at: new Date() });
    res.status(201).json({ user: { id: created.id, name: created.name, email: created.email, role: created.role } });
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── INTERNAL (called by n8n) ──────────────────────────────

// POST /api/internal/save-conversation
app.post('/api/internal/save-conversation', internalAuth, async (req, res) => {
  try {
    const { lead_id, direction, message, sender, wa_message_id } = req.body;
    // The old SQL wrote message columns into conversations (which has none of
    // them); store the message on the lead's conversation instead.
    const lead = await Leads.findOne({ id: lead_id }, { _id: 0, id: 1, phone: 1 }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const conversation = await upsertOne(
      Conversations,
      lead.phone ? { phone: lead.phone } : { lead_id: lead.id },
      { $set: { lead_id: lead.id, last_message: message, last_message_at: new Date() } },
      { lead_id: lead.id, phone: lead.phone || null, status: 'open', last_message: message, last_message_at: new Date(), created_at: new Date() }
    );
    await Messages.create({
      conversation_id: conversation.id, direction, content: message, msg_type: 'text', wa_msg_id: wa_message_id || null,
      is_ai: sender === 'ai' || sender === 'bot', status: 'sent', sent_at: new Date(),
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/internal/update-lead
app.post('/api/internal/update-lead', internalAuth, async (req, res) => {
  try {
    const { lead_id, status, score, interest } = req.body;
    const leadChanges = { updated_at: new Date() };
    if (status != null) leadChanges.status = status;
    if (score != null) leadChanges.score = score;
    if (interest != null) leadChanges.interest = interest;
    await Leads.updateOne({ id: lead_id }, { $set: leadChanges });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ── CRON JOBS ─────────────────────────────────────────────
// Re-enabled internal campaign execution cron and added logging for WF05 Dashboard
let scheduledCampaignCronRunning = false;
cron.schedule('* * * * *', async () => {
  if (scheduledCampaignCronRunning) return;
  scheduledCampaignCronRunning = true;
  try {
    const rows = await Campaigns.find({ status: 'scheduled', scheduled_at: { $lte: new Date() } }, { _id: 0, id: 1 }).lean();

    for (const row of rows) {
      console.log(`Cron: Starting scheduled campaign ${row.id}`);
      await executeCampaign(row.id);
      
      // Log the execution to workflow_logs so it appears in the Admin Dashboard
      await WorkflowLogs.create({
        workflow: 'WF05', lead_id: null, status: 'success',
        message: `Campaign ${row.id} execution automatically triggered by backend engine`,
      });
    }
  } catch (err) {
    console.error('Cron check error:', err);
  } finally {
    scheduledCampaignCronRunning = false;
  }
});

// Safety net for demo-call reminders. WF02 normally invokes these endpoints,
// but this local runner guarantees the 60/30/10-minute checks still happen if
// n8n is paused or temporarily unavailable. The reminder table's unique claim
// prevents duplicate sends when both runners execute at the same minute.
let demoReminderFallbackRunning = false;
cron.schedule('* * * * *', async () => {
  if (process.env.DEMO_REMINDER_FALLBACK_ENABLED === 'false' || demoReminderFallbackRunning) return;
  demoReminderFallbackRunning = true;
  try {
    const localApi = `http://127.0.0.1:${PORT}/api`;
    const dueResponse = await axios.get(`${localApi}/demo-reminders/due`, { timeout: 15000 });
    for (const reminder of dueResponse.data?.reminders || []) {
      try {
        await axios.post(`${localApi}/demo-reminders/send`, {
          lead_id: reminder.lead_id,
          booking_time: reminder.booking_time,
          reminder_minutes: Number(reminder.reminder_minutes),
        }, { timeout: 30000 });
      } catch (sendError) {
        console.error('[Demo Reminder Fallback] Send failed:', sendError.response?.data || sendError.message);
      }
    }
  } catch (error) {
    console.error('[Demo Reminder Fallback] Due check failed:', error.response?.data || error.message);
  } finally {
    demoReminderFallbackRunning = false;
  }
});

// Run every 1 minute to poll Google Drive folders for new videos
let drivePollerRunning = false;
if (process.env.DISABLE_DRIVE_POLLER !== 'true') {
  cron.schedule('* * * * *', async () => {
    if (drivePollerRunning) return;
    drivePollerRunning = true;
    try {
      await checkNewDriveVideos();
    } catch (err) {
      console.error('Cron checkNewDriveVideos error:', err);
    } finally {
      drivePollerRunning = false;
    }
  });
} else {
  console.log('DrivePoller: Polling disabled via DISABLE_DRIVE_POLLER=true environment variable.');
}

// Run every minute to auto-publish scheduled approved posts (acting as a fallback for n8n)
cron.schedule('* * * * *', async () => {
  console.log('Cron: Checking for scheduled approved content due for publishing...');
  try {
    const now = Date.now();
    const duePosts = await models.ContentQueue.find({
      status: { $in: ['APPROVED', 'approved', 'SCHEDULED', 'scheduled'] },
      scheduled_at: { $lte: new Date(now + 2 * 60 * 1000), $gt: new Date(now - 24 * 60 * 60 * 1000) },
    }, { _id: 0, id: 1 }).sort({ scheduled_at: 1 }).lean();

    if (duePosts.length > 0) {
      console.log(`Cron: Found ${duePosts.length} posts due for publishing.`);
      for (const post of duePosts) {
        console.log(`Cron: Fallback publishing post ${post.id}...`);
        const dummyReq = {
          params: { id: post.id },
          headers: {
            'host': 'leados-api.abmgroups.org',
            'x-forwarded-proto': 'https'
          },
          get: (header) => dummyReq.headers[header.toLowerCase()] || null,
          protocol: 'https'
        };
        const dummyRes = {
          status: function (code) {
            this.statusCode = code;
            return this;
          },
          json: function (data) {
            console.log(`Cron: Publish result for post ${post.id}:`, JSON.stringify(data));
          }
        };
        try {
          await publishPost(dummyReq, dummyRes);
        } catch (pubErr) {
          console.error(`Cron: Failed to publish post ${post.id}:`, pubErr.message);
        }
      }
    }
  } catch (err) {
    console.error('Cron scheduled fallback publisher check error:', err);
  }
});

// Run every Sunday at 2 AM automatically to refresh citations for all GMB clients
cron.schedule('0 2 * * 0', async () => {
  console.log('Cron: Starting weekly Mafiya citation check for all active clients...');
  try {
    const clients = await models.MafiyaGmbClients.find({ status: 'active' }, { _id: 0, id: 1 }).lean();
    const { runCheckForBusiness } = require('./services/citations/citation.service');
    for (const client of clients) {
      console.log(`Cron: Running citation check for GMB Client ID ${client.id}...`);
      await runCheckForBusiness(client.id).catch(err => {
        console.error(`Cron: Citation check failed for Client ID ${client.id}:`, err.message);
      });
    }
    console.log('Cron: Weekly Mafiya citation check completed.');
  } catch (err) {
    console.error('Cron Weekly Citation Check error:', err);
  }
});

// ── START ─────────────────────────────────────────────────
connectMongo().then(() => httpServer.listen(PORT, () => {
  console.log(`LeadOS API running on port ${PORT} (Socket.io enabled)`);

  // Repair historical routing drift once at startup. New writes are also
  // forced through the same owner, so AI/source metadata cannot move them.
  getLeadOSBrand()
    .then((brand) => Leads.updateMany(
      { client_id: { $ne: brand.id } },
      { $set: { client_id: brand.id, updated_at: new Date() } }
    ).then((result) => console.log(`[LeadOS Brand Lock] ${result.modifiedCount} existing lead(s) assigned to ${brand.name}.`)))
    .catch((error) => console.error('[LeadOS Brand Lock]', error.message));

  startAllianceEmailWorker(io).catch((error) => {
    console.error('[Startup] Alliance email worker failed:', error.message);
  });
  startAllianceEmailReplyPoller(io).catch((error) => {
    console.error('[Startup] Alliance email reply poller failed:', error.message);
  });
  startAllianceWhatsAppCampaignWorker(io).catch((error) => {
    console.error('[Startup] Alliance WhatsApp campaign worker failed:', error.message);
  });
  startAllianceAiNudgeWorker(io).catch((error) => {
    console.error('[Startup] Alliance AI nudge worker failed:', error.message);
  });

  // Start campaign message queue processor
  startCampaignQueueProcessor();

  // Initialize followup collections (indexes only; MongoDB needs no DDL)
  Promise.all([models.FollowupRules.createIndexes(), LeadNotes.createIndexes()]).then(() => {
    console.log('[Startup] Followup tables initialized');
  }).catch(err => {
    console.error('[Startup] Error initializing followup tables:', err.message);
  });

  // Reset any stuck publishing jobs on startup to prevent limbo states
  models.PublishQueue.updateMany(
    { status: 'publishing' },
    { $set: { status: 'failed', error_message: 'Publishing interrupted by server restart', updated_at: new Date() } }
  ).then(async (res) => {
    if (res.modifiedCount > 0) {
      console.log(`[Startup] Cleaned up ${res.modifiedCount} stuck publishing jobs.`);
      const contentIds = await models.PublishQueue.distinct('content_id', { error_message: 'Publishing interrupted by server restart' });
      const { updateOverallPostStatus } = require("./controllers/contentController");
      for (const contentId of contentIds) {
        await updateOverallPostStatus(contentId);
      }
    }
  }).catch(err => {
    console.error('[Startup] Failed to clean up stuck publishing jobs:', err.message);
  });
})).catch((error) => {
  console.error('[Startup] MongoDB connection failed:', error.message);
  process.exit(1);
});

module.exports = { app, httpServer, io };
  
