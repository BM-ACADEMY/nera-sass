/**
 * Nera LeadOS API — multi-tenant backend.
 * Tenant isolation: services/tenantContext.js + db/tenantScope.js.
 * Started by `node server.js`; tests import { app } without listening.
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
// Tests supply their own environment (an in-memory database); .env must not override it.
require('dotenv').config({ path: path.join(__dirname, '.env'), override: process.env.NODE_ENV !== 'test' });
ffmpeg.setFfmpegPath(ffmpegPath);

const app = express();
const httpServer = http.createServer(app);
const PORT = process.env.PORT || 3600;

const {
  auth, internalAuth, internalPlatformAuth, staffAuth, socketAuth, verifyToken, resolveIdentity,
} = require('./middleware/authMiddleware');
const { runAsSystem, runAsTenant, currentTenantId, getContext } = require('./services/tenantContext');
const { tenantCanSend } = require('./services/lifecycle');
const { sanitizeClient } = require('./services/clientSecrets');
const { assertPhoneNumberAvailable } = require('./services/whatsappIdentity');
const { customerResponseGuard } = require('./services/responseGuard');
const { inventoryAccessToken, requireInventoryAccessToken } = require('./services/metaInventoryCredentials');

// Background jobs (crons, queue processor). Off in tests: JOBS_ENABLED=false.
const jobsEnabled = () => process.env.JOBS_ENABLED !== 'false';

// ── ALLOWED BROWSER ORIGINS ───────────────────────────────
// Only these sites may call the API from a browser. Requests without an
// Origin header (webhooks, n8n, cron, curl) are not affected by CORS.
// Add more with CORS_ORIGINS=https://a.example,https://b.example
const toOrigin = (value) => { try { return new URL(value).origin; } catch { return null; } };
const ALLOWED_ORIGINS = new Set([
  'https://getnera.in',
  'https://www.getnera.in',
  'https://app.getnera.in',
  'https://admin.getnera.in',
  process.env.PORTAL_URL,
  process.env.ADMIN_PANEL_URL,
  ...String(process.env.CORS_ORIGINS || '').split(','),
].map((value) => value && toOrigin(value.trim())).filter(Boolean));
const isAllowedOrigin = (origin) => !origin
  || ALLOWED_ORIGINS.has(origin)
  || (process.env.NODE_ENV !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
const corsOrigin = (origin, callback) => callback(null, isAllowedOrigin(origin));

// ── MODULE SWITCHES ───────────────────────────────────────
// The shared Nera platform launches LeadOS only. Set
// DISABLED_MODULES=alliance,mafiya,contentos there; leave it empty on ABM's
// own server so its existing modules keep running.
const DISABLED_MODULES = new Set(String(process.env.DISABLED_MODULES || '')
  .split(',').map((name) => name.trim().toLowerCase()).filter(Boolean));
const moduleEnabled = (name) => !DISABLED_MODULES.has(name);

// ── SOCKET.IO ─────────────────────────────────────────────
const socketServer = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Every socket must present a valid login token and joins its tenant's room
// (tenant:<id>) or the platform staff room.
socketServer.use(socketAuth);

// Route and job code calls io.emit(...). This wrapper sends each event only to
// the room of the tenant the current request or job belongs to (plan T8);
// with no tenant (platform jobs) it goes to the platform staff room.
const io = {
  emit(event, payload) {
    const tenantId = currentTenantId();
    if (tenantId) socketServer.to(`tenant:${tenantId}`).emit(event, payload);
    else if (getContext()?.system) socketServer.to('platform').emit(event, payload);
    else console.warn(`[Socket.io] Dropped "${event}": no tenant context`);
    return true;
  },
  to: (room) => socketServer.to(room),
  in: (room) => socketServer.in(room),
  use: (fn) => socketServer.use(fn),
  on: (event, fn) => socketServer.on(event, fn),
  get sockets() { return socketServer.sockets; },
};

app.set('io', io);
// Admin panel live updates go to the platform staff room only.
require('./services/realtime').setStaffSender((event, payload) => socketServer.to('platform').emit(event, payload));

socketServer.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// ── DB CONNECTION ─────────────────────────────────────────
const { connectMongo, mongoose } = require('./db/connection');

// The database may be unreachable at startup (network, or this machine's IP
// not allowed by the database firewall). Nothing below may crash the process
// or run against a missing connection while start() keeps retrying.
const dbConnected = () => mongoose.connection.readyState === 1;
const whenDbConnected = () => (dbConnected()
  ? Promise.resolve()
  : new Promise((resolve) => mongoose.connection.once('connected', resolve)));
// Scheduled jobs skip their run while the database is not connected.
const scheduleJob = (expression, task, options) => cron.schedule(expression, (...args) => {
  if (!dbConnected()) return undefined;
  return task(...args);
}, options);
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

// A tenant's own WhatsApp Business credentials only. There is deliberately no
// fallback to the platform's .env number or token: that would send one
// customer's messages through another account.
const resolveClientMetaConfig = client => ({
  wabaId: client.wa_business_id || null,
  phoneId: client.phone_number_id || null,
  token: client.wa_access_token || null,
});

// The current tenant's WhatsApp sender (its brand profile). Null when the
// brand has not connected WhatsApp yet.
async function tenantWhatsAppSender() {
  const client = await Clients.findOne({}, { id: 1, name: 1, phone_number_id: 1, wa_access_token: 1, wa_business_id: 1, whatsapp_status: 1 }).lean();
  if (!client?.phone_number_id || !client?.wa_access_token) return null;
  return { clientId: client.id, phoneNumberId: client.phone_number_id, token: client.wa_access_token, wabaId: client.wa_business_id || null, status: client.whatsapp_status };
}

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

async function verifyClientWhatsApp(client) {
  if (!client) throw Object.assign(new Error('Brand profile not found'), { status: 404 });
  const metaConfig = resolveClientMetaConfig(client);
  if (!metaConfig.phoneId || !metaConfig.token || !metaConfig.wabaId || !client.whatsapp_number) {
    throw Object.assign(new Error('Real WhatsApp number, Meta Phone Number ID, WABA ID and token are required before verification'), { status: 400 });
  }
  // A number already connected to another brand (in any workspace) is never
  // verified or registered for this one.
  await assertPhoneNumberAvailable(metaConfig.phoneId, { exceptClientId: client.id });

  await Clients.updateOne({ id: client.id }, { $set: { whatsapp_status: 'verification_pending', whatsapp_verified_at: null, whatsapp_verification_error: null } });

  try {
    const ownership = await assertPhoneBelongsToWaba(client);
    const phone = ownership.phone;
    const savedDigits = normalizedPhoneDigits(client.whatsapp_number);
    const metaDigits = normalizedPhoneDigits(phone.display_phone_number);
    if (!metaDigits || (savedDigits !== metaDigits && !savedDigits.endsWith(metaDigits) && !metaDigits.endsWith(savedDigits))) {
      throw Object.assign(new Error('The WhatsApp number does not match the supplied Meta Phone Number ID'), { status: 400 });
    }

    // 1. Update Business Profile
    try {
      await updateWhatsAppBusinessProfile(client);
    } catch (profileError) {
      console.warn('[WhatsApp Profile Update]', profileError.response?.data || profileError.message);
    }

    // 2. Register only assets that Meta has not already connected.
    if (String(phone.status || '').toUpperCase() !== 'CONNECTED') {
      if (!process.env.WA_REGISTRATION_PIN) {
        throw Object.assign(new Error('WA_REGISTRATION_PIN is required to register this phone number with Cloud API'), { status: 400 });
      }
      const base = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
      await axios.post(
        `${base}/${metaConfig.phoneId}/register`,
        { messaging_product: 'whatsapp', pin: process.env.WA_REGISTRATION_PIN },
        { headers: { Authorization: `Bearer ${metaConfig.token}` } }
      );
    }

    const verified = await Clients.findOneAndUpdate(
      { id: client.id },
      { $set: { whatsapp_status: 'verified', whatsapp_verified_at: new Date(), whatsapp_verification_error: null, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    return verified;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message || 'WhatsApp verification failed';
    await Clients.updateOne(
      { id: client.id },
      { $set: { whatsapp_status: 'verification_failed', whatsapp_verification_error: errorMsg, updated_at: new Date() } }
    );
    throw Object.assign(new Error(errorMsg), { status: err.status || 400 });
  }
}

// The inventory sync reads the WhatsApp accounts of the Meta business set in
// .env. On the multi-tenant platform that business is not a customer, so it is
// switched off there with META_INVENTORY_SYNC=off.
const metaInventorySyncEnabled = () => process.env.META_INVENTORY_SYNC !== 'off';

// Uses META_INVENTORY_ACCESS_TOKEN only; with it unset nothing is called or
// written (see services/metaInventoryCredentials.js).
async function syncMetaWhatsAppInventory() {
  if (!metaInventorySyncEnabled()) throw new Error('Meta inventory sync is disabled (META_INVENTORY_SYNC=off)');
  const token = requireInventoryAccessToken();
  await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
  const businessId = process.env.META_BUSINESS_ID || process.env.WA_META_BUSINESS_ID;
  const configuredWabaId = process.env.WA_BUSINESS_ACCOUNT_ID;
  if (!businessId && !configuredWabaId) {
    throw new Error('Configure META_BUSINESS_ID for all WABAs, or WA_BUSINESS_ACCOUNT_ID for single-WABA sync');
  }
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
    // Refresh the verification status of brands linked to an inventory number.
    // A brand's number, WABA and display number belong to the customer's own
    // connection and are never written here; the filter matches only while the
    // brand still uses this exact number.
    for (const phone of await MetaWhatsappPhoneNumbers.find({ client_id: { $ne: null } }).lean()) {
      const verified = String(phone.connection_status ?? '').toUpperCase() === 'CONNECTED'
        || String(phone.verification_status ?? '').toUpperCase() === 'VERIFIED';
      const sameIdentity = { id: phone.client_id, phone_number_id: phone.phone_number_id, wa_business_id: phone.waba_id };
      const linkedClient = await Clients.findOne(sameIdentity, { whatsapp_verified_at: 1 }).lean();
      if (!linkedClient) continue;
      await Clients.updateOne(sameIdentity, { $set: {
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

// Scheduled sync: skipped (no call, no write) while META_INVENTORY_ACCESS_TOKEN
// is unset. Exported for tests.
let inventoryCredentialWarned = false;
async function scheduledMetaInventorySync() {
  if (!inventoryAccessToken()) {
    if (!inventoryCredentialWarned) console.warn('[Meta Inventory Sync] Skipped: META_INVENTORY_ACCESS_TOKEN is not configured');
    inventoryCredentialWarned = true;
    return { skipped: true };
  }
  return runAsSystem(syncMetaWhatsAppInventory, 'meta-inventory');
}
if (jobsEnabled() && metaInventorySyncEnabled()) scheduleJob('*/15 * * * *', () => scheduledMetaInventorySync().catch(err =>
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
      phone_number_id: campaign.phone_number_id || '',
    })));
  }
}

// Process queue - runs continuously. Claiming looks across all tenants
// (system context); each claimed message is then handled inside its own tenant.
function processCampaignQueue() {
  return runAsSystem(processCampaignQueueBatch, 'campaign-queue');
}

async function processCampaignQueueBatch() {
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

    // Process each message inside its own tenant.
    for (const msg of pending) {
      if (!msg.tenant_id) {
        await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { status: 'failed', processed_at: new Date(), error_message: 'Queue row has no tenant' } });
        continue;
      }
      await runAsTenant(msg.tenant_id, async () => {
      try {
        // A restricted or suspended workspace may not send (plan U6): hand
        // the row back untouched so it can go out after renewal.
        if (!(await tenantCanSend(msg.tenant_id))) {
          await CampaignMessageQueue.updateOne({ id: msg.id }, { $set: { status: 'pending', error_message: 'Workspace cannot send in its current subscription state' }, $inc: { attempts: -1 } });
          return;
        }
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
      });
    }

    // A queue batch can contain more than one campaign.
    for (const item of [...new Map(pending.filter((row) => row.tenant_id).map((row) => [row.campaign_id, row])).values()]) {
      await runAsTenant(item.tenant_id, () => checkCampaignCompletion(item.campaign_id));
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

    const sender = await tenantWhatsAppSender();
    const waToken = sender?.token;
    const phoneId = sender?.phoneNumberId;

    if (!waToken || !phoneId) {
      return { success: false, error: 'WhatsApp is not connected for this workspace' };
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
  origin: corsOrigin,
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
// Customer responses never carry a WhatsApp credential (services/responseGuard.js).
app.use(customerResponseGuard);
// Media that Meta downloads for outbound messages stays public (unguessable
// names). Lead exports, archives and logs are never served statically: lead
// exports are downloaded through the tenant-checked export route.
const PRIVATE_UPLOADS = /^\/(lead-exports|tenant-archives)(\/|$)|\.log$/i;
const publicUploads = [(req, res, next) => (PRIVATE_UPLOADS.test(req.path) ? res.status(404).end() : next()), express.static(path.join(__dirname, 'uploads'))];
app.use('/uploads', ...publicUploads);
app.use('/api/uploads', ...publicUploads);

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
// Customer workspace administration: /api/tenant, /api/team/*.
app.use('/api', require('./routes/team'));
// Platform admin panel API: platform staff only.
// The SalesOS maintenance routes POST /api/admin/{cleanup,retry,refresh-embeddings}
// share this prefix. They pass through to SalesOS, which requires the internal
// service key (n8n) or founder/ops staff (internalPlatformAuth); the admin router
// defines no such paths, so nothing else is reachable this way.
const SALESOS_MAINTENANCE_PATHS = new Set(['/cleanup', '/retry', '/refresh-embeddings']);
const adminPanelAuth = staffAuth();
app.use(
  '/api/admin',
  (req, res, next) => (req.method === 'POST' && SALESOS_MAINTENANCE_PATHS.has(req.path) ? next() : adminPanelAuth(req, res, next)),
  require('./routes/admin')({
    verifyClientWhatsApp: (client) => verifyClientWhatsApp(client),
    metaInventory: { syncMetaWhatsAppInventory, graphPageData, metaGraphVersion: META_GRAPH_VERSION },
  }),
);
// SalesOS routes are called by the app (user token) and by n8n / cron jobs
// (x-internal-key + x-tenant-id); the router checks this itself per route.
app.use('/api', salesosRoutes);

// Modules outside the LeadOS launch (AllianceOS, ContentOS, Mafiya OS and the
// older org-analysis tools) hold no tenant isolation, so on Nera they are
// platform-staff only, even when enabled (plan M12). Customers get 403.
const modulesAuth = staffAuth('platform.modules', { allowOAuthRedirects: true });
app.use('/api/knowledge', modulesAuth, knowledgeRoutes);
app.use('/api/upload', modulesAuth, uploadRoutes);
app.use('/api/pipeline', modulesAuth, pipelineRoutes);
app.use('/api/analyze', modulesAuth, analyzeRoutes);
// The website chat widget posts to /chat without a login; everything else is staff-only.
app.use('/api/chatbot', (req, res, next) => (req.method === 'POST' && req.path === '/chat' ? next() : modulesAuth(req, res, next)), chatbotRoutes);

if (moduleEnabled('alliance')) {
  app.use('/api/alliance', modulesAuth, allianceRoutes);
  app.use('/api/alliance-inbox', createAllianceInboxRouter({ auth: modulesAuth, io }));
  app.use('/api/internal/alliance', internalPlatformAuth, createAllianceAutomationRouter({ io }));
}

// ── CONTENT OS ROUTES ─────────────────────────────────────
if (moduleEnabled('contentos')) {
  app.use('/api/content', modulesAuth, contentRoutes);
  app.use('/api/integrations', modulesAuth, integrationsRoutes);
  app.use('/api/content-os', modulesAuth, contentOsRoutes);
}


// ── MAFIYA OS ROUTES ──────────────────────────────────────
// Required only when enabled: several of these files start cron jobs on load.
if (moduleEnabled('mafiya')) {
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

app.use('/api/mafiya/plans', modulesAuth, mafiyaPlansRoutes);
app.use('/api/mafiya/clients', modulesAuth, mafiyaClientsRoutes);
app.use('/api/mafiya/gmb', mafiyaGmbRoutes); // No auth — email links are clicked by external clients
app.use('/api/mafiya/turf', modulesAuth, mafiyaTurfRoutes);
app.use('/api/mafiya/rivals', modulesAuth, mafiyaRivalsRoutes);
app.use('/api/mafiya/usage', modulesAuth, mafiyaUsageRoutes);
app.use('/api/mafiya/orders', modulesAuth, mafiyaOrdersRoutes);
app.use('/api/citations', modulesAuth, citationRoutes);

// Public route for Google to download GMB Post images (bypassing the 'auth' middleware on the main reviews router)
app.get('/api/mafiya/reviews/image/:filename', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  const filepath = path.join(__dirname, 'uploads', 'gmb_posts', req.params.filename);
  if (fs.existsSync(filepath)) res.sendFile(filepath);
  else res.status(404).send('Image not found');
});

app.use('/api/mafiya/reviews', modulesAuth, mafiyaReviewsRoutes);
app.use('/api/mafiya/insights', modulesAuth, mafiyaInsightsRoutes);
app.get('/api/auth/google/callback', handleGoogleCallback); // Map the standard OAuth callback to Mafiya GMB handler
}
// WhatsApp media proxy (plan T9). Loaded by <img>/<audio> tags, which cannot
// send headers, so the login token arrives as ?token=. Media is fetched with
// the signed-in tenant's own WhatsApp token.
app.get('/api/whatsapp-media/:mediaId', async (req, res, next) => {
  if (!req.headers.authorization && req.query.token) req.headers.authorization = `Bearer ${req.query.token}`;
  return auth(req, res, next);
}, async (req, res) => {
  try {
    const { mediaId } = req.params;
    const sender = await tenantWhatsAppSender();
    const waToken = sender?.token;
    if (!waToken) return res.status(404).send('WhatsApp is not connected for this workspace');

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

const LEAD_EXPORT_DIR = path.join(__dirname, 'uploads', 'lead-exports');
const activeLeadExports = new Set();
const leadExportReady = whenDbConnected()
  .then(() => LeadExportJobs.createIndexes())
  .catch((error) => console.error('[Lead Export] Index setup failed:', error.message));

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

// Resume interrupted jobs after a server restart, each in its own tenant.
function resumeLeadExports() {
  return runAsSystem(async () => {
    await leadExportReady;
    await LeadExportJobs.updateMany({ status: 'processing' }, { $set: { status: 'queued', error_message: null } });
    const queuedJobs = await LeadExportJobs.find({ status: 'queued' }, { id: 1, tenant_id: 1 }).sort({ created_at: 1 }).lean();
    for (const row of queuedJobs) {
      if (row.tenant_id) setImmediate(() => runAsTenant(row.tenant_id, () => processLeadExportJob(row.id)));
    }
  }, 'lead-export-recovery').catch(err => console.error('[Lead Export] Startup recovery failed:', err.message));
}

// Export files are temporary. Clean up completed/failed jobs after 48 hours.
if (jobsEnabled()) scheduleJob('17 */6 * * *', () => runAsSystem(async () => {
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
}, 'lead-export-cleanup'));

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

// ── WHATSAPP WEBHOOK ──────────────────────────────────────
const aiReplyQueue = new Map();

// POST /api/templates/upload-media — upload sample media to Meta and get a handle
const templateMediaMulter = multer({ dest: 'uploads/temp/' });

// ── LEADS IMPORT ──────────────────────────────────────────
const upload = multer({ dest: 'uploads/' });

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

// ── CRON JOBS ─────────────────────────────────────────────
// Re-enabled internal campaign execution cron and added logging for WF05 Dashboard
let scheduledCampaignCronRunning = false;
if (jobsEnabled()) scheduleJob('* * * * *', async () => {
  if (scheduledCampaignCronRunning) return;
  scheduledCampaignCronRunning = true;
  try {
    const rows = await runAsSystem(() => Campaigns.find({ status: 'scheduled', scheduled_at: { $lte: new Date() } }, { _id: 0, id: 1, tenant_id: 1 }).lean(), 'campaign-cron');

    for (const row of rows) {
      if (!row.tenant_id) continue;
      await runAsTenant(row.tenant_id, async () => {
        if (!(await tenantCanSend(row.tenant_id))) return; // restricted/suspended workspaces do not send
        console.log(`Cron: Starting scheduled campaign ${row.id} (tenant ${row.tenant_id})`);
        await executeCampaign(row.id);
        // Log the execution to workflow_logs so it appears in the Admin Dashboard
        await WorkflowLogs.create({
          workflow: 'WF05', lead_id: null, status: 'success',
          message: `Campaign ${row.id} execution automatically triggered by backend engine`,
        });
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
if (jobsEnabled()) scheduleJob('* * * * *', async () => {
  if (process.env.DEMO_REMINDER_FALLBACK_ENABLED === 'false' || demoReminderFallbackRunning) return;
  demoReminderFallbackRunning = true;
  try {
    const localApi = `http://127.0.0.1:${PORT}/api`;
    const tenants = await runAsSystem(() => Tenants.find({ status: 'active' }, { _id: 0, id: 1 }).lean(), 'demo-reminders');
    for (const tenant of tenants) {
      if (!(await tenantCanSend(tenant.id))) continue;
      const internalHeaders = { 'x-internal-key': process.env.INTERNAL_API_KEY, 'x-tenant-id': String(tenant.id) };
      try {
        const dueResponse = await axios.get(`${localApi}/demo-reminders/due`, { headers: internalHeaders, timeout: 15000 });
        for (const reminder of dueResponse.data?.reminders || []) {
          try {
            await axios.post(`${localApi}/demo-reminders/send`, {
              lead_id: reminder.lead_id,
              booking_time: reminder.booking_time,
              reminder_minutes: Number(reminder.reminder_minutes),
            }, { headers: internalHeaders, timeout: 30000 });
          } catch (sendError) {
            console.error('[Demo Reminder Fallback] Send failed:', sendError.response?.data || sendError.message);
          }
        }
      } catch (error) {
        console.error(`[Demo Reminder Fallback] Due check failed for tenant ${tenant.id}:`, error.response?.data || error.message);
      }
    }
  } catch (error) {
    console.error('[Demo Reminder Fallback]', error.message);
  } finally {
    demoReminderFallbackRunning = false;
  }
});

// Tenant lifecycle (plan U6): stores each workspace's state daily and archives
// workspaces that reach day 90. Access rules are also applied live per request.
if (jobsEnabled()) scheduleJob('30 0 * * *', () => {
  require('./services/tenantData').runLifecycleSweep()
    .then((changes) => { if (changes.length) console.log('[Lifecycle] State changes:', JSON.stringify(changes)); })
    .catch((error) => console.error('[Lifecycle] Sweep failed:', error.message));
});

// Run every 1 minute to poll Google Drive folders for new videos
let drivePollerRunning = false;
if (jobsEnabled() && moduleEnabled('contentos') && process.env.DISABLE_DRIVE_POLLER !== 'true') {
  scheduleJob('* * * * *', async () => {
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
if (jobsEnabled() && moduleEnabled('contentos')) scheduleJob('* * * * *', async () => {
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
            'host': new URL(process.env.PUBLIC_API_URL).host,
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
if (jobsEnabled() && moduleEnabled('mafiya')) scheduleJob('0 2 * * 0', async () => {
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

// ── LEADOS ROUTES ─────────────────────────────────────────
// Route handlers live in routes/leados/*.js. They are registered here, after
// every helper above is defined, in their original order.
const DEFAULT_TENANT_ID = 1;
const leadosRouteContext = {
  BrainDocs,
  CampaignImportRecipients,
  CampaignLogs,
  CampaignMessageQueue,
  Campaigns,
  Clients,
  Conversations,
  DEFAULT_TENANT_ID,
  FACEBOOK_SOURCE,
  FailedWebhooks,
  Jimp,
  LeadExportJobs,
  LeadNotes,
  LeadTags,
  Leads,
  META_GRAPH_VERSION,
  META_PROFILE_FIELDS,
  Messages,
  MetaWhatsappAccounts,
  MetaWhatsappPhoneNumbers,
  MetaWhatsappSyncRuns,
  MetaWhatsappTemplates,
  NO_ID,
  Payments,
  SalesTasks,
  Templates,
  Users,
  addDays,
  aiReplyQueue,
  assertPhoneBelongsToWaba,
  auth,
  axios,
  bcrypt,
  cacheMetaBusinessProfile,
  campaignQueueStats,
  clientsWhatsAppStatusReady,
  convertToWhatsAppVoiceNote,
  crypto,
  cryptoHelper,
  dailyLeadBuckets,
  dayKey,
  deleteCascade,
  enrichLeadRows,
  escapeRegex,
  evaluateLeadBrandAndSchedule,
  executeCampaign,
  formatReportDay,
  fs,
  getLeadOSBrand,
  getTemplateVariableNumbers,
  graphPageData,
  ieq,
  insertIgnore,
  internalAuth,
  io,
  jwt,
  leadExportFilter,
  leadExportReady,
  leadFunnel,
  leadInboxMessages,
  leadSourceCounts,
  mediaUpload,
  metaInventoryReady,
  models,
  normalizedPhoneDigits,
  openRouter,
  parsePhoneNumberFromString,
  path,
  phoneTailRegex,
  processLeadExportJob,
  profileLogoUpload,
  rateLimiter,
  resolveClientMetaConfig,
  socialPageId,
  startOfDay,
  sumCapturedPayments,
  syncMetaWhatsAppInventory,
  templateMediaMulter,
  templateParameterDefinitionsReady,
  trigramSimilarity,
  updateKeyCascade,
  updateWhatsAppBusinessProfile,
  verifyClientWhatsApp,
  upload,
  upsertOne,
  validateCampaignParameterMappings,
  validateCampaignTemplate,
  verifyToken,
  xlsx,
  SERVER_ROOT: __dirname,
};
[
  'health',
  'auth',
  'inbox',
  'messages',
  'leads',
  'followups',
  'leads-crud',
  'whatsapp',
  'webhook-whatsapp',
  'webhook-meta-leads',
  'webhook-razorpay',
  'payments',
  'templates',
  'clients',
  'brain',
  'leads-import',
  'webhook-meta',
  'campaigns',
  'reports',
  'users',
  'internal',
].forEach((name) => require(`./routes/leados/${name}`)(app, leadosRouteContext));

// ── ERRORS ────────────────────────────────────────────────
// A query outside its tenant is refused by the tenant-scope plugin. Route
// handlers usually catch their own errors; this covers the ones that do not.
app.use((err, req, res, next) => {
  if (err?.name === 'TenantContextError') {
    console.warn('[Tenant isolation]', req.method, req.originalUrl, err.message);
    return res.status(403).json({ error: 'Access denied' });
  }
  console.error('[Unhandled]', req.method, req.originalUrl, err?.message);
  return res.status(err?.status || 500).json({ error: err?.status && err.status < 500 ? err.message : 'Server error' });
});

// ── START ─────────────────────────────────────────────────
function startBackgroundJobs() {
  if (!jobsEnabled()) {
    console.log('[Startup] Background jobs are disabled (JOBS_ENABLED=false)');
    return;
  }
  resumeLeadExports();

  if (moduleEnabled('alliance')) {
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
  }
  // Start campaign message queue processor
  startCampaignQueueProcessor();

  // Reset any stuck publishing jobs on startup to prevent limbo states
  if (moduleEnabled('contentos')) models.PublishQueue.updateMany(
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
}

// A promise rejection nobody handled (for example a database call made while
// the connection is down) is logged; it must not take the whole API down.
process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled rejection]', reason?.message || reason);
});

function start() {
  for (const name of ['JWT_SECRET', 'INTERNAL_API_KEY', 'TOKEN_ENCRYPTION_KEY', 'PUBLIC_API_URL', 'PORTAL_URL']) {
    if (!process.env[name]) {
      console.error(`[Startup] ${name} is not set; refusing to start.`);
      process.exit(1);
    }
  }
  // The API listens only once MongoDB is connected. If the database cannot be
  // reached (network down, or this machine's IP not allowed by the database
  // firewall), keep retrying instead of exiting, so a dev server under nodemon
  // comes up on its own as soon as the database is reachable again.
  const RETRY_MS = Number(process.env.MONGO_RETRY_MS || 10000);
  const attempt = (n = 1) => connectMongo().then(() => httpServer.listen(PORT, () => {
    console.log(`Nera LeadOS API running on port ${PORT} (Socket.io enabled)`);
    if (DISABLED_MODULES.size) console.log(`[Startup] Disabled modules: ${[...DISABLED_MODULES].join(', ')}`);
    startBackgroundJobs();
  })).catch((error) => {
    console.error(`[Startup] MongoDB connection failed (attempt ${n}): ${error.message}. The API is not listening yet; retrying in ${RETRY_MS / 1000}s. Check the network and that this machine's IP is allowed by the database firewall.`);
    setTimeout(() => attempt(n + 1), RETRY_MS);
  });
  return attempt();
}

// Tests import the app without starting it (NERA_NO_AUTOSTART=true). A plain
// require.main check would also stop PM2, which loads this file through a wrapper.
if (process.env.NERA_NO_AUTOSTART !== 'true') start();

module.exports = { app, httpServer, io, socketServer, start, scheduledMetaInventorySync };
  
