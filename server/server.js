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
const { Pool } = require('pg');
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
const pool = require('./db/connection');
const templateParameterDefinitionsReady = pool.query(`
  ALTER TABLE templates ADD COLUMN IF NOT EXISTS parameter_definitions JSONB NOT NULL DEFAULT '{}'::jsonb;
  ALTER TABLE templates ADD COLUMN IF NOT EXISTS template_scope VARCHAR(20) NOT NULL DEFAULT 'shared';
`).catch(err => console.error('[Templates] Parameter definitions migration failed:', err.message));
const clientsWhatsAppStatusReady = pool.query(`
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_status VARCHAR(30) NOT NULL DEFAULT 'not_configured';
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMP;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_verification_error TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_tag TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS brand_voice TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS industry TEXT;
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS target_audience TEXT;
`).catch(err => console.error('[Clients] WhatsApp status migration failed:', err.message));
const metaInventoryReady = pool.query(`
  CREATE TABLE IF NOT EXISTS meta_whatsapp_accounts (
    waba_id VARCHAR(100) PRIMARY KEY, business_id VARCHAR(100), name TEXT,
    currency VARCHAR(10), timezone_id VARCHAR(30), template_namespace TEXT,
    ownership_type VARCHAR(20), raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS meta_whatsapp_phone_numbers (
    phone_number_id VARCHAR(100) PRIMARY KEY,
    waba_id VARCHAR(100) REFERENCES meta_whatsapp_accounts(waba_id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    display_phone_number TEXT, verified_name TEXT, verification_status TEXT,
    connection_status TEXT, quality_rating TEXT, platform_type TEXT,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS meta_whatsapp_templates (
    template_id VARCHAR(100) PRIMARY KEY, waba_id VARCHAR(100), name TEXT,
    language VARCHAR(20), status VARCHAR(30), category VARCHAR(30),
    components JSONB NOT NULL DEFAULT '[]'::jsonb,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE TABLE IF NOT EXISTS meta_whatsapp_sync_runs (
    id BIGSERIAL PRIMARY KEY, status VARCHAR(20), wabas_count INT DEFAULT 0,
    phones_count INT DEFAULT 0, templates_count INT DEFAULT 0,
    error TEXT, started_at TIMESTAMP DEFAULT NOW(), completed_at TIMESTAMP
  );
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_picture_url TEXT;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_about TEXT;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_address TEXT;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_description TEXT;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_email TEXT;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_websites JSONB NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE meta_whatsapp_phone_numbers ADD COLUMN IF NOT EXISTS profile_vertical TEXT;
`).catch(err => console.error('[Meta Inventory] Migration failed:', err.message));

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
  await pool.query(`UPDATE meta_whatsapp_phone_numbers SET
    profile_picture_url=$1,profile_about=$2,profile_address=$3,profile_description=$4,
    profile_email=$5,profile_websites=$6,profile_vertical=$7,raw_data=raw_data || $8::jsonb,last_synced_at=NOW()
    WHERE phone_number_id=$9`, [profile.profile_picture_url || null, profile.about || null,
    profile.address || null, profile.description || null, profile.email || null,
    JSON.stringify(profile.websites || []), profile.vertical || null,
    JSON.stringify({ business_profile: profile }), String(config.phoneId)]);
  if (client.id) {
    await pool.query('UPDATE meta_whatsapp_phone_numbers SET client_id=$1 WHERE phone_number_id=$2', [client.id, config.phoneId]);
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
  await pool.query(`UPDATE meta_whatsapp_phone_numbers SET
    profile_picture_url=$1,profile_about=$2,profile_address=$3,profile_description=$4,
    profile_email=$5,profile_websites=$6,profile_vertical=$7,raw_data=raw_data || $8::jsonb,last_synced_at=NOW()
    WHERE phone_number_id=$9`, [profile.profile_picture_url || null, profile.about || null,
    profile.address || null, profile.description || null, profile.email || null,
    JSON.stringify(profile.websites || []), profile.vertical || null,
    JSON.stringify({ business_profile: profile }), String(phoneId)]);
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
  const run = await pool.query(`INSERT INTO meta_whatsapp_sync_runs (status) VALUES ('running') RETURNING id`);
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
      await pool.query(`INSERT INTO meta_whatsapp_accounts
        (waba_id, business_id, name, currency, timezone_id, template_namespace, ownership_type, raw_data, last_synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (waba_id) DO UPDATE SET
        business_id=EXCLUDED.business_id,name=EXCLUDED.name,currency=EXCLUDED.currency,
        timezone_id=EXCLUDED.timezone_id,template_namespace=EXCLUDED.template_namespace,
        ownership_type=EXCLUDED.ownership_type,raw_data=EXCLUDED.raw_data,last_synced_at=NOW()`,
      [String(waba.id), businessId || null, waba.name, waba.currency, waba.timezone_id,
        waba.message_template_namespace, waba.ownership_type, JSON.stringify(waba)]);
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
        await pool.query(`INSERT INTO meta_whatsapp_phone_numbers
          (phone_number_id,waba_id,display_phone_number,verified_name,verification_status,connection_status,quality_rating,platform_type,profile_picture_url,profile_about,profile_address,profile_description,profile_email,profile_websites,profile_vertical,raw_data,last_synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()) ON CONFLICT (phone_number_id) DO UPDATE SET
          waba_id=EXCLUDED.waba_id,display_phone_number=EXCLUDED.display_phone_number,
          verified_name=EXCLUDED.verified_name,verification_status=EXCLUDED.verification_status,
          connection_status=EXCLUDED.connection_status,quality_rating=EXCLUDED.quality_rating,
          platform_type=EXCLUDED.platform_type,profile_picture_url=EXCLUDED.profile_picture_url,
          profile_about=EXCLUDED.profile_about,profile_address=EXCLUDED.profile_address,
          profile_description=EXCLUDED.profile_description,profile_email=EXCLUDED.profile_email,
          profile_websites=EXCLUDED.profile_websites,profile_vertical=EXCLUDED.profile_vertical,
          raw_data=EXCLUDED.raw_data,last_synced_at=NOW()`,
        [String(phone.id), String(waba.id), phone.display_phone_number, phone.verified_name,
          phone.code_verification_status, phone.status, phone.quality_rating, phone.platform_type,
          profile.profile_picture_url, profile.about, profile.address, profile.description, profile.email,
          JSON.stringify(profile.websites || []), profile.vertical, JSON.stringify({ ...phone, business_profile: profile })]);
      }
      for (const template of templates) {
        await pool.query(`INSERT INTO meta_whatsapp_templates
          (template_id,waba_id,name,language,status,category,components,raw_data,last_synced_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (template_id) DO UPDATE SET
          waba_id=EXCLUDED.waba_id,name=EXCLUDED.name,language=EXCLUDED.language,status=EXCLUDED.status,
          category=EXCLUDED.category,components=EXCLUDED.components,raw_data=EXCLUDED.raw_data,last_synced_at=NOW()`,
        [String(template.id), String(waba.id), template.name, template.language, template.status,
          template.category, JSON.stringify(template.components || []), JSON.stringify(template)]);
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
      await pool.query(`
        DELETE FROM meta_whatsapp_templates
        WHERE waba_id IN (
          SELECT waba_id
          FROM meta_whatsapp_accounts
          WHERE business_id = $1
            AND NOT (waba_id = ANY($2::text[]))
        )
      `, [businessId, activeWabaIds]);
      await pool.query(`
        DELETE FROM meta_whatsapp_accounts
        WHERE business_id = $1
          AND NOT (waba_id = ANY($2::text[]))
      `, [businessId, activeWabaIds]);
    }
    await pool.query(`UPDATE clients client SET
      wa_business_id=phone.waba_id, phone_number_id=phone.phone_number_id,
      whatsapp_number=phone.display_phone_number,
      whatsapp_status=CASE WHEN UPPER(COALESCE(phone.connection_status,''))='CONNECTED'
        OR UPPER(COALESCE(phone.verification_status,''))='VERIFIED' THEN 'verified' ELSE 'verification_pending' END,
      whatsapp_verified_at=CASE WHEN UPPER(COALESCE(phone.connection_status,''))='CONNECTED'
        OR UPPER(COALESCE(phone.verification_status,''))='VERIFIED'
        THEN COALESCE(client.whatsapp_verified_at,NOW()) ELSE NULL END,
      updated_at=NOW()
      FROM meta_whatsapp_phone_numbers phone WHERE phone.client_id=client.id`);
    await pool.query(`UPDATE meta_whatsapp_sync_runs SET status='success',wabas_count=$1,
      phones_count=$2,templates_count=$3,completed_at=NOW() WHERE id=$4`,
    [wabaMap.size, phoneCount, templateCount, run.rows[0].id]);
    return { wabas: wabaMap.size, phone_numbers: phoneCount, templates: templateCount };
  } catch (error) {
    const message = error.response?.data?.error?.message || error.message;
    await pool.query(`UPDATE meta_whatsapp_sync_runs SET status='failed',error=$1,completed_at=NOW() WHERE id=$2`, [message, run.rows[0].id]);
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

// Initialize campaign queue table
async function initCampaignQueue() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_message_queue (
      id SERIAL PRIMARY KEY,
      campaign_id BIGINT NOT NULL,
      lead_id BIGINT NOT NULL,
      phone VARCHAR(20) NOT NULL,
      name VARCHAR(255),
      template_name VARCHAR(255) NOT NULL,
      template_language VARCHAR(20) DEFAULT 'en',
      template_body TEXT,
      template_header TEXT,
      template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
      recipient_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
      recipient_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      campaign_name TEXT,
      brand_name TEXT,
      wa_token VARCHAR(500),
      phone_number_id VARCHAR(100),
      status VARCHAR(20) DEFAULT 'pending',
      attempts INTEGER DEFAULT 0,
      last_attempt_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    )
  `);

  await pool.query(`
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS template_language VARCHAR(20) DEFAULT 'en';
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS template_header TEXT;
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS recipient_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS recipient_data JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS campaign_name TEXT;
    ALTER TABLE campaign_message_queue ADD COLUMN IF NOT EXISTS brand_name TEXT;
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  // Create indexes separately for PostgreSQL
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_queue_status ON campaign_message_queue(status)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_queue_campaign ON campaign_message_queue(campaign_id)`).catch(() => {});

  // Create table to track daily/hourly counts
  await pool.query(`
    CREATE TABLE IF NOT EXISTS campaign_rate_stats (
      id SERIAL PRIMARY KEY,
      campaign_id BIGINT,
      date DATE DEFAULT CURRENT_DATE,
      messages_sent INTEGER DEFAULT 0,
      messages_failed INTEGER DEFAULT 0,
      rate_limited_count INTEGER DEFAULT 0,
      UNIQUE(campaign_id, date)
    )
  `).catch(() => {});

  console.log('[Campaign Queue] Database tables initialized');
}

// Add messages to queue
async function addToCampaignQueue(campaign_id, leads, campaign) {
  if (leads.length > 0) {
    await pool.query(`
      INSERT INTO campaign_message_queue
      (campaign_id, lead_id, phone, name, template_name, template_language, template_body,
       template_header, template_parameters, recipient_parameters, recipient_data, campaign_name, brand_name, wa_token, phone_number_id)
      SELECT $1, audience.lead_id, audience.phone, audience.name,
             $2, $3, $4, $5, $6::jsonb, audience.parameters, audience.data, $7, $8, $9, $10
      FROM UNNEST($11::bigint[], $12::text[], $13::text[], $14::jsonb[], $15::jsonb[])
        AS audience(lead_id, phone, name, parameters, data)
      WHERE NOT EXISTS (
        SELECT 1
        FROM campaign_message_queue queued
        WHERE queued.campaign_id = $1
          AND queued.lead_id = audience.lead_id
      )
    `, [
      campaign_id,
      campaign.template_name,
      campaign.template_language || 'en',
      campaign.template_body || '',
      campaign.template_header || '',
      JSON.stringify(campaign.template_parameters || {}),
      campaign.campaign_name || '',
      campaign.brand_name || '',
      campaign.wa_access_token || '',
      campaign.phone_number_id || '',
      leads.map((lead) => lead.id),
      leads.map((lead) => lead.phone),
      leads.map((lead) => lead.name || ''),
      leads.map((lead) => JSON.stringify(lead.template_parameters || {})),
      leads.map((lead) => JSON.stringify({
        recipient_email: lead.email || '', lead_status: lead.status || '',
        lead_source: lead.source || '', lead_interest: lead.interest || '', lead_score: lead.score ?? ''
      })),
    ]);
  }
}

// Process queue - runs continuously
async function processCampaignQueue() {
  try {
    // Recover jobs abandoned by a crashed/restarted worker. A normal send has
    // a 15-second HTTP timeout, so five minutes safely indicates a stale claim.
    await pool.query(`
      UPDATE campaign_message_queue
      SET status = 'pending'
      WHERE status = 'processing'
        AND last_attempt_at < NOW() - INTERVAL '5 minutes'
    `);

    // Quarantine duplicate queue rows left by older executions before any
    // recipient is claimed. Keep the oldest row as the canonical send.
    await pool.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY campaign_id, lead_id
                 ORDER BY id
               ) AS duplicate_rank
        FROM campaign_message_queue
        WHERE status IN ('pending', 'processing')
      )
      UPDATE campaign_message_queue queue
      SET status = 'failed',
          processed_at = NOW(),
          error_message = 'Duplicate queue entry skipped before send'
      FROM ranked
      WHERE queue.id = ranked.id
        AND (
          ranked.duplicate_rank > 1
          OR EXISTS (
            SELECT 1
            FROM campaign_message_queue sent
            WHERE sent.campaign_id = queue.campaign_id
              AND sent.lead_id = queue.lead_id
              AND sent.status = 'sent'
          )
        )
    `);

    // Atomically claim rows before doing any network work. FOR UPDATE SKIP
    // LOCKED prevents overlapping queue intervals (or multiple API instances)
    // from sending the same recipient at the same time.
    const { rows: pending } = await pool.query(`
      WITH claimable AS (
        SELECT id
        FROM campaign_message_queue
        WHERE status = 'pending'
          AND attempts < ${QUEUE_SETTINGS.MAX_RETRIES}
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${QUEUE_SETTINGS.BATCH_SIZE}
      )
      UPDATE campaign_message_queue queue
      SET status = 'processing',
          attempts = queue.attempts + 1,
          last_attempt_at = NOW()
      FROM claimable
      WHERE queue.id = claimable.id
      RETURNING queue.*
    `);

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
          await pool.query(`
            UPDATE campaign_message_queue
            SET status = 'sent', processed_at = NOW(), error_message = NULL
            WHERE id = $1
          `, [msg.id]);

          // Update campaign log
          await pool.query(`
            INSERT INTO campaign_logs (campaign_id, lead_id, wa_message_id, status, sent_at)
            VALUES ($1, $2, $3, 'sent', NOW())
          `, [msg.campaign_id, msg.lead_id, result.messageId]);

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
            const conversationResult = await pool.query(`
              INSERT INTO conversations
                (lead_id, tenant_id, phone, status, last_message, last_message_at, created_at)
              SELECT $1, campaign.client_id, $2, 'open', $3, NOW(), NOW()
              FROM campaigns campaign
              WHERE campaign.id = $4
              ON CONFLICT (phone, tenant_id) DO UPDATE
                SET lead_id = EXCLUDED.lead_id,
                    status = 'open',
                    last_message = EXCLUDED.last_message,
                    last_message_at = NOW()
              RETURNING id
            `, [msg.lead_id, msg.phone, renderedBody, msg.campaign_id]);

            const conversationId = conversationResult.rows[0]?.id;
            if (conversationId) {
              const messageResult = await pool.query(`
                INSERT INTO messages
                  (conversation_id, direction, content, msg_type, wa_msg_id, status, is_ai, sent_at)
                VALUES ($1, 'outbound', $2, 'template', $3, 'sent', false, NOW())
                RETURNING id, conversation_id, direction, content,
                          msg_type AS type, wa_msg_id, status, is_ai,
                          sent_at AS timestamp
              `, [conversationId, renderedBody, result.messageId]);

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
          await pool.query(`
            INSERT INTO campaign_rate_stats (campaign_id, date, messages_sent)
            VALUES ($1, CURRENT_DATE, 1)
            ON CONFLICT (campaign_id, date)
            DO UPDATE SET messages_sent = campaign_rate_stats.messages_sent + 1
          `, [msg.campaign_id]);

          recordSendSuccess();
        } else if (result.rateLimited) {
          // Release the claim so a later queue pass can retry it.
          await pool.query(`
            UPDATE campaign_message_queue
            SET status = 'pending', error_message = $2
            WHERE id = $1
          `, [msg.id, result.error]);
          recordRateLimit();

          // Update rate limit stat
          await pool.query(`
            INSERT INTO campaign_rate_stats (campaign_id, date, rate_limited_count)
            VALUES ($1, CURRENT_DATE, 1)
            ON CONFLICT (campaign_id, date)
            DO UPDATE SET rate_limited_count = campaign_rate_stats.rate_limited_count + 1
          `, [msg.campaign_id]);

          console.warn(`[Campaign Queue] Rate limited: ${result.error}`);
        } else {
          // Permanent failure
          await pool.query(`
            UPDATE campaign_message_queue
            SET status = 'failed', processed_at = NOW(),
                error_message = $2
            WHERE id = $1
          `, [msg.id, result.error]);

          // Log failure
          await pool.query(`
            INSERT INTO campaign_logs (campaign_id, lead_id, status, error_message, sent_at)
            VALUES ($1, $2, 'failed', $3, NOW())
          `, [msg.campaign_id, msg.lead_id, result.error]);

          // Update stats
          await pool.query(`
            INSERT INTO campaign_rate_stats (campaign_id, date, messages_failed)
            VALUES ($1, CURRENT_DATE, 1)
            ON CONFLICT (campaign_id, date)
            DO UPDATE SET messages_failed = campaign_rate_stats.messages_failed + 1
          `, [msg.campaign_id]);
        }

        // Wait between messages
        const delay = getRecommendedDelay();
        await new Promise(r => setTimeout(r, delay));

      } catch (err) {
        console.error(`[Campaign Queue] Error processing message ${msg.id}:`, err.message);
        // The external result is unknown for unexpected errors. Do not
        // immediately release the row and risk a duplicate send; leave it
        // claimed for stale-job review/recovery.
        await pool.query(`
          UPDATE campaign_message_queue
          SET error_message = $2
          WHERE id = $1
        `, [msg.id, `Worker error after claim: ${err.message}`]).catch(() => {});
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

  const [pending, sent, failed] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM campaign_message_queue WHERE campaign_id = $1 AND status IN ('pending', 'processing')`, [campaign_id]),
    pool.query(`SELECT COUNT(*) FROM campaign_message_queue WHERE campaign_id = $1 AND status = 'sent'`, [campaign_id]),
    pool.query(`SELECT COUNT(*) FROM campaign_message_queue WHERE campaign_id = $1 AND status = 'failed'`, [campaign_id])
  ]);

  const pendingCount = parseInt(pending.rows[0].count);
  const sentCount = parseInt(sent.rows[0].count);
  const failedCount = parseInt(failed.rows[0].count);

  if (pendingCount === 0) {
    const finalStatus = sentCount > 0 ? 'completed' : 'failed';
    await pool.query(`UPDATE campaigns SET status = $1 WHERE id = $2`, [finalStatus, campaign_id]);
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
const thedalRoutes = require('./routes/thedal');
const thedalClientsRoutes = require('./routes/thedal-clients');
const thedalPlansRoutes = require('./routes/thedal-plans');
const thedalAuditRoutes = require('./routes/thedal-audit');
const thedalSeoAuditRoutes = require('./routes/thedal-seo-audit');
const thedalKeywordTrackingRoutes = require('./routes/thedal-keywordtracking');
const thedalGscIntelRoutes = require('./routes/thedal-gsc-intel');
const thedalSerpRadarRoutes = require('./routes/thedal-serp-radar');
const thedalGapHunterRoutes = require('./routes/thedal-gap-hunter');
const thedalSchemaLibraryRoutes = require('./routes/thedal-schema-library');
const thedalCompetitorSpyRoutes = require('./routes/thedal-competitor-spy');
const thedalBacklinksRoutes = require('./routes/thedal-backlinks');
const thedalCitationsRoutes = require('./routes/thedal-citations');
const thedalLocalSeoBridgeRoutes = require('./routes/thedal-localseobridge');
const thedalRankDropAlertRoutes = require('./routes/thedal-rank-drop-alert');
const thedalContentRoutes = require('./routes/thedal-content');
const contentRoutes = require('./routes/contentRoutes');
const integrationsRoutes = require('./routes/integrationsRoutes');

const salesosRoutes = require('./routes/salesos');

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

// Thedal OS Routes
app.use('/api/thedal/audit', auth, thedalAuditRoutes);
app.use('/api/thedal/plans', auth, thedalPlansRoutes);
app.use('/api/thedal/seo-audit', auth, thedalSeoAuditRoutes);
app.use('/api/thedal/keywordtracking', auth, thedalKeywordTrackingRoutes);
app.use('/api/thedal/gscintel', thedalGscIntelRoutes); // Removed auth so OAuth browser redirects work
app.use('/api/thedal/serpradar', auth, thedalSerpRadarRoutes);
app.use('/api/thedal/gaphunter', auth, thedalGapHunterRoutes);
app.use('/api/thedal/schemalibrary', auth, thedalSchemaLibraryRoutes);
app.use('/api/thedal/competitorspy', auth, thedalCompetitorSpyRoutes);
app.use('/api/thedal/rankdropalert', auth, thedalRankDropAlertRoutes);
app.use('/api/thedal/backlinks', auth, thedalBacklinksRoutes);
app.use('/api/thedal/citations', auth, thedalCitationsRoutes);
app.use('/api/thedal/localseobridge', auth, thedalLocalSeoBridgeRoutes);
app.use('/api/thedal/clients', auth, thedalClientsRoutes);
app.use('/api/thedal/content', auth, thedalContentRoutes);
app.use('/api/thedal', auth, thedalRoutes);

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
    // Graph API endpoints accept the page access token for media download
    const waToken = process.env.META_PAGE_ACCESS_TOKEN; 
    
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

    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1 AND is_active = true', [email.toLowerCase()]);
    if (!rows.length) return res.status(401).json({ error: 'Invalid credentials' });

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

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
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
    const valid = await bcrypt.compare(current, rows[0].password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password incorrect' });
    const hash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);
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
    const q = `
      SELECT 
        l.id, 
        l.name, 
        c.name as brand, 
        l.status,
        (SELECT last_message FROM conversations WHERE lead_id = l.id OR (lead_id IS NULL AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10)) ORDER BY last_message_at DESC NULLS LAST LIMIT 1) as last,
        (SELECT last_message_at FROM conversations WHERE lead_id = l.id OR (lead_id IS NULL AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10)) ORDER BY last_message_at DESC NULLS LAST LIMIT 1) as time,
        COALESCE((SELECT SUM(unread_count) FROM conversations WHERE lead_id = l.id OR (lead_id IS NULL AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10))), 0) as unread
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE EXISTS (SELECT 1 FROM conversations WHERE lead_id = l.id OR (lead_id IS NULL AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10)))
      ORDER BY time DESC NULLS LAST
    `;
    const { rows } = await pool.query(q);
    res.json(rows);
  } catch (err) {
    console.error('Inbox fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PUT /api/conversations/:lead_id/read
app.put('/api/conversations/:lead_id/read', auth, async (req, res) => {
  try {
    await pool.query(`
      UPDATE conversations SET unread_count = 0 
      WHERE lead_id = $1 OR RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = (
        SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) FROM leads WHERE id = $1 LIMIT 1
      )
    `, [req.params.lead_id]);
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
    const { rows } = await pool.query('UPDATE messages SET content = $1 WHERE id = $2 RETURNING *', [content, msgId]);
    if (rows.length) {
      io.emit('message_edited', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
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
    const { rows } = await pool.query('UPDATE messages SET is_deleted = true WHERE id = $1 RETURNING *', [msgId]);
    if (rows.length) {
      io.emit('message_deleted', rows[0]);
    }
    res.json({ success: true, message: rows[0] });
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

    let query;
    let params;

    if (unpin) {
      query = 'UPDATE messages SET pinned_until = NULL WHERE id = $1 RETURNING *';
      params = [msgId];
    } else {
      query = `UPDATE messages SET pinned_until = NOW() + interval '1 hour' * $1 WHERE id = $2 RETURNING *`;
      params = [duration || 24, msgId];
    }

    const { rows } = await pool.query(query, params);
    if (rows.length) {
      io.emit('message_edited', rows[0]); // reuse message_edited or create message_pinned event
    }
    res.json({ success: true, message: rows[0] });
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

    const { rows } = await pool.query(
      'UPDATE messages SET is_starred = $1 WHERE id = $2 RETURNING *',
      [is_starred, msgId]
    );

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
    const msgQuery = await pool.query(`
      SELECT m.reactions, m.wa_msg_id, l.phone, c.phone_number_id, c.wa_access_token
      FROM messages m
      JOIN conversations cv ON m.conversation_id = cv.id
      JOIN leads l ON cv.lead_id = l.id
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE m.id = $1
    `, [msgId]);

    if (!msgQuery.rows.length) return res.status(404).json({ error: 'Message not found' });
    const msgData = msgQuery.rows[0];

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

    const { rows } = await pool.query(
      'UPDATE messages SET reactions = $1::jsonb WHERE id = $2 RETURNING *',
      [JSON.stringify(reactions), msgId]
    );

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
    const result = await pool.query('SELECT name, body, header, parameter_definitions FROM templates WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Template not found' });
    const template = result.rows[0];
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

    let query = `
      SELECT cir.batch_id, cir.lead_id, cir.created_at, l.name, l.phone, l.client_id, l.status
      FROM campaign_import_recipients cir
      JOIN leads l ON cir.lead_id = l.id
    `;
    let params = [];

    if (batch_id) {
      query += ' WHERE cir.batch_id = $1';
      params.push(batch_id);
    }

    query += ' ORDER BY cir.created_at DESC LIMIT 50';

    const result = await pool.query(query, params);

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
    const { rows } = await pool.query(
      `SELECT DISTINCT source FROM leads WHERE source IS NOT NULL AND source <> '' ORDER BY source`
    );
    
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
    const { rows } = await pool.query(`
      SELECT
        l.id as lead_id,
        l.name,
        l.phone,
        l.email,
        l.status as lead_status,
        l.client_id,
        l.touch_count,
        l.next_follow_up,
        l.last_contact,
        c.name as brand
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE l.next_follow_up IS NOT NULL
        AND l.next_follow_up <= NOW()
        AND l.status NOT IN ('lost', 'converted')
      ORDER BY l.next_follow_up ASC
      LIMIT 100
    `);
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
    const { rows } = await pool.query(`
      SELECT * FROM followup_rules
      WHERE client_id = (SELECT client_id FROM leads WHERE id = $1)
        AND stage = $2
        AND touch_count <= $3
      ORDER BY touch_count DESC
      LIMIT 1
    `, [lead_id, stage || 'new', touch_count || 0]);

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
    const { rows } = await pool.query(`
      SELECT MAX(sent_at) as last_message_at
      FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE c.lead_id = $1 AND m.direction = 'outbound'
    `, [lead_id]);

    const lastMessageAt = rows[0]?.last_message_at;
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
    const leadRes = await pool.query(`
      SELECT l.*, c.wa_access_token, c.phone_number_id, c.whatsapp_status
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1
    `, [lead_id]);

    if (!leadRes.rows.length) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    const lead = leadRes.rows[0];
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
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
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
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
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

    await pool.query(`
      INSERT INTO lead_notes (lead_id, user_id, note, created_at)
      VALUES ($1, $2, $3, NOW())
    `, [lead_id, req.user.id, note]);

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
      await pool.query(`
        UPDATE leads SET touch_count = COALESCE(touch_count, 0) + 1, updated_at = NOW()
        WHERE id = $1
      `, [lead_id]);
    }

    // Set next follow-up
    if (delay_hours) {
      await pool.query(`
        UPDATE leads SET next_follow_up = NOW() + INTERVAL '${delay_hours} hours', last_contact = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [lead_id]);
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
const leadExportReady = pool.query(`
  CREATE TABLE IF NOT EXISTS lead_export_jobs (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT,
    mode VARCHAR(20) NOT NULL,
    filters JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(20) NOT NULL DEFAULT 'queued',
    total_records INTEGER NOT NULL DEFAULT 0,
    processed_records INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,
    error_message TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    started_at TIMESTAMP,
    completed_at TIMESTAMP
  )
`).then(() => pool.query(`CREATE INDEX IF NOT EXISTS idx_lead_export_jobs_user_created ON lead_export_jobs(user_id, created_at DESC)`));

function addLeadExportFilters(filter, params) {
  let sql = '';
  const source = String(filter.source || '').toLowerCase();
  if (source === 'facebook') {
    sql += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'`;
  } else if (source === 'whatsapp') {
    sql += ` AND LOWER(TRIM(COALESCE(l.source, ''))) LIKE '%whatsapp%'`;
  } else if (source === 'website') {
    sql += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(website|web site)%'`;
  } else if (source === 'xls_sheet') {
    sql += ` AND (LOWER(TRIM(COALESCE(l.source, ''))) IN ('xls sheet', 'xlsx sheet', 'excel sheet', 'csv import') OR LOWER(TRIM(COALESCE(l.source, ''))) LIKE 'csv\\_%' ESCAPE '\\')`;
  }
  if (filter.from) {
    params.push(filter.from);
    sql += ` AND l.created_at >= $${params.length}`;
  }
  if (filter.to) {
    params.push(filter.to);
    sql += ` AND l.created_at <= $${params.length}`;
  }
  return sql;
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
    const { rows } = await pool.query('SELECT * FROM lead_export_jobs WHERE id = $1', [jobId]);
    const job = rows[0];
    if (!job || job.status !== 'queued') return;

    await pool.query(`UPDATE lead_export_jobs SET status = 'processing', started_at = NOW() WHERE id = $1`, [jobId]);
    fs.mkdirSync(LEAD_EXPORT_DIR, { recursive: true });
    const filePath = path.join(LEAD_EXPORT_DIR, `${jobId}.csv`);
    stream = fs.createWriteStream(filePath, { encoding: 'utf8' });
    stream.write('\uFEFFName,Phone,Source,Brand,Status,Score,Assigned,Interest,Created At\n');

    const filter = job.filters || {};
    let lastId = 0;
    let processed = 0;
    const batchSize = 2000;
    while (true) {
      const params = [lastId];
      const where = addLeadExportFilters(filter, params);
      params.push(batchSize);
      const batch = await pool.query(`
        SELECT l.id, l.name, l.phone, l.source, c.name AS brand_name, l.status,
               l.score, u.name AS assigned_name, l.interest, l.created_at
        FROM leads l
        LEFT JOIN clients c ON c.id = l.client_id
        LEFT JOIN users u ON u.id = l.assigned_to
        WHERE l.id > $1 ${where}
        ORDER BY l.id ASC
        LIMIT $${params.length}
      `, params);
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
      await pool.query('UPDATE lead_export_jobs SET processed_records = $1 WHERE id = $2', [processed, jobId]);
      await new Promise(resolve => setImmediate(resolve));
    }

    await new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.end(resolve);
    });
    stream = null;
    await pool.query(`UPDATE lead_export_jobs SET status = 'completed', processed_records = $1, file_path = $2, completed_at = NOW() WHERE id = $3`, [processed, filePath, jobId]);
  } catch (err) {
    if (stream) stream.destroy();
    console.error(`[Lead Export ${jobId}]`, err);
    await pool.query(`UPDATE lead_export_jobs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE id = $2`, [err.message, jobId]).catch(() => {});
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
    const countParams = [];
    const where = addLeadExportFilters(filters, countParams);
    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM leads l WHERE 1=1 ${where}`, countParams);
    const totalRecords = countResult.rows[0].count;
    const userId = req.user.id || req.user.user_id || null;
    const result = await pool.query(`
      INSERT INTO lead_export_jobs (user_id, mode, filters, total_records)
      VALUES ($1, $2, $3::jsonb, $4) RETURNING id, status, total_records
    `, [userId, mode, JSON.stringify(filters), totalRecords]);
    const job = result.rows[0];
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
  const { rows } = await pool.query(`SELECT id, status, total_records, processed_records, error_message, created_at, completed_at FROM lead_export_jobs WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2`, [req.params.id, userId]);
  if (!rows.length) return res.status(404).json({ error: 'Export not found' });
  res.json(rows[0]);
});

app.get('/api/leads/exports/:id/download', auth, async (req, res) => {
  await leadExportReady;
  const userId = req.user.id || req.user.user_id || null;
  const { rows } = await pool.query(`SELECT status, file_path, mode FROM lead_export_jobs WHERE id = $1 AND user_id IS NOT DISTINCT FROM $2`, [req.params.id, userId]);
  const job = rows[0];
  if (!job) return res.status(404).json({ error: 'Export not found' });
  if (job.status !== 'completed' || !job.file_path || !fs.existsSync(job.file_path)) return res.status(409).json({ error: 'Export is not ready' });
  res.download(job.file_path, `leads_export_${job.mode}_${new Date().toISOString().slice(0, 10)}.csv`);
});

// Resume interrupted jobs after a server restart.
leadExportReady.then(async () => {
  await pool.query(`UPDATE lead_export_jobs SET status = 'queued', error_message = NULL WHERE status = 'processing'`);
  const { rows } = await pool.query(`SELECT id FROM lead_export_jobs WHERE status = 'queued' ORDER BY created_at ASC`);
  for (const row of rows) setImmediate(() => processLeadExportJob(row.id));
}).catch(err => console.error('[Lead Export] Startup recovery failed:', err.message));

// Export files are temporary. Clean up completed/failed jobs after 48 hours.
cron.schedule('17 */6 * * *', async () => {
  try {
    await leadExportReady;
    const { rows } = await pool.query(`SELECT id, file_path FROM lead_export_jobs WHERE created_at < NOW() - INTERVAL '48 hours'`);
    for (const job of rows) {
      if (job.file_path && fs.existsSync(job.file_path)) fs.unlinkSync(job.file_path);
    }
    await pool.query(`DELETE FROM lead_export_jobs WHERE created_at < NOW() - INTERVAL '48 hours'`);
  } catch (err) {
    console.error('[Lead Export] Cleanup failed:', err.message);
  }
});

// GET /api/leads
app.get('/api/leads/facebook-filter-options', auth, async (req, res) => {
  try {
    const [leadOptions, pageOptions] = await Promise.all([
      pool.query(`
        SELECT DISTINCT campaign_name, ad_name
        FROM leads
        WHERE LOWER(TRIM(COALESCE(source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'
          AND (NULLIF(TRIM(campaign_name), '') IS NOT NULL OR NULLIF(TRIM(ad_name), '') IS NOT NULL)
        ORDER BY campaign_name NULLS LAST, ad_name NULLS LAST
      `),
      pool.query(`
        SELECT DISTINCT platform, account_name AS page_name, brand_name,
          CASE WHEN LOWER(platform) = 'instagram'
            THEN COALESCE(NULLIF(instagram_business_id, ''), NULLIF(account_id, ''), NULLIF(facebook_page_id, ''))
            ELSE COALESCE(NULLIF(facebook_page_id, ''), NULLIF(account_id, ''), NULLIF(instagram_business_id, ''))
          END AS page_id
        FROM brand_social_accounts
        WHERE is_active = TRUE
          AND LOWER(platform) IN ('facebook', 'instagram')
          AND NULLIF(TRIM(account_name), '') IS NOT NULL
        ORDER BY platform, account_name
      `)
    ]);
    res.json({ options: leadOptions.rows, pages: pageOptions.rows.filter(page => page.page_id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/leads', auth, async (req, res) => {
  try {
    const { status, brand, search, source, campaign_name, ad_name, meta_page_id, from, to, tag_id, limit = 100, offset = 0 } = req.query;
    let q = `
      SELECT l.*, COUNT(*) OVER() AS filtered_total, c.name as brand_name, u.name as assigned_name,
        (
          SELECT page_account.account_name
          FROM brand_social_accounts page_account
          WHERE page_account.brand_name = c.name
            AND LOWER(page_account.platform) = 'facebook'
            AND page_account.is_active = TRUE
            AND NULLIF(TRIM(page_account.account_name), '') IS NOT NULL
          ORDER BY page_account.id
          LIMIT 1
        ) AS facebook_page_name,
        COALESCE((SELECT SUM(unread_count) FROM conversations WHERE lead_id = l.id), 0) as unread,
        (SELECT MAX(last_message_at) FROM conversations WHERE lead_id = l.id) as last_contact,
        (
          SELECT json_build_object(
            'content', m.content,
            'msg_type', m.msg_type,
            'media_url', m.media_url,
            'is_deleted', m.is_deleted
          )
          FROM messages m
          JOIN conversations cv ON m.conversation_id = cv.id
          WHERE cv.lead_id = l.id
          ORDER BY m.sent_at DESC, m.id DESC
          LIMIT 1
        ) as last_msg,
        lead_tags.tags
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json) AS tags
        FROM lead_tags lt
        JOIN alliance_inbox_tags t ON lt.tag_id = t.id
        WHERE lt.lead_id = l.id
      ) lead_tags ON TRUE
      WHERE 1=1
    `;
    const params = [];

    if (status && status !== 'all') {
      params.push(status);
      if (String(status).toLowerCase() === 'cold') {
        // Legacy leads with no status have always been displayed as Cold in the
        // UI, so include them in the Cold tab as well.
        q += ` AND COALESCE(NULLIF(LOWER(TRIM(l.status)), ''), 'cold') = LOWER($${params.length})`;
      } else {
        q += ` AND LOWER(TRIM(COALESCE(l.status, ''))) = LOWER($${params.length})`;
      }
    }
    if (brand && brand !== 'All Brands') {
      params.push(`%${brand}%`);
      q += ` AND c.name ILIKE $${params.length}`;
    }
    if (source && source !== 'all') {
      const normalizedSource = String(source).toLowerCase();
      if (normalizedSource === 'facebook') {
        q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'`;
      } else if (normalizedSource === 'whatsapp') {
        q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) LIKE '%whatsapp%'`;
      } else if (normalizedSource === 'website') {
        q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(website|web site)%'`;
      } else if (normalizedSource === 'xls_sheet') {
        q += ` AND (
          LOWER(TRIM(COALESCE(l.source, ''))) IN ('xls sheet', 'xlsx sheet', 'excel sheet', 'csv import')
          OR LOWER(TRIM(COALESCE(l.source, ''))) LIKE 'csv\\_%' ESCAPE '\\'
        )`;
      } else {
        params.push(source);
        q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) = LOWER(TRIM($${params.length}))`;
      }
    }
    if (campaign_name) {
      params.push(campaign_name);
      q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'`;
      q += ` AND l.campaign_name = $${params.length}`;
    }
    if (ad_name) {
      params.push(ad_name);
      q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'`;
      q += ` AND l.ad_name = $${params.length}`;
    }
    if (meta_page_id) {
      params.push(meta_page_id);
      q += ` AND LOWER(TRIM(COALESCE(l.source, ''))) SIMILAR TO '%(facebook|instagram|meta[_ ]?ads)%'`;
      q += ` AND EXISTS (
        SELECT 1
        FROM brand_social_accounts page_account
        JOIN clients page_client ON page_client.name = page_account.brand_name
        WHERE page_client.id = l.client_id
          AND CASE WHEN LOWER(page_account.platform) = 'instagram'
            THEN COALESCE(NULLIF(page_account.instagram_business_id, ''), NULLIF(page_account.account_id, ''), NULLIF(page_account.facebook_page_id, ''))
            ELSE COALESCE(NULLIF(page_account.facebook_page_id, ''), NULLIF(page_account.account_id, ''), NULLIF(page_account.instagram_business_id, ''))
          END = $${params.length}
          AND page_account.is_active = TRUE
      )`;
    }
    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) return res.status(400).json({ error: 'Invalid from date' });
      params.push(fromDate.toISOString());
      q += ` AND l.created_at >= $${params.length}`;
    }
    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) return res.status(400).json({ error: 'Invalid to date' });
      params.push(toDate.toISOString());
      q += ` AND l.created_at <= $${params.length}`;
    }
    if (tag_id) {
      params.push(tag_id);
      q += ` AND EXISTS (SELECT 1 FROM lead_tags WHERE lead_id = l.id AND tag_id = $${params.length})`;
    }
    if (search) {
      params.push(`%${search}%`);
      const likeParam = `$${params.length}`;
      
      params.push(search);
      const searchParam = `$${params.length}`;
      
      q += ` AND (
        l.name ILIKE ${likeParam}
        OR l.phone ILIKE ${likeParam}
        OR l.name % ${searchParam}
        OR (
          REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') <> ''
          AND REGEXP_REPLACE(COALESCE(l.phone, ''), '[^0-9]', '', 'g')
            LIKE '%' || REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') || '%'
        )
      )`;
    }

    if (search) {
      const searchParamIndex = params.length; // points to the exact search term param
      q += ` ORDER BY
        CASE WHEN REGEXP_REPLACE($${searchParamIndex}, '[^0-9]', '', 'g') <> ''
          AND REGEXP_REPLACE(COALESCE(l.phone, ''), '[^0-9]', '', 'g')
            LIKE '%' || REGEXP_REPLACE($${searchParamIndex}, '[^0-9]', '', 'g') || '%'
          THEN 0 ELSE 1 END,
        similarity(l.name, $${searchParamIndex}) DESC,
        similarity(COALESCE(l.phone, ''), $${searchParamIndex}) DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    } else {
      q += ` ORDER BY COALESCE((SELECT MAX(last_message_at) FROM conversations WHERE lead_id = l.id), l.created_at) DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    }
    params.push(limit, offset);

    const { rows } = await pool.query(q, params);
    const filteredTotal = rows.length ? parseInt(rows[0].filtered_total, 10) : 0;
    res.json({ leads: rows, total: filteredTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id
app.get('/api/leads/:id', auth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.*, c.name as brand_name, c.phone_number_id, c.wa_access_token,
             u.name as assigned_name, lead_tags.tags
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      LEFT JOIN users u ON l.assigned_to = u.id
      LEFT JOIN LATERAL (
        SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json) AS tags
        FROM lead_tags lt
        JOIN alliance_inbox_tags t ON lt.tag_id = t.id
        WHERE lt.lead_id = l.id
      ) lead_tags ON TRUE
      WHERE l.id = $1
    `, [req.params.id]);

    if (!rows.length) return res.status(404).json({ error: 'Lead not found' });

    // Join conversations (thread) → messages (individual) for this lead
    const conversations = await pool.query(`
      SELECT m.id, m.direction, m.content, m.msg_type as type, m.media_url, m.wa_msg_id,
             m.status, m.is_ai, m.sent_at as timestamp, m.read_at, m.is_deleted, m.is_forwarded, m.pinned_until, m.is_starred, m.reactions,
             CASE WHEN m.reply_to_wa_id IS NOT NULL THEN (
               SELECT json_build_object('direction', r.direction, 'media_url', r.media_url, 'content', r.content, 'msg_type', r.msg_type)
               FROM messages r WHERE r.wa_msg_id = m.reply_to_wa_id LIMIT 1
             ) ELSE NULL END as reply_to
      FROM messages m
      JOIN conversations cv ON m.conversation_id = cv.id
      WHERE cv.lead_id = $1
      ORDER BY m.sent_at ASC
    `, [req.params.id]);

    res.json({ lead: rows[0], conversations: conversations.rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id/messages
app.get('/api/leads/:id/messages', auth, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const conversations = await pool.query(`
      SELECT m.id, m.direction, m.content, m.msg_type as type, m.media_url, m.wa_msg_id,
             m.status, m.is_ai, m.sent_at as timestamp, m.read_at, m.is_deleted, m.is_forwarded, m.pinned_until, m.is_starred, m.reactions,
             CASE WHEN m.reply_to_wa_id IS NOT NULL THEN (
               SELECT json_build_object('direction', r.direction, 'media_url', r.media_url, 'content', r.content, 'msg_type', r.msg_type)
               FROM messages r WHERE r.wa_msg_id = m.reply_to_wa_id LIMIT 1
             ) ELSE NULL END as reply_to
      FROM messages m
      JOIN conversations cv ON m.conversation_id = cv.id
      WHERE cv.lead_id = $1
         OR (cv.lead_id IS NULL AND RIGHT(REGEXP_REPLACE(cv.phone, '[^0-9]', '', 'g'), 10) = (
              SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) FROM leads WHERE id = $1 LIMIT 1
            ))
      ORDER BY m.sent_at DESC
      LIMIT $2 OFFSET $3
    `, [req.params.id, parseInt(limit), parseInt(offset)]);

    res.json({ messages: conversations.rows.reverse() });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads
app.post('/api/leads', auth, async (req, res) => {
  try {
    const { name, phone, source, interest, assigned_to } = req.body;
    const leadOSBrand = await getLeadOSBrand(pool);
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    // Strip formatting (spaces/dashes/parens) so this matches the digits-only format
    // every phone-matching query in the app expects. Does not add/assume a country code.
    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (!normalizedPhone) return res.status(400).json({ error: 'Enter a valid phone number' });

    const { rows } = await pool.query(`
      INSERT INTO leads (name, phone, source, client_id, interest, assigned_to, status, score, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'new', 0, NOW())
      RETURNING *
    `, [name, normalizedPhone, source || 'Manual', leadOSBrand.id, interest || '', assigned_to || null]);

    // Trigger n8n webhook for new leads to send welcome template.
    // Prefer this brand's own WhatsApp credentials (kept current via the
    // integrations/reconnect flow) over the static .env pair, which can go
    // stale — matches the lookup already done for bulk import (see /api/leads/import).
    if (process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
      pool.query('SELECT phone_number_id, wa_access_token FROM clients WHERE id = $1', [rows[0].client_id])
        .then(clientRes => {
          const phoneNumberId = clientRes.rows[0]?.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
          const waAccessToken = clientRes.rows[0]?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
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
    const updates = [];
    const params = [];

    if (name !== undefined) { params.push(name); updates.push(`name = $${params.length}`); }
    if (phone !== undefined) { params.push(String(phone).replace(/\D/g, '')); updates.push(`phone = $${params.length}`); }
    if (email !== undefined) { params.push(email); updates.push(`email = $${params.length}`); }
    if (status !== undefined) { params.push(status); updates.push(`status = $${params.length}`); }
    if (score !== undefined) { params.push(score); updates.push(`score = $${params.length}`); }
    if (assigned_to !== undefined) { params.push(assigned_to); updates.push(`assigned_to = $${params.length}`); }
    if (interest !== undefined) { params.push(interest); updates.push(`interest = $${params.length}`); }
    if (notes !== undefined) { params.push(notes); updates.push(`notes = $${params.length}`); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    params.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE leads SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    res.json({ lead: rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE lead_id = $1)', [id]);
    await pool.query('DELETE FROM conversations WHERE lead_id = $1', [id]);
    await pool.query('DELETE FROM payments WHERE lead_id = $1', [id]);
    // sales_tasks has no ON DELETE CASCADE (unlike every other lead_id FK), so it
    // silently blocks the delete below with a 23503 violation if left out.
    await pool.query('DELETE FROM sales_tasks WHERE lead_id = $1', [id]);

    const { rowCount } = await pool.query('DELETE FROM leads WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Lead not found' });

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
    await pool.query(
      `INSERT INTO lead_tags (lead_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, tagId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('Add lead tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/leads/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const { id, tagId } = req.params;
    await pool.query(
      `DELETE FROM lead_tags WHERE lead_id = $1 AND tag_id = $2`,
      [id, tagId]
    );
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
    await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS flow_step VARCHAR(100) DEFAULT 'welcome'`);
    await pool.query(`UPDATE leads SET flow_step = 'welcome' WHERE flow_step IS NULL`);
    
    // 2. Fix brain_docs constraint to allow 'training' and 'welcome_template'
    await pool.query(`ALTER TABLE brain_docs DROP CONSTRAINT IF EXISTS brain_docs_doc_type_check`);
    
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

    const leadRes = await pool.query(`
      SELECT l.*, c.phone_number_id, c.wa_access_token, c.whatsapp_status
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE l.id = $1
    `, [lead_id]);

    if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead not found.' });
    const lead = leadRes.rows[0];

    if (lead.client_id && lead.whatsapp_status !== 'verified') {
      return res.status(403).json({ error: 'WhatsApp is disabled for this brand until verification succeeds' });
    }

    const phoneNumberId = lead.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
    const waAccessToken = lead.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

    if (!phoneNumberId || !waAccessToken) {
      return res.status(400).json({ error: 'WhatsApp not configured for this brand. Please add phone_number_id and wa_access_token in Clients settings or server .env file.' });
    }

    // --- Check 24-hour window ---
    const windowRes = await pool.query(`
      SELECT 1 FROM messages m
      JOIN conversations c ON m.conversation_id = c.id
      WHERE (c.lead_id = $1 
         OR RIGHT(REGEXP_REPLACE(c.phone, '[^0-9]', '', 'g'), 10) = (
              SELECT RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) FROM leads WHERE id = $1 LIMIT 1
            )
      )
      AND m.direction = 'inbound' AND m.sent_at > NOW() - INTERVAL '24 HOURS'
      LIMIT 1
    `, [lead_id]);

    const isWindowOpen = windowRes.rows.length > 0;

    if (!isWindowOpen) {
      // Check if we already sent a wakeup template in the last 30 minutes to avoid spamming
      const recentTemplate = await pool.query(`
        SELECT 1 FROM messages m
        JOIN conversations c ON m.conversation_id = c.id
        WHERE c.lead_id = $1 AND m.direction = 'outbound' AND m.msg_type = 'template'
          AND m.sent_at > NOW() - INTERVAL '30 MINUTES'
        LIMIT 1
      `, [lead_id]);

      if (recentTemplate.rows.length === 0) {
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
          const convCheck = await pool.query(
            `SELECT id FROM conversations WHERE lead_id = $1 LIMIT 1`, [lead_id]
          );
          if (convCheck.rows.length > 0) {
            const convId = convCheck.rows[0].id;
            const existingTemplateMsg = waMsgId ? await pool.query('SELECT id FROM messages WHERE wa_msg_id = $1', [waMsgId]) : { rows: [] };
            if (existingTemplateMsg.rows.length === 0) {
              await pool.query(`
                INSERT INTO messages (conversation_id, direction, content, msg_type, wa_msg_id, status, is_ai, sent_at)
                VALUES ($1, 'outbound', 'common_welcome_message', 'template', $2, 'sent', false, NOW())
              `, [convId, waMsgId]);
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
    const convRes = await pool.query(`
      INSERT INTO conversations (lead_id, tenant_id, phone, status, last_message, last_message_at, created_at)
      VALUES ($1, $2, $3, 'open', $4, NOW(), NOW())
      ON CONFLICT (phone, tenant_id) DO UPDATE
        SET lead_id = EXCLUDED.lead_id,
            last_message = EXCLUDED.last_message,
            last_message_at = NOW()
      RETURNING id
    `, [lead_id, DEFAULT_TENANT_ID, phone, message]);
    const conversationId = convRes.rows[0].id;

    // Insert message into messages table
    const { rows: savedRows } = await pool.query(`
      INSERT INTO messages (conversation_id, direction, content, msg_type, media_url, wa_msg_id, status, sent_at, reply_to_wa_id, is_forwarded)
      VALUES ($1, 'outbound', $2, $3, $4, $5, 'sent', NOW(), $6, $7)
      RETURNING id, direction, content, msg_type as type, media_url, wa_msg_id, status, sent_at as timestamp, is_deleted, reply_to_wa_id, is_forwarded
    `, [conversationId, message, type, media_url || null, waMessageId, reply_to_wa_id || null, is_forwarded || false]);

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
              const clientRes = await pool.query('SELECT id FROM clients WHERE phone_number_id = $1 LIMIT 1', [phoneNumberId]);
              if (clientRes.rows.length > 0) {
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
            const updateResult = await pool.query(`
              UPDATE templates
              SET status = $1,
                  approved_at = CASE WHEN $1 = 'approved' THEN NOW() ELSE approved_at END
              WHERE meta_template_id = $2 OR name = $3
              RETURNING id, name, status
            `, [newStatus, String(message_template_id), message_template_name]);

            if (updateResult.rows.length) {
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
            await pool.query(`UPDATE messages SET status = $1 WHERE wa_msg_id = $2`, [newStatus, wamid]);
            if (newStatus === 'failed' && errorMsg) {
              await pool.query(`UPDATE campaign_logs SET status = $1, error_message = $3 WHERE wa_message_id = $2`, [newStatus, wamid, errorMsg]);
            } else {
              await pool.query(`UPDATE campaign_logs SET status = $1 WHERE wa_message_id = $2`, [newStatus, wamid]);
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
            referralCampaign = (await pool.query(`
              SELECT campaign_id, campaign_name, ad_id, ad_name, client_id
              FROM leads
              WHERE ad_id = $1
              ORDER BY campaign_name IS NULL, updated_at DESC
              LIMIT 1
            `, [referralAdId])).rows[0] || null;
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
          const client = (await pool.query(
            'SELECT * FROM clients WHERE phone_number_id = $1', [phoneNumberId]
          )).rows[0];

          // Find or auto-create lead by phone number
          const phoneDigits = phone.replace(/\D/g, '');
          let lead = (await pool.query(
            `SELECT l.*, c.wa_access_token as client_wa_token, c.phone_number_id as client_phone_number_id
             FROM leads l
             LEFT JOIN clients c ON l.client_id = c.id
             WHERE RIGHT(REGEXP_REPLACE(l.phone, '[^0-9]', '', 'g'), 10) = RIGHT($1, 10)
             ORDER BY l.created_at DESC LIMIT 1`,
            [phoneDigits]
          )).rows[0];

          if (!lead) {
            const newLead = await pool.query(`
              INSERT INTO leads (
                name, phone, source, client_id, status, score, flow_step, created_at,
                campaign_id, campaign_name, ad_id, ad_name
              )
              VALUES ($1, $2, $3, $4, 'new', 10, 'welcome', NOW(), $5, $6, $7, $8)
              RETURNING *
            `, [
              value.contacts?.[0]?.profile?.name || phone,
              phone,
              referralAdId ? 'facebook' : 'WhatsApp',
              (await getLeadOSBrand(pool)).id,
              referralCampaign?.campaign_id || null,
              referralCampaign?.campaign_name || null,
              referralAdId,
              referralCampaign?.ad_name || msg.referral?.headline || null,
            ]);
            lead = newLead.rows[0];
            lead.client_wa_token = client?.wa_access_token;
            lead.client_phone_number_id = client?.phone_number_id;
            console.log(`[Webhook] Auto-created lead for phone: ${phone}`);
          } else {
            if (lead.phone !== phone) {
              await pool.query('UPDATE leads SET phone = $1 WHERE id = $2', [phone, lead.id]);
              lead.phone = phone;
            }
            if (referralAdId) {
              const updatedLead = await pool.query(`
                UPDATE leads SET
                  source = 'facebook',
                  client_id = COALESCE($1, client_id),
                  campaign_id = COALESCE($2, campaign_id),
                  campaign_name = COALESCE($3, campaign_name),
                  ad_id = $4,
                  ad_name = COALESCE($5, ad_name),
                  updated_at = NOW()
                WHERE id = $6
                RETURNING *
              `, [
                (await getLeadOSBrand(pool)).id,
                referralCampaign?.campaign_id || null,
                referralCampaign?.campaign_name || null,
                referralAdId,
                referralCampaign?.ad_name || msg.referral?.headline || null,
                lead.id,
              ]);
              lead = { ...lead, ...updatedLead.rows[0] };
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
          const tenantId = DEFAULT_TENANT_ID;
          const convRes = await pool.query(`
            INSERT INTO conversations (lead_id, tenant_id, phone, status, last_message, last_message_at, created_at)
            VALUES ($1, $2, $3, 'open', $4, NOW(), NOW())
            ON CONFLICT (phone, tenant_id) DO UPDATE
              SET lead_id = EXCLUDED.lead_id,
                  last_message = EXCLUDED.last_message,
                  last_message_at = NOW()
            RETURNING id
          `, [lead.id, tenantId, normalizedPhone, text]);
          const conversationId = convRes.rows[0].id;

          // Save incoming message to messages table (avoid duplicate wa_msg_id from retried webhooks)
          const existingMsg = waMessageId ? await pool.query('SELECT id FROM messages WHERE wa_msg_id = $1', [waMessageId]) : { rows: [] };
          
          if (existingMsg.rows.length > 0) {
            console.log(`[Webhook] Duplicate message skipped (wa_msg_id: ${waMessageId})`);
          } else {
            const { rows: savedRows } = await pool.query(`
              INSERT INTO messages (conversation_id, direction, content, msg_type, media_url, wa_msg_id, status, is_ai, sent_at, is_forwarded)
              VALUES ($1, 'inbound', $2, $3, $4, $5, 'delivered', false, NOW(), $6)
              RETURNING id, direction, content, msg_type as type, media_url, wa_msg_id, status, sent_at as timestamp, is_forwarded
            `, [conversationId, text, msgType, mediaUrl, waMessageId, isForwarded]);

            // ── REAL-TIME: push to CRM Inbox immediately ─────────
            // Count only messages that passed the duplicate webhook check.
            await pool.query(`
              UPDATE conversations
              SET unread_count = COALESCE(unread_count, 0) + 1
              WHERE id = $1
            `, [conversationId]);

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
        const { rows: accountRows } = await pool.query(
          `SELECT bsa.access_token, c.id as client_id 
           FROM brand_social_accounts bsa 
           JOIN clients c ON bsa.brand_name = c.name 
           WHERE bsa.facebook_page_id = $1 OR bsa.account_id = $1 
           LIMIT 1`,
          [pageId]
        );

        if (!accountRows.length || !accountRows[0].access_token) {
          console.error(`[Meta Leads] No access token found for page_id: ${pageId}. Cannot fetch leadgen_id: ${leadgenId}`);
          await pool.query(
            `INSERT INTO failed_webhooks (page_id, leadgen_id, payload, error_message) VALUES ($1, $2, $3, $4)`,
            [pageId, leadgenId, change.value, 'No access token found for this page in database.']
          );
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
          await pool.query(
            `INSERT INTO failed_webhooks (page_id, leadgen_id, payload, error_message) VALUES ($1, $2, $3, $4)`,
            [pageId, leadgenId, change.value, apiErr.response?.data ? JSON.stringify(apiErr.response.data) : apiErr.message]
          );
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
        const existing = await pool.query(
          `SELECT id FROM leads WHERE leadgen_id = $1`,
          [leadgenId]
        );
        if (existing.rows.length) {
          console.log(`[Meta Leads] Lead ${leadgenId} already exists. Skipping.`);
          continue;
        }

        // 4. Insert lead properly assigned to client
        let newLead;
        try {
          const newLeadRes = await pool.query(`
            INSERT INTO leads (name, phone, email, source, status, score, client_id, leadgen_id, created_at)
            VALUES ($1, $2, $3, 'Meta Ads', 'new', 20, $4, $5, NOW())
            RETURNING *
          `, [name, phone, email, (await getLeadOSBrand(pool)).id, leadgenId]);
          newLead = newLeadRes.rows[0];
        } catch (insertErr) {
          console.error(`[Meta Leads] Error inserting lead: ${insertErr.message}. Attempting update on conflict.`);
          // Fallback if there is a conflict on (phone, client_id)
          const fallbackRes = await pool.query(`
            UPDATE leads SET 
              leadgen_id = $1, 
              name = $2, 
              email = $3, 
              source = 'Meta Ads'
            WHERE phone = $4 AND client_id = $5
            RETURNING *
          `, [leadgenId, name, email, phone, (await getLeadOSBrand(pool)).id]);
          newLead = fallbackRes.rows[0];
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
    const { rows: accountRows } = await pool.query(
      `SELECT access_token FROM brand_social_accounts 
       WHERE (facebook_page_id = $1 OR account_id = $1) AND access_token IS NOT NULL 
       LIMIT 1`,
      [page_id]
    );

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
        await pool.query(`
          INSERT INTO payments (lead_id, amount, status, razorpay_payment_id, created_at)
          VALUES ($1, $2, 'captured', $3, NOW())
        `, [leadId, amount / 100, paymentId]);
        await pool.query(
          "UPDATE leads SET status = 'converted', score = 100 WHERE id = $1", [leadId]
        );

        // Hand off to n8n's WF04 (Customer Journey) - same forwarding pattern as the WhatsApp webhook.
        try {
          // Fetch lead data to pass full context to WF04
          const leadRow = await pool.query('SELECT id, name, phone, client_id FROM leads WHERE id = $1', [leadId]);
          const leadData = leadRow.rows[0] || {};
          const clientRow = leadData.client_id
            ? await pool.query('SELECT id, name FROM clients WHERE id = $1', [leadData.client_id])
            : { rows: [] };
          const clientData = clientRow.rows[0] || {};

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
    const leadRes = await pool.query('SELECT * FROM leads WHERE id = $1', [lead_id]);
    if (!leadRes.rows.length) return res.status(404).json({ error: 'Lead not found' });
    const lead = leadRes.rows[0];

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

    await pool.query(`
      INSERT INTO payments (lead_id, amount, status, razorpay_link_id, payment_link, created_at)
      VALUES ($1, $2, 'pending', $3, $4, NOW())
    `, [lead_id, amount, rzpRes.data.id, rzpRes.data.short_url]);

    res.json({ payment_link: rzpRes.data.short_url, link_id: rzpRes.data.id });
  } catch (err) {
    console.error('Payment link error:', err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});

app.get('/api/payments', auth, async (req, res) => {
  try {
    const { lead_id } = req.query;
    let q = 'SELECT p.*, l.name as lead_name FROM payments p JOIN leads l ON p.lead_id = l.id WHERE 1=1';
    const params = [];
    if (lead_id) { params.push(lead_id); q += ` AND p.lead_id = $${params.length}`; }
    q += ' ORDER BY p.created_at DESC';
    const { rows } = await pool.query(q, params);
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
    const { rows } = await pool.query(`
      SELECT t.*, c.name as brand_name
      FROM templates t
      LEFT JOIN clients c ON t.client_id = c.id
      ORDER BY t.created_at DESC
    `);
    res.json({ templates: rows });
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
    const result = await pool.query(
      `UPDATE templates SET template_scope = $1, updated_at = NOW() WHERE id = ANY($2::int[]) RETURNING id`,
      [scope, ids]
    );
    res.json({ success: true, updated: result.rowCount, template_scope: scope });
  } catch (error) {
    console.error('Bulk template workspace update error:', error);
    res.status(500).json({ error: 'Unable to update selected templates.' });
  }
});

app.post('/api/templates/sync-all', auth, async (req, res) => {
  try {
    const { client_id } = req.body;
    const client = client_id ? (await pool.query('SELECT * FROM clients WHERE id = $1', [client_id])).rows[0] : null;
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
      const existing = await pool.query(
        'SELECT id, status, meta_template_id FROM templates WHERE name = $1 AND language = $2',
        [t.name, t.language]
      );

      if (existing.rows.length > 0) {
        const localTpl = existing.rows[0];
        const approvedAt = (status === 'approved' && !localTpl.approved_at) ? new Date() : localTpl.approved_at;
        await pool.query(
          `UPDATE templates
           SET status=$1, meta_template_id=$2, approved_at=$3, category=$4,
               header_format=$5, header=$6, body=$7, footer=$8, buttons=$9::jsonb,
               updated_at=NOW()
           WHERE id=$10`,
          [status, metaId, approvedAt, t.category, headerFormat, headerText, bodyText, footerText, buttonsVal, localTpl.id]
        );
        updated++;
      } else {
        const approvedAt = status === 'approved' ? new Date() : null;
        await pool.query(
          `INSERT INTO templates (name, category, language, header_format, header, body, footer, buttons, client_id, status, meta_template_id, approved_at, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())`,
          [t.name, t.category, t.language, headerFormat, headerText, bodyText, footerText, buttonsVal, client_id || null, status, metaId, approvedAt]
        );
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
    const { rows } = await pool.query(`
      INSERT INTO templates (name, category, language, header_format, header, body, footer, buttons, client_id, status, created_at, samples, parameter_definitions, template_scope)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'draft', NOW(), $10, $11::jsonb, $12)
      RETURNING *
    `, [name, category, language || 'en', header_format || 'TEXT', header || null, body, footer || null, JSON.stringify(buttons || []), client_id || null, samples ? JSON.stringify(samples) : '[]', JSON.stringify(parameter_definitions), ['leados', 'alliance', 'shared'].includes(template_scope) ? template_scope : 'leados']);
    res.status(201).json({ template: rows[0] });
  } catch (err) {
    console.error('Create template err:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/templates/:id/submit — submit to Meta for approval
app.post('/api/templates/:id/submit', auth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    const tpl = rows[0];

    const client = tpl.client_id
      ? (await pool.query('SELECT * FROM clients WHERE id = $1', [tpl.client_id])).rows[0]
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

    await pool.query(`
      UPDATE templates SET status = 'pending', submitted_at = NOW(), meta_template_id = $1 WHERE id = $2
    `, [metaRes.data.id, req.params.id]);

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
      const { rows } = await pool.query('SELECT wa_access_token FROM clients WHERE id = $1', [client_id]);
      if (rows[0] && rows[0].wa_access_token) waToken = rows[0].wa_access_token;
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
    const { rows } = await pool.query('SELECT * FROM templates WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    const tpl = rows[0];

    const client = tpl.client_id ? (await pool.query('SELECT * FROM clients WHERE id = $1', [tpl.client_id])).rows[0] : null;
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
      const { rows: updatedRows } = await pool.query(
        `UPDATE templates SET status=$1,meta_template_id=$2,approved_at=CASE WHEN $9 THEN COALESCE(approved_at,NOW()) ELSE approved_at END,
          category=$3,header_format=$4,header=$5,body=$6,footer=$7,buttons=$8::jsonb,updated_at=NOW()
         WHERE id=$10 RETURNING *`,
        [status, metaTpl.id, metaTpl.category, headerComp?.format || 'NONE', headerComp?.text || headerComp?.example?.header_handle?.[0] || null,
          bodyComp.text || '', footerComp?.text || null, JSON.stringify(buttonsComp?.buttons || []), status === 'approved', tpl.id]
      );
      return res.json({ template: updatedRows[0] });
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

    const { rows: currentRows } = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    if (!currentRows.length) return res.status(404).json({ error: 'Template not found' });
    const current = currentRows[0];

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
      const client = current.client_id ? (await pool.query('SELECT * FROM clients WHERE id = $1', [current.client_id])).rows[0] : null;
      const waToken = client?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;

      await axios.post(
        `https://graph.facebook.com/v18.0/${current.meta_template_id}`,
        { components },
        { headers: { Authorization: `Bearer ${waToken}` } }
      );
    }

    const { rows } = await pool.query(`
      UPDATE templates 
      SET name = COALESCE($1, name), 
          category = COALESCE($2, category), 
          language = COALESCE($3, language),
          header_format = COALESCE($4, header_format),
          header = $5, 
          body = COALESCE($6, body), 
          footer = $7, 
          buttons = COALESCE($8, buttons),
          client_id = COALESCE($9, client_id),
          samples = COALESCE($10, samples),
          parameter_definitions = COALESCE($11::jsonb, parameter_definitions),
          template_scope = COALESCE($12, template_scope),
          status = CASE WHEN status != 'draft' THEN 'pending' ELSE status END,
          updated_at = NOW()
      WHERE id = $13
      RETURNING *
    `, [
      name, category, language,
      header_format,
      header !== undefined ? header : current.header,
      body,
      footer !== undefined ? footer : current.footer,
      buttons ? JSON.stringify(buttons) : null,
      client_id || null,
      samples ? JSON.stringify(samples) : null,
      parameter_definitions ? JSON.stringify(parameter_definitions) : null,
      ['leados', 'alliance', 'shared'].includes(template_scope) ? template_scope : null,
      id
    ]);

    res.json({ template: rows[0] });
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
    const { rows } = await pool.query('SELECT * FROM templates WHERE id = $1', [id]);
    if (!rows.length) return res.status(404).json({ error: 'Template not found' });
    const tpl = rows[0];

    if (tpl.status !== 'draft') {
      const client = tpl.client_id ? (await pool.query('SELECT * FROM clients WHERE id = $1', [tpl.client_id])).rows[0] : null;
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

    await pool.query('DELETE FROM templates WHERE id = $1', [id]);
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
    const duplicate = await pool.query('SELECT id,name FROM clients WHERE phone_number_id=$1 AND id<>$2 LIMIT 1', [phoneId, req.params.id]);
    if (duplicate.rows.length) return res.status(409).json({ error: `This phone is already assigned to ${duplicate.rows[0].name}` });
    const connected = String(phone.status || '').toUpperCase() === 'CONNECTED';
    const updated = await pool.query(`UPDATE clients SET wa_business_id=$1,phone_number_id=$2,
      whatsapp_number=$3,whatsapp_status=$4,whatsapp_verified_at=$5,
      name=COALESCE(NULLIF(TRIM($6::text),''),name),wa_category=COALESCE($7,wa_category),
      wa_description=$8,whatsapp_verification_error=NULL,updated_at=NOW() WHERE id=$9 RETURNING *`,
    [wabaId, phoneId, normalizedPhoneDigits(phone.display_phone_number), connected ? 'verified' : 'verification_pending',
      connected ? new Date() : null, name || null, waCategory || null, waDescription || null, req.params.id]);
    if (!updated.rows.length) return res.status(404).json({ error: 'Client not found' });
    await pool.query('UPDATE meta_whatsapp_phone_numbers SET client_id=$1 WHERE phone_number_id=$2', [req.params.id, phoneId]);
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
    const clientResult = await pool.query('SELECT * FROM clients WHERE id=$1', [req.params.id]);
    const client = clientResult.rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });
    if (!client.phone_number_id) {
      return res.status(400).json({ error: 'Add this brand’s real Meta Phone Number ID before uploading its profile logo' });
    }
    const config = await assertPhoneBelongsToWaba(client);
    const duplicatePhone = await pool.query(
      'SELECT id, name FROM clients WHERE phone_number_id=$1 AND id<>$2 LIMIT 1',
      [config.phoneId, client.id]
    );
    if (duplicatePhone.rows.length) {
      return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.rows[0].name}` });
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
    await pool.query('UPDATE meta_whatsapp_phone_numbers SET client_id=$1 WHERE phone_number_id=$2', [client.id, config.phoneId]);
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
    const [wabas, phones, templates, templateSummary, lastRun] = await Promise.all([
      pool.query(`SELECT account.*, COUNT(phone.phone_number_id)::int AS phone_count FROM meta_whatsapp_accounts account LEFT JOIN meta_whatsapp_phone_numbers phone ON phone.waba_id=account.waba_id GROUP BY account.waba_id ORDER BY account.name`),
      pool.query(`SELECT phone.*, account.name AS waba_name, client.name AS client_name FROM meta_whatsapp_phone_numbers phone JOIN meta_whatsapp_accounts account ON account.waba_id=phone.waba_id LEFT JOIN clients client ON client.id=phone.client_id ORDER BY phone.client_id NULLS FIRST, phone.verified_name`),
      pool.query(`SELECT template_id,waba_id,name,language,status,category,components,last_synced_at FROM meta_whatsapp_templates ORDER BY name,language`),
      pool.query(`SELECT waba_id,COUNT(*)::int AS total,COUNT(*) FILTER (WHERE status='APPROVED')::int AS approved,COUNT(*) FILTER (WHERE status<>'APPROVED')::int AS other FROM meta_whatsapp_templates GROUP BY waba_id`),
      pool.query(`SELECT * FROM meta_whatsapp_sync_runs ORDER BY id DESC LIMIT 1`),
    ]);
    res.json({ wabas: wabas.rows, phone_numbers: phones.rows, templates: templates.rows, template_summary: templateSummary.rows, last_sync: lastRun.rows[0] || null });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/meta/whatsapp/sync', auth, async (req, res) => {
  try { res.json({ success: true, ...(await syncMetaWhatsAppInventory()) }); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

app.delete('/api/meta/whatsapp/cache/wabas/:wabaId', auth, async (req, res) => {
  const db = await pool.connect();
  try {
    await metaInventoryReady;
    await db.query('BEGIN');
    const account = await db.query(
      'SELECT waba_id,name FROM meta_whatsapp_accounts WHERE waba_id=$1 FOR UPDATE',
      [req.params.wabaId]
    );
    if (!account.rows.length) {
      await db.query('ROLLBACK');
      return res.status(404).json({ error: 'Cached WABA not found' });
    }
    const mapped = await db.query(
      `SELECT phone.phone_number_id,client.name AS client_name
       FROM meta_whatsapp_phone_numbers phone
       JOIN clients client ON client.id=phone.client_id
       WHERE phone.waba_id=$1
       LIMIT 1`,
      [req.params.wabaId]
    );
    if (mapped.rows.length) {
      await db.query('ROLLBACK');
      return res.status(409).json({
        error: `Cannot clear this cache because a phone number is mapped to ${mapped.rows[0].client_name}`
      });
    }
    await db.query('DELETE FROM meta_whatsapp_templates WHERE waba_id=$1', [req.params.wabaId]);
    await db.query('DELETE FROM meta_whatsapp_accounts WHERE waba_id=$1', [req.params.wabaId]);
    await db.query('COMMIT');
    res.json({ success: true, waba_id: account.rows[0].waba_id, name: account.rows[0].name });
  } catch (err) {
    await db.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    db.release();
  }
});

app.post('/api/meta/whatsapp/phone-numbers/:phoneId/register', auth, async (req, res) => {
  try {
    await metaInventoryReady;
    const pin = String(req.body?.pin || '').trim();
    if (!/^\d{6}$/.test(pin)) return res.status(400).json({ error: 'Enter a valid 6-digit two-step verification PIN' });
    const phoneResult = await pool.query(
      `SELECT phone.phone_number_id,phone.waba_id FROM meta_whatsapp_phone_numbers phone
       WHERE phone.phone_number_id=$1`, [req.params.phoneId]
    );
    if (!phoneResult.rows.length) return res.status(404).json({ error: 'Meta phone number not found in inventory' });
    const phone = phoneResult.rows[0];
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
  const db = await pool.connect();
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { client_id } = req.body;
    await db.query('BEGIN');
    const phoneResult = await db.query(`SELECT * FROM meta_whatsapp_phone_numbers WHERE phone_number_id=$1 FOR UPDATE`, [req.params.phoneId]);
    if (!phoneResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Meta phone number not found' }); }
    if (client_id === null || client_id === undefined || client_id === '') {
      await db.query(`UPDATE meta_whatsapp_phone_numbers SET client_id=NULL WHERE phone_number_id=$1`, [req.params.phoneId]);
      await db.query('COMMIT'); return res.json({ success: true });
    }
    const clientResult = await db.query('SELECT id FROM clients WHERE id=$1 FOR UPDATE', [client_id]);
    if (!clientResult.rows.length) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'Brand not found' }); }
    const phone = phoneResult.rows[0];
    await db.query(`UPDATE meta_whatsapp_phone_numbers SET client_id=NULL WHERE client_id=$1`, [client_id]);
    await db.query(`UPDATE meta_whatsapp_phone_numbers SET client_id=$1 WHERE phone_number_id=$2`, [client_id, phone.phone_number_id]);
    const metaVerified = String(phone.connection_status || '').toUpperCase() === 'CONNECTED' || String(phone.verification_status || '').toUpperCase() === 'VERIFIED';
    await db.query(`UPDATE clients SET wa_business_id=$1,phone_number_id=$2,whatsapp_number=$3,whatsapp_status=$4,whatsapp_verified_at=$5,whatsapp_verification_error=NULL,updated_at=NOW() WHERE id=$6`,
      [phone.waba_id, phone.phone_number_id, phone.display_phone_number, metaVerified ? 'verified' : 'verification_pending', metaVerified ? new Date() : null, client_id]);
    await db.query('COMMIT'); res.json({ success: true });
  } catch (err) { await db.query('ROLLBACK'); res.status(500).json({ error: err.message }); }
  finally { db.release(); }
});

app.get('/api/clients', auth, async (req, res) => {
  try {
    await Promise.all([clientsWhatsAppStatusReady, metaInventoryReady]);
    const { rows } = await pool.query(`
      SELECT c.*,
        meta_phone.profile_picture_url AS meta_profile_picture_url,
        meta_phone.verified_name AS meta_verified_name,
        meta_phone.profile_about AS meta_profile_about,
        COALESCE(meta_phone.profile_address, c.wa_address) AS meta_profile_address,
        COALESCE(meta_phone.profile_description, c.wa_description) AS meta_profile_description,
        COALESCE(meta_phone.profile_email, c.wa_email) AS meta_profile_email,
        COALESCE(meta_phone.profile_websites, CASE WHEN c.wa_website IS NOT NULL THEN jsonb_build_array(c.wa_website) END) AS meta_profile_websites,
        COALESCE(meta_phone.profile_vertical, c.wa_category) AS meta_profile_vertical,
        meta_phone.quality_rating AS meta_quality_rating,
        meta_phone.connection_status AS meta_connection_status,
        (SELECT COUNT(*) FROM leads l WHERE l.client_id = c.id) as lead_count,
        (SELECT COUNT(*) FROM leads l WHERE l.client_id = c.id AND l.status = 'converted') as converted_count
      FROM clients c
      LEFT JOIN meta_whatsapp_phone_numbers meta_phone ON meta_phone.client_id = c.id
      ORDER BY c.created_at DESC
    `);
    res.json({ clients: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const { name, wa_category, wa_description, wa_address, wa_email, wa_website } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Business name is required' });
    const { rows } = await pool.query(`
      INSERT INTO clients (name, wa_category, wa_description, wa_address, wa_email, wa_website, status, whatsapp_status, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'active', 'not_configured', NOW())
      RETURNING *
    `, [name.trim(), wa_category || 'OTHER', wa_description || null, wa_address || null, wa_email || null, wa_website || null]);
    res.status(201).json({ client: rows[0] });
  } catch (err) {
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
    const existingResult = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const existing = existingResult.rows[0];
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
        const duplicatePhone = await pool.query(
          'SELECT id, name FROM clients WHERE phone_number_id = $1 AND id <> $2 LIMIT 1',
          [nextMetaConfig.phoneId, req.params.id]
        );
        if (duplicatePhone.rows.length) {
          return res.status(409).json({ error: `This Meta Phone Number ID is already assigned to ${duplicatePhone.rows[0].name}` });
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
    const assignments = entries.map(([field], index) => `${field} = $${index + 1}`);
    const values = entries.map(([, value]) => value === '' ? null : value);
    const result = await pool.query(`UPDATE clients SET ${assignments.join(', ')}, updated_at = NOW()
      WHERE id = $${values.length + 1} RETURNING *`, [...values, req.params.id]);
    res.json({
      success: true,
      client: result.rows[0],
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
  const clientDb = await pool.connect();
  try {
    await clientDb.query('BEGIN');
    const { id } = req.params;

    // Use FOR UPDATE to lock the row during transaction
    const { rows } = await clientDb.query('SELECT * FROM clients WHERE id = $1 FOR UPDATE', [id]);
    if (!rows.length) {
      await clientDb.query('ROLLBACK');
      return res.status(404).json({ error: 'Client not found' });
    }
    const client = rows[0];

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

    await clientDb.query('DELETE FROM clients WHERE id = $1', [id]);
    await clientDb.query('COMMIT');

    res.json({ success: true, message: 'Client deleted and deregistered successfully' });
  } catch (err) {
    await clientDb.query('ROLLBACK');
    console.error(`[Delete Client API] Error deleting client ${req.params.id}:`, err);
    res.status(500).json({ error: 'Server error during deletion' });
  } finally {
    clientDb.release();
  }
});

// POST /api/clients/:id/whatsapp-setup
app.post('/api/clients/:id/whatsapp-setup', auth, async (req, res) => {
  try {
    await clientsWhatsAppStatusReady;
    const { rows } = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
    const client = rows[0];
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const metaConfig = resolveClientMetaConfig(client);
    if (!metaConfig.phoneId || !metaConfig.token || !metaConfig.wabaId || !client.whatsapp_number) {
      return res.status(400).json({ error: 'Real WhatsApp number and its Meta Phone Number ID are required before verification' });
    }

    await pool.query(`UPDATE clients SET whatsapp_status = 'verification_pending',
      whatsapp_verified_at = NULL, whatsapp_verification_error = NULL WHERE id = $1`, [client.id]);

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

    const verified = await pool.query(`UPDATE clients SET whatsapp_status = 'verified',
      whatsapp_verified_at = NOW(), whatsapp_verification_error = NULL, updated_at = NOW()
      WHERE id = $1 RETURNING *`, [client.id]);
    res.json({ success: true, message: 'WhatsApp verified and enabled successfully', client: verified.rows[0] });
  } catch (err) {
    const message = err.response?.data?.error?.message || err.message || 'WhatsApp verification failed';
    await pool.query(`UPDATE clients SET whatsapp_status = 'verification_failed',
      whatsapp_verified_at = NULL, whatsapp_verification_error = $1, updated_at = NOW()
      WHERE id = $2`, [message, req.params.id]).catch(() => {});
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
    const q = client_id
      ? 'SELECT * FROM brain_docs WHERE client_id = $1 ORDER BY doc_type'
      : 'SELECT * FROM brain_docs ORDER BY client_id, doc_type';
    const { rows } = await pool.query(q, client_id ? [client_id] : []);
    res.json({ docs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain', auth, async (req, res) => {
  try {
    const { client_id, doc_type, content } = req.body;
    const { rows } = await pool.query(`
      INSERT INTO brain_docs (client_id, doc_type, content, updated_at)
      VALUES ($1, $2, $3, NOW())
      ON CONFLICT (client_id, doc_type)
      DO UPDATE SET content = $3, updated_at = NOW()
      RETURNING *
    `, [client_id, doc_type, content]);
    res.json({ doc: rows[0] });
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
    const leadOSBrand = await getLeadOSBrand(pool);
    if (!req.file) {
      return res.status(400).json({ error: 'File is required' });
    }

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const results = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '', raw: false });
    const isCampaignBatch = String(req.body.force_source || '').startsWith('csv_');

    if (isCampaignBatch && req.body.template_id) {
      const templateResult = await pool.query('SELECT body, header FROM templates WHERE id = $1', [req.body.template_id]);
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

    if (isCampaignBatch) {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS campaign_import_recipients (
          batch_id VARCHAR(30) NOT NULL,
          lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
          PRIMARY KEY (batch_id, lead_id)
        )
      `);
      await pool.query(`ALTER TABLE campaign_import_recipients ADD COLUMN IF NOT EXISTS template_parameters JSONB NOT NULL DEFAULT '{}'::jsonb`);
    }

    const [clientsRes, usersRes] = await Promise.all([
      pool.query('SELECT id, name FROM clients'),
      pool.query('SELECT id, name, email FROM users'),
    ]);
    const clientsMap = Object.fromEntries(
      clientsRes.rows.map((client) => [client.name.toLowerCase(), client.id])
    );
    const usersMap = {};
    usersRes.rows.forEach((user) => {
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
           const existingRes = await pool.query(`
             SELECT id FROM leads 
             WHERE ($1::text != '' AND RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) = $1)
                OR ($1::text = '' AND $2::text IS NOT NULL AND LOWER(email) = LOWER($2))
             LIMIT 1
           `, [phoneDigits, email]);
           existingLead = existingRes.rows[0];
        }

        let importedLeadId;
        const isCampaignImport = isCampaignBatch;

        if (existingLead) {
          importedLeadId = existingLead.id;
          existing++;
          if (!isCampaignImport) {
            // Normal CRM imports may refresh an existing lead. A campaign list
            // only references it and must not alter its CRM fields.
            await pool.query(`
              UPDATE leads
              SET name = COALESCE($1, name),
                  phone = COALESCE($2, phone),
                  email = COALESCE($3, email),
                  status = COALESCE($4, status),
                  client_id = COALESCE($5, client_id),
                  source = COALESCE($6, source),
                  score = COALESCE($7, score),
                  interest = COALESCE($8, interest),
                  assigned_to = COALESCE($9, assigned_to),
                  updated_at = NOW()
              WHERE id = $10
            `, [name, phone, email, status, rowClientId, source, score, interest, assignedTo, existingLead.id]);
          }
        } else {
          // Insert new
          const insertedLead = await pool.query(`
            INSERT INTO leads (client_id, name, phone, email, status, source, score, interest, assigned_to, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            RETURNING id
          `, [rowClientId, name, phone, email, status, source, score, interest, assignedTo]);
          importedLeadId = insertedLead.rows[0].id;
          inserted++;

          // ── Send welcome template for newly inserted leads (not existing ones) ──
          if (!isCampaignImport && process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
            // Stagger by 1s per lead to avoid WhatsApp rate limits on bulk import
            const delay = inserted * 1000;
            setTimeout(() => {
              // Fetch client-specific credentials for this lead (if client_id set)
              pool.query(
                'SELECT c.phone_number_id, c.wa_access_token FROM clients c WHERE c.id = $1',
                [rowClientId]
              ).then(clientRes => {
                const phoneNumberId = clientRes.rows[0]?.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
                const waAccessToken = clientRes.rows[0]?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
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
          await pool.query(`
            INSERT INTO campaign_import_recipients (batch_id, lead_id, template_parameters)
            VALUES ($1, $2, $3::jsonb)
            ON CONFLICT (batch_id, lead_id) DO UPDATE SET template_parameters = EXCLUDED.template_parameters
          `, [req.body.force_source, importedLeadId, JSON.stringify(rowTemplateParameters)]);
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
        await pool.query(`
          UPDATE campaign_logs 
          SET status = $1, error_message = $2
          WHERE wa_message_id = $3
        `, [newStatus, error, wamid]);
      }

      // Handle incoming replied messages
      if (value.messages && value.messages.length > 0) {
        const msg = value.messages[0];
        const incomingPhone = msg.from;
        const msgId = msg.id;
        const text = msg.text ? msg.text.body : '';

        // Find if this user was part of a campaign
        const { rowCount } = await pool.query(`
          UPDATE campaign_logs 
          SET status = 'replied'
          WHERE lead_id = (SELECT id FROM leads WHERE phone LIKE '%' || $1 LIMIT 1)
        `, [incomingPhone.substring(incomingPhone.length - 10)]);

        // Insert into messages table
        await pool.query(`
          INSERT INTO messages (client_id, lead_id, direction, type, content, wa_message_id, status, timestamp)
          SELECT client_id, id, 'inbound', 'text', $1, $2, 'delivered', NOW()
          FROM leads WHERE phone LIKE '%' || $3 LIMIT 1
        `, [text, msgId, incomingPhone.substring(incomingPhone.length - 10)]);
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
    const { rows } = await pool.query(`
      SELECT camp.*, c.name as brand_name, t.name as template_name,
        (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = camp.id AND cl.status = 'sent') as sent_count,
        (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = camp.id AND cl.status = 'delivered') as delivered_count,
        (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = camp.id AND cl.status = 'read') as read_count,
        (SELECT COUNT(*) FROM campaign_logs cl WHERE cl.campaign_id = camp.id AND cl.status = 'replied') as replied_count
      FROM campaigns camp
      LEFT JOIN clients c ON camp.client_id = c.id
      LEFT JOIN templates t ON camp.template_id = t.id
      ORDER BY camp.created_at DESC
    `);
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

    const templateResult = await pool.query(
      'SELECT id, name, status, body, header, client_id, parameter_definitions FROM templates WHERE id = $1',
      [template_id]
    );
    if (!templateResult.rows.length) {
      return res.status(404).json({ error: 'Template not found.' });
    }
    const selectedTemplate = templateResult.rows[0];
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

    const { rows } = await pool.query(`
      INSERT INTO campaigns (name, client_id, template_id, target_status, scheduled_at, status, created_by, created_at, template_parameters)
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8::jsonb)
      RETURNING *
    `, [name, client_id, template_id, target_status, scheduled_at, initialStatus, req.user.id, JSON.stringify(template_parameters)]);

    const campaign = rows[0];

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
    await pool.query('DELETE FROM campaign_logs WHERE campaign_id = $1', [id]);
    const { rowCount } = await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
    if (rowCount === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Background Campaign Execution Function - Now uses queue system
async function executeCampaign(campaign_id) {
  console.log(`[executeCampaign] Starting for campaign ${campaign_id}`);
  try {
    // Ensure error_message column exists
    await pool.query(`
      ALTER TABLE campaign_logs
      ADD COLUMN IF NOT EXISTS error_message TEXT
    `).catch(() => {}); // Ignore if already exists

    const campRes = await pool.query(`
      SELECT c.*, t.body as template_body, t.header as template_header, t.name as template_name,
             t.language as template_language, cl.name as brand_name,
             cl.wa_access_token, cl.phone_number_id, cl.whatsapp_status
      FROM campaigns c
      JOIN templates t ON c.template_id = t.id
      LEFT JOIN clients cl ON c.client_id = cl.id
      WHERE c.id = $1
    `, [campaign_id]);

    if (!campRes.rows.length) {
      console.log(`[executeCampaign] Campaign ${campaign_id} not found`);
      return;
    }
    const campaign = campRes.rows[0];

    const templateError = validateCampaignTemplate({
      body: campaign.template_body,
      header: campaign.template_header,
    });
    if (templateError) {
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
      console.error(`Campaign ${campaign_id}: ${templateError}`);
      return;
    }
    const parameterError = validateCampaignParameterMappings(
      { body: campaign.template_body, header: campaign.template_header },
      campaign.template_parameters || {}
    );
    if (parameterError) {
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
      console.error(`Campaign ${campaign_id}: ${parameterError}`);
      return;
    }

    if (campaign.client_id && campaign.whatsapp_status !== 'verified') {
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
      console.error(`Campaign ${campaign_id}: WhatsApp is not verified for this brand`);
      return;
    }

    console.log(`[executeCampaign] Campaign: ${campaign.name}, target_status: ${campaign.target_status}, client_id: ${campaign.client_id}`);

    // Atomically claim the campaign: only proceed if it's still 'scheduled' or 'failed'.
    const claimRes = await pool.query(
      "UPDATE campaigns SET status = 'running' WHERE id = $1 AND status IN ('scheduled', 'failed') RETURNING id",
      [campaign_id]
    );
    if (claimRes.rowCount === 0) {
      console.warn(`Campaign ${campaign_id}: skipped, already running/completed (not in 'scheduled' or 'failed' state).`);
      return;
    }

    console.log(`[executeCampaign] Campaign claimed, finding leads...`);

    // Build leads query
    let leadsQuery = '';
    const queryParams = [];

    if (campaign.target_status && campaign.target_status.startsWith('csv_')) {
      // A custom upload is an exact audience. Existing leads may belong to a
      // different CRM brand, but the selected campaign brand supplies the
      // WhatsApp credentials used for this send.
      leadsQuery = `SELECT l.id, l.phone, l.name, l.email, l.status, l.source, l.interest, l.score, cir.template_parameters
        FROM leads l
        JOIN campaign_import_recipients cir ON cir.lead_id = l.id
        WHERE cir.batch_id = $1
          AND l.phone IS NOT NULL
          AND BTRIM(l.phone) <> ''
        ORDER BY cir.created_at, l.id`;
      queryParams.push(campaign.target_status);
    } else {
      // Regular target status (new, warm, cold, etc.) or all leads
      leadsQuery = `SELECT id, phone, name, email, status, source, interest, score FROM leads WHERE client_id = $1`;
      queryParams.push(campaign.client_id);

      if (campaign.target_status && campaign.target_status !== 'all') {
        leadsQuery += ' AND status = $2';
        queryParams.push(campaign.target_status);
      }
    }

    let leadsRes = await pool.query(leadsQuery, queryParams);
    let leads = leadsRes.rows;

    const excelMappings = ['header', 'body'].flatMap((section) =>
      Object.entries(campaign.template_parameters?.[section] || {})
        .filter(([, mapping]) => mapping?.source === 'excel_parameter')
        .map(([number]) => ({ section, number }))
    );
    if (excelMappings.length) {
      if (!campaign.target_status?.startsWith('csv_')) {
        await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
        console.error(`Campaign ${campaign_id}: Excel parameter mappings require a custom Excel audience.`);
        return;
      }
      const incomplete = leads.find((lead) => excelMappings.some(({ section, number }) =>
        !String(lead.template_parameters?.[section]?.[number] || '').trim()
      ));
      if (incomplete) {
        await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
        console.error(`Campaign ${campaign_id}: recipient ${incomplete.id} has missing Excel parameter values.`);
        return;
      }
    }

    console.log(`[Campaign ${campaign_id}] Query: ${leadsQuery}`);
    console.log(`[Campaign ${campaign_id}] Params: ${JSON.stringify(queryParams)}`);
    console.log(`[Campaign ${campaign_id}] Found: ${leads.length} leads`);

    if (leads.length === 0) {
      // Debug: check what's in the campaign_import_recipients table
      let debugInfo = '';
      if (campaign.target_status && campaign.target_status.startsWith('csv_')) {
        const recipientsCheck = await pool.query(
          `SELECT COUNT(*) as cnt FROM campaign_import_recipients WHERE batch_id = $1`,
          [campaign.target_status]
        );
        debugInfo = ` (batch_id: ${campaign.target_status}, found: ${recipientsCheck.rows[0].cnt} recipients in campaign_import_recipients)`;
      }

      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
      console.warn(`Campaign ${campaign_id} has no recipients matching its target.${debugInfo}`);
      return;
    }

    const waToken = campaign.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
    const phoneId = campaign.phone_number_id || process.env.WA_PHONE_NUMBER_ID;

    // Validate credentials
    if (!waToken || !phoneId) {
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
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
    await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [campaign_id]);
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
    const campRes = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!campRes.rows.length) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const campaign = campRes.rows[0];

    // Check if there are already messages in queue for this campaign
    const queueCheck = await pool.query(
      'SELECT COUNT(*) as count FROM campaign_message_queue WHERE campaign_id = $1',
      [id]
    );

    if (parseInt(queueCheck.rows[0].count) > 0) {
      // Messages already in queue, just reset status to running
      await pool.query("UPDATE campaigns SET status = 'running' WHERE id = $1", [id]);
      return res.json({ success: true, message: 'Campaign already has messages in queue, status reset to running' });
    }

    // Re-execute the campaign (will add fresh messages to queue)
    await pool.query("UPDATE campaigns SET status = 'scheduled' WHERE id = $1", [id]);

    // Execute and wait for result
    try {
      await executeCampaign(id);
      res.json({ success: true, message: 'Campaign retry initiated' });
    } catch (execErr) {
      console.error('Execute campaign error:', execErr);
      // Reset status to failed
      await pool.query("UPDATE campaigns SET status = 'failed' WHERE id = $1", [id]);
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
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM campaign_message_queue
      WHERE campaign_id = $1
    `, [id]);

    res.json({ queue: stats.rows[0] });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/:id/debug - Debug campaign recipients
app.get('/api/campaigns/:id/debug', auth, async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign details
    const campaign = await pool.query('SELECT * FROM campaigns WHERE id = $1', [id]);
    if (!campaign.rows.length) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const c = campaign.rows[0];

    // Check campaign_import_recipients
    let recipients = [];
    if (c.target_status && c.target_status.startsWith('csv_')) {
      const recipientsRes = await pool.query(`
        SELECT cir.*, l.name, l.phone, l.client_id
        FROM campaign_import_recipients cir
        JOIN leads l ON cir.lead_id = l.id
        WHERE cir.batch_id = $1
      `, [c.target_status]);
      recipients = recipientsRes.rows;
    }

    // Check leads for this client
    const leadsRes = await pool.query(`
      SELECT id, name, phone, client_id, status
      FROM leads
      WHERE client_id = $1
      LIMIT 10
    `, [c.client_id]);

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
    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'sent') as sent,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) as total
      FROM campaign_message_queue
    `);

    res.json({
      queue: stats.rows[0],
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
    const { rows } = await pool.query(`
      SELECT cl.*, l.name, l.phone 
      FROM campaign_logs cl
      JOIN leads l ON cl.lead_id = l.id
      WHERE cl.campaign_id = $1
      ORDER BY cl.sent_at DESC
    `, [id]);
    res.json({ logs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ══════════════════════════════════════════════════════════
// REPORTS
// ══════════════════════════════════════════════════════════

// GET /api/reports/summary — dashboard stats
app.get('/api/reports/summary', auth, async (req, res) => {
  try {
    const range = req.query.range || '30d';
    const client_id = req.query.client_id;
    const filterBrand = client_id && client_id !== 'all' && client_id !== 'All Brands' && client_id !== 'undefined';

    if (range === 'custom') {
      const from = req.query.from;
      const to = req.query.to;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
        return res.status(400).json({ error: 'Invalid custom date range' });
      }
      const brandId = filterBrand ? client_id : null;
      const params = [from, to, brandId];
      const [leadCounts, hot, convertedCounts, revenues, weekly, sources, funnel, revenueTrend, brands] = await Promise.all([
        pool.query(`WITH bounds AS (
          SELECT $1::date AS from_date, $2::date AS to_date, ($2::date - $1::date + 1) AS span
        ) SELECT
          COUNT(*) FILTER (WHERE l.created_at >= b.from_date AND l.created_at < b.to_date + INTERVAL '1 day') AS current_count,
          COUNT(*) FILTER (WHERE l.created_at >= b.from_date - b.span * INTERVAL '1 day' AND l.created_at < b.from_date) AS previous_count
        FROM leads l CROSS JOIN bounds b WHERE ($3::bigint IS NULL OR l.client_id = $3)`, params),
        pool.query(`SELECT COUNT(*) AS count FROM leads WHERE status = 'hot' AND created_at >= $1::date AND created_at < $2::date + INTERVAL '1 day' AND ($3::bigint IS NULL OR client_id = $3)`, params),
        pool.query(`WITH bounds AS (SELECT $1::date AS from_date, $2::date AS to_date, ($2::date - $1::date + 1) AS span)
          SELECT COUNT(*) FILTER (WHERE l.updated_at >= b.from_date AND l.updated_at < b.to_date + INTERVAL '1 day') AS current_count,
          COUNT(*) FILTER (WHERE l.updated_at >= b.from_date - b.span * INTERVAL '1 day' AND l.updated_at < b.from_date) AS previous_count
          FROM leads l CROSS JOIN bounds b WHERE l.status = 'converted' AND ($3::bigint IS NULL OR l.client_id = $3)`, params),
        pool.query(`WITH bounds AS (SELECT $1::date AS from_date, $2::date AS to_date, ($2::date - $1::date + 1) AS span)
          SELECT COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= b.from_date AND p.created_at < b.to_date + INTERVAL '1 day'),0) AS current_amount,
          COALESCE(SUM(p.amount) FILTER (WHERE p.created_at >= b.from_date - b.span * INTERVAL '1 day' AND p.created_at < b.from_date),0) AS previous_amount
          FROM payments p LEFT JOIN leads l ON l.id = p.lead_id CROSS JOIN bounds b
          WHERE p.status = 'captured' AND ($3::bigint IS NULL OR l.client_id = $3)`, params),
        pool.query(`SELECT TO_CHAR(d.day, 'DD Mon') AS day, COUNT(l.id) AS leads,
          COUNT(l.id) FILTER (WHERE l.status = 'converted') AS converted
          FROM generate_series($1::date, $2::date, '1 day') d(day)
          LEFT JOIN leads l ON DATE(l.created_at) = d.day AND ($3::bigint IS NULL OR l.client_id = $3)
          GROUP BY d.day ORDER BY d.day`, params),
        pool.query(`SELECT COALESCE(source, 'Other') AS source, COUNT(*) AS count FROM leads
          WHERE created_at >= $1::date AND created_at < $2::date + INTERVAL '1 day' AND ($3::bigint IS NULL OR client_id = $3)
          GROUP BY source ORDER BY count DESC LIMIT 6`, params),
        pool.query(`SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status != 'new') AS contacted,
          COUNT(*) FILTER (WHERE score >= 40) AS qualified, COUNT(*) FILTER (WHERE status = 'hot') AS hot,
          COUNT(*) FILTER (WHERE status = 'converted') AS converted FROM leads
          WHERE created_at >= $1::date AND created_at < $2::date + INTERVAL '1 day' AND ($3::bigint IS NULL OR client_id = $3)`, params),
        pool.query(`SELECT TO_CHAR(d.day, 'DD Mon') AS m, COALESCE(SUM(p.amount),0) AS r
          FROM generate_series($1::date, $2::date, '1 day') d(day)
          LEFT JOIN payments p ON DATE(p.created_at) = d.day AND p.status = 'captured'
          LEFT JOIN leads l ON l.id = p.lead_id
          WHERE ($3::bigint IS NULL OR l.client_id = $3 OR p.id IS NULL)
          GROUP BY d.day ORDER BY d.day`, params),
        pool.query(`SELECT c.id, c.name, COUNT(l.id) AS lead_count FROM clients c
          LEFT JOIN leads l ON l.client_id = c.id AND l.created_at >= $1::date AND l.created_at < $2::date + INTERVAL '1 day'
          WHERE ($3::bigint IS NULL OR c.id = $3) GROUP BY c.id, c.name ORDER BY lead_count DESC`, params),
      ]);
      return res.json({
        leads_today: Number(leadCounts.rows[0].current_count), leads_yesterday: Number(leadCounts.rows[0].previous_count),
        hot_leads: Number(hot.rows[0].count), converted_today: Number(convertedCounts.rows[0].current_count),
        converted_yesterday: Number(convertedCounts.rows[0].previous_count), revenue_month: Number(revenues.rows[0].current_amount),
        revenue_last_month: Number(revenues.rows[0].previous_amount), weekly: weekly.rows, sources: sources.rows,
        funnel: funnel.rows[0], revenue_trend: revenueTrend.rows.map(row => ({ m: row.m, r: Number(row.r) })), brands: brands.rows,
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
    const intervalStr = `${days - 1} days`;

    let todayQ = `SELECT COUNT(*) as leads_today FROM leads WHERE DATE(created_at) = CURRENT_DATE`;
    let todayParams = [];
    if (filterBrand) {
      todayParams.push(client_id);
      todayQ += ` AND client_id = $1`;
    }
    const today = await pool.query(todayQ, todayParams);

    let yesterdayQ = `SELECT COUNT(*) as leads_yesterday FROM leads WHERE DATE(created_at) = CURRENT_DATE - INTERVAL '1 day'`;
    let yesterdayParams = [];
    if (filterBrand) {
      yesterdayParams.push(client_id);
      yesterdayQ += ` AND client_id = $1`;
    }
    const yesterday = await pool.query(yesterdayQ, yesterdayParams);

    let hotQ = "SELECT COUNT(*) as hot FROM leads WHERE status = 'hot'";
    let hotParams = [];
    if (filterBrand) {
      hotParams.push(client_id);
      hotQ += ` AND client_id = $1`;
    }
    const hot = await pool.query(hotQ, hotParams);

    let convertedQ = `SELECT COUNT(*) as converted FROM leads WHERE status = 'converted' AND DATE(updated_at) = CURRENT_DATE`;
    let convertedParams = [];
    if (filterBrand) {
      convertedParams.push(client_id);
      convertedQ += ` AND client_id = $1`;
    }
    const converted = await pool.query(convertedQ, convertedParams);

    let convYestQ = `SELECT COUNT(*) as converted_yesterday FROM leads WHERE status = 'converted' AND DATE(updated_at) = CURRENT_DATE - INTERVAL '1 day'`;
    let convYestParams = [];
    if (filterBrand) {
      convYestParams.push(client_id);
      convYestQ += ` AND client_id = $1`;
    }
    const convertedYesterday = await pool.query(convYestQ, convYestParams);

    let revenueQ = `
      SELECT COALESCE(SUM(p.amount), 0) as revenue FROM payments p
      LEFT JOIN leads l ON p.lead_id = l.id
      WHERE p.status = 'captured' AND DATE_TRUNC('month', p.created_at) = DATE_TRUNC('month', NOW())
    `;
    let revenueParams = [];
    if (filterBrand) {
      revenueParams.push(client_id);
      revenueQ += ` AND l.client_id = $1`;
    }
    const revenue = await pool.query(revenueQ, revenueParams);

    let revenueLastQ = `
      SELECT COALESCE(SUM(p.amount), 0) as revenue FROM payments p
      LEFT JOIN leads l ON p.lead_id = l.id
      WHERE p.status = 'captured' AND DATE_TRUNC('month', p.created_at) = DATE_TRUNC('month', NOW() - INTERVAL '1 month')
    `;
    let revenueLastParams = [];
    if (filterBrand) {
      revenueLastParams.push(client_id);
      revenueLastQ += ` AND l.client_id = $1`;
    }
    const revenueLastMonth = await pool.query(revenueLastQ, revenueLastParams);

    let weeklyQ = `
      SELECT
        TO_CHAR(d.day, $1) as day,
        COUNT(l.id) as leads,
        COUNT(CASE WHEN l.status = 'converted' THEN 1 END) as converted
      FROM generate_series(
        CURRENT_DATE - CAST($2 as INTERVAL), CURRENT_DATE, '1 day'
      ) d(day)
      LEFT JOIN leads l ON DATE(l.created_at) = d.day
    `;
    let weeklyParams = [dateFormat, intervalStr];
    if (filterBrand) {
      weeklyParams.push(client_id);
      weeklyQ += ` AND l.client_id = $3`;
    }
    weeklyQ += ` GROUP BY d.day ORDER BY d.day`;
    const weekly = await pool.query(weeklyQ, weeklyParams);

    let sourcesQ = `
      SELECT source, COUNT(*) as count
      FROM leads
    `;
    let sourcesParams = [];
    if (filterBrand) {
      sourcesParams.push(client_id);
      sourcesQ += ` WHERE client_id = $1`;
    }
    sourcesQ += ` GROUP BY source ORDER BY count DESC LIMIT 6`;
    const sources = await pool.query(sourcesQ, sourcesParams);

    let funnelQ = `
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN status != 'new' THEN 1 END) as contacted,
        COUNT(CASE WHEN score >= 40 THEN 1 END) as qualified,
        COUNT(CASE WHEN status = 'hot' THEN 1 END) as hot,
        COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted
      FROM leads
    `;
    let funnelParams = [];
    if (filterBrand) {
      funnelParams.push(client_id);
      funnelQ += ` WHERE client_id = $1`;
    }
    const funnel = await pool.query(funnelQ, funnelParams);

    let trendQ = `
      SELECT
        TO_CHAR(d.month, 'Mon') as m,
        COALESCE(SUM(p.amount), 0) as r
      FROM generate_series(
        DATE_TRUNC('month', CURRENT_DATE) - INTERVAL '5 months',
        DATE_TRUNC('month', CURRENT_DATE),
        '1 month'
      ) d(month)
      LEFT JOIN payments p ON DATE_TRUNC('month', p.created_at) = d.month AND p.status = 'captured'
    `;
    let trendParams = [];
    if (filterBrand) {
      trendParams.push(client_id);
      trendQ += ` AND EXISTS (SELECT 1 FROM leads l WHERE l.id = p.lead_id AND l.client_id = $1)`;
    }
    trendQ += ` GROUP BY d.month ORDER BY d.month`;
    const revenueTrend = await pool.query(trendQ, trendParams);

    res.json({
      leads_today: parseInt(today.rows[0].leads_today),
      leads_yesterday: parseInt(yesterday.rows[0].leads_yesterday),
      hot_leads: parseInt(hot.rows[0].hot),
      converted_today: parseInt(converted.rows[0].converted),
      converted_yesterday: parseInt(convertedYesterday.rows[0].converted_yesterday),
      revenue_month: parseFloat(revenue.rows[0].revenue),
      revenue_last_month: parseFloat(revenueLastMonth.rows[0].revenue),
      weekly: weekly.rows,
      sources: sources.rows,
      funnel: funnel.rows[0],
      revenue_trend: revenueTrend.rows.map(row => ({ m: row.m, r: parseFloat(row.r) })),
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
    let q = `
      SELECT l.*, c.name as brand_name
      FROM leads l
      LEFT JOIN clients c ON l.client_id = c.id
      WHERE 1=1
    `;
    const params = [];
    if (from) { params.push(from); q += ` AND l.created_at >= $${params.length}`; }
    if (to) { params.push(to); q += ` AND l.created_at <= $${params.length}`; }
    if (brand && brand !== 'All Brands') { params.push(`%${brand}%`); q += ` AND c.name ILIKE $${params.length}`; }
    q += ' ORDER BY l.created_at DESC LIMIT 500';
    const { rows } = await pool.query(q, params);
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
    const { rows } = await pool.query(
      'SELECT id, name, email, role, is_active, last_login, created_at FROM users ORDER BY created_at'
    );
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
    const { rows } = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, is_active, created_at)
      VALUES ($1, $2, $3, $4, true, NOW())
      RETURNING id, name, email, role
    `, [name, email.toLowerCase(), hash, role || 'agent']);
    res.status(201).json({ user: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Email already exists' });
    res.status(500).json({ error: 'Server error' });
  }
});

// ── INTERNAL (called by n8n) ──────────────────────────────

// POST /api/internal/save-conversation
app.post('/api/internal/save-conversation', internalAuth, async (req, res) => {
  try {
    const { lead_id, direction, message, sender, wa_message_id } = req.body;
    await pool.query(`
      INSERT INTO conversations (lead_id, direction, message, message_type, sent_at, sender, wa_message_id)
      VALUES ($1, $2, $3, 'text', NOW(), $4, $5)
    `, [lead_id, direction, message, sender, wa_message_id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/internal/update-lead
app.post('/api/internal/update-lead', internalAuth, async (req, res) => {
  try {
    const { lead_id, status, score, interest } = req.body;
    await pool.query(`
      UPDATE leads SET
        status = COALESCE($1, status),
        score = COALESCE($2, score),
        interest = COALESCE($3, interest),
        updated_at = NOW()
      WHERE id = $4
    `, [status, score, interest, lead_id]);
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
    const { rows } = await pool.query(`
      SELECT id FROM campaigns 
      WHERE status = 'scheduled' AND scheduled_at <= NOW()
    `);

    for (const row of rows) {
      console.log(`Cron: Starting scheduled campaign ${row.id}`);
      await executeCampaign(row.id);
      
      // Log the execution to workflow_logs so it appears in the Admin Dashboard
      await pool.query(`
        INSERT INTO workflow_logs (workflow, lead_id, status, message) 
        VALUES ('WF05', null, 'success', $1)
      `, [`Campaign ${row.id} execution automatically triggered by backend engine`]);
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
    const { rows: duePosts } = await pool.query(`
      SELECT id FROM content_queue
      WHERE status IN ('APPROVED', 'approved', 'SCHEDULED', 'scheduled')
        AND scheduled_at <= (NOW() AT TIME ZONE 'Asia/Kolkata') + INTERVAL '2 minutes'
        AND scheduled_at > (NOW() AT TIME ZONE 'Asia/Kolkata') - INTERVAL '24 hours'
      ORDER BY scheduled_at ASC
    `);

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
    const { rows: clients } = await pool.query("SELECT id FROM mafiya_gmb_clients WHERE status = 'active'");
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
httpServer.listen(PORT, () => {
  console.log(`LeadOS API running on port ${PORT} (Socket.io enabled)`);

  // Repair historical routing drift once at startup. New writes are also
  // forced through the same owner, so AI/source metadata cannot move them.
  getLeadOSBrand(pool)
    .then((brand) => pool.query(
      `UPDATE leads SET client_id=$1, updated_at=NOW()
       WHERE client_id IS DISTINCT FROM $1`,
      [brand.id]
    ).then((result) => console.log(`[LeadOS Brand Lock] ${result.rowCount} existing lead(s) assigned to ${brand.name}.`)))
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

  // Initialize followup tables
  pool.query(`
    CREATE TABLE IF NOT EXISTS followup_rules (
      id SERIAL PRIMARY KEY,
      client_id BIGINT REFERENCES clients(id) ON DELETE CASCADE,
      stage VARCHAR(50) NOT NULL,
      touch_count INTEGER NOT NULL DEFAULT 0,
      action_type VARCHAR(50) NOT NULL,
      template_id VARCHAR(255),
      ai_prompt_template TEXT,
      payload_template JSONB,
      delay_hours INTEGER NOT NULL DEFAULT 24,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(client_id, stage, touch_count)
    );

    CREATE TABLE IF NOT EXISTS lead_notes (
      id SERIAL PRIMARY KEY,
      lead_id BIGINT REFERENCES leads(id) ON DELETE CASCADE,
      user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Add columns if they don't exist
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS touch_count INTEGER DEFAULT 0;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up TIMESTAMP;
  `).then(() => {
    console.log('[Startup] Followup tables initialized');
  }).catch(err => {
    console.error('[Startup] Error initializing followup tables:', err.message);
  });

  // Reset any stuck publishing jobs on startup to prevent limbo states
  pool.query(`
    UPDATE publish_queue 
    SET status = 'failed', 
        error_message = 'Publishing interrupted by server restart', 
        updated_at = NOW() 
    WHERE status = 'publishing'
  `).then(async (res) => {
    if (res.rowCount > 0) {
      console.log(`[Startup] Cleaned up ${res.rowCount} stuck publishing jobs.`);
      const { rows } = await pool.query(`
        SELECT DISTINCT content_id FROM publish_queue 
        WHERE error_message = 'Publishing interrupted by server restart'
      `);
      const { updateOverallPostStatus } = require("./controllers/contentController");
      for (const r of rows) {
        await updateOverallPostStatus(r.content_id);
      }
    }
  }).catch(err => {
    console.error('[Startup] Failed to clean up stuck publishing jobs:', err.message);
  });
});

module.exports = { app, httpServer, io };
  
