const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
const db = require('../db/connection');
const ensureAllianceSchema = require('../db/alliance-schema');
const { processQueuedAllianceWelcomes } = require('../services/alliance-welcome');
const { publicAllianceEmailConfig, verifyAllianceEmailTransport, createAllianceEmailTransport, getAllianceEmailConfig, isAllianceSenderAllowed, allowedAllianceFromAddresses } = require('../services/alliance-email');
const openRouter = require('../services/openrouter');
const { regenerateReplySuggestion } = require('../services/alliance-email-replies');
const { processAllianceWhatsAppCampaigns } = require('../services/alliance-whatsapp-campaign-worker');
const { getAllianceBrainContext } = require('../services/alliance-brain-context');
const { getAlliancePromptRules } = require('../services/alliance-prompt-rules');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const CHANNELS = new Set(['auto', 'email', 'whatsapp', 'both']);
const TRUTHY = new Set(['true', 'yes', 'y', '1', 'opted_in', 'opt-in']);
const WHATSAPP_CONSENT_SOURCES = new Set(['website_form', 'click_to_whatsapp_ad', 'qr_code_optin', 'inbound_whatsapp_optin', 'event_registration', 'customer_request', 'written_consent']);
const CONSENT_SCOPES = new Set(['marketing', 'service', 'both']);
const NON_CONSENT_SOURCE_PATTERN = /(scrap|purchas|directory|research)/i;
const COMMON_FIELDS = new Set(['name', 'business_name', 'business name', 'organisation name', 'organization name', 'email', 'phone', 'mobile', 'audience', 'industry', 'location', 'source', 'channel_pref', 'channel preference', 'consent', 'whatsapp_consent', 'whatsapp consent', 'consent_source', 'consent source', 'consent_at', 'consent at', 'consent_evidence', 'consent evidence', 'consent_scope', 'consent scope']);
const SYSTEM_COLUMN_KEYS = ['name','business_name','email','phone','audience','industry','location','source','channel_pref','consent','consent_source','consent_at','consent_evidence','consent_scope'];
const defaultSystemColumns = () => SYSTEM_COLUMN_KEYS.map((key) => ({ key, label: key, enabled: true, required: false }));
function normalizeSystemColumns(value) {
  const supplied = Array.isArray(value) ? value : [];
  const byKey = new Map(supplied.map((column) => [text(column.key).toLowerCase(), column]));
  const columns = defaultSystemColumns().map((column) => {
    const configured = byKey.get(column.key);
    const label = text(configured?.label || column.label).toLowerCase().replace(/[^a-z0-9_ ]/g, '_').replace(/\s+/g, '_').replace(/^_+|_+$/g, '');
    const enabled = configured ? configured.enabled !== false : true;
    return { key: column.key, label: label || column.key, enabled, required: enabled && Boolean(configured?.required) };
  });
  const labels = columns.filter((column) => column.enabled).map((column) => column.label);
  if (new Set(labels).size !== labels.length) throw Object.assign(new Error('Enabled column names must be unique.'), { status: 400 });
  return columns;
}

function validateChannelSystemColumns(columns, channel) {
  const required = [
    ...(['email','both'].includes(channel) ? ['email'] : []),
    ...(['whatsapp','both'].includes(channel) ? ['phone','consent','consent_source','consent_at','consent_evidence','consent_scope'] : []),
  ];
  const missing = required.filter((key) => !columns.some((column) => column.key === key && column.enabled));
  if (missing.length) throw Object.assign(new Error(`${channel === 'both' ? 'Email + WhatsApp' : channel} requires these system columns: ${missing.join(', ')}. Restore them before saving.`), { status: 400 });
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

async function getBulkSendLimit(channel, queryable = db) {
  const result = await queryable.query(`SELECT channel,limit_mode,custom_limit,updated_at FROM alliance_bulk_send_limits WHERE channel=$1`, [channel]);
  return result.rows[0] || { channel, limit_mode: 'unlimited', custom_limit: null };
}

function assertBulkSendLimit(policy, recipientCount) {
  if (policy.limit_mode === 'custom' && recipientCount > Number(policy.custom_limit)) {
    throw Object.assign(new Error(`Selected ${recipientCount} recipients, but the ${policy.channel} bulk-send limit is ${policy.custom_limit}. Reduce the selection or update the send limit.`), { status: 409 });
  }
}

function isValidEmailAddress(value) {
  const email = text(value);
  if (!email || email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  if (!local || local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return false;
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/i.test(local)) return false;
  const labels = domain.split('.');
  return labels.length >= 2
    && /^[a-z]{2,}$/i.test(labels[labels.length - 1])
    && labels.every((label) => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
}

function isValidOptionalTenDigitPhone(value) {
  const phone = text(value);
  return !phone || /^\d{10}$/.test(phone);
}

function normalizeBusinessHours(value) {
  const hours = text(value);
  if (!hours) return '';
  const match = hours
    .replace(/[–—]/g, '-')
    .replace(/\b(?:to|until|till)\b/gi, '-')
    .match(/^\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?\s*-\s*(\d{1,2})(?:[:.]?(\d{2}))?\s*(am|pm)?\s*$/i);
  if (!match) return null;
  const start = { hour: Number(match[1]), minute: Number(match[2] || 0), period: match[3]?.toUpperCase() || '' };
  const end = { hour: Number(match[4]), minute: Number(match[5] || 0), period: match[6]?.toUpperCase() || '' };
  if (start.minute > 59 || end.minute > 59) return null;
  const normalizePart = (part, fallbackPeriod) => {
    if (!part.period && (part.hour > 12 || part.hour === 0)) {
      if (part.hour > 23) return null;
      return { hour: ((part.hour + 11) % 12) + 1, minute: part.minute, period: part.hour >= 12 ? 'PM' : 'AM' };
    }
    if (part.hour < 1 || part.hour > 12) return null;
    return { ...part, period: part.period || fallbackPeriod };
  };
  const normalizedStart = normalizePart(start, 'AM');
  const normalizedEnd = normalizePart(end, 'PM');
  if (!normalizedStart || !normalizedEnd) return null;
  const format = (part) => `${part.hour}:${String(part.minute).padStart(2, '0')} ${part.period}`;
  return `${format(normalizedStart)} - ${format(normalizedEnd)}`;
}

function isValidBusinessHours(value) {
  return normalizeBusinessHours(value) !== null;
}

function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  return isValidEmailAddress(email) ? email : null;
}

function normalizePhone(value) {
  let phone = text(value).replace(/[^0-9]/g, '');
  if (phone.length === 10) phone = `91${phone}`;
  return phone.length >= 11 && phone.length <= 15 ? phone : null;
}

function normalizeChannelPreference(value) {
  const raw = text(value).replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase();
  const aliases = {
    'e-mail': 'email',
    'whats app': 'whatsapp',
    'email + whatsapp': 'both',
    'email+whatsapp': 'both',
    'email & whatsapp': 'both',
  };
  return aliases[raw] || raw;
}

function valueFrom(row, names) {
  const entries = Object.entries(row);
  for (const name of names) {
    const found = entries.find(([key]) => key.trim().toLowerCase() === name);
    if (found) return found[1];
  }
  return '';
}

function repairImportedEncoding(value) {
  if (typeof value !== 'string') return value;
  let repaired = value.replace(/^\uFEFF/, '').normalize('NFC');
  // Typical UTF-8 decoded as Latin-1/Windows-1252. Only attempt repair when
  // suspicious byte-pair markers exist, so legitimate multilingual text stays intact.
  for (let pass = 0; pass < 2 && /(?:Ã|Â|â|ð|à)[\x80-\xBF]/.test(repaired); pass += 1) {
    const candidate = Buffer.from(repaired, 'latin1').toString('utf8');
    if (candidate.includes('\uFFFD')) break;
    const beforeMarkers = (repaired.match(/(?:Ã|Â|â|ð|à)[\x80-\xBF]/g) || []).length;
    const afterMarkers = (candidate.match(/(?:Ã|Â|â|ð|à)[\x80-\xBF]/g) || []).length;
    if (afterMarkers >= beforeMarkers) break;
    repaired = candidate.normalize('NFC');
  }
  // Strip unsafe controls while preserving tabs/newlines used inside valid cells.
  return repaired.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
}

function decodeCsvBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('CSV file is empty.');
  let decoded;
  if (buffer.length >= 4 && buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff) {
    throw new Error('UTF-32 CSV files are not supported. Save the file as UTF-8 CSV or XLSX.');
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00) {
    throw new Error('UTF-32 CSV files are not supported. Save the file as UTF-8 CSV or XLSX.');
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    decoded = new TextDecoder('utf-16le', { fatal: true }).decode(buffer.subarray(2));
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    decoded = new TextDecoder('utf-16be', { fatal: true }).decode(buffer.subarray(2));
  } else {
    const sampleLength = Math.min(buffer.length, 2000);
    let evenNulls = 0;
    let oddNulls = 0;
    for (let index = 0; index < sampleLength; index += 1) {
      if (buffer[index] === 0) {
        if (index % 2 === 0) evenNulls += 1;
        else oddNulls += 1;
      }
    }
    if (oddNulls > sampleLength * 0.2 && evenNulls < sampleLength * 0.02) {
      decoded = new TextDecoder('utf-16le', { fatal: true }).decode(buffer);
    } else if (evenNulls > sampleLength * 0.2 && oddNulls < sampleLength * 0.02) {
      decoded = new TextDecoder('utf-16be', { fatal: true }).decode(buffer);
    }
  }
  if (decoded === undefined) {
    try {
      decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      // Legacy exports from older Windows tools are commonly Windows-1252.
      decoded = new TextDecoder('windows-1252', { fatal: true }).decode(buffer);
    }
  }
  decoded = decoded.replace(/^\uFEFF/, '');
  if (decoded.includes('\u0000') || /\uFFFD/.test(decoded)) {
    throw new Error('CSV encoding could not be detected safely. Save the file as UTF-8 CSV or XLSX.');
  }
  return decoded;
}

function parseRows(buffer, originalName = '') {
  const isCsv = /\.csv$/i.test(originalName);
  // SheetJS may apply a legacy code page when a CSV is supplied as a Buffer.
  // Decoding explicitly guarantees that UTF-8 Tamil, emoji, and styled Unicode survive.
  const workbook = isCsv
    ? xlsx.read(decodeCsvBuffer(buffer), { type: 'string' })
    : xlsx.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const formattedRows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const rawRows = xlsx.utils.sheet_to_json(sheet, { defval: '', raw: true });

  return formattedRows.map((formattedRow, index) => {
    const rawRow = rawRows[index] || {};
    const merged = { ...formattedRow };
    for (const key of Object.keys(formattedRow)) {
      const normalizedKey = key.trim().toLowerCase();
      if (!['phone', 'mobile'].includes(normalizedKey)) continue;
      const rawValue = rawRow[key];
      // Excel often displays long phone numbers as 9.18807E+11. The underlying
      // numeric cell still contains the full safe integer, so use that value.
      if (typeof rawValue === 'number' && Number.isSafeInteger(rawValue)) {
        merged[key] = String(rawValue);
      } else if (rawValue !== undefined && rawValue !== null && rawValue !== '') {
        merged[key] = String(rawValue).trim();
      }
    }
    return Object.fromEntries(Object.entries(merged).map(([key, value]) => [
      repairImportedEncoding(key),
      typeof value === 'string' ? repairImportedEncoding(value) : value,
    ]));
  });
}

function parseCustomValue(value, type) {
  const raw = text(value);
  if (!raw) return null;
  if (type === 'auto') {
    if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
    if (/^-?\d+\.\d+$/.test(raw)) return Number(raw);
    if (TRUTHY.has(raw.toLowerCase())) return true;
    if (['false', 'no', 'n', '0'].includes(raw.toLowerCase())) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return raw;
  }
  if (type === 'integer') return /^-?\d+$/.test(raw) ? Number.parseInt(raw, 10) : undefined;
  if (type === 'number') return Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  if (type === 'boolean') {
    if (TRUTHY.has(raw.toLowerCase())) return true;
    if (['false', 'no', 'n', '0'].includes(raw.toLowerCase())) return false;
    return undefined;
  }
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : undefined;
  return raw;
}

async function buildAudienceTemplateData(code) {
  const result = await db.query(
    `SELECT a.*, COALESCE(json_agg(json_build_object(
       'field_key', f.field_key, 'label', f.label, 'data_type', f.data_type,
       'required', f.required, 'sample_value', f.sample_value, 'sort_order', f.sort_order
     ) ORDER BY f.sort_order, f.id) FILTER (WHERE f.id IS NOT NULL), '[]'::json) AS fields
     FROM alliance_audiences a
     LEFT JOIN alliance_audience_fields f ON f.audience_id = a.id AND f.active = TRUE
     WHERE a.code = $1 AND a.active = TRUE GROUP BY a.id`, [code]
  );
  if (!result.rowCount) return null;
  const audience = result.rows[0];
  const systemColumns = normalizeSystemColumns(audience.column_config?.length ? audience.column_config : defaultSystemColumns());
  const enabledSystemColumns = systemColumns.filter((column) => column.enabled);
  const headers = [...enabledSystemColumns.map((column) => column.label), ...audience.fields.map((field) => field.field_key)];
  const generic = {
    name: 'Contact Name', business_name: `Example ${audience.label}`, email: 'contact@example.com', phone: '919876543210',
    audience: audience.code, industry: 'Industry', location: 'Chennai', source: ['whatsapp','both'].includes(audience.default_channel) ? 'website_form' : 'manual_research',
    channel_pref: audience.default_channel, consent: ['whatsapp','both'].includes(audience.default_channel) ? 'true' : 'false',
    consent_source: ['whatsapp','both'].includes(audience.default_channel) ? 'website_form' : '',
    consent_at: '',
    consent_evidence: ['whatsapp','both'].includes(audience.default_channel) ? 'form_submission_4821' : '',
    consent_scope: ['whatsapp','both'].includes(audience.default_channel) ? 'marketing' : '',
  };
  const samples = (Array.isArray(audience.template_samples) && audience.template_samples.length ? audience.template_samples : [generic]).slice(0, 2);
  const rows = samples.map((sample) => {
    const values = {
      ...generic,
      ...sample,
      audience: audience.code,
      channel_pref: audience.default_channel,
      consent: ['whatsapp','both'].includes(audience.default_channel) ? 'true' : 'false',
      source: ['whatsapp','both'].includes(audience.default_channel)
        ? (['whatsapp','both'].includes(sample.channel_pref) && sample.source && !/(scrap|purchas|directory|research)/i.test(sample.source) ? sample.source : 'website_form')
        : (sample.source || 'manual_research'),
      consent_source: ['whatsapp','both'].includes(audience.default_channel) ? (sample.consent_source || 'website_form') : '',
      consent_evidence: ['whatsapp','both'].includes(audience.default_channel) ? (sample.consent_evidence || 'form_submission_4821') : '',
      consent_scope: ['whatsapp','both'].includes(audience.default_channel) ? (sample.consent_scope || 'marketing') : '',
    };
    audience.fields.forEach((field) => { values[field.field_key] = sample[field.field_key] ?? field.sample_value ?? ''; });
    const row = {};
    enabledSystemColumns.forEach((column) => { row[column.label] = values[column.key] ?? ''; });
    audience.fields.forEach((field) => { row[field.field_key] = values[field.field_key] ?? ''; });
    return row;
  });
  return { audience, headers, rows };
}

router.use(async (req, res, next) => {
  try {
    await ensureAllianceSchema();
    next();
  } catch (error) {
    console.error('Alliance schema initialization failed:', error);
    res.status(500).json({ error: 'AllianceOS database is not ready' });
  }
});

router.get('/analytics', async (_req, res) => {
  try {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    const periodSql = `SELECT date_trunc('week', NOW()) AS week_start,
                              date_trunc('week', NOW()) - INTERVAL '7 days' AS previous_start,
                              date_trunc('week', NOW()) + INTERVAL '7 days' AS week_end`;
    const [periodResult, sentResult, replyResult, funnelResult, channelResult, audienceResult, operationsResult, dailyResult, campaignStatusResult, campaignPerformanceResult] = await Promise.all([
      db.query(periodSql),
      db.query(
        `WITH bounds AS (${periodSql}), sent AS (
           SELECT sent_at AS occurred_at FROM alliance_touches
            WHERE status='sent' AND sent_at IS NOT NULL
           UNION ALL
           SELECT sent_at FROM alliance_whatsapp_campaign_recipients
            WHERE status IN ('sent','delivered','read') AND sent_at IS NOT NULL
         )
         SELECT COUNT(*) FILTER (WHERE occurred_at >= previous_start AND occurred_at < week_start)::int AS previous,
                COUNT(*) FILTER (WHERE occurred_at >= week_start AND occurred_at < week_end)::int AS current
         FROM sent CROSS JOIN bounds`
      ),
      db.query(
        `WITH bounds AS (${periodSql})
         SELECT COUNT(*) FILTER (WHERE r.created_at >= week_start AND r.created_at < week_end)::int AS replies,
                COUNT(*) FILTER (WHERE r.created_at >= date_trunc('day', NOW()) AND r.created_at < date_trunc('day', NOW()) + INTERVAL '1 day')::int AS replies_today
         FROM alliance_replies r CROSS JOIN bounds`
      ),
      db.query(
        `WITH bounds AS (${periodSql}), contacted AS (
           SELECT prospect_id FROM alliance_touches, bounds
            WHERE status='sent' AND sent_at >= week_start AND sent_at < week_end
           UNION
           SELECT prospect_id FROM alliance_whatsapp_campaign_recipients, bounds
            WHERE status IN ('sent','delivered','read') AND sent_at >= week_start AND sent_at < week_end
         ), delivered AS (
           SELECT DISTINCT prospect_id FROM alliance_email_events, bounds
            WHERE event_type IN ('delivered','opened','clicked') AND occurred_at >= week_start AND occurred_at < week_end
           UNION
           SELECT DISTINCT prospect_id FROM alliance_whatsapp_campaign_recipients, bounds
            WHERE status IN ('delivered','read') AND sent_at >= week_start AND sent_at < week_end
         )
         SELECT (SELECT COUNT(*)::int FROM contacted) AS contacted,
                (SELECT COUNT(*)::int FROM delivered) AS delivered,
                COUNT(*) FILTER (WHERE p.status IN ('replied','interested','not_interested') AND p.updated_at >= week_start AND p.updated_at < week_end)::int AS replied,
                COUNT(*) FILTER (WHERE p.status='interested' AND p.updated_at >= week_start AND p.updated_at < week_end)::int AS interested,
                COUNT(*) FILTER (WHERE p.status IN ('converted','closed') AND p.updated_at >= week_start AND p.updated_at < week_end)::int AS closed,
                COUNT(*) FILTER (WHERE p.status='interested' AND p.updated_at >= date_trunc('day', NOW()) AND p.updated_at < date_trunc('day', NOW()) + INTERVAL '1 day')::int AS interested_today
         FROM alliance_prospects p CROSS JOIN bounds`
      ),
      db.query(
        `WITH bounds AS (${periodSql}), sent AS (
           SELECT channel, COUNT(*)::int AS sent FROM alliance_touches, bounds
            WHERE status='sent' AND sent_at >= week_start AND sent_at < week_end GROUP BY channel
           UNION ALL
           SELECT 'whatsapp', COUNT(*)::int FROM alliance_whatsapp_campaign_recipients, bounds
            WHERE status IN ('sent','delivered','read') AND sent_at >= week_start AND sent_at < week_end
         ), replies AS (
           SELECT channel, COUNT(*)::int AS replied FROM alliance_replies, bounds
            WHERE created_at >= week_start AND created_at < week_end GROUP BY channel
         )
         SELECT channels.channel, COALESCE(SUM(sent.sent),0)::int AS sent,
                COALESCE(MAX(replies.replied),0)::int AS replied
         FROM (VALUES ('email'),('whatsapp')) AS channels(channel)
         LEFT JOIN sent ON sent.channel=channels.channel
         LEFT JOIN replies ON replies.channel=channels.channel
         GROUP BY channels.channel ORDER BY channels.channel`
      ),
      db.query(
        `WITH bounds AS (${periodSql})
         SELECT a.code, a.label,
                COUNT(p.id) FILTER (WHERE p.status='interested' AND p.updated_at >= week_start AND p.updated_at < week_end)::int AS interested
         FROM alliance_audiences a CROSS JOIN bounds
         LEFT JOIN alliance_prospects p ON p.audience=a.code
         WHERE a.active=TRUE
         GROUP BY a.id, a.code, a.label, a.created_at ORDER BY a.created_at, a.id`
      ),
      db.query(
        `WITH bounds AS (${periodSql})
         SELECT (SELECT COUNT(*)::int FROM alliance_prospects) AS total_prospects,
                (SELECT COUNT(*)::int FROM alliance_prospects WHERE created_at >= week_start AND created_at < week_end) AS prospects_added,
                (SELECT COUNT(*)::int FROM alliance_prospects WHERE suppressed=TRUE) AS suppressed,
                ((SELECT COUNT(*) FROM alliance_campaigns WHERE status IN ('running','ready')) +
                 (SELECT COUNT(*) FROM alliance_whatsapp_campaigns WHERE status IN ('running','scheduled')))::int AS active_campaigns,
                ((SELECT COUNT(*) FROM alliance_touches WHERE status='failed' AND COALESCE(sent_at,scheduled_at) >= week_start AND COALESCE(sent_at,scheduled_at) < week_end) +
                 (SELECT COUNT(*) FROM alliance_whatsapp_campaign_recipients WHERE status='failed' AND scheduled_at >= week_start AND scheduled_at < week_end))::int AS failed_messages
         FROM bounds`
      ),
      db.query(
        `WITH bounds AS (${periodSql}), days AS (
           SELECT generate_series(week_start::date, (week_end - INTERVAL '1 day')::date, INTERVAL '1 day')::date AS day FROM bounds
         ), sent AS (
           SELECT sent_at::date AS day, COUNT(*)::int AS total FROM alliance_touches, bounds
            WHERE status='sent' AND sent_at >= week_start AND sent_at < week_end GROUP BY sent_at::date
           UNION ALL
           SELECT sent_at::date, COUNT(*)::int FROM alliance_whatsapp_campaign_recipients, bounds
            WHERE status IN ('sent','delivered','read') AND sent_at >= week_start AND sent_at < week_end GROUP BY sent_at::date
         ), replies AS (
           SELECT created_at::date AS day, COUNT(*)::int AS total FROM alliance_replies, bounds
            WHERE created_at >= week_start AND created_at < week_end GROUP BY created_at::date
         )
         SELECT d.day, COALESCE(SUM(s.total),0)::int AS sent, COALESCE(MAX(r.total),0)::int AS replies
         FROM days d LEFT JOIN sent s ON s.day=d.day LEFT JOIN replies r ON r.day=d.day
         GROUP BY d.day ORDER BY d.day`
      ),
      db.query(
        `WITH statuses AS (
           SELECT status FROM alliance_campaigns
           UNION ALL SELECT status FROM alliance_whatsapp_campaigns
         ) SELECT status, COUNT(*)::int AS count FROM statuses GROUP BY status ORDER BY count DESC, status`
      ),
      db.query(
        `SELECT * FROM (
         SELECT 'email-'||c.id AS row_id, c.id, c.name, c.audience, c.channel, c.status, c.created_at,
                (SELECT COUNT(DISTINCT cp.prospect_id) FROM alliance_campaign_prospects cp WHERE cp.campaign_id=c.id)::int AS prospects,
                (SELECT COUNT(*) FROM alliance_touches t WHERE t.campaign_id=c.id AND t.status='sent')::int AS sent,
                (SELECT COUNT(DISTINCT r.prospect_id) FROM alliance_replies r JOIN alliance_campaign_prospects cp ON cp.prospect_id=r.prospect_id WHERE cp.campaign_id=c.id)::int AS replies,
                (SELECT COUNT(DISTINCT p.id) FROM alliance_prospects p JOIN alliance_campaign_prospects cp ON cp.prospect_id=p.id WHERE cp.campaign_id=c.id AND p.status='interested')::int AS interested
         FROM alliance_campaigns c
         UNION ALL
         SELECT 'whatsapp-'||w.id, w.id, w.name, w.audience, 'whatsapp', w.status, w.created_at,
                (SELECT COUNT(*) FROM alliance_whatsapp_campaign_recipients wr WHERE wr.campaign_id=w.id)::int,
                (SELECT COUNT(*) FROM alliance_whatsapp_campaign_recipients wr WHERE wr.campaign_id=w.id AND wr.status IN ('sent','delivered','read'))::int,
                (SELECT COUNT(DISTINCT r.prospect_id) FROM alliance_replies r JOIN alliance_whatsapp_campaign_recipients wr ON wr.prospect_id=r.prospect_id WHERE wr.campaign_id=w.id AND r.channel='whatsapp')::int,
                (SELECT COUNT(DISTINCT p.id) FROM alliance_prospects p JOIN alliance_whatsapp_campaign_recipients wr ON wr.prospect_id=p.id WHERE wr.campaign_id=w.id AND p.status='interested')::int
         FROM alliance_whatsapp_campaigns w
         ) campaigns ORDER BY created_at DESC LIMIT 8`
      ),
    ]);
    const sent = sentResult.rows[0] || { current: 0, previous: 0 };
    const replies = replyResult.rows[0]?.replies || 0;
    const currentSent = sent.current || 0;
    const previousSent = sent.previous || 0;
    const sentChangePct = previousSent ? Math.round(((currentSent - previousSent) / previousSent) * 1000) / 10 : null;
    res.json({
      period: periodResult.rows[0],
      stats: {
        messages_sent: currentSent,
        messages_change_pct: sentChangePct,
        replies,
        reply_rate: currentSent ? Math.round((replies / currentSent) * 1000) / 10 : 0,
        interested: funnelResult.rows[0]?.interested || 0,
        interested_today: funnelResult.rows[0]?.interested_today || 0,
        closed: funnelResult.rows[0]?.closed || 0,
      },
      funnel: funnelResult.rows[0],
      channels: channelResult.rows.map((row) => ({
        ...row,
        reply_rate: row.sent ? Math.round((row.replied / row.sent) * 1000) / 10 : 0,
      })),
      audiences: audienceResult.rows,
      operations: operationsResult.rows[0],
      daily_activity: dailyResult.rows,
      campaign_statuses: campaignStatusResult.rows,
      recent_campaigns: campaignPerformanceResult.rows,
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Alliance analytics failed:', error);
    res.status(500).json({ error: 'Failed to load AllianceOS analytics.' });
  }
});

router.get('/bulk-send-limits', async (_req, res) => {
  try {
    const result = await db.query(`SELECT channel,limit_mode,custom_limit,updated_at FROM alliance_bulk_send_limits ORDER BY channel`);
    res.json({ limits: result.rows });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load bulk-send limits.' });
  }
});

router.put('/bulk-send-limits/:channel', async (req, res) => {
  const channel = text(req.params.channel).toLowerCase();
  const mode = text(req.body.limit_mode).toLowerCase();
  const customLimit = Number(req.body.custom_limit);
  if (!['email','whatsapp'].includes(channel)) return res.status(400).json({ error: 'Channel must be email or whatsapp.' });
  if (!['unlimited','custom'].includes(mode)) return res.status(400).json({ error: 'Choose Unlimited or Custom limit.' });
  if (mode === 'custom' && (!Number.isInteger(customLimit) || customLimit < 1 || customLimit > 100000)) return res.status(400).json({ error: 'Custom limit must be between 1 and 100,000 recipients.' });
  try {
    const result = await db.query(
      `INSERT INTO alliance_bulk_send_limits(channel,limit_mode,custom_limit,updated_by,updated_at)
       VALUES($1,$2,$3,$4,NOW()) ON CONFLICT(channel) DO UPDATE SET limit_mode=EXCLUDED.limit_mode,custom_limit=EXCLUDED.custom_limit,updated_by=EXCLUDED.updated_by,updated_at=NOW()
       RETURNING channel,limit_mode,custom_limit,updated_at`,
      [channel, mode, mode === 'custom' ? customLimit : null, req.user?.id || null]
    );
    res.json({ success: true, limit: result.rows[0], message: `${channel === 'email' ? 'Email' : 'WhatsApp'} bulk-send limit updated.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update bulk-send limit.' });
  }
});

router.get('/audiences', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.id, a.code, a.label, a.brand, a.default_channel, a.column_config, a.active,
              COALESCE(json_agg(json_build_object(
                'id', f.id, 'field_key', f.field_key, 'label', f.label,
                'data_type', f.data_type, 'required', f.required, 'sample_value', f.sample_value, 'sort_order', f.sort_order
              ) ORDER BY f.sort_order, f.id) FILTER (WHERE f.id IS NOT NULL), '[]'::json) AS fields
       FROM alliance_audiences a
       LEFT JOIN alliance_audience_fields f ON f.audience_id = a.id AND f.active = TRUE
       WHERE a.active = TRUE
       GROUP BY a.id ORDER BY a.created_at, a.id`
    );
    res.json({ audiences: result.rows });
  } catch (error) {
    console.error('Alliance audience list failed:', error);
    res.status(500).json({ error: 'Failed to load audience configuration.' });
  }
});

router.get('/email-settings', async (_req, res) => {
  try {
    const senders = await db.query(
      `SELECT id, inbox_email, provider, credential_ref, warmup_stage, daily_cap,
              sent_today, reputation, status, last_reset, created_at
       FROM alliance_domains ORDER BY created_at DESC`
    );
    res.json({ config: publicAllianceEmailConfig(), senders: senders.rows });
  } catch (error) {
    console.error('Alliance email settings failed:', error);
    res.status(500).json({ error: 'Failed to load Alliance email settings.' });
  }
});

router.put('/email-settings', async (req, res) => {
  try {
    const config = publicAllianceEmailConfig();
    if (!config.from || !config.user || !config.host || !config.password_configured) {
      return res.status(400).json({ error: 'Complete the Alliance SMTP environment variables before activating this sender.' });
    }
    const dailyCap = Math.min(Math.max(Number(req.body.daily_cap) || 20, 1), 50);
    const warmupStage = Math.min(Math.max(Number(req.body.warmup_stage) || 1, 1), 4);
    const status = ['active', 'inactive', 'paused'].includes(req.body.status) ? req.body.status : 'inactive';
    const result = await db.query(
      `INSERT INTO alliance_domains
        (inbox_email, provider, credential_ref, warmup_stage, daily_cap, reputation, status)
       VALUES ($1,$2,'env:ALLIANCE_EMAIL_SMTP_PASSWORD',$3,$4,'unknown',$5)
       ON CONFLICT (inbox_email) DO UPDATE SET
         provider = EXCLUDED.provider, credential_ref = EXCLUDED.credential_ref,
         warmup_stage = EXCLUDED.warmup_stage, daily_cap = EXCLUDED.daily_cap,
         status = EXCLUDED.status
       RETURNING id, inbox_email, provider, credential_ref, warmup_stage, daily_cap,
                 sent_today, reputation, status, last_reset, created_at`,
      [config.from, config.provider, warmupStage, dailyCap, status]
    );
    res.json({ success: true, sender: result.rows[0] });
  } catch (error) {
    console.error('Alliance email sender save failed:', error);
    res.status(500).json({ error: 'Failed to save Alliance email sender.' });
  }
});

router.post('/email-settings/verify', async (_req, res) => {
  try {
    await verifyAllianceEmailTransport();
    res.json({ success: true, message: 'Zoho SMTP authentication succeeded. No email was sent.' });
  } catch (error) {
    console.error('Alliance SMTP verification failed:', error.message);
    res.status(502).json({ error: `Zoho SMTP verification failed: ${error.message}` });
  }
});

router.get('/audiences/:code/template', async (req, res) => {
  try {
    const template = await buildAudienceTemplateData(req.params.code);
    if (!template) return res.status(404).json({ error: 'Audience not found.' });
    const { audience, headers, rows } = template;
    const workbook = xlsx.utils.book_new();
    const leadsSheet = xlsx.utils.json_to_sheet(rows, { header: headers });
    leadsSheet['!cols'] = headers.map((header) => ({ wch: Math.max(14, header.length + 3) }));
    xlsx.utils.book_append_sheet(workbook, leadsSheet, 'Leads');
    const instructions = xlsx.utils.aoa_to_sheet([
      [`AllianceOS ${audience.label} upload template`],
      ['Instructions', 'Do not rename headers. Replace or delete sample rows before uploading.'],
      ['Required custom columns', audience.fields.filter((field) => field.required).map((field) => field.field_key).join(', ') || 'None'],
      ['Default channel', audience.default_channel],
      ['WhatsApp rule', 'phone, consent=true, and consent_source are mandatory.'],
    ]);
    instructions['!cols'] = [{ wch: 28 }, { wch: 90 }];
    xlsx.utils.book_append_sheet(workbook, instructions, 'Instructions');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="AllianceOS_${audience.code}_Lead_Template.xlsx"`);
    res.send(buffer);
  } catch (error) {
    console.error('Alliance audience template failed:', error);
    res.status(500).json({ error: 'Failed to generate Excel template.' });
  }
});

router.get('/audiences/:code/template-preview', async (req, res) => {
  try {
    const template = await buildAudienceTemplateData(req.params.code);
    if (!template) return res.status(404).json({ error: 'Audience not found.' });
    res.json({
      audience: { code: template.audience.code, label: template.audience.label, default_channel: template.audience.default_channel },
      columns: template.headers,
      rows: template.rows.slice(0, 2),
    });
  } catch (error) {
    console.error('Alliance audience preview failed:', error);
    res.status(500).json({ error: 'Failed to load template preview.' });
  }
});

router.post('/audiences', async (req, res) => {
  const code = text(req.body.code).toLowerCase();
  const label = text(req.body.label);
  const brand = text(req.body.brand);
  const defaultChannel = text(req.body.default_channel || 'email').toLowerCase();
  const fields = Array.isArray(req.body.fields) ? req.body.fields : [];
  let systemColumns;
  try { systemColumns = normalizeSystemColumns(req.body.system_columns); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  if (code.length > 50) return res.status(400).json({ error: 'Audience code must be 50 characters or less.' });
  if (!/^[a-z][a-z0-9_]*$/.test(code)) return res.status(400).json({ error: 'Audience code must use lowercase letters, numbers, and underscores.' });
  if (!label) return res.status(400).json({ error: 'Audience label is required.' });
  if (!['email', 'whatsapp', 'both'].includes(defaultChannel)) return res.status(400).json({ error: 'Default channel must be email, whatsapp, or both.' });
  try { validateChannelSystemColumns(systemColumns, defaultChannel); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  if (fields.length > 50) return res.status(400).json({ error: 'A maximum of 50 custom fields is allowed.' });

  const normalizedFields = [];
  const seen = new Set();
  for (const [index, field] of fields.entries()) {
    const fieldKey = text(field.field_key).toLowerCase();
    const dataType = text(field.data_type || 'text').toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(fieldKey) || COMMON_FIELDS.has(fieldKey) || seen.has(fieldKey)) {
      return res.status(400).json({ error: `Invalid or duplicate custom field: ${fieldKey || index + 1}` });
    }
    if (!['auto', 'text', 'integer', 'number', 'boolean', 'date'].includes(dataType)) return res.status(400).json({ error: `Invalid data type for ${fieldKey}.` });
    if (!text(field.sample_value)) return res.status(400).json({ error: `Add a sample value for ${fieldKey}.` });
    seen.add(fieldKey);
    normalizedFields.push({ fieldKey, label: text(field.label) || fieldKey, dataType, required: Boolean(field.required), sampleValue: text(field.sample_value), sortOrder: index });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const audienceResult = await client.query(
      `INSERT INTO alliance_audiences (code, label, brand, default_channel, column_config)
       VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING *`,
      [code, label, brand || null, defaultChannel, JSON.stringify(systemColumns)]
    );
    for (const field of normalizedFields) {
      await client.query(
        `INSERT INTO alliance_audience_fields (audience_id, field_key, label, data_type, required, sample_value, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [audienceResult.rows[0].id, field.fieldKey, field.label, field.dataType, field.required, field.sampleValue || null, field.sortOrder]
      );
    }
    const channelCadences = [
      ...(['email','both'].includes(defaultChannel) ? [{ channel:'email', cadence:[[1,0,'Introduction and one clear ask'],[2,2,'Short friendly reminder'],[3,5,'New angle and proof'],[4,9,'Polite break-up message']] }] : []),
      ...(['whatsapp','both'].includes(defaultChannel) ? [{ channel:'whatsapp', cadence:[[1,0,'Approved introduction template'],[2,4,'One gentle follow-up']] }] : []),
    ];
    for (const { channel, cadence } of channelCadences) {
      for (const [touchNo, delayDays, purpose] of cadence) {
        await client.query(
          `INSERT INTO alliance_sequences (audience, channel, touch_no, delay_days, purpose)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT (audience, channel, touch_no) DO NOTHING`,
          [code, channel, touchNo, delayDays, purpose]
        );
        if (channel === 'email') {
          const subject = touchNo === 1 ? 'Introduction for {{org}}' : `Follow-up ${touchNo} for {{org}}`;
          const messageType = touchNo === 1 ? 'introduction' : 'follow-up message';
          await client.query(
            `INSERT INTO alliance_templates
               (audience,channel,touch_no,template_name,subject,body,provider_status,active)
             VALUES ($1,'email',$2,$3,$4,$5,'draft',TRUE)
             ON CONFLICT (audience,channel,touch_no) DO NOTHING`,
            [code, touchNo, `Touch ${touchNo}`, subject,
              `Hi {{name}},\n\nAdd your ${messageType} for {{org}} here.\n\nTo stop receiving these, reply "unsubscribe".`]
          );
        }
      }
    }
    await client.query('COMMIT');
    res.status(201).json({ audience: { ...audienceResult.rows[0], fields: normalizedFields } });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'That audience code already exists.' });
    console.error('Alliance audience create failed:', error);
    res.status(500).json({ error: 'Failed to create audience.' });
  } finally {
    client.release();
  }
});

router.post('/prospects/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select a CSV or XLSX file.' });

  const defaultAudience = text(req.body.audience || req.body.type).toLowerCase();
  const requestedChannel = text(req.body.channel || 'auto').toLowerCase();
  if (!CHANNELS.has(requestedChannel)) return res.status(400).json({ error: 'Select a valid channel.' });

  const audienceResult = await db.query(
    `SELECT a.*, COALESCE(json_agg(json_build_object(
       'field_key', f.field_key, 'data_type', f.data_type, 'required', f.required
     ) ORDER BY f.sort_order) FILTER (WHERE f.id IS NOT NULL), '[]'::json) AS fields
     FROM alliance_audiences a
     LEFT JOIN alliance_audience_fields f ON f.audience_id = a.id AND f.active = TRUE
     WHERE a.code = $1 AND a.active = TRUE GROUP BY a.id`,
    [defaultAudience]
  );
  if (!audienceResult.rowCount) return res.status(400).json({ error: 'Select a valid audience.' });
  const audienceConfig = audienceResult.rows[0];
  const configuredSystemColumns = normalizeSystemColumns(audienceConfig.column_config?.length ? audienceConfig.column_config : defaultSystemColumns());

  let rows;
  try {
    rows = parseRows(req.file.buffer, req.file.originalname);
    rows = rows.map((row) => {
      const mapped = { ...row };
      configuredSystemColumns.forEach((column) => {
        if (!column.enabled || column.label === column.key) return;
        const value = valueFrom(row, [column.label]);
        if (value !== '') mapped[column.key] = value;
      });
      return mapped;
    });
  } catch (error) {
    const safeEncodingError = /(?:CSV|UTF-|encoding)/i.test(error.message || '') ? error.message : null;
    return res.status(400).json({ error: safeEncodingError || 'The uploaded spreadsheet could not be read.' });
  }
  if (!rows.length) return res.status(400).json({ error: 'The uploaded file has no prospect rows.' });
  if (rows.length > 5000) return res.status(400).json({ error: 'A maximum of 5,000 rows is allowed per upload.' });

  const client = await db.connect();
  const report = {
    total: rows.length,
    imported: 0,
    duplicates: 0,
    suppressed: 0,
    invalid: 0,
    welcome_queued: 0,
    welcome_not_eligible: 0,
    welcome_missing_template: 0,
    errors: [],
  };
  try {
    await client.query('BEGIN');
    const campaignName = text(req.body.campaign) || `Import ${new Date().toISOString().slice(0, 10)}`;
    const campaignResult = await client.query(
      `INSERT INTO alliance_campaigns (name, audience, channel, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id, name`,
      [campaignName, defaultAudience, requestedChannel, req.user?.id || null]
    );
    const campaign = campaignResult.rows[0];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNo = index + 2;
      let businessName = text(valueFrom(row, ['business_name', 'business name', 'organisation name', 'organization name']));
      // Preserve the contact name exactly as supplied. A contact and business may
      // legitimately share the same display name, so never infer that one is redundant.
      const name = text(valueFrom(row, ['name', 'contact name', 'principal name']));
      const audience = text(valueFrom(row, ['audience'])).toLowerCase() || defaultAudience;
      const emailRaw = text(valueFrom(row, ['email']));
      const phoneRaw = text(valueFrom(row, ['phone', 'mobile']));
      businessName = businessName || name || emailRaw.split('@')[0] || phoneRaw || `Prospect row ${rowNo}`;
      const email = normalizeEmail(emailRaw);
      const phone = normalizePhone(phoneRaw);
      const rowChannelRaw = text(valueFrom(row, ['channel_pref', 'channel preference']));
      const rowChannel = normalizeChannelPreference(rowChannelRaw);
      const consent = TRUTHY.has(text(valueFrom(row, ['consent', 'whatsapp_consent', 'whatsapp consent'])).toLowerCase());
      const consentSource = text(valueFrom(row, ['consent_source', 'consent source'])).toLowerCase();
      const consentAtRaw = text(valueFrom(row, ['consent_at', 'consent at']));
      let consentAt = null;
      if (consentAtRaw) {
        const consentAtHasTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(consentAtRaw);
        consentAt = consentAtHasTimezone && !Number.isNaN(Date.parse(consentAtRaw)) ? new Date(consentAtRaw) : null;
      } else if (consent) {
        consentAt = new Date();
      }
      const consentEvidence = text(valueFrom(row, ['consent_evidence', 'consent evidence']));
      const consentScope = text(valueFrom(row, ['consent_scope', 'consent scope'])).toLowerCase();
      const leadSource = text(valueFrom(row, ['source'])) || 'file_upload';
      const channelPref = rowChannel || (requestedChannel === 'auto' ? '' : requestedChannel);
      const hasWhatsAppAccess = Boolean(phone && consent && consentSource);
      const inferredChannel = email && hasWhatsAppAccess ? 'both' : email ? 'email' : 'whatsapp';
      const channel = channelPref || (requestedChannel === 'auto' ? inferredChannel : audienceConfig.default_channel);
      const problems = [];

      for (const column of configuredSystemColumns) {
        if (column.key === 'consent_at') continue;
        if (column.enabled && column.required && !text(valueFrom(row, [column.key]))) {
          problems.push(`${column.label} is required`);
        }
      }

      if (audience !== defaultAudience) problems.push(`audience must be ${defaultAudience} for this campaign`);
      if (rowChannel && !['email', 'whatsapp', 'both'].includes(rowChannel)) problems.push(`invalid channel_pref "${rowChannelRaw}"; use email, whatsapp, both, or leave it blank`);
      if (emailRaw && !email) problems.push('invalid email');
      if (phoneRaw && !phone) problems.push('invalid mobile number');
      if (['email', 'both'].includes(channel) && !email) problems.push('email is required for email outreach');
      if (['whatsapp', 'both'].includes(channel) && !phone) problems.push('mobile number is required for WhatsApp');
      if (['whatsapp', 'both'].includes(channel) && !consent) problems.push('WhatsApp consent is required');
      if (['whatsapp', 'both'].includes(channel) && !consentSource) problems.push('consent_source is required for WhatsApp');
      if (['whatsapp', 'both'].includes(channel) && consentSource && !WHATSAPP_CONSENT_SOURCES.has(consentSource)) problems.push(`invalid consent_source "${consentSource}"; use ${[...WHATSAPP_CONSENT_SOURCES].join(', ')}`);
      if (['whatsapp', 'both'].includes(channel) && !consentAt) problems.push('consent_at is required for WhatsApp');
      else if (consentAtRaw && !consentAt) problems.push('consent_at must be a valid date/time with timezone');
      if (['whatsapp', 'both'].includes(channel) && !consentEvidence) problems.push('consent_evidence is required for WhatsApp');
      if (['whatsapp', 'both'].includes(channel) && !CONSENT_SCOPES.has(consentScope)) problems.push('consent_scope must be marketing, service, or both');
      if (consent && NON_CONSENT_SOURCE_PATTERN.test(leadSource)) problems.push(`source "${leadSource}" cannot be marked consent=true; scraped, purchased, directory, and researched numbers must remain consent=false`);

      const customFields = {};
      for (const field of audienceConfig.fields) {
        const rawValue = valueFrom(row, [field.field_key]);
        const parsedValue = parseCustomValue(rawValue, field.data_type);
        if (field.required && (parsedValue === null || parsedValue === undefined)) problems.push(`${field.field_key} is required`);
        else if (parsedValue === undefined) problems.push(`${field.field_key} must be ${field.data_type}`);
        else if (parsedValue !== null) customFields[field.field_key] = parsedValue;
      }

      if (problems.length) {
        report.invalid += 1;
        if (report.errors.length < 100) report.errors.push({ row: rowNo, business_name: businessName, reasons: problems });
        continue;
      }

      const suppression = await client.query(
        `SELECT 1 FROM alliance_suppression
         WHERE ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
            OR ($2::text IS NOT NULL AND phone = $2)
         LIMIT 1`,
        [email, phone]
      );
      if (suppression.rowCount) {
        report.suppressed += 1;
        continue;
      }

      const duplicate = await client.query(
        `SELECT 1 FROM alliance_prospects
         WHERE ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
            OR ($2::text IS NOT NULL AND phone = $2)
         LIMIT 1`,
        [email, phone]
      );
      if (duplicate.rowCount) {
        report.duplicates += 1;
        continue;
      }

      const prospectResult = await client.query(
        `INSERT INTO alliance_prospects
          (campaign_id, audience, name, business_name, phone, email, industry, location,
           channel_pref, channel, consent, consent_source, consent_at, consent_evidence, consent_scope, source, custom_fields)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING id`,
        [campaign.id, audience, name || null, businessName, phone, email,
          text(valueFrom(row, ['industry'])) || null, text(valueFrom(row, ['location'])) || null,
          channelPref || null, channel, consent,
          consent ? consentSource : null,
          consent ? consentAt : null, consent ? consentEvidence : null, consent ? consentScope : null,
          leadSource, customFields]
      );
      const prospectId = prospectResult.rows[0].id;
      await client.query(
        `INSERT INTO alliance_campaign_prospects (campaign_id, prospect_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [campaign.id, prospectId]
      );
      let contactResult;
      if (phone) {
        contactResult = await client.query(`SELECT id FROM alliance_inbox_contacts WHERE phone = $1 LIMIT 1`, [phone]);
      }
      if (contactResult?.rowCount) {
        contactResult = await client.query(
          `UPDATE alliance_inbox_contacts
           SET prospect_id = $1, wa_id = COALESCE(wa_id, $2), name = COALESCE($3, name),
               source = 'file_upload', custom_fields = custom_fields || $4::jsonb, updated_at = NOW()
           WHERE id = $5 RETURNING *`,
          [prospectId, phone, name || null, JSON.stringify({ business_name: businessName, audience, email }), contactResult.rows[0].id]
        );
      } else {
        contactResult = await client.query(
          `INSERT INTO alliance_inbox_contacts (prospect_id, wa_id, phone, name, profile_name, source, custom_fields)
           VALUES ($1,$2,$2,$3,$3,'file_upload',$4::jsonb) RETURNING *`,
          [prospectId, phone, name || businessName, JSON.stringify({ business_name: businessName, audience, email })]
        );
      }
      const contact = contactResult.rows[0];
      const settingsResult = await client.query(`SELECT phone_number_id FROM alliance_inbox_settings WHERE active = TRUE ORDER BY id LIMIT 1`);
      const phoneNumberId = settingsResult.rows[0]?.phone_number_id || process.env.ALLIANCE_WA_PHONE_NUMBER_ID || 'unconfigured';
      const welcomeEligible = Boolean(phone && consent);
      const conversationResult = await client.query(
        `INSERT INTO alliance_inbox_conversations (contact_id, phone_number_id, welcome_status)
         VALUES ($1,$2,$3)
         ON CONFLICT (contact_id) DO UPDATE SET phone_number_id = EXCLUDED.phone_number_id, updated_at = NOW()
         RETURNING *`,
        [contact.id, phoneNumberId, welcomeEligible ? 'queued' : 'not_eligible']
      );
      if (welcomeEligible) {
        const templateResult = await client.query(
          `SELECT template_name, body, language FROM alliance_templates
           WHERE audience = $1 AND channel = 'whatsapp' AND touch_no = 1 AND active = TRUE
             AND template_name IS NOT NULL AND LOWER(COALESCE(provider_status, 'approved')) = 'approved'
           ORDER BY updated_at DESC LIMIT 1`,
          [audience]
        );
        if (templateResult.rowCount) {
          const template = templateResult.rows[0];
          await client.query(
            `INSERT INTO alliance_inbox_messages
              (conversation_id, contact_id, direction, msg_type, content, status, raw_payload)
             VALUES ($1,$2,'outbound','template',$3,'queued',$4::jsonb)`,
            [conversationResult.rows[0].id, contact.id, template.body,
              JSON.stringify({ purpose: 'welcome', template_name: template.template_name, language: template.language || 'en', prospect_id: prospectId })]
          );
          await client.query(
            `UPDATE alliance_inbox_conversations SET welcome_template_name = $1 WHERE id = $2`,
            [template.template_name, conversationResult.rows[0].id]
          );
          report.welcome_queued = (report.welcome_queued || 0) + 1;
        } else {
          await client.query(
            `UPDATE alliance_inbox_conversations SET welcome_status = 'missing_template', welcome_error = $1 WHERE id = $2`,
            ['No approved WhatsApp touch-1 template is configured for this audience.', conversationResult.rows[0].id]
          );
          report.welcome_missing_template = (report.welcome_missing_template || 0) + 1;
        }
      } else {
        report.welcome_not_eligible = (report.welcome_not_eligible || 0) + 1;
      }
      report.imported += 1;
    }

    await client.query('COMMIT');
    req.app.get('io')?.emit('alliance_contacts_changed', { campaign_id: campaign.id, imported: report.imported });
    setImmediate(() => processQueuedAllianceWelcomes(req.app.get('io')).catch((error) => {
      console.error('[Alliance welcome queue]', error);
    }));
    res.status(201).json({
      success: true,
      campaign,
      report,
      message: `Imported ${report.imported} of ${report.total} prospects.`,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance prospect import failed:', error);
    res.status(500).json({ error: 'Failed to import AllianceOS prospects.' });
  } finally {
    client.release();
  }
});

router.get('/prospects', async (req, res) => {
  const values = [];
  const where = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  if (req.query.audience) add('p.audience = ?', req.query.audience);
  const campaignName = text(req.query.campaign_name);
  if (campaignName) {
    values.push(campaignName);
    where.push(`EXISTS (
      SELECT 1 FROM alliance_campaigns selected_campaign
      WHERE selected_campaign.name = $${values.length}
        AND (selected_campaign.id = p.campaign_id OR EXISTS (
          SELECT 1 FROM alliance_campaign_prospects selected_cp
          WHERE selected_cp.prospect_id = p.id AND selected_cp.campaign_id = selected_campaign.id
        ))
    )`);
  }
  if (req.query.status) add('p.status = ?', req.query.status);
  if (req.query.channel && ['email', 'whatsapp'].includes(req.query.channel)) {
    add(`p.channel IN (?, 'both')`, req.query.channel);
  }
  if (req.query.tag) {
    values.push(req.query.tag);
    where.push(`(
      EXISTS (
        SELECT 1 FROM alliance_prospect_tags apt
        WHERE apt.prospect_id = p.id AND apt.tag_id = $${values.length}
      ) OR EXISTS (
        SELECT 1 FROM alliance_contact_tags act
        JOIN alliance_inbox_contacts c ON c.id = act.contact_id
        WHERE c.prospect_id = p.id AND act.tag_id = $${values.length}
      )
    )`);
  }
  if (req.query.search) {
    values.push(req.query.search);
    const searchParam = `$${values.length}`;
    where.push(`(p.business_name ILIKE '%' || ${searchParam} || '%'
      OR p.name ILIKE '%' || ${searchParam} || '%'
      OR p.email ILIKE '%' || ${searchParam} || '%'
      OR (REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') <> '' AND
          REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE '%' ||
          REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') || '%'))`);
  }
  if (req.query.dateFrom) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date >= ?::date`, req.query.dateFrom);
  if (req.query.dateTo) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ?::date`, req.query.dateTo);

  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM alliance_prospects p
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`,
      values
    );
    values.push(limit);
    const limitParam = `$${values.length}`;
    values.push(offset);
    const offsetParam = `$${values.length}`;
    const result = await db.query(
      `SELECT p.id, p.name, p.business_name, p.location, p.industry, p.audience, p.channel,
              p.status, p.current_touch, p.ai_score, p.email, p.phone, p.source,
              p.consent, p.consent_source, p.custom_fields, p.updated_at,
              p.campaign_id, linked_campaigns.campaign_name, p.created_at,
              prospect_tags.tags
       FROM alliance_prospects p
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT linked.name, ', ' ORDER BY linked.name) AS campaign_name
         FROM alliance_campaigns linked
         WHERE linked.id = p.campaign_id OR EXISTS (
           SELECT 1 FROM alliance_campaign_prospects linked_cp
           WHERE linked_cp.prospect_id = p.id AND linked_cp.campaign_id = linked.id
         )
       ) linked_campaigns ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json) AS tags
         FROM (
           SELECT tag_id FROM alliance_prospect_tags WHERE prospect_id = p.id
           UNION
           SELECT act.tag_id FROM alliance_contact_tags act
           JOIN alliance_inbox_contacts c ON c.id = act.contact_id
           WHERE c.prospect_id = p.id
         ) combined_tags
         JOIN alliance_inbox_tags t ON combined_tags.tag_id = t.id
       ) prospect_tags ON TRUE
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      values
    );
    res.json({ prospects: result.rows, count: result.rowCount, total: countResult.rows[0].total, limit, offset });
  } catch (error) {
    console.error('Alliance prospect list failed:', error);
    res.status(500).json({ error: 'Failed to load AllianceOS prospects.' });
  }
});

router.get('/prospects/export', async (req, res) => {
  const values = [];
  const where = [];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  if (req.query.audience) add('p.audience = ?', req.query.audience);
  const campaignName = text(req.query.campaign_name);
  if (campaignName) {
    values.push(campaignName);
    where.push(`EXISTS (
      SELECT 1 FROM alliance_campaigns selected_campaign
      WHERE selected_campaign.name = $${values.length}
        AND (selected_campaign.id = p.campaign_id OR EXISTS (
          SELECT 1 FROM alliance_campaign_prospects selected_cp
          WHERE selected_cp.prospect_id = p.id AND selected_cp.campaign_id = selected_campaign.id
        ))
    )`);
  }
  if (req.query.status) add('p.status = ?', req.query.status);
  if (req.query.channel && ['email', 'whatsapp'].includes(req.query.channel)) {
    add(`p.channel IN (?, 'both')`, req.query.channel);
  }
  if (req.query.tag) {
    values.push(req.query.tag);
    where.push(`(
      EXISTS (
        SELECT 1 FROM alliance_prospect_tags apt
        WHERE apt.prospect_id = p.id AND apt.tag_id = $${values.length}
      ) OR EXISTS (
        SELECT 1 FROM alliance_contact_tags act
        JOIN alliance_inbox_contacts c ON c.id = act.contact_id
        WHERE c.prospect_id = p.id AND act.tag_id = $${values.length}
      )
    )`);
  }
  if (req.query.search) {
    values.push(req.query.search);
    const searchParam = `$${values.length}`;
    where.push(`(p.business_name ILIKE '%' || ${searchParam} || '%'
      OR p.name ILIKE '%' || ${searchParam} || '%'
      OR p.email ILIKE '%' || ${searchParam} || '%'
      OR (REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') <> '' AND
          REGEXP_REPLACE(COALESCE(p.phone, ''), '[^0-9]', '', 'g') LIKE '%' ||
          REGEXP_REPLACE(${searchParam}, '[^0-9]', '', 'g') || '%'))`);
  }
  if (req.query.dateFrom) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date >= ?::date`, req.query.dateFrom);
  if (req.query.dateTo) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ?::date`, req.query.dateTo);

  try {
    const result = await db.query(
      `SELECT p.id, p.name, p.business_name, p.location, p.industry, p.audience, p.channel,
              p.status, p.current_touch, p.ai_score, p.email, p.phone, p.source,
              p.consent, p.consent_source, p.custom_fields, p.updated_at,
              p.campaign_id, linked_campaigns.campaign_name, p.created_at,
              prospect_tags.tags
       FROM alliance_prospects p
       LEFT JOIN LATERAL (
         SELECT STRING_AGG(DISTINCT linked.name, ', ' ORDER BY linked.name) AS campaign_name
         FROM alliance_campaigns linked
         WHERE linked.id = p.campaign_id OR EXISTS (
           SELECT 1 FROM alliance_campaign_prospects linked_cp
           WHERE linked_cp.prospect_id = p.id AND linked_cp.campaign_id = linked.id
         )
       ) linked_campaigns ON TRUE
       LEFT JOIN LATERAL (
         SELECT COALESCE(json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color)), '[]'::json) AS tags
         FROM (
           SELECT tag_id FROM alliance_prospect_tags WHERE prospect_id = p.id
           UNION
           SELECT act.tag_id FROM alliance_contact_tags act
           JOIN alliance_inbox_contacts c ON c.id = act.contact_id
           WHERE c.prospect_id = p.id
         ) combined_tags
         JOIN alliance_inbox_tags t ON combined_tags.tag_id = t.id
       ) prospect_tags ON TRUE
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.created_at DESC`,
      values
    );

    const rows = result.rows.map(p => ({
      'Business Name': p.business_name,
      'Contact Name': p.name || '',
      'Email': p.email || '',
      'Phone': p.phone || '',
      'Status': p.status || '',
      'Audience': p.audience || '',
      'Campaigns': p.campaign_name || '',
      'Tags': (p.tags || []).map(t => t.name).join(', '),
      'Source': p.source || '',
      'Industry': p.industry || '',
      'Location': p.location || '',
      'Added On': p.created_at ? new Date(p.created_at).toLocaleString() : ''
    }));

    const workbook = xlsx.utils.book_new();
    const worksheet = xlsx.utils.json_to_sheet(rows);
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Prospects');
    const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Prospects_Export.xlsx"');
    res.send(buffer);
  } catch (error) {
    console.error('Alliance prospect export failed:', error);
    res.status(500).json({ error: 'Failed to export prospects.' });
  }
});

router.put('/audiences/:code', async (req, res) => {
  const code = text(req.params.code).toLowerCase();
  const newCode = text(req.body.code || code).toLowerCase();
  const label = text(req.body.label);
  const brand = text(req.body.brand);
  const defaultChannel = text(req.body.default_channel).toLowerCase();
  const fields = Array.isArray(req.body.fields) ? req.body.fields : [];
  let systemColumns;
  try { systemColumns = normalizeSystemColumns(req.body.system_columns); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  if (!/^[a-z][a-z0-9_]*$/.test(newCode)) return res.status(400).json({ error: 'Audience code must use lowercase letters, numbers, and underscores.' });
  if (!label) return res.status(400).json({ error: 'Audience label is required.' });
  if (!['email', 'whatsapp', 'both'].includes(defaultChannel)) return res.status(400).json({ error: 'Default channel must be email, whatsapp, or both.' });
  try { validateChannelSystemColumns(systemColumns, defaultChannel); } catch (error) { return res.status(error.status || 400).json({ error: error.message }); }
  if (fields.length > 50) return res.status(400).json({ error: 'A maximum of 50 custom fields is allowed.' });
  const normalizedFields = [];
  const seen = new Set();
  for (const [index, field] of fields.entries()) {
    const fieldKey = text(field.field_key).toLowerCase();
    const dataType = text(field.data_type || 'text').toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(fieldKey) || COMMON_FIELDS.has(fieldKey) || seen.has(fieldKey)) return res.status(400).json({ error: `Invalid or duplicate custom field: ${fieldKey || index + 1}` });
    if (!['auto', 'text', 'integer', 'number', 'boolean', 'date'].includes(dataType)) return res.status(400).json({ error: `Invalid data type for ${fieldKey}.` });
    if (!text(field.sample_value)) return res.status(400).json({ error: `Add a sample value for ${fieldKey}.` });
    seen.add(fieldKey);
    normalizedFields.push({ fieldKey, originalFieldKey: text(field.original_field_key).toLowerCase() || fieldKey, label: text(field.label) || fieldKey.replace(/_/g, ' '), dataType, required: Boolean(field.required), sampleValue: text(field.sample_value), sortOrder: index });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (newCode !== code) {
      const duplicate = await client.query(`SELECT 1 FROM alliance_audiences WHERE code=$1`, [newCode]);
      if (duplicate.rowCount) throw Object.assign(new Error('That audience code already exists.'), { status: 409 });
    }
    const audienceResult = await client.query(
      `UPDATE alliance_audiences SET code=$1,label=$2,brand=$3,default_channel=$4,column_config=$5::jsonb,updated_at=NOW()
       WHERE code=$6 AND active=TRUE RETURNING *`,
      [newCode, label, brand || null, defaultChannel, JSON.stringify(systemColumns), code]
    );
    if (!audienceResult.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Audience not found.' }); }
    const audienceId = audienceResult.rows[0].id;
    if (newCode !== code) {
      for (const table of ['alliance_prospects', 'alliance_campaigns', 'alliance_sequences', 'alliance_templates', 'alliance_kb', 'alliance_objections', 'alliance_whatsapp_campaigns']) {
        await client.query(`UPDATE ${table} SET audience=$1 WHERE audience=$2`, [newCode, code]);
      }
    }
    for (const field of normalizedFields) {
      if (field.originalFieldKey === field.fieldKey) continue;
      if (!/^[a-z][a-z0-9_]*$/.test(field.originalFieldKey)) throw Object.assign(new Error(`Invalid original field key: ${field.originalFieldKey}`), { status: 400 });
      await client.query(
        `UPDATE alliance_prospects
         SET custom_fields = (custom_fields - $1) || jsonb_build_object($2, COALESCE(custom_fields -> $2, custom_fields -> $1)), updated_at=NOW()
         WHERE audience=$3 AND custom_fields ? $1`,
        [field.originalFieldKey, field.fieldKey, newCode]
      );
    }
    await client.query(`UPDATE alliance_audience_fields SET active=FALSE WHERE audience_id=$1`, [audienceId]);
    for (const field of normalizedFields) {
      await client.query(
        `INSERT INTO alliance_audience_fields (audience_id,field_key,label,data_type,required,sample_value,sort_order,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE)
         ON CONFLICT (audience_id,field_key) DO UPDATE SET label=EXCLUDED.label,data_type=EXCLUDED.data_type,
           required=EXCLUDED.required,sample_value=EXCLUDED.sample_value,sort_order=EXCLUDED.sort_order,active=TRUE`,
        [audienceId, field.fieldKey, field.label, field.dataType, field.required, field.sampleValue, field.sortOrder]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, audience: { ...audienceResult.rows[0], fields: normalizedFields }, message: newCode === code ? 'Audience configuration updated.' : `Audience renamed to ${newCode}.` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance audience update failed:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to update audience configuration.' });
  } finally { client.release(); }
});

router.delete('/audiences/:code', async (req, res) => {
  const code = text(req.params.code).toLowerCase();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const audienceResult = await client.query(`SELECT id,label FROM alliance_audiences WHERE code=$1 AND active=TRUE FOR UPDATE`, [code]);
    if (!audienceResult.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Audience not found.' }); }
    const usage = await client.query(
      `SELECT (SELECT COUNT(*) FROM alliance_prospects WHERE audience=$1)::int AS prospects,
              (SELECT COUNT(*) FROM alliance_campaigns WHERE audience=$1)::int AS campaigns`, [code]
    );
    if (usage.rows[0].prospects || usage.rows[0].campaigns) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `This audience is used by ${usage.rows[0].prospects} prospect(s) and ${usage.rows[0].campaigns} campaign(s). Remove those records before deleting the audience.` });
    }
    await client.query(`DELETE FROM alliance_sequences WHERE audience=$1`, [code]);
    await client.query(`DELETE FROM alliance_templates WHERE audience=$1`, [code]);
    await client.query(`DELETE FROM alliance_audiences WHERE id=$1`, [audienceResult.rows[0].id]);
    await client.query('COMMIT');
    res.json({ success: true, message: `Audience "${audienceResult.rows[0].label}" deleted.` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance audience delete failed:', error);
    res.status(500).json({ error: 'Failed to delete audience.' });
  } finally { client.release(); }
});

router.post('/prospects/repair-imported-names', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `SELECT id, name, business_name, industry, location, source
       FROM alliance_prospects
       ORDER BY id
       FOR UPDATE`
    );
    let repaired = 0;
    let encodingRepairs = 0;
    const repairedIds = [];

    for (const prospect of result.rows) {
      const businessName = repairImportedEncoding(prospect.business_name);
      const importedName = repairImportedEncoding(prospect.name || '');
      const name = importedName || null;
      const industry = prospect.industry == null ? null : repairImportedEncoding(prospect.industry);
      const location = prospect.location == null ? null : repairImportedEncoding(prospect.location);
      const source = prospect.source == null ? null : repairImportedEncoding(prospect.source);
      const encodingChanged = businessName !== prospect.business_name
        || importedName !== (prospect.name || '')
        || industry !== prospect.industry || location !== prospect.location || source !== prospect.source;
      if (!encodingChanged) continue;

      await client.query(
        `UPDATE alliance_prospects
         SET business_name = $1, name = $2, industry = $3, location = $4, source = $5, updated_at = NOW()
         WHERE id = $6`,
        [businessName, name, industry, location, source, prospect.id]
      );
      repairedIds.push(prospect.id);
      repaired += 1;
      if (encodingChanged) encodingRepairs += 1;
    }

    if (repairedIds.length) {
      await client.query(
        `UPDATE alliance_inbox_contacts c
         SET name = COALESCE(p.name, p.business_name),
             profile_name = COALESCE(p.name, p.business_name),
             custom_fields = COALESCE(c.custom_fields, '{}'::jsonb)
               || jsonb_build_object('business_name', p.business_name),
             updated_at = NOW()
         FROM alliance_prospects p
         WHERE c.prospect_id = p.id
           AND p.id = ANY($1::bigint[])
           AND c.source = 'file_upload'`,
        [repairedIds]
      );
    }

    await client.query('COMMIT');
    req.app.get('io')?.emit('alliance_contacts_changed', { repaired });
    res.json({
      success: true,
      scanned: result.rowCount,
      repaired,
      encoding_repairs: encodingRepairs,
      message: repaired
        ? `Repaired ${repaired} prospect record${repaired === 1 ? '' : 's'}.`
        : 'No damaged or duplicated prospect names were found.',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance prospect name repair failed:', error);
    res.status(500).json({ error: 'Failed to repair imported prospect names.' });
  } finally {
    client.release();
  }
});

router.post('/prospects', async (req, res) => {
  try {
    const audience = text(req.body.audience).toLowerCase();
    const audienceResult = await db.query(
      `SELECT a.default_channel, COALESCE(json_agg(json_build_object(
         'field_key', f.field_key, 'data_type', f.data_type, 'required', f.required
       ) ORDER BY f.sort_order) FILTER (WHERE f.id IS NOT NULL), '[]'::json) AS fields
       FROM alliance_audiences a
       LEFT JOIN alliance_audience_fields f ON f.audience_id = a.id AND f.active = TRUE
       WHERE a.code = $1 AND a.active = TRUE GROUP BY a.id`,
      [audience]
    );
    if (!audienceResult.rowCount) return res.status(400).json({ error: 'Select a valid audience.' });

    const config = audienceResult.rows[0];
    const businessName = text(req.body.business_name);
    const emailInput = text(req.body.email);
    const phoneInput = text(req.body.phone);
    const email = emailInput ? normalizeEmail(emailInput) : null;
    const phone = phoneInput ? normalizePhone(phoneInput) : null;
    const channel = text(req.body.channel || config.default_channel).toLowerCase();
    const consent = Boolean(req.body.consent);
    const consentSource = text(req.body.consent_source);
    if (!businessName) return res.status(400).json({ error: 'Business name is required.' });
    if (!['email', 'whatsapp', 'both'].includes(channel)) return res.status(400).json({ error: 'Channel must be email, whatsapp, or both.' });
    if (emailInput && !email) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (phoneInput && !phone) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    if (['email', 'both'].includes(channel) && !email) return res.status(400).json({ error: 'Email is required for email outreach.' });
    if (['whatsapp', 'both'].includes(channel) && (!phone || !consent || !consentSource)) {
      return res.status(400).json({ error: 'WhatsApp requires phone, consent, and consent source.' });
    }

    const inputCustomFields = req.body.custom_fields && typeof req.body.custom_fields === 'object' ? req.body.custom_fields : {};
    const customFields = {};
    for (const field of config.fields) {
      const parsedValue = parseCustomValue(inputCustomFields[field.field_key], field.data_type);
      if (field.required && (parsedValue === null || parsedValue === undefined)) {
        return res.status(400).json({ error: `${field.field_key} is required.` });
      }
      if (parsedValue === undefined) return res.status(400).json({ error: `${field.field_key} must be ${field.data_type}.` });
      if (parsedValue !== null) customFields[field.field_key] = parsedValue;
    }

    const suppression = await db.query(
      `SELECT 1 FROM alliance_suppression
       WHERE ($1::text IS NOT NULL AND LOWER(email) = LOWER($1))
          OR ($2::text IS NOT NULL AND phone = $2) LIMIT 1`,
      [email, phone]
    );
    if (suppression.rowCount) return res.status(409).json({ error: 'This contact is on the do-not-contact list.' });

    const result = await db.query(
      `INSERT INTO alliance_prospects
        (audience, name, business_name, phone, email, industry, location, channel_pref,
         channel, consent, consent_source, consent_at, source, custom_fields)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [audience, text(req.body.name) || null, businessName, phone, email,
        text(req.body.industry) || null, text(req.body.location) || null, channel, consent,
        consent ? consentSource : null, consent ? new Date() : null, text(req.body.source) || 'manual_entry', customFields]
    );
    req.app.get('io')?.emit('alliance_contacts_changed', { prospect_id: result.rows[0].id, created: 1 });
    res.status(201).json({ success: true, prospect: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Another prospect already uses this email or phone.' });
    console.error('Alliance prospect create failed:', error);
    res.status(500).json({ error: 'Failed to create prospect.' });
  }
});

router.patch('/prospects/:id', async (req, res) => {
  try {
    const existingResult = await db.query(`SELECT * FROM alliance_prospects WHERE id = $1`, [req.params.id]);
    if (!existingResult.rowCount) return res.status(404).json({ error: 'Prospect not found.' });
    const existing = existingResult.rows[0];
    const audience = text(req.body.audience ?? existing.audience).toLowerCase();
    const audienceExists = await db.query(`SELECT 1 FROM alliance_audiences WHERE code = $1 AND active = TRUE`, [audience]);
    if (!audienceExists.rowCount) return res.status(400).json({ error: 'Select a valid audience.' });
    const emailInput = req.body.email !== undefined ? text(req.body.email) : existing.email;
    const phoneInput = req.body.phone !== undefined ? text(req.body.phone) : existing.phone;
    const email = emailInput ? normalizeEmail(emailInput) : null;
    const phone = phoneInput ? normalizePhone(phoneInput) : null;
    const channel = text(req.body.channel ?? existing.channel).toLowerCase();
    const consent = req.body.consent !== undefined ? Boolean(req.body.consent) : existing.consent;
    const consentSource = req.body.consent_source !== undefined ? text(req.body.consent_source) : existing.consent_source;
    if (!['email', 'whatsapp', 'both'].includes(channel)) return res.status(400).json({ error: 'Channel must be email, whatsapp, or both.' });
    if (emailInput && !email) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (phoneInput && !phone) return res.status(400).json({ error: 'Enter a valid mobile number.' });
    if (['email', 'both'].includes(channel) && !email) return res.status(400).json({ error: 'Email is required for email outreach.' });
    if (['whatsapp', 'both'].includes(channel) && (!phone || !consent || !consentSource)) return res.status(400).json({ error: 'WhatsApp requires phone, consent, and consent source.' });
    const businessName = text(req.body.business_name ?? existing.business_name);
    if (!businessName) return res.status(400).json({ error: 'Business name is required.' });

    const result = await db.query(
      `UPDATE alliance_prospects SET audience=$1, name=$2, business_name=$3, email=$4, phone=$5,
       industry=$6, location=$7, source=$8, channel=$9, channel_pref=$9, consent=$10,
       consent_source=$11, consent_at=CASE WHEN $10 THEN COALESCE(consent_at,NOW()) ELSE NULL END,
       custom_fields=$12, updated_at=NOW() WHERE id=$13 RETURNING *`,
      [audience, text(req.body.name ?? existing.name) || null, businessName, email, phone,
        text(req.body.industry ?? existing.industry) || null, text(req.body.location ?? existing.location) || null,
        text(req.body.source ?? existing.source) || 'manual_edit', channel, consent, consent ? consentSource : null,
        req.body.custom_fields && typeof req.body.custom_fields === 'object' ? req.body.custom_fields : existing.custom_fields,
        req.params.id]
    );
    res.json({ prospect: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Another prospect already uses this email or phone.' });
    console.error('Alliance prospect update failed:', error);
    res.status(500).json({ error: 'Failed to update prospect.' });
  }
});

router.delete('/prospects/:id', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM alliance_prospects WHERE id = $1 RETURNING id, business_name`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Prospect not found.' });
    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    console.error('Alliance prospect delete failed:', error);
    res.status(500).json({ error: 'Failed to delete prospect.' });
  }
});

router.post('/prospects/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No prospect IDs provided.' });
    const result = await db.query(`DELETE FROM alliance_prospects WHERE id = ANY($1::bigint[])`, [ids]);
    res.json({ success: true, deleted: result.rowCount });
  } catch (error) {
    console.error('Alliance bulk delete failed:', error);
    res.status(500).json({ error: 'Failed to delete prospects.' });
  }
});

router.post('/prospects/:id/tags', async (req, res) => {
  try {
    const { tagId } = req.body;
    if (!tagId) return res.status(400).json({ error: 'tagId is required' });
    await db.query(
      `INSERT INTO alliance_prospect_tags (prospect_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.params.id, tagId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign tag' });
  }
});

router.delete('/prospects/:id/tags/:tagId', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM alliance_prospect_tags WHERE prospect_id = $1 AND tag_id = $2`,
      [req.params.id, req.params.tagId]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

function campaignProspectFilters(query) {
  const values = [];
  const where = [`p.email IS NOT NULL`, `p.suppressed = FALSE`, `p.status NOT IN ('converted','closed','not_interested','unsubscribed')`];
  const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
  if (query.audience) add('p.audience = ?', text(query.audience).toLowerCase());
  if (query.industry) add('p.industry = ?', text(query.industry));
  if (query.status) add('p.status = ?', text(query.status));
  if (query.source) add('p.source = ?', text(query.source));
  if (query.location) add('p.location = ?', text(query.location));
  if (query.dateFrom) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date >= ?::date`, text(query.dateFrom));
  if (query.dateTo) add(`(p.created_at AT TIME ZONE 'Asia/Kolkata')::date <= ?::date`, text(query.dateTo));
  if (query.tag) add('? = ANY(p.tags)', text(query.tag));
  if (query.search) {
    values.push(text(query.search));
    const param = `$${values.length}`;
    where.push(`(p.name ILIKE '%' || ${param} || '%' OR p.business_name ILIKE '%' || ${param} || '%' OR p.email ILIKE '%' || ${param} || '%')`);
  }
  return { values, where };
}

router.get('/campaign-builder/options', async (req, res) => {
  try {
    const audience = text(req.query.audience).toLowerCase();
    const facetValues = [];
    const facetWhere = [
      `email IS NOT NULL`,
      `suppressed = FALSE`,
      `status NOT IN ('converted','closed','not_interested','unsubscribed')`,
    ];
    if (audience) {
      facetValues.push(audience);
      facetWhere.push(`audience = $${facetValues.length}`);
    }
    const [audiences, facets, senders] = await Promise.all([
      db.query(`SELECT code, label, brand FROM alliance_audiences WHERE active = TRUE ORDER BY label`),
      db.query(`SELECT
        COALESCE(ARRAY_AGG(DISTINCT industry ORDER BY industry) FILTER (WHERE NULLIF(BTRIM(industry), '') IS NOT NULL), ARRAY[]::TEXT[]) AS industries,
        COALESCE(ARRAY_AGG(DISTINCT status ORDER BY status) FILTER (WHERE NULLIF(BTRIM(status), '') IS NOT NULL), ARRAY[]::TEXT[]) AS statuses,
        COALESCE(ARRAY_AGG(DISTINCT source ORDER BY source) FILTER (WHERE NULLIF(BTRIM(source), '') IS NOT NULL), ARRAY[]::TEXT[]) AS sources,
        COALESCE(ARRAY_AGG(DISTINCT location ORDER BY location) FILTER (WHERE NULLIF(BTRIM(location), '') IS NOT NULL), ARRAY[]::TEXT[]) AS locations
        FROM alliance_prospects
        WHERE ${facetWhere.join(' AND ')}`, facetValues),
      db.query(`SELECT id, inbox_email, provider, daily_cap, sent_today, status FROM alliance_domains WHERE status = 'active' ORDER BY inbox_email`),
    ]);
    res.json({ audiences: audiences.rows, ...(facets.rows[0] || {}), senders: senders.rows });
  } catch (error) {
    console.error('Alliance campaign options failed:', error);
    res.status(500).json({ error: 'Failed to load campaign builder options.' });
  }
});

router.get('/replies', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const conditions = [`r2.channel='email'`];
    const values = [];
    const add = (sql, value) => { values.push(value); conditions.push(sql.replace('?', `$${values.length}`)); };
    const search = text(req.query.search).toLowerCase();
    if (search) add(`(LOWER(COALESCE(p.name,'')) LIKE ? OR LOWER(COALESCE(p.business_name,'')) LIKE ? OR LOWER(COALESCE(p.email,'')) LIKE ? OR COALESCE(p.phone,'') LIKE ?)`, `%${search}%`);
    if (search) { const value = values.at(-1); values.push(value, value, value); conditions[conditions.length - 1] = conditions.at(-1).replace('$' + (values.length - 3), '$' + (values.length - 3)).replace('?', `$${values.length - 2}`).replace('?', `$${values.length - 1}`).replace('?', `$${values.length}`); }
    if (req.query.campaign) add(`ei2.campaign_id=?`, Number(req.query.campaign));
    if (req.query.audience) add(`p.audience=?`, text(req.query.audience));
    if (req.query.reply_status) add(`(r2.status=? OR r2.ai_intent=?)`, text(req.query.reply_status));
    if (req.query.reply_status) { values.push(values.at(-1)); conditions[conditions.length - 1] = conditions.at(-1).replace('?', `$${values.length}`); }
    if (req.query.date_from) add(`ei2.received_at>=?::date`, req.query.date_from);
    if (req.query.date_to) add(`ei2.received_at<(?::date + INTERVAL '1 day')`, req.query.date_to);
    const exists = `EXISTS (SELECT 1 FROM alliance_replies r2 LEFT JOIN alliance_email_inbound ei2 ON ei2.id=r2.email_inbound_id WHERE r2.prospect_id=p.id AND ${conditions.join(' AND ')})`;
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM alliance_prospects p WHERE ${exists}`, values);
    const listValues = [...values, limit, (page - 1) * limit];
    const result = await db.query(
      `SELECT p.id AS prospect_id,p.name,p.business_name,p.email,p.phone,p.audience,p.status AS lead_status,a.label AS audience_label,a.brand,
              latest.reply_status,latest.ai_intent,latest.last_reply_received,latest.last_subject,
              sent.last_email_sent,
              GREATEST(COALESCE(latest.last_reply_received,'epoch'),COALESCE(sent.last_email_sent,'epoch')) AS last_activity
       FROM alliance_prospects p
       LEFT JOIN alliance_audiences a ON a.code=p.audience
       LEFT JOIN LATERAL (
         SELECT r.status AS reply_status,r.ai_intent,ei.received_at AS last_reply_received,ei.subject AS last_subject
         FROM alliance_replies r LEFT JOIN alliance_email_inbound ei ON ei.id=r.email_inbound_id
         WHERE r.prospect_id=p.id AND r.channel='email' ORDER BY COALESCE(ei.received_at,r.created_at) DESC LIMIT 1
       ) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT MAX(t.sent_at) AS last_email_sent FROM alliance_touches t
         WHERE t.prospect_id=p.id AND t.channel='email' AND t.status='sent'
       ) sent ON TRUE
       WHERE ${exists}
       ORDER BY last_activity DESC,p.id DESC LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`,
      listValues
    );
    const [sync, campaigns, audiences] = await Promise.all([
      db.query(`SELECT mailbox,last_checked_at,last_success_at,last_error FROM alliance_email_sync_state ORDER BY updated_at DESC LIMIT 1`),
      db.query(`SELECT DISTINCT c.id,c.name FROM alliance_campaigns c JOIN alliance_email_inbound ei ON ei.campaign_id=c.id ORDER BY c.name`),
      db.query(`SELECT code,label FROM alliance_audiences WHERE active=TRUE ORDER BY label`),
    ]);
    res.json({ conversations: result.rows, total: count.rows[0]?.total || 0, page, limit, sync: sync.rows[0] || null,
      filters: { campaigns: campaigns.rows, audiences: audiences.rows, statuses: ['new','drafted','sent','interested','question','objection','not_interested','other'] } });
  } catch (error) {
    console.error('Alliance email replies failed:', error);
    res.status(500).json({ error: 'Failed to load Alliance email replies.' });
  }
});

router.get('/reply-conversations/:prospectId', async (req, res) => {
  try {
    const prospect = await db.query(
      `SELECT p.id,p.name,p.business_name,p.email,p.phone,p.audience,p.status,a.label AS audience_label,a.brand
       FROM alliance_prospects p LEFT JOIN alliance_audiences a ON a.code=p.audience WHERE p.id=$1`,
      [req.params.prospectId]
    );
    if (!prospect.rowCount) return res.status(404).json({ error: 'Lead not found.' });
    const [sent, inbound, approved] = await Promise.all([
      db.query(
        `SELECT 'outbound' AS direction,'campaign' AS message_type,t.id,t.subject,t.message_body AS body,t.sent_at AS occurred_at,
                t.status,t.provider_message_id,t.touch_no,c.name AS campaign_name,
                COALESCE((SELECT ARRAY_AGG(DISTINCT e.event_type) FROM alliance_email_events e WHERE e.touch_id=t.id),ARRAY[]::varchar[]) AS events
         FROM alliance_touches t LEFT JOIN alliance_campaigns c ON c.id=t.campaign_id
         WHERE t.prospect_id=$1 AND t.channel='email' AND t.sent_at IS NOT NULL`, [req.params.prospectId]),
      db.query(
        `SELECT 'inbound' AS direction,'reply' AS message_type,ei.id,ei.subject,COALESCE(r.body,ei.text_body) AS body,
                ei.received_at AS occurred_at,COALESCE(r.status,ei.processing_status) AS status,ei.message_id AS provider_message_id,
                ei.campaign_id,c.name AS campaign_name,r.id AS reply_id,r.ai_intent,r.ai_draft,
                COALESCE((SELECT JSON_AGG(JSON_BUILD_OBJECT('id',att.id,'filename',att.filename,'content_type',att.content_type,'size_bytes',att.size_bytes) ORDER BY att.attachment_index) FROM alliance_email_attachments att WHERE att.inbound_id=ei.id),'[]'::json) AS attachments
         FROM alliance_email_inbound ei LEFT JOIN alliance_replies r ON r.email_inbound_id=ei.id
         LEFT JOIN alliance_campaigns c ON c.id=ei.campaign_id WHERE ei.prospect_id=$1`, [req.params.prospectId]),
      db.query(
        `SELECT 'outbound' AS direction,'approved_reply' AS message_type,r.id,CASE WHEN ei.subject ILIKE 'Re:%' THEN ei.subject ELSE 'Re: '||COALESCE(ei.subject,'Your reply') END AS subject,
                r.ai_draft AS body,r.approved_at AS occurred_at,r.status,NULL::varchar AS provider_message_id,
                ei.campaign_id,c.name AS campaign_name,ARRAY['sent']::varchar[] AS events
         FROM alliance_replies r JOIN alliance_email_inbound ei ON ei.id=r.email_inbound_id
         LEFT JOIN alliance_campaigns c ON c.id=ei.campaign_id
         WHERE r.prospect_id=$1 AND r.channel='email' AND r.status='sent' AND r.approved_at IS NOT NULL`, [req.params.prospectId]),
    ]);
    const messages = [...sent.rows, ...inbound.rows, ...approved.rows].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    res.json({ prospect: prospect.rows[0], messages });
  } catch (error) {
    console.error('Alliance conversation failed:', error);
    res.status(500).json({ error: 'Failed to load email conversation.' });
  }
});

router.get('/reply-attachments/:id', async (req, res) => {
  try {
    const result = await db.query(`SELECT filename,content_type,content FROM alliance_email_attachments WHERE id=$1`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Attachment not found.' });
    const attachment = result.rows[0];
    res.setHeader('Content-Type', attachment.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(attachment.filename).replace(/["\r\n]/g, '_')}"`);
    res.send(attachment.content);
  } catch (error) { res.status(500).json({ error: 'Failed to download attachment.' }); }
});

router.post('/replies/:id/suggest', async (req, res) => {
  try {
    const suggestion = await regenerateReplySuggestion(req.params.id);
    res.json({ success: true, suggestion });
  } catch (error) {
    console.error('Alliance reply suggestion failed:', error.message);
    res.status(error.message === 'Reply record not found.' ? 404 : 502).json({ error: error.message || 'Failed to generate reply suggestion.' });
  }
});

router.post('/replies/:id/send', async (req, res) => {
  try {
    const body = text(req.body.body);
    if (!body) return res.status(400).json({ error: 'Reply body is required.' });
    const result = await db.query(
      `SELECT r.id, r.status, r.prospect_id, p.email, p.name, p.business_name,
              ei.message_id, ei.message_references, ei.subject, ei.campaign_id,
               c.sender_domain_id, d.inbox_email, d.status AS sender_status,d.sent_today,d.daily_cap
       FROM alliance_replies r
       JOIN alliance_prospects p ON p.id = r.prospect_id
       JOIN alliance_email_inbound ei ON ei.id = r.email_inbound_id
       JOIN alliance_campaigns c ON c.id = ei.campaign_id
       JOIN alliance_domains d ON d.id = c.sender_domain_id
       WHERE r.id = $1`,
      [req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Reply record not found.' });
    const reply = result.rows[0];
    if (reply.status === 'sent') return res.status(409).json({ error: 'This reply has already been sent.' });
    if (reply.sender_status !== 'active') return res.status(409).json({ error: 'The campaign email sender is not active.' });
    if (Number(reply.sent_today) >= Number(reply.daily_cap)) return res.status(409).json({ error: 'The email sender has reached its daily cap.' });
    const config = getAllianceEmailConfig();
    if (!isAllianceSenderAllowed(reply.inbox_email, config)) return res.status(409).json({ error: `Selected sender is not allowed by the Zoho SMTP configuration. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.` });
    const subject = /^re:/i.test(reply.subject || '') ? reply.subject : `Re: ${reply.subject || 'Your reply'}`;
    const html = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const originalId = String(reply.message_id || '').replace(/^<|>$/g, '');
    const references = [...(reply.message_references || []), originalId].filter(Boolean).map((id) => `<${String(id).replace(/^<|>$/g, '')}>`);
    const sent = await createAllianceEmailTransport().sendMail({
      from: { name: config.fromName, address: reply.inbox_email }, to: reply.email,
      replyTo: config.replyTo, subject, text: body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${html}</div>`,
      inReplyTo: originalId ? `<${originalId}>` : undefined,
      references,
    });
    await db.query(
      `UPDATE alliance_replies SET ai_draft=$1, status='sent', approved_by=$2, approved_at=NOW() WHERE id=$3`,
      [body, req.user?.id || null, reply.id]
    );
    await db.query(
      `INSERT INTO alliance_email_events (campaign_id,prospect_id,provider_message_id,event_type,event_payload)
       VALUES ($1,$2,$3,'reply_sent',$4::jsonb)`,
      [reply.campaign_id, reply.prospect_id, sent.messageId || null,
        JSON.stringify({ recipient: reply.email, accepted: sent.accepted, rejected: sent.rejected, response: sent.response, reply_id: reply.id })]
    );
    await db.query(`UPDATE alliance_domains SET sent_today=sent_today+1 WHERE id=$1`, [reply.sender_domain_id]);
    res.json({ success: true, message: `Reply submitted to Zoho for ${reply.email}.`, provider_message_id: sent.messageId || null });
  } catch (error) {
    console.error('Alliance approved email reply failed:', error.response || error.message);
    res.status(502).json({ error: error.response || error.message || 'Failed to send approved reply.' });
  }
});

router.get('/campaign-builder/prospects', async (req, res) => {
  try {
    const { values, where } = campaignProspectFilters(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 5000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const count = await db.query(`SELECT COUNT(*)::int AS total FROM alliance_prospects p WHERE ${where.join(' AND ')}`, values);
    values.push(limit, offset);
    const result = await db.query(
      `SELECT p.id, p.name, p.business_name, p.email, p.phone, p.audience, p.industry, p.location,
              p.status, p.source, p.channel, p.channel_pref, p.consent, p.consent_source, p.custom_fields, p.tags, p.ai_score, p.created_at
       FROM alliance_prospects p WHERE ${where.join(' AND ')}
       ORDER BY p.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    res.json({ prospects: result.rows, total: count.rows[0].total, limit, offset });
  } catch (error) {
    console.error('Alliance campaign prospect selection failed:', error);
    res.status(500).json({ error: 'Failed to load eligible email prospects.' });
  }
});

async function baseEmailSequence(audience) {
  const result = await db.query(
    `SELECT s.touch_no, s.delay_days, s.purpose, t.subject, t.body
     FROM alliance_sequences s
     JOIN alliance_templates t ON t.audience = s.audience AND t.channel = s.channel AND t.touch_no = s.touch_no AND t.active = TRUE
     WHERE s.audience = $1 AND s.channel = 'email' AND s.active = TRUE
     ORDER BY s.touch_no`,
    [audience]
  );
  return result.rows;
}

router.get('/campaign-builder/templates', async (req, res) => {
  try {
    const audience = text(req.query.audience).toLowerCase();
    const audienceResult = await db.query(`SELECT code, label, brand FROM alliance_audiences WHERE code = $1 AND active = TRUE`, [audience]);
    if (!audienceResult.rowCount) return res.status(400).json({ error: 'Select a valid audience.' });
    res.json({ audience: audienceResult.rows[0], templates: await baseEmailSequence(audience), ai_configured: openRouter.isConfigured });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load email sequence templates.' });
  }
});

router.post('/campaign-builder/ai-suggestion', async (req, res) => {
  try {
    const audience = text(req.body.audience).toLowerCase();
    const objective = text(req.body.objective);
    const requestedTouchNo = Math.max(1, Number(req.body.touch_no) || 1);
    const audienceResult = await db.query(`SELECT code, label, brand FROM alliance_audiences WHERE code = $1 AND active = TRUE`, [audience]);
    if (!audienceResult.rowCount) return res.status(400).json({ error: 'Select a valid audience.' });
    const base = await baseEmailSequence(audience);
    if (!base.length) return res.status(409).json({ error: 'No base email templates are configured for this audience.' });
    const selectedBase = base.find((item) => Number(item.touch_no) === requestedTouchNo);
    if (!selectedBase) return res.status(400).json({ error: `Touch ${requestedTouchNo} is not configured for this audience.` });
    const currentTemplate = req.body.current_template && typeof req.body.current_template === 'object'
      ? { ...selectedBase, ...req.body.current_template, touch_no: requestedTouchNo }
      : selectedBase;
    if (!openRouter.isConfigured) return res.json({ template: currentTemplate, ai_generated: false, warning: 'OpenRouter is not configured; the current template was returned.' });
    const brain = await getAllianceBrainContext(audience, objective);
    const promptJob = requestedTouchNo === 1 ? 'campaign_message' : 'followup';
    const contentRules = await getAlliancePromptRules(promptJob, 'email', audience, `${objective} ${currentTemplate.subject || ''} ${currentTemplate.body || ''}`);
    const prompt = `You are AllianceOS's B2B cold-email campaign editor. Rewrite one selected email touch for human review.
Brand: ${audienceResult.rows[0].brand || 'ABM Groups'}
Audience: ${audienceResult.rows[0].label}
Campaign objective: ${objective || 'Start a relevant business conversation'}
Approved AI Brain data: ${brain ? JSON.stringify(brain) : 'No Brain data is configured. Do not invent brand facts.'}
Selected touch: ${JSON.stringify(currentTemplate)}
Pre-matched mandatory ${promptJob === 'campaign_message' ? 'campaign-message' : 'follow-up/reminder'} rules (lower priority number wins if instructions conflict):
${contentRules}
System rules: preserve every {{field_name}} variable present in the selected touch exactly; one clear CTA; no invented claims; include the existing unsubscribe instruction; do not exceed 100 words per email. Brain facts are authoritative and administrator rules may control tone or behavior but may never introduce unsupported factual claims.
Return JSON only: {"template":{"touch_no":${requestedTouchNo},"delay_days":${Number(currentTemplate.delay_days) || 0},"purpose":"...","subject":"...","body":"..."}}`;
    const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: 2400 } });
    const parsed = JSON.parse(String(generated.text).replace(/^```json\s*|\s*```$/g, ''));
    if (!parsed.template?.subject || !parsed.template?.body) throw new Error('AI returned an invalid email touch.');
    res.json({ template: { ...currentTemplate, ...parsed.template, touch_no: requestedTouchNo }, ai_generated: true });
  } catch (error) {
    console.error('Alliance AI campaign suggestion failed:', error);
    res.status(502).json({ error: error.message || 'AI suggestion failed.' });
  }
});

router.put('/campaign-builder/templates/:touchNo', async (req, res) => {
  const audience = text(req.body.audience).toLowerCase();
  const touchNo = Math.max(1, Number(req.params.touchNo) || 1);
  const subject = text(req.body.subject);
  const body = text(req.body.body);
  const purpose = text(req.body.purpose);
  const delayDays = Math.min(Math.max(Number(req.body.delay_days) || 0, 0), 30);
  if (!audience || !subject || !body) return res.status(400).json({ error: 'Audience, subject, and body are required.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const template = await client.query(
      `UPDATE alliance_templates SET subject=$1,body=$2,updated_at=NOW()
       WHERE audience=$3 AND channel='email' AND touch_no=$4 AND active=TRUE RETURNING *`,
      [subject, body, audience, touchNo]
    );
    if (!template.rowCount) throw Object.assign(new Error(`Touch ${touchNo} is not configured for this audience.`), { status: 404 });
    await client.query(
      `UPDATE alliance_sequences SET delay_days=$1,purpose=COALESCE(NULLIF($2,''),purpose)
       WHERE audience=$3 AND channel='email' AND touch_no=$4 AND active=TRUE`,
      [delayDays, purpose, audience, touchNo]
    );
    await client.query('COMMIT');
    res.json({ success: true, template: template.rows[0], message: `Touch ${touchNo} saved as the default template.` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.message || 'Unable to save email template.' });
  } finally { client.release(); }
});

router.post('/campaign-builder/templates', async (req, res) => {
  const audience = text(req.body.audience).toLowerCase();
  if (!audience) return res.status(400).json({ error: 'Select a target audience first.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const audienceRow = await client.query(`SELECT code FROM alliance_audiences WHERE code=$1 AND active=TRUE`, [audience]);
    if (!audienceRow.rowCount) throw Object.assign(new Error('Select a valid target audience.'), { status: 400 });
    const next = await client.query(
      `SELECT COALESCE(MAX(touch_no),0)+1 AS touch_no FROM alliance_sequences WHERE audience=$1 AND channel='email'`,
      [audience]
    );
    const touchNo = Number(next.rows[0].touch_no);
    if (touchNo > 10) throw Object.assign(new Error('A maximum of 10 email touches is supported.'), { status: 400 });
    const previous = await client.query(
      `SELECT COALESCE(MAX(delay_days),-2) AS delay_days FROM alliance_sequences WHERE audience=$1 AND channel='email' AND active=TRUE`,
      [audience]
    );
    const delayDays = Math.min(Number(previous.rows[0].delay_days) + 2, 30);
    await client.query(
      `INSERT INTO alliance_sequences(audience,channel,touch_no,delay_days,purpose,active)
       VALUES($1,'email',$2,$3,$4,TRUE)`,
      [audience, touchNo, delayDays, `Follow-up touch ${touchNo}`]
    );
    await client.query(
      `INSERT INTO alliance_templates(audience,channel,touch_no,subject,body,provider_status,active)
       VALUES($1,'email',$2,$3,$4,'draft',TRUE)`,
      [audience, touchNo, `Follow-up for {{org}}`, `Hi {{name}},\n\nAdd your message for {{org}} here.\n\nTo stop receiving these, reply "unsubscribe".`]
    );
    await client.query('COMMIT');
    const templates = await baseEmailSequence(audience);
    res.status(201).json({ success: true, templates, touch_no: touchNo, message: `Touch ${touchNo} created for ${audience}.` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.message || 'Unable to create email touch.' });
  } finally { client.release(); }
});

router.delete('/campaign-builder/templates/:touchNo', async (req, res) => {
  const audience = text(req.query.audience).toLowerCase();
  const touchNo = Math.max(1, Number(req.params.touchNo) || 1);
  if (!audience) return res.status(400).json({ error: 'Target audience is required.' });
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const max = await client.query(`SELECT MAX(touch_no)::int AS touch_no FROM alliance_sequences WHERE audience=$1 AND channel='email' AND active=TRUE`, [audience]);
    if (Number(max.rows[0].touch_no) !== touchNo) throw Object.assign(new Error('Delete the last touch first to keep the sequence order valid.'), { status: 409 });
    if (touchNo === 1) throw Object.assign(new Error('An email sequence must keep at least one touch.'), { status: 409 });
    await client.query(`DELETE FROM alliance_templates WHERE audience=$1 AND channel='email' AND touch_no=$2`, [audience, touchNo]);
    await client.query(`DELETE FROM alliance_sequences WHERE audience=$1 AND channel='email' AND touch_no=$2`, [audience, touchNo]);
    await client.query('COMMIT');
    res.json({ success: true, templates: await baseEmailSequence(audience), message: `Touch ${touchNo} deleted.` });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(error.status || 500).json({ error: error.message || 'Unable to delete email touch.' });
  } finally { client.release(); }
});

router.post('/campaigns', async (req, res) => {
  const name = text(req.body.name);
  const audience = text(req.body.audience).toLowerCase();
  const prospectIds = [...new Set((Array.isArray(req.body.prospect_ids) ? req.body.prospect_ids : []).map(Number).filter(Number.isInteger))];
  const templates = Array.isArray(req.body.templates) ? req.body.templates : [];
  if (!name) return res.status(400).json({ error: 'Campaign name is required.' });
  if (!audience) return res.status(400).json({ error: 'Audience is required.' });
  if (!prospectIds.length) return res.status(400).json({ error: 'Select at least one lead.' });
  if (!templates.length || templates.some((template) => !text(template.subject) || !text(template.body))) {
    return res.status(400).json({ error: 'Review every active email touch before creating the campaign.' });
  }
  if (templates.length > 10) {
    return res.status(400).json({ error: 'An email campaign can have at most 10 touches.' });
  }
  const touchNumbers = templates.map((template, index) => Number(template.touch_no) || index + 1);
  if (touchNumbers.some((touchNo) => !Number.isInteger(touchNo) || touchNo < 1 || touchNo > 10)) {
    return res.status(400).json({ error: 'Email touch numbers must be whole numbers from 1 to 10.' });
  }
  if (new Set(touchNumbers).size !== touchNumbers.length) {
    return res.status(400).json({ error: 'Each email touch must have a unique touch number.' });
  }
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    assertBulkSendLimit(await getBulkSendLimit('email', client), prospectIds.length);
    const eligible = await client.query(
      `SELECT id FROM alliance_prospects
       WHERE id = ANY($1::bigint[]) AND audience = $2 AND email IS NOT NULL AND suppressed = FALSE
         AND status NOT IN ('converted','closed','not_interested','unsubscribed')`,
      [prospectIds, audience]
    );
    if (eligible.rowCount !== prospectIds.length) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Some selected leads are no longer eligible or do not match the selected audience.' });
    }
    const senderId = Number(req.body.sender_domain_id);
    const sender = await client.query(`SELECT id FROM alliance_domains WHERE id = $1 AND status = 'active'`, [senderId]);
    if (!sender.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Select an active email sender.' });
    }
    const campaignResult = await client.query(
      `INSERT INTO alliance_campaigns (name, audience, channel, objective, sender_domain_id, created_by)
       VALUES ($1,$2,'email',$3,$4,$5) RETURNING *`,
      [name, audience, text(req.body.objective) || null, senderId, req.user?.id || null]
    );
    const campaign = campaignResult.rows[0];
    await client.query(
      `INSERT INTO alliance_campaign_prospects (campaign_id, prospect_id)
       SELECT $1, UNNEST($2::bigint[])`,
      [campaign.id, prospectIds]
    );
    for (const [index, template] of templates.entries()) {
      const touchNo = touchNumbers[index];
      const subject = text(template.subject);
      const body = text(template.body);
      if (!subject || !body) throw new Error(`Touch ${touchNo} subject and body are required.`);
      await client.query(
        `INSERT INTO alliance_campaign_templates (campaign_id, touch_no, delay_days, subject, body, ai_generated)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [campaign.id, touchNo, Math.min(Math.max(Number(template.delay_days) || 0, 0), 30), subject, body, Boolean(req.body.ai_generated)]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ success: true, campaign, selected_count: prospectIds.length, message: 'Draft email campaign created. Review readiness before starting.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance email campaign create failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create email campaign.' });
  } finally {
    client.release();
  }
});

async function getCampaignReadiness(queryable, campaignId) {
  const campaignResult = await queryable.query(
    `SELECT * FROM alliance_campaigns WHERE id = $1`,
    [campaignId]
  );
  if (!campaignResult.rowCount) return null;
  const campaign = campaignResult.rows[0];
  const statsResult = await queryable.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE suppressed = FALSE)::int AS eligible,
            COUNT(*) FILTER (WHERE (CASE WHEN c.channel = 'auto' THEN p.channel ELSE c.channel END) = 'email' AND p.email IS NOT NULL AND suppressed = FALSE)::int AS email,
            COUNT(*) FILTER (WHERE (CASE WHEN c.channel = 'auto' THEN p.channel ELSE c.channel END) = 'whatsapp' AND consent = TRUE AND suppressed = FALSE)::int AS whatsapp
     FROM alliance_campaign_prospects cp
     JOIN alliance_prospects p ON p.id = cp.prospect_id
     JOIN alliance_campaigns c ON c.id = cp.campaign_id
     WHERE cp.campaign_id = $1`,
    [campaignId]
  );
  const channelsResult = await queryable.query(
    `SELECT DISTINCT CASE WHEN c.channel = 'auto' THEN p.channel ELSE c.channel END AS channel
     FROM alliance_campaign_prospects cp
     JOIN alliance_prospects p ON p.id = cp.prospect_id
     JOIN alliance_campaigns c ON c.id = cp.campaign_id
     WHERE cp.campaign_id = $1 AND p.suppressed = FALSE`,
    [campaignId]
  );
  const missingTemplates = [];
  const missingSenders = [];
  const missingSequences = [];
  for (const { channel } of channelsResult.rows) {
    const sequenceResult = await queryable.query(
      `SELECT COUNT(*)::int AS expected FROM alliance_sequences
       WHERE audience = $1 AND channel = $2 AND active = TRUE`,
      [campaign.audience, channel]
    );
    const templateResult = channel === 'email'
      ? await queryable.query(`SELECT COUNT(*)::int AS available FROM alliance_campaign_templates WHERE campaign_id = $1`, [campaignId])
      : await queryable.query(
        `SELECT COUNT(*)::int AS available FROM alliance_templates WHERE audience = $1 AND channel = $2 AND active = TRUE`,
        [campaign.audience, channel]
      );
    if (!sequenceResult.rows[0].expected) missingSequences.push(channel);
    if (templateResult.rows[0].available < sequenceResult.rows[0].expected) missingTemplates.push(channel);

    const senderResult = channel === 'email'
      ? await queryable.query(
        `SELECT inbox_email FROM alliance_domains
         WHERE id = $1 AND status = 'active' AND sent_today < daily_cap`,
        [campaign.sender_domain_id]
      )
      : await queryable.query(`SELECT 1 FROM alliance_numbers WHERE status = 'active' AND quality_rating = 'green' AND sent_today < daily_cap LIMIT 1`);
    if (!senderResult.rowCount) missingSenders.push(channel);
    if (channel === 'email' && senderResult.rowCount
       && !isAllianceSenderAllowed(senderResult.rows[0].inbox_email, getAllianceEmailConfig())) {
      missingSenders.push('email configuration');
    }
  }
  const stats = statsResult.rows[0];
  const blockers = [];
  if (!stats.eligible) blockers.push('Campaign has no eligible prospects.');
  if (missingSequences.length) blockers.push(`Missing ${missingSequences.join(' and ')} sequence configuration.`);
  if (missingTemplates.length) blockers.push(`Missing complete ${missingTemplates.join(' and ')} template set.`);
  if (missingSenders.length) blockers.push(`No active ${missingSenders.join(' or ')} sender with available capacity.`);
  return { campaign, stats, missing_sequences: missingSequences, missing_templates: missingTemplates, missing_senders: missingSenders, blockers, ready: blockers.length === 0 };
}

router.get('/campaigns', async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 100, 1), 5000);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const totalResult = await db.query(`SELECT COUNT(*)::int AS total FROM alliance_campaigns`);
    const result = await db.query(
      `SELECT c.id, c.name, c.audience, c.channel, c.status, c.created_at, c.started_at, c.completed_at,
              COUNT(DISTINCT p.id)::int AS prospects,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'in_sequence')::int AS in_sequence,
              (SELECT COUNT(DISTINCT inbound.prospect_id)::int FROM alliance_email_inbound inbound WHERE inbound.campaign_id=c.id AND inbound.prospect_id IS NOT NULL) AS replied,
              COUNT(DISTINCT p.id) FILTER (WHERE p.status = 'interested')::int AS interested,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'sent')::int AS sent
       FROM alliance_campaigns c
       LEFT JOIN alliance_campaign_prospects cp ON cp.campaign_id = c.id
       LEFT JOIN alliance_prospects p ON p.id = cp.prospect_id
       LEFT JOIN alliance_touches t ON t.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ campaigns: result.rows, total: totalResult.rows[0]?.total || 0, limit, offset });
  } catch (error) {
    console.error('Alliance campaign list failed:', error);
    res.status(500).json({ error: 'Failed to load AllianceOS campaigns.' });
  }
});

router.get('/campaigns/:id/detail', async (req, res) => {
  try {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId < 1) return res.status(400).json({ error: 'Select a valid campaign.' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const values = [campaignId];
    const where = ['cp.campaign_id = $1'];
    if (text(req.query.search)) {
      values.push(text(req.query.search));
      const param = `$${values.length}`;
      where.push(`(p.name ILIKE '%' || ${param} || '%' OR p.business_name ILIKE '%' || ${param} || '%' OR p.email ILIKE '%' || ${param} || '%')`);
    }
    if (text(req.query.status)) {
      values.push(text(req.query.status));
      where.push(`p.status = $${values.length}`);
    }
    const campaignResult = await db.query(
      `SELECT c.*, a.label AS audience_label, d.inbox_email AS sender_email,
              COUNT(DISTINCT cp.prospect_id)::int AS prospects,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status='sent')::int AS sent,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status='failed')::int AS failed,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status='processing')::int AS processing,
              COUNT(DISTINCT t.id) FILTER (WHERE t.status='cancelled')::int AS cancelled,
              (SELECT error_message FROM alliance_touches issue WHERE issue.campaign_id=c.id AND issue.status='failed' AND issue.error_message IS NOT NULL ORDER BY issue.id DESC LIMIT 1) AS latest_touch_error,
              COUNT(DISTINCT r.prospect_id)::int AS replied
       FROM alliance_campaigns c
       LEFT JOIN alliance_audiences a ON a.code=c.audience
       LEFT JOIN alliance_domains d ON d.id=c.sender_domain_id
       LEFT JOIN alliance_campaign_prospects cp ON cp.campaign_id=c.id
       LEFT JOIN alliance_touches t ON t.campaign_id=c.id
       LEFT JOIN alliance_replies r ON r.prospect_id=cp.prospect_id
       WHERE c.id=$1 GROUP BY c.id,a.label,d.inbox_email`, [campaignId]
    );
    if (!campaignResult.rowCount) return res.status(404).json({ error: 'Campaign not found.' });
    const [templatesResult, touchStatsResult, countResult] = await Promise.all([
      db.query(`SELECT touch_no,delay_days,subject,body FROM alliance_campaign_templates WHERE campaign_id=$1 ORDER BY touch_no`, [campaignId]),
      db.query(`SELECT touch_no,
        COUNT(*) FILTER (WHERE status='sent')::int AS sent,
        COUNT(*) FILTER (WHERE status IN ('scheduled','paused'))::int AS pending,
        COUNT(*) FILTER (WHERE status='processing')::int AS processing,
        COUNT(*) FILTER (WHERE status='failed')::int AS failed,
        COUNT(*) FILTER (WHERE status='cancelled')::int AS cancelled
        FROM alliance_touches WHERE campaign_id=$1 GROUP BY touch_no ORDER BY touch_no`, [campaignId]),
      db.query(`SELECT COUNT(*)::int AS total FROM alliance_campaign_prospects cp
        JOIN alliance_prospects p ON p.id=cp.prospect_id
        LEFT JOIN LATERAL (SELECT status FROM alliance_touches WHERE campaign_id=cp.campaign_id AND prospect_id=cp.prospect_id ORDER BY touch_no DESC,id DESC LIMIT 1) latest_touch ON TRUE
        WHERE ${where.join(' AND ')}`, values),
    ]);
    const listValues = [...values, limit, offset];
    const recipientsResult = await db.query(
      `SELECT p.id,p.name,p.business_name,p.email,p.audience,p.status AS prospect_status,cp.enrollment_status,cp.current_touch,cp.next_touch_at,
              p.status AS delivery_status,
              cp.stop_reason,
              latest_touch.error_message,latest_touch.last_sent_at,
              COALESCE(touch_totals.sent_count,0)::int AS sent_count,
              COALESCE(reply_totals.reply_count,0)::int AS reply_count
       FROM alliance_campaign_prospects cp JOIN alliance_prospects p ON p.id=cp.prospect_id
       LEFT JOIN LATERAL (
         SELECT status,error_message,sent_at AS last_sent_at FROM alliance_touches
         WHERE campaign_id=cp.campaign_id AND prospect_id=cp.prospect_id ORDER BY touch_no DESC,id DESC LIMIT 1
       ) latest_touch ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) FILTER (WHERE status='sent') AS sent_count FROM alliance_touches
         WHERE campaign_id=cp.campaign_id AND prospect_id=cp.prospect_id
       ) touch_totals ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS reply_count FROM alliance_replies WHERE prospect_id=cp.prospect_id
       ) reply_totals ON TRUE
       WHERE ${where.join(' AND ')} ORDER BY cp.created_at DESC
       LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues
    );
    res.json({ campaign: campaignResult.rows[0], templates: templatesResult.rows, touch_stats: touchStatsResult.rows,
      recipients: recipientsResult.rows, total: countResult.rows[0].total, limit, offset });
  } catch (error) {
    console.error('Alliance email campaign detail failed:', error);
    res.status(500).json({ error: 'Failed to load email campaign detail.' });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const readiness = await getCampaignReadiness(db, req.params.id);
    if (!readiness) return res.status(404).json({ error: 'Campaign not found.' });
    const touches = await db.query(
      `SELECT touch_no, channel, status, COUNT(*)::int AS count
       FROM alliance_touches WHERE campaign_id = $1
       GROUP BY touch_no, channel, status ORDER BY touch_no, channel, status`,
      [req.params.id]
    );
    const failures = await db.query(
      `SELECT t.id, t.touch_no, t.error_message, p.email, p.business_name
       FROM alliance_touches t JOIN alliance_prospects p ON p.id = t.prospect_id
       WHERE t.campaign_id = $1 AND t.status = 'failed'
       ORDER BY t.id DESC LIMIT 20`,
      [req.params.id]
    );
    const deliveries = await db.query(
      `SELECT t.id, t.touch_no, t.status, t.sent_at, t.provider_message_id,
              p.email, p.business_name, e.event_payload
       FROM alliance_touches t
       JOIN alliance_prospects p ON p.id = t.prospect_id
       LEFT JOIN LATERAL (
         SELECT event_payload FROM alliance_email_events
         WHERE touch_id = t.id AND event_type = 'sent' ORDER BY id DESC LIMIT 1
       ) e ON TRUE
       WHERE t.campaign_id = $1 AND t.channel = 'email' AND t.status = 'sent'
       ORDER BY t.sent_at DESC LIMIT 20`,
      [req.params.id]
    );
    res.json({ ...readiness, touches: touches.rows, failures: failures.rows, deliveries: deliveries.rows });
  } catch (error) {
    console.error('Alliance campaign detail failed:', error);
    res.status(500).json({ error: 'Failed to load campaign details.' });
  }
});

router.post('/campaigns/:id/start', async (req, res) => {
  const client = await db.connect();
  try {
    const requestedStart = req.body?.scheduled_at ? new Date(req.body.scheduled_at) : null;
    if (requestedStart && Number.isNaN(requestedStart.getTime())) {
      return res.status(400).json({ error: 'scheduled_at must be a valid date and time.' });
    }
    const scheduling = requestedStart && requestedStart.getTime() > Date.now();
    if (req.body?.scheduled_at && !scheduling) {
      return res.status(400).json({ error: 'Scheduled campaign time must be in the future.' });
    }
    await client.query('BEGIN');
    await client.query(`SELECT id FROM alliance_campaigns WHERE id = $1 FOR UPDATE`, [req.params.id]);
    const readiness = await getCampaignReadiness(client, req.params.id);
    if (!readiness) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    if (!readiness.ready) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Campaign is not ready to start.', readiness });
    }
    assertBulkSendLimit(await getBulkSendLimit('email', client), Number(readiness.stats.eligible));
    if (!['draft', 'ready', 'paused', 'scheduled'].includes(readiness.campaign.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Campaign cannot start from ${readiness.campaign.status} status.` });
    }

    const resuming = readiness.campaign.status === 'paused';
    const rescheduling = readiness.campaign.status === 'scheduled';
    if (resuming) {
      await client.query(
        `UPDATE alliance_touches SET status = 'scheduled', error_message = NULL,
                scheduled_at = COALESCE($2::timestamptz, NOW())
         WHERE campaign_id = $1 AND status IN ('paused', 'failed') AND sent_at IS NULL`,
        [req.params.id, scheduling ? requestedStart.toISOString() : null]
      );
    } else if (rescheduling) {
      await client.query(
        `UPDATE alliance_touches SET scheduled_at = COALESCE($2::timestamptz, NOW()), error_message = NULL
         WHERE campaign_id = $1 AND status = 'scheduled' AND sent_at IS NULL`,
        [req.params.id, scheduling ? requestedStart.toISOString() : null]
      );
    } else {
      await client.query(
        `INSERT INTO alliance_touches (prospect_id, campaign_id, touch_no, channel, subject, message_body, status, scheduled_at)
         SELECT p.id, cp.campaign_id, 1, CASE WHEN c.channel = 'auto' THEN p.channel ELSE c.channel END,
                COALESCE(ct.subject, template.subject), COALESCE(ct.body, template.body), 'scheduled', COALESCE($2::timestamptz, NOW())
         FROM alliance_campaign_prospects cp
         JOIN alliance_prospects p ON p.id = cp.prospect_id
         JOIN alliance_campaigns c ON c.id = cp.campaign_id
         LEFT JOIN alliance_campaign_templates ct ON ct.campaign_id = cp.campaign_id AND ct.touch_no = 1 AND c.channel = 'email'
         LEFT JOIN alliance_templates template
           ON template.audience = p.audience AND template.channel = (CASE WHEN c.channel = 'auto' THEN p.channel ELSE c.channel END) AND template.touch_no = 1 AND template.active = TRUE
         WHERE cp.campaign_id = $1 AND p.suppressed = FALSE
         ON CONFLICT (campaign_id, prospect_id, touch_no) DO NOTHING`,
        [req.params.id, scheduling ? requestedStart.toISOString() : null]
      );
    }
    await client.query(
      `UPDATE alliance_prospects p SET status = 'pending', updated_at = NOW()
       FROM alliance_campaign_prospects cp
       WHERE cp.campaign_id = $1 AND cp.prospect_id = p.id AND p.suppressed = FALSE`,
      [req.params.id]
    );
    await client.query(`UPDATE alliance_campaign_prospects SET enrollment_status = 'in_sequence' WHERE campaign_id = $1 AND enrollment_status <> 'stopped'`, [req.params.id]);
    await client.query(
      `UPDATE alliance_campaigns
       SET status = $2::varchar, scheduled_start_at = $3::timestamptz,
           started_at = CASE WHEN $2::varchar = 'running' THEN COALESCE(started_at, NOW()) ELSE NULL END
       WHERE id = $1`,
      [req.params.id, scheduling ? 'scheduled' : 'running', scheduling ? requestedStart.toISOString() : null]
    );
    await client.query('COMMIT');
    res.json({
      success: true,
      resumed: resuming,
      scheduled: Boolean(scheduling),
      scheduled_at: scheduling ? requestedStart.toISOString() : null,
      message: scheduling ? `Campaign scheduled for ${requestedStart.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : resuming ? 'Campaign resumed. Unsent paused or failed touches were restored.' : 'Campaign started and first touches scheduled.'
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance campaign start failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to start campaign.' });
  } finally {
    client.release();
  }
});

router.post('/campaigns/:id/pause', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE alliance_campaigns SET status = 'paused' WHERE id = $1 AND status IN ('running', 'scheduled') RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Only a running or scheduled campaign can be paused.' });
    }
    await client.query(`UPDATE alliance_touches SET status = 'paused' WHERE campaign_id = $1 AND status = 'scheduled'`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Campaign paused. Scheduled touches will not send.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance campaign pause failed:', error);
    res.status(500).json({ error: 'Failed to pause campaign.' });
  } finally {
    client.release();
  }
});

router.post('/campaigns/:id/stop', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE alliance_campaigns SET status = 'cancelled', completed_at = NOW()
       WHERE id = $1 AND status IN ('draft','ready','scheduled','running','paused') RETURNING id`,
      [req.params.id]
    );
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'This campaign cannot be stopped from its current status.' });
    }
    await client.query(
      `UPDATE alliance_touches SET status = 'cancelled', error_message = 'Campaign stopped by user.'
       WHERE campaign_id = $1 AND status IN ('scheduled','paused') AND sent_at IS NULL`,
      [req.params.id]
    );
    await client.query(
      `UPDATE alliance_campaign_prospects
       SET enrollment_status = 'stopped', stopped_at = NOW(), stop_reason = 'campaign_stopped'
       WHERE campaign_id = $1 AND enrollment_status <> 'completed'`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.json({ success: true, message: 'Campaign stopped permanently. All unsent touches were cancelled.' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance campaign stop failed:', error);
    res.status(500).json({ error: 'Failed to stop campaign.' });
  } finally {
    client.release();
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const campaignResult = await client.query(
      `SELECT id, name, status FROM alliance_campaigns WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (!campaignResult.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    const campaign = campaignResult.rows[0];
    if (['scheduled', 'running', 'paused'].includes(campaign.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Stop this campaign before deleting it permanently.' });
    }

    // These tables use SET NULL for audit/history safety, so explicitly remove
    // campaign-owned records before deleting the campaign itself.
    await client.query(`DELETE FROM alliance_email_inbound WHERE campaign_id = $1`, [campaign.id]);
    await client.query(`DELETE FROM alliance_touches WHERE campaign_id = $1`, [campaign.id]);
    await client.query(`DELETE FROM alliance_campaigns WHERE id = $1`, [campaign.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: `Campaign "${campaign.name}" was permanently deleted.` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Alliance campaign delete failed:', error);
    res.status(500).json({ error: 'Failed to delete campaign.' });
  } finally {
    client.release();
  }
});

router.post('/campaigns/:id/test-email', async (req, res) => {
  try {
    const recipient = normalizeEmail(req.body.email);
    const touchNo = Math.min(Math.max(Number(req.body.touch_no) || 1, 1), 10);
    if (!recipient) return res.status(400).json({ error: 'Enter a valid test email address.' });
    const result = await db.query(
      `SELECT c.id AS campaign_id, c.name AS campaign_name, c.audience, c.sender_domain_id,
              d.inbox_email, d.status AS sender_status,
              COALESCE(ct.subject, t.subject) AS subject, COALESCE(ct.body, t.body) AS body,
              p.id AS prospect_id, p.name, p.business_name, p.location
       FROM alliance_campaigns c
       JOIN alliance_domains d ON d.id = c.sender_domain_id
       LEFT JOIN alliance_campaign_templates ct ON ct.campaign_id = c.id AND ct.touch_no = $2
       LEFT JOIN alliance_templates t ON t.audience = c.audience AND t.channel = 'email' AND t.touch_no = $2 AND t.active = TRUE
       LEFT JOIN LATERAL (
         SELECT p.* FROM alliance_campaign_prospects cp
         JOIN alliance_prospects p ON p.id = cp.prospect_id
         WHERE cp.campaign_id = c.id ORDER BY cp.created_at LIMIT 1
       ) p ON TRUE
       WHERE c.id = $1`,
      [req.params.id, touchNo]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Campaign not found.' });
    const preview = result.rows[0];
    if (preview.sender_status !== 'active') return res.status(409).json({ error: 'Activate the selected email sender before testing.' });
    if (!preview.subject || !preview.body) return res.status(409).json({ error: `Touch ${touchNo} template is not configured.` });
    const replace = (value) => String(value || '')
      .replace(/\{\{name\}\}/gi, preview.name || 'Test Contact')
      .replace(/\{\{org\}\}/gi, preview.business_name || 'Test Organisation')
      .replace(/\{\{location\}\}/gi, preview.location || 'Test Location');
    const subject = `[TEST] ${replace(preview.subject)}`;
    const body = replace(preview.body);
    const html = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
    const config = getAllianceEmailConfig();
    if (!isAllianceSenderAllowed(preview.inbox_email, config)) {
      return res.status(409).json({ error: `Selected sender is not allowed by the Zoho SMTP configuration. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.` });
    }
    const sent = await createAllianceEmailTransport().sendMail({
      from: { name: config.fromName, address: preview.inbox_email }, to: recipient,
      replyTo: config.replyTo, subject, text: body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${html}</div>`,
      headers: { 'X-Alliance-Test': 'true' },
    });
    await db.query(
      `INSERT INTO alliance_email_events (campaign_id, prospect_id, provider_message_id, event_type, event_payload)
       VALUES ($1,$2,$3,'test_sent',$4::jsonb)`,
      [preview.campaign_id, preview.prospect_id || null, sent.messageId || null,
        JSON.stringify({ recipient, touch_no: touchNo, accepted: sent.accepted, rejected: sent.rejected, response: sent.response })]
    );
    res.json({ success: true, message: `Test touch ${touchNo} submitted to Zoho for ${recipient}.`, provider_message_id: sent.messageId || null });
  } catch (error) {
    console.error('Alliance campaign test email failed:', error.response || error.message);
    res.status(502).json({ error: error.response || error.message || 'Failed to send test email.' });
  }
});

router.get('/whatsapp-campaigns/prospects', async (req, res) => {
  try {
    const values=[]; const where=[`p.phone IS NOT NULL`,`p.consent=TRUE`,`p.consent_source IN ('website_form','click_to_whatsapp_ad','qr_code_optin','inbound_whatsapp_optin','event_registration','customer_request','written_consent')`,`p.consent_at IS NOT NULL`,`NULLIF(BTRIM(p.consent_evidence),'') IS NOT NULL`,`p.consent_scope IN ('marketing','service','both')`,`COALESCE(p.source,'') !~* '(scrap|purchas|directory|research)'`,`p.suppressed=FALSE`,`p.status NOT IN ('converted','closed','not_interested','unsubscribed')`];
    if(text(req.query.audience)){values.push(text(req.query.audience));where.push(`p.audience=$${values.length}`);}
    if(text(req.query.search)){values.push(`%${text(req.query.search).toLowerCase()}%`);where.push(`(LOWER(COALESCE(p.name,'')) LIKE $${values.length} OR LOWER(p.business_name) LIKE $${values.length} OR p.phone LIKE $${values.length})`);}
    if(text(req.query.dateFrom)){values.push(text(req.query.dateFrom));where.push(`p.created_at >= $${values.length}::date`);}
    if(text(req.query.dateTo)){values.push(text(req.query.dateTo));where.push(`p.created_at < ($${values.length}::date + INTERVAL '1 day')`);}
    const limit=Math.min(Math.max(Number(req.query.limit)||20,1),5000);const offset=Math.max(Number(req.query.offset)||0,0);
    const count=await db.query(`SELECT COUNT(*)::int AS total FROM alliance_prospects p WHERE ${where.join(' AND ')}`,values);
    const rows=await db.query(`SELECT p.id,p.name,p.business_name,p.phone,p.email,p.audience,p.industry,p.location,p.status,p.source,p.channel,p.channel_pref,p.consent,p.consent_source,p.consent_at,p.consent_evidence,p.consent_scope,p.ai_score,p.campaign_id,p.custom_fields,p.created_at FROM alliance_prospects p WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,offset]);
    res.json({prospects:rows.rows,total:count.rows[0]?.total||0});
  }catch(error){console.error('Alliance WhatsApp prospects failed:',error);res.status(500).json({error:'Failed to load WhatsApp-eligible prospects.'});}
});

router.get('/whatsapp-campaigns', async (_req,res)=>{
  try{const result=await db.query(`SELECT c.*,COUNT(r.id)::int AS recipients,
    COUNT(r.id) FILTER(WHERE r.status IN ('sent','delivered','read'))::int AS sent,
    COUNT(r.id) FILTER(WHERE r.status='delivered')::int AS delivered,
    COUNT(r.id) FILTER(WHERE r.status='read')::int AS read,
    COUNT(r.id) FILTER(WHERE r.status='failed')::int AS failed,
    COUNT(r.id) FILTER(WHERE r.status='skipped')::int AS skipped,
    (ARRAY_AGG(r.error_message ORDER BY r.id DESC) FILTER(WHERE r.error_message IS NOT NULL))[1] AS latest_error,
    (SELECT MIN(j.scheduled_at) FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status IN ('pending','claimed')) AS next_followup_at
    FROM alliance_whatsapp_campaigns c LEFT JOIN alliance_whatsapp_campaign_recipients r ON r.campaign_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`);res.json({campaigns:result.rows});}
  catch(error){res.status(500).json({error:'Failed to load WhatsApp campaigns.'});}
});

router.get('/whatsapp-campaigns/:id',async(req,res)=>{
  try{
    const campaignResult=await db.query(`SELECT c.*,
      COUNT(r.id)::int AS recipients,
      COUNT(r.id) FILTER(WHERE r.status IN ('sent','delivered','read'))::int AS sent,
      COUNT(r.id) FILTER(WHERE r.status='delivered')::int AS delivered,
      COUNT(r.id) FILTER(WHERE r.status='read')::int AS read,
      COUNT(r.id) FILTER(WHERE r.status='failed')::int AS failed,
      COUNT(r.id) FILTER(WHERE r.status='skipped')::int AS skipped,
      COUNT(r.id) FILTER(WHERE r.status IN ('queued','sending'))::int AS pending,
      COUNT(r.id) FILTER(WHERE r.status='cancelled')::int AS cancelled,
      (SELECT MIN(j.scheduled_at) FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status IN ('pending','claimed')) AS next_followup_at,
      (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status='sent') AS reminders_sent_total,
      (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status='failed') AS reminders_failed_total,
      (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status IN ('pending','claimed','sending')) AS reminders_pending_total,
      (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.status='skipped') AS reminders_skipped_total,
      (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id) AS reminder_jobs_total,
      (SELECT j.error_message FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=c.id AND j.error_message IS NOT NULL ORDER BY j.id DESC LIMIT 1) AS latest_reminder_error
      FROM alliance_whatsapp_campaigns c LEFT JOIN alliance_whatsapp_campaign_recipients r ON r.campaign_id=c.id
      WHERE c.id=$1 GROUP BY c.id`,[req.params.id]);
    if(!campaignResult.rowCount)return res.status(404).json({error:'WhatsApp campaign not found.'});

    const values=[req.params.id];const where=['r.campaign_id=$1'];
    if(text(req.query.status)){values.push(text(req.query.status));where.push(`r.status=$${values.length}`);}
    if(text(req.query.search)){values.push(`%${text(req.query.search).toLowerCase()}%`);where.push(`(LOWER(COALESCE(p.name,'')) LIKE $${values.length} OR LOWER(p.business_name) LIKE $${values.length} OR p.phone LIKE $${values.length})`);}
    const limit=Math.min(Math.max(Number(req.query.limit)||25,1),500);
    const offset=Math.max(Number(req.query.offset)||0,0);
    const countResult=await db.query(`SELECT COUNT(*)::int AS total FROM alliance_whatsapp_campaign_recipients r JOIN alliance_prospects p ON p.id=r.prospect_id WHERE ${where.join(' AND ')}`,values);
    values.push(limit);const limitParam=`$${values.length}`;values.push(offset);const offsetParam=`$${values.length}`;
    const recipients=await db.query(`SELECT r.id,r.prospect_id,r.status,r.reshare_status,r.reshare_updated_at,r.wa_msg_id,r.sent_at,r.scheduled_at,
        COALESCE(NULLIF(r.error_message,'Meta reported message delivery failed without additional details.'),
          CASE WHEN r.status='failed' THEN (
            SELECT COALESCE(
              NULLIF(CONCAT_WS(': ',
                CASE WHEN msg.raw_payload #>> '{status_event,errors,0,code}' IS NOT NULL THEN 'Meta ' || (msg.raw_payload #>> '{status_event,errors,0,code}') END,
                msg.raw_payload #>> '{status_event,errors,0,title}',
                msg.raw_payload #>> '{status_event,errors,0,message}',
                msg.raw_payload #>> '{status_event,errors,0,error_data,details}'
              ),''),
              CASE WHEN REGEXP_REPLACE(COALESCE(p.phone,''),'[^0-9]','','g') LIKE '91%'
                        AND REGEXP_REPLACE(COALESCE(p.phone,''),'[^0-9]','','g') !~ '^91[6-9][0-9]{9}$'
                   THEN 'Likely invalid Indian mobile format: expected country code 91 followed by a 10-digit mobile number starting with 6, 7, 8, or 9.'
                   ELSE 'Meta reported delivery failure without details. The number may not be registered on WhatsApp or may be unreachable.' END
            )
            FROM alliance_inbox_messages msg WHERE msg.wa_msg_id=r.wa_msg_id LIMIT 1
          ) END,
          CASE WHEN r.status='failed' THEN
            CASE WHEN REGEXP_REPLACE(COALESCE(p.phone,''),'[^0-9]','','g') LIKE '91%'
                       AND REGEXP_REPLACE(COALESCE(p.phone,''),'[^0-9]','','g') !~ '^91[6-9][0-9]{9}$'
                 THEN 'Likely invalid Indian mobile format: expected country code 91 followed by a 10-digit mobile number starting with 6, 7, 8, or 9.'
                 ELSE 'Meta reported delivery failure without details. The number may not be registered on WhatsApp or may be unreachable.' END
          END
        ) AS error_message,
        p.name,p.business_name,p.phone,p.audience,p.location,
        (SELECT COUNT(*)::int FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=r.campaign_id AND j.prospect_id=r.prospect_id AND j.status='sent') AS reminders_sent,
        (SELECT MIN(j.scheduled_at) FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=r.campaign_id AND j.prospect_id=r.prospect_id AND j.status IN ('pending','claimed')) AS next_reminder_at,
        (SELECT j.status FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=r.campaign_id AND j.prospect_id=r.prospect_id ORDER BY j.id DESC LIMIT 1) AS reminder_status,
        (SELECT j.scheduled_at FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=r.campaign_id AND j.prospect_id=r.prospect_id ORDER BY j.id DESC LIMIT 1) AS reminder_scheduled_at,
        (SELECT j.error_message FROM alliance_whatsapp_followup_jobs j WHERE j.campaign_id=r.campaign_id AND j.prospect_id=r.prospect_id ORDER BY j.id DESC LIMIT 1) AS reminder_error
      FROM alliance_whatsapp_campaign_recipients r JOIN alliance_prospects p ON p.id=r.prospect_id
      WHERE ${where.join(' AND ')} ORDER BY r.id LIMIT ${limitParam} OFFSET ${offsetParam}`,values);
    res.json({campaign:campaignResult.rows[0],recipients:recipients.rows,total:countResult.rows[0].total,limit,offset});
  }catch(error){console.error('Alliance WhatsApp campaign detail failed:',error);res.status(500).json({error:'Failed to load campaign detail.'});}
});

router.post('/whatsapp-campaigns/:id/failed-leads/reshare', async (req, res) => {
  try {
    const recipientIds = [...new Set((req.body.recipient_ids || []).map(Number).filter(Number.isInteger))];
    const reshareStatus = text(req.body.reshare_status);
    const allowed = ['excluded', 'awaiting_confirmation', 'confirmed', 'reshared'];
    if (!recipientIds.length || !allowed.includes(reshareStatus)) {
      return res.status(400).json({ error: 'Choose failed leads and a valid re-share action.' });
    }
    const result = await db.query(
      `UPDATE alliance_whatsapp_campaign_recipients
       SET reshare_status=$1, reshare_updated_at=NOW(), reshare_updated_by=$2
       WHERE campaign_id=$3 AND id=ANY($4::bigint[]) AND status='failed'
       RETURNING id, reshare_status, reshare_updated_at`,
      [reshareStatus, req.user?.id || null, req.params.id, recipientIds],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'No failed recipients were found for this campaign.' });
    res.json({ success: true, message: `${result.rowCount} failed lead${result.rowCount === 1 ? '' : 's'} updated.`, recipients: result.rows });
  } catch (error) {
    console.error('Alliance failed-lead re-share update failed:', error);
    res.status(500).json({ error: 'Failed to update re-share status.' });
  }
});

router.post('/whatsapp-campaigns/:id/retry-failed', async (req, res) => {
  try {
    const recipientIds = [...new Set((req.body.recipient_ids || []).map(Number).filter(Number.isInteger))];
    if (!recipientIds.length) {
      return res.status(400).json({ error: 'Choose one or more failed leads to retry.' });
    }
    
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE alliance_whatsapp_campaign_recipients
         SET status='queued', error_message=NULL
         WHERE campaign_id=$1 AND id=ANY($2::bigint[]) AND status='failed'
         RETURNING id`,
        [req.params.id, recipientIds],
      );
      if (result.rowCount) {
        await client.query(
          `UPDATE alliance_whatsapp_campaigns SET status='running', updated_at=NOW() WHERE id=$1`,
          [req.params.id]
        );
      }
      await client.query('COMMIT');
      if (!result.rowCount) return res.status(404).json({ error: 'No failed recipients were updated.' });
      res.json({ success: true, message: `${result.rowCount} failed lead${result.rowCount === 1 ? '' : 's'} queued for retry.` });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Alliance WhatsApp retry failed leads error:', error);
    res.status(500).json({ error: 'Failed to retry failed leads.' });
  }
});

const getAllianceWhatsAppSettings = async (queryable = db) => {
  const result = await queryable.query(`SELECT * FROM alliance_inbox_settings WHERE active=TRUE ORDER BY id LIMIT 1`);
  if (result.rowCount) return result.rows[0];
  if (process.env.ALLIANCE_WA_PHONE_NUMBER_ID) {
    return {
      phone_number_id: process.env.ALLIANCE_WA_PHONE_NUMBER_ID,
      access_token_env: 'ALLIANCE_WA_ACCESS_TOKEN',
      active: true,
      source: 'environment',
    };
  }
  return null;
};

router.post('/whatsapp-campaigns', async (req,res)=>{
  const name=text(req.body.name);const templateId=Number(req.body.template_id);const prospectIds=[...new Set((req.body.prospect_ids||[]).map(Number).filter(Number.isInteger))];const mapping=Array.isArray(req.body.parameter_mapping)?req.body.parameter_mapping.map(text):[];
  const followupTemplateId=Number(req.body.followup_template_id)||null;const followupMapping=Array.isArray(req.body.followup_parameter_mapping)?req.body.followup_parameter_mapping.map(text):[];const followupDelayMinutes=Math.min(Math.max(Number(req.body.followup_delay_minutes)||5760,10),43200);const followupDelay=Math.max(1,Math.ceil(followupDelayMinutes/1440));const followupRepeat=Math.min(Math.max(Number(req.body.followup_repeat_days)||4,1),30);const maxFollowups=0;
  if(!name||!templateId||!prospectIds.length)return res.status(400).json({error:'Campaign name, approved template, and at least one lead are required.'});
  const client=await db.connect();
  try{await client.query('BEGIN');
    const template=await client.query(`SELECT id,name,language,body,status,category,header_format FROM templates WHERE id=$1`,[templateId]);
    if(!template.rowCount||String(template.rows[0].status).toLowerCase()!=='approved')throw Object.assign(new Error('Select a Meta-approved registered template.'),{status:409});
    const variableCount=Math.max(0,...[...String(template.rows[0].body).matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1])));
    const validMappingField=(field)=>/^[a-z][a-z0-9_]*$/.test(field)&&!['__proto__','constructor','prototype'].includes(field);
    if(mapping.length!==variableCount||mapping.some(field=>!validMappingField(field)))throw Object.assign(new Error(`Map all ${variableCount} template variables before scheduling.`),{status:400});
    let followup=null;if(followupTemplateId){const followupResult=await client.query(`SELECT id,name,language,body,status FROM templates WHERE id=$1`,[followupTemplateId]);followup=followupResult.rows[0];if(!followup||String(followup.status).toLowerCase()!=='approved')throw Object.assign(new Error('Select a Meta-approved follow-up template.'),{status:409});const count=Math.max(0,...[...String(followup.body).matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1])));if(followupMapping.length!==count||followupMapping.some(field=>!validMappingField(field)))throw Object.assign(new Error(`Map all ${count} follow-up variables.`),{status:400});}
    const settings=await getAllianceWhatsAppSettings(client);
    if(!settings)throw Object.assign(new Error('Configure ALLIANCE_WA_PHONE_NUMBER_ID or an active Alliance WhatsApp number.'),{status:409});
    if(!process.env[settings.access_token_env||'ALLIANCE_WA_ACCESS_TOKEN'])throw Object.assign(new Error('Alliance WhatsApp access token is missing.'),{status:409});
    const eligible=await client.query(`SELECT id FROM alliance_prospects WHERE id=ANY($1::bigint[]) AND phone IS NOT NULL AND consent=TRUE AND consent_source IN ('website_form','click_to_whatsapp_ad','qr_code_optin','inbound_whatsapp_optin','event_registration','customer_request','written_consent') AND consent_at IS NOT NULL AND NULLIF(BTRIM(consent_evidence),'') IS NOT NULL AND consent_scope IN ('marketing','service','both') AND COALESCE(source,'') !~* '(scrap|purchas|directory|research)' AND suppressed=FALSE AND status NOT IN ('converted','closed','complete','completed','not_interested','unsubscribed')`,[prospectIds]);
    if(!eligible.rowCount)throw Object.assign(new Error('No selected leads have valid WhatsApp consent.'),{status:409});
    if(eligible.rowCount!==prospectIds.length)throw Object.assign(new Error(`${prospectIds.length-eligible.rowCount} selected lead${prospectIds.length-eligible.rowCount===1?' is':'s are'} missing valid WhatsApp consent evidence. Nothing was scheduled. Correct consent_source, consent_at, consent_evidence, and consent_scope, then try again.`),{status:409});
    assertBulkSendLimit(await getBulkSendLimit('whatsapp',client),eligible.rowCount);
    const scheduledAt=req.body.scheduled_at?new Date(req.body.scheduled_at):new Date();if(Number.isNaN(scheduledAt.getTime()))throw Object.assign(new Error('Enter a valid schedule date and time.'),{status:400});
    const campaign=await client.query(`INSERT INTO alliance_whatsapp_campaigns(name,audience,template_id,template_name,template_language,template_body,parameter_mapping,phone_number_id,status,scheduled_at,created_by,followup_template_id,followup_template_name,followup_template_language,followup_template_body,followup_parameter_mapping,followup_delay_days,followup_delay_minutes,followup_repeat_days,max_followups) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'scheduled',$9,$10,$11,$12,$13,$14,$15::jsonb,$16,$17,$18,$19) RETURNING *`,[name,text(req.body.audience)||null,templateId,template.rows[0].name,template.rows[0].language||'en',template.rows[0].body,JSON.stringify(mapping),settings.phone_number_id,scheduledAt,req.user?.id||null,followup?.id||null,followup?.name||null,followup?.language||null,followup?.body||null,JSON.stringify(followupMapping),followupDelay,followupDelayMinutes,followupRepeat,maxFollowups]);
    await client.query(`INSERT INTO alliance_whatsapp_campaign_recipients(campaign_id,prospect_id,scheduled_at) SELECT $1,id,$2 FROM alliance_prospects WHERE id=ANY($3::bigint[])`,[campaign.rows[0].id,scheduledAt,eligible.rows.map(row=>row.id)]);
    await client.query('COMMIT');setImmediate(()=>processAllianceWhatsAppCampaigns(req.app.get('io')).catch(error=>console.error('[Alliance WhatsApp bulk]',error)));
    res.status(201).json({success:true,campaign:campaign.rows[0],recipients:eligible.rowCount,message:`WhatsApp campaign scheduled for ${eligible.rowCount} opted-in leads.`});
  }catch(error){await client.query('ROLLBACK');console.error('Alliance WhatsApp campaign create failed:',error.message);res.status(error.status||500).json({error:error.message||'Failed to create WhatsApp campaign.'});}
  finally{client.release();}
});

router.post('/whatsapp-campaigns/test',async(req,res)=>{
  try{const templateId=Number(req.body.template_id);const phone=normalizePhone(req.body.phone);const mapping=Array.isArray(req.body.sample_values)?req.body.sample_values.map(text):[];if(!templateId||!phone)return res.status(400).json({error:'Template and test phone number are required.'});
    const [templateResult,settings]=await Promise.all([db.query(`SELECT name,language,body,status FROM templates WHERE id=$1`,[templateId]),getAllianceWhatsAppSettings()]);const template=templateResult.rows[0];if(!template||String(template.status).toLowerCase()!=='approved')return res.status(409).json({error:'Select an approved template.'});if(!settings)return res.status(409).json({error:'Alliance WhatsApp number is not configured.'});const token=process.env[settings.access_token_env||'ALLIANCE_WA_ACCESS_TOKEN'];if(!token)return res.status(409).json({error:'Alliance WhatsApp access token is missing.'});
    const payload={messaging_product:'whatsapp',to:phone,type:'template',template:{name:template.name,language:{code:template.language||'en'},...(mapping.length?{components:[{type:'body',parameters:mapping.map(value=>({type:'text',text:value||'Test'}))}]}:{})}};const response=await axios.post(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});res.json({success:true,message:'Test template submitted to Meta.',wa_msg_id:response.data?.messages?.[0]?.id||null});
  }catch(error){res.status(502).json({error:error.response?.data?.error?.message||error.message||'Test send failed.'});}
});

router.post('/whatsapp-campaigns/:id/pause',async(req,res)=>{
  try{
    const result=await db.query(`UPDATE alliance_whatsapp_campaigns SET status='paused',updated_at=NOW() WHERE id=$1 AND status IN ('scheduled','running') RETURNING id`,[req.params.id]);
    if(!result.rowCount)return res.status(409).json({error:'Only a scheduled or running campaign can be paused.'});
    res.json({success:true,message:'WhatsApp campaign paused. Queued messages will not send until resumed.'});
  }catch(error){console.error('Alliance WhatsApp campaign pause failed:',error);res.status(500).json({error:'Failed to pause campaign.'});}
});

router.post('/whatsapp-campaigns/:id/resume',async(req,res)=>{
  try{
    const result=await db.query(`UPDATE alliance_whatsapp_campaigns SET status='running',updated_at=NOW() WHERE id=$1 AND status='paused' RETURNING id`,[req.params.id]);
    if(!result.rowCount)return res.status(409).json({error:'Only a paused campaign can be resumed.'});
    setImmediate(()=>processAllianceWhatsAppCampaigns(req.app.get('io')).catch(error=>console.error('[Alliance WhatsApp bulk]',error)));
    res.json({success:true,message:'WhatsApp campaign resumed.'});
  }catch(error){console.error('Alliance WhatsApp campaign resume failed:',error);res.status(500).json({error:'Failed to resume campaign.'});}
});

router.post('/whatsapp-campaigns/:id/stop',async(req,res)=>{try{await db.query(`UPDATE alliance_whatsapp_campaigns SET status='stopped',completed_at=NOW(),updated_at=NOW() WHERE id=$1 AND status IN ('scheduled','running','paused','completed')`,[req.params.id]);await db.query(`UPDATE alliance_whatsapp_campaign_recipients SET status='cancelled',error_message='Campaign stopped by user.' WHERE campaign_id=$1 AND status='queued'`,[req.params.id]);await db.query(`UPDATE alliance_whatsapp_followup_jobs SET status='cancelled',error_message='Campaign stopped by user.' WHERE campaign_id=$1 AND status IN ('pending','claimed')`,[req.params.id]);res.json({success:true,message:'WhatsApp campaign and reminders stopped.'});}catch(error){res.status(500).json({error:'Failed to stop campaign.'});}});

router.delete('/whatsapp-campaigns/:id',async(req,res)=>{
  try{
    const campaign=await db.query(`SELECT id,name,status FROM alliance_whatsapp_campaigns WHERE id=$1`,[req.params.id]);
    if(!campaign.rowCount)return res.status(404).json({error:'WhatsApp campaign not found.'});
    if(['scheduled','running','paused'].includes(campaign.rows[0].status))return res.status(409).json({error:'Stop this campaign before deleting it.'});
    await db.query(`DELETE FROM alliance_whatsapp_campaigns WHERE id=$1`,[req.params.id]);
    res.json({success:true,message:'WhatsApp campaign deleted. Existing Alliance Inbox messages were preserved.'});
  }catch(error){console.error('Alliance WhatsApp campaign delete failed:',error);res.status(500).json({error:'Failed to delete WhatsApp campaign.'});}
});

// ── AI Brain: brands, offerings (courses/services), and FAQs the AI reply
// suggestions (email + WhatsApp) read from. See alliance-brain-context.js.

router.get('/prompt-rules', async (_req, res) => {
  try {
    const result = await db.query(`SELECT r.*,a.label AS audience_label FROM alliance_prompt_rules r LEFT JOIN alliance_audiences a ON a.code=r.audience ORDER BY r.priority,r.id`);
    res.json({ rules: result.rows });
  } catch (error) { res.status(500).json({ error: 'Failed to load AI prompt rules.' }); }
});

router.post('/campaigns/:id/retry-failed', async (req, res) => {
  try {
    const campaign = await db.query(`SELECT c.id,c.status,d.inbox_email FROM alliance_campaigns c JOIN alliance_domains d ON d.id=c.sender_domain_id WHERE c.id=$1`, [req.params.id]);
    if (!campaign.rowCount) return res.status(404).json({ error: 'Campaign not found.' });
    if (campaign.rows[0].status !== 'running') return res.status(409).json({ error: 'Resume or start the campaign before retrying failed emails.' });
    const config = getAllianceEmailConfig();
    if (!isAllianceSenderAllowed(campaign.rows[0].inbox_email, config)) return res.status(409).json({ error: `Selected sender is not allowed by the Zoho SMTP configuration. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.` });
    const result = await db.query(`UPDATE alliance_touches SET status='scheduled',scheduled_at=NOW(),error_message=NULL,processing_started_at=NULL WHERE campaign_id=$1 AND channel='email' AND status='failed' AND sent_at IS NULL RETURNING id`, [req.params.id]);
    res.json({ success:true, retried:result.rowCount, message:result.rowCount ? `${result.rowCount} failed email${result.rowCount===1?'':'s'} queued for retry.` : 'No failed emails need retrying.' });
  } catch (error) {
    console.error('Alliance campaign retry failed:', error);
    res.status(500).json({ error: 'Failed to retry campaign emails.' });
  }
});

router.get('/number-health', async (_req, res) => {
  try {
    await db.query(`UPDATE alliance_domains SET sent_today=0,last_reset=NOW() WHERE last_reset::date<CURRENT_DATE`);
    const [numbers, domains] = await Promise.all([
      db.query(`WITH sender_ids AS (
          SELECT phone_number_id FROM alliance_inbox_settings
          UNION SELECT phone_number_id FROM alliance_numbers WHERE phone_number_id IS NOT NULL
          UNION SELECT phone_number_id FROM alliance_whatsapp_campaigns
          UNION SELECT NULLIF($1,'')
        ) SELECT
          ids.phone_number_id AS id,
          COALESCE(n.label,m.verified_name,s.verified_name,'WhatsApp sender') AS label,
          COALESCE(n.phone_number,m.display_phone_number,s.display_phone_number) AS phone_number,
          ids.phone_number_id,
          LOWER(COALESCE(NULLIF(m.quality_rating,''),n.quality_rating)) AS quality_rating,
          n.warmup_stage,n.daily_cap,
          COALESCE(n.status,CASE WHEN COALESCE(s.active,TRUE) THEN 'active' ELSE 'inactive' END) AS status,
          n.paused_until,n.last_reset,m.connection_status,m.last_synced_at,
          COALESCE(today.sent_count,0)::int AS sent_today,
          (NULLIF(m.quality_rating,'') IS NOT NULL OR n.quality_rating IS NOT NULL) AS quality_monitored,
          (n.id IS NOT NULL) AS cap_configured
        FROM sender_ids ids
        LEFT JOIN alliance_inbox_settings s ON s.phone_number_id=ids.phone_number_id
        LEFT JOIN alliance_numbers n ON n.phone_number_id=ids.phone_number_id
        LEFT JOIN meta_whatsapp_phone_numbers m ON m.phone_number_id=ids.phone_number_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS sent_count FROM (SELECT DISTINCT message_key FROM (
            SELECT COALESCE(r.wa_msg_id,'recipient:'||r.id) AS message_key FROM alliance_whatsapp_campaign_recipients r
            JOIN alliance_whatsapp_campaigns c ON c.id=r.campaign_id
            WHERE c.phone_number_id=ids.phone_number_id AND r.sent_at>=CURRENT_DATE
              AND r.status IN ('sent','delivered','read')
            UNION ALL
            SELECT COALESCE(j.wa_msg_id,'followup:'||j.id) FROM alliance_whatsapp_followup_jobs j
            JOIN alliance_whatsapp_campaigns c ON c.id=j.campaign_id
            WHERE c.phone_number_id=ids.phone_number_id AND j.sent_at>=CURRENT_DATE AND j.status='sent'
            UNION ALL
            SELECT COALESCE(msg.wa_msg_id,'inbox:'||msg.id) FROM alliance_inbox_messages msg
            JOIN alliance_inbox_conversations conversation ON conversation.id=msg.conversation_id
            WHERE conversation.phone_number_id=ids.phone_number_id AND msg.direction='outbound'
              AND msg.sent_at>=CURRENT_DATE AND msg.status IN ('sent','delivered','read')
          ) all_sends) sends
        ) today ON TRUE
        WHERE ids.phone_number_id IS NOT NULL
        ORDER BY COALESCE(s.active,TRUE) DESC,COALESCE(s.created_at,n.created_at,m.last_synced_at)`,
        [process.env.ALLIANCE_WA_PHONE_NUMBER_ID || '']),
      db.query(`SELECT d.id,d.inbox_email,d.provider,d.warmup_stage,d.daily_cap,d.sent_today,d.reputation,d.status,d.last_reset,d.created_at,
          COALESCE(metrics.failed_today,0)::int AS failed_today,
          COALESCE(metrics.replies_today,0)::int AS replies_today,
          COALESCE(metrics.bounce_notices_today,0)::int AS bounce_notices_today,
          sync.last_checked_at AS imap_last_checked_at,sync.last_success_at AS imap_last_success_at,sync.last_error AS imap_last_error
        FROM alliance_domains d
        LEFT JOIN LATERAL (
          SELECT
            (SELECT COUNT(*) FROM alliance_touches t JOIN alliance_campaigns c ON c.id=t.campaign_id
             WHERE c.sender_domain_id=d.id AND t.channel='email' AND t.status='failed' AND t.scheduled_at>=CURRENT_DATE) AS failed_today,
            (SELECT COUNT(*) FROM alliance_email_inbound inbound JOIN alliance_campaigns c ON c.id=inbound.campaign_id
             WHERE c.sender_domain_id=d.id AND inbound.received_at>=CURRENT_DATE
               AND NOT (COALESCE(inbound.subject,'') ~* '(delivery status notification|undeliver|mail delivery failed|returned mail|failure notice|delivery failure)'
                 OR COALESCE(inbound.from_email,'') ~* '(mailer-daemon|postmaster)')) AS replies_today,
            (SELECT COUNT(*) FROM alliance_email_inbound inbound
             WHERE LOWER(COALESCE(inbound.to_email,''))=LOWER(d.inbox_email) AND inbound.received_at>=CURRENT_DATE
               AND (COALESCE(inbound.subject,'') ~* '(delivery status notification|undeliver|mail delivery failed|returned mail|failure notice|delivery failure)'
                 OR COALESCE(inbound.from_email,'') ~* '(mailer-daemon|postmaster)')) AS bounce_notices_today
        ) metrics ON TRUE
        LEFT JOIN alliance_email_sync_state sync ON LOWER(sync.mailbox)=LOWER(d.inbox_email)
        ORDER BY d.status='active' DESC,d.created_at`),
    ]);
    const issues = [];
    for (const number of numbers.rows) {
      if (number.quality_rating === 'red') issues.push({ severity:'red', message:`${number.label} has red Meta quality and must remain stopped.` });
      else if (number.quality_rating === 'yellow') issues.push({ severity:'yellow', message:`${number.label} has yellow Meta quality. Reduce volume and review recent failures.` });
      else if (number.status === 'paused') issues.push({ severity:'yellow', message:`${number.label} is paused${number.paused_until ? ` until ${number.paused_until.toISOString()}` : ''}.` });
      if (!number.quality_monitored) issues.push({ severity:'unknown', message:`${number.label} is connected, but Meta quality monitoring is not configured.` });
      if (!number.cap_configured) issues.push({ severity:'unknown', message:`${number.label} does not have an AllianceOS daily cap and warm-up stage configured.` });
      if (number.last_synced_at && Date.now()-new Date(number.last_synced_at).getTime()>24*60*60*1000) issues.push({ severity:'unknown', message:`${number.label} Meta health data is more than 24 hours old. Sync Meta inventory.` });
    }
    for (const domain of domains.rows) {
      const reputation=String(domain.reputation||'unknown').toLowerCase();
      if (domain.status === 'paused' || ['bad','poor'].includes(reputation)) issues.push({ severity:'red', message:`${domain.inbox_email} is ${domain.status === 'paused' ? 'paused' : `reporting ${domain.reputation} reputation`}.` });
      else if (!['good','high','healthy'].includes(reputation)) issues.push({ severity:'unknown', message:`${domain.inbox_email} mailbox activity is monitored, but Zoho provider reputation, confirmed delivery, and complaint events are unavailable.` });
      if (domain.imap_last_error) issues.push({ severity:'yellow', message:`${domain.inbox_email} IMAP monitoring error: ${domain.imap_last_error}` });
      else if (!domain.imap_last_success_at) issues.push({ severity:'unknown', message:`${domain.inbox_email} has no successful IMAP monitoring check yet.` });
      if (Number(domain.bounce_notices_today)>0) issues.push({ severity:'yellow', message:`${domain.inbox_email} received ${domain.bounce_notices_today} possible bounce notice${Number(domain.bounce_notices_today)===1?'':'s'} today. Review the mailbox and suppress hard-bounced recipients.` });
    }
    res.json({ numbers:numbers.rows, domains:domains.rows, issues, generated_at:new Date().toISOString() });
  } catch (error) {
    console.error('Alliance number health failed:', error);
    res.status(500).json({ error: 'Failed to load sender health.' });
  }
});

router.post('/prompt-rules/extract', async (req, res) => {
  try {
    if (!openRouter.isConfigured) return res.status(503).json({ error: 'OpenRouter is not configured on the API server.' });
    const rawText = text(req.body.text);
    if (!rawText) return res.status(400).json({ error: 'Paste some rule text first.' });
    const audiences = await db.query(`SELECT code,label,brand FROM alliance_audiences WHERE active=TRUE ORDER BY label`);
    const prompt = `Convert this administrator's plain-language AI behavior rule into one structured AllianceOS rule.
Available jobs:
- all: applies to every AI task
- campaign_message: initial campaign content
- followup: campaign reminders and follow-up content
- reply_suggestion: suggested responses to inbound email or WhatsApp messages
- classify: classifying reply intent
Available channels: all, email, whatsapp.
Available audiences: ${JSON.stringify(audiences.rows)}
Rules:
- Pick an audience code only when a specific listed audience or brand is clearly named. Otherwise use an empty string.
- condition_text describes WHEN the instruction applies. Keep it empty if the pasted rule is unconditional.
- instruction_text describes WHAT the AI must do. Preserve important constraints and do not invent new policy.
- priority is 1-999; use 100 when none is stated. Lower numbers run first.
- active defaults to true.
- Create a short descriptive name when the text has no title.
Plain text:
${rawText}
Return JSON only: {"name":"","job":"all|campaign_message|followup|reply_suggestion|classify","channel":"all|email|whatsapp","audience":"","condition_text":"","instruction_text":"","priority":100,"active":true}`;
    const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1000 } });
    const parsed = JSON.parse(String(generated.text).replace(/^```json\s*|\s*```$/g, ''));
    const extracted = {
      name: text(parsed.name),
      job: ['all','campaign_message','followup','reply_suggestion','classify'].includes(parsed.job) ? parsed.job : 'all',
      channel: ['all','email','whatsapp'].includes(parsed.channel) ? parsed.channel : 'all',
      audience: audiences.rows.some((item) => item.code === parsed.audience) ? parsed.audience : '',
      condition_text: text(parsed.condition_text), instruction_text: text(parsed.instruction_text),
      priority: Math.min(Math.max(Number(parsed.priority) || 100, 1), 999), active: parsed.active !== false,
    };
    if (!extracted.name || !extracted.instruction_text) return res.status(502).json({ error: 'AI could not identify a complete rule from that text.' });
    res.json({ extracted });
  } catch (error) {
    console.error('Alliance prompt rule extraction failed:', error);
    res.status(502).json({ error: error.message || 'Failed to extract the AI rule.' });
  }
});

function validatePromptRule(body) {
  const rule = { name:text(body.name), job:text(body.job||'all'), channel:text(body.channel||'all'), audience:text(body.audience)||null, condition_text:text(body.condition_text), instruction_text:text(body.instruction_text), priority:Math.min(Math.max(Number(body.priority)||100,1),999), active:body.active!==false };
  if (!rule.name || !rule.instruction_text) return { error: 'Rule name and instruction are required.' };
  if (!['all','campaign_message','followup','reply_suggestion','classify'].includes(rule.job)) return { error: 'Invalid AI job.' };
  if (!['all','email','whatsapp'].includes(rule.channel)) return { error: 'Invalid channel.' };
  return { rule };
}

router.post('/prompt-rules', async (req, res) => {
  const { rule, error } = validatePromptRule(req.body); if (error) return res.status(400).json({ error });
  try {
    const result = await db.query(`INSERT INTO alliance_prompt_rules(name,job,channel,audience,condition_text,instruction_text,priority,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[rule.name,rule.job,rule.channel,rule.audience,rule.condition_text,rule.instruction_text,rule.priority,rule.active]);
    res.status(201).json({ rule: result.rows[0] });
  } catch (dbError) { if(dbError.code==='23503')return res.status(400).json({error:'Select a valid audience.'}); res.status(500).json({error:'Failed to create AI prompt rule.'}); }
});

router.patch('/prompt-rules/:id', async (req, res) => {
  const { rule, error } = validatePromptRule(req.body); if (error) return res.status(400).json({ error });
  try {
    const result = await db.query(`UPDATE alliance_prompt_rules SET name=$1,job=$2,channel=$3,audience=$4,condition_text=$5,instruction_text=$6,priority=$7,active=$8,updated_at=NOW() WHERE id=$9 RETURNING *`,[rule.name,rule.job,rule.channel,rule.audience,rule.condition_text,rule.instruction_text,rule.priority,rule.active,req.params.id]);
    if(!result.rowCount)return res.status(404).json({error:'AI prompt rule not found.'}); res.json({rule:result.rows[0]});
  } catch (dbError) { if(dbError.code==='23503')return res.status(400).json({error:'Select a valid audience.'}); res.status(500).json({error:'Failed to update AI prompt rule.'}); }
});

router.delete('/prompt-rules/:id', async (req, res) => {
  try { const result=await db.query(`DELETE FROM alliance_prompt_rules WHERE id=$1 RETURNING id`,[req.params.id]); if(!result.rowCount)return res.status(404).json({error:'AI prompt rule not found.'}); res.json({success:true}); }
  catch(error){res.status(500).json({error:'Failed to delete AI prompt rule.'});}
});

const BRAIN_BRAND_FIELDS = ['code', 'name', 'description', 'phone', 'whatsapp', 'email', 'website', 'address',
  'business_hours', 'languages', 'target_customers', 'primary_contact', 'escalation_contact', 'escalation_phone',
  'verified_by', 'last_verified_date'];

router.post('/brain/brands/extract', async (req, res) => {
  try {
    if (!openRouter.isConfigured) return res.status(503).json({ error: 'OpenRouter is not configured on the API server.' });
    const rawText = text(req.body.text);
    if (!rawText) return res.status(400).json({ error: 'Paste some brand info text first.' });
    const prompt = `Extract structured brand information from this raw data-collection form text.
Map onto these exact JSON keys when the text supports it: ${JSON.stringify(BRAIN_BRAND_FIELDS)}.
Rules:
- "code" is a short lowercase slug for the brand (letters, numbers, underscores only, e.g. "bmacademy"), derived from the brand name if no explicit code is given.
- "last_verified_date" must be YYYY-MM-DD, or an empty string if unknown or a placeholder like "YYYY-MM-DD".
- Never invent a value. If a field is blank, marked "needs_confirmation", or not present in the text, return an empty string for it.
- Ignore instructional/template lines (e.g. "Rules:", "Write needs_confirmation if information is unknown", section dividers like "====").
- Any other label: value pairs found in the text that do NOT match one of the known keys above (for example general policy lines, or any other custom field) go into an "extra" object, keyed by the original field label exactly as written in the text.
Raw text:
${rawText}
Return JSON only: {${BRAIN_BRAND_FIELDS.map((field) => `"${field}":""`).join(',')},"extra":{}}`;
    const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 1800 } });
    const parsed = JSON.parse(String(generated.text).replace(/^```json\s*|\s*```$/g, ''));
    res.json({ success: true, extracted: parsed });
  } catch (error) {
    console.error('Alliance brain brand extract failed:', error);
    res.status(502).json({ error: error.message || 'Failed to extract brand info from text.' });
  }
});

// Splits a pasted multi-record document into one text block per course/service,
// using the doc's own section markers as delimiters (falls back to treating
// the whole paste as a single record if no markers are found).
function splitOfferingBlocks(rawText) {
  const serviceMarker = /={10,}\s*\r?\n\s*SERVICE DETAILS\s*\r?\n\s*={10,}/gi;
  const serviceParts = rawText.split(serviceMarker).map((part) => part.trim()).filter(Boolean);
  if (serviceParts.length > 1) return serviceParts.slice(1); // drop preamble before the first marker

  const courseSplit = /\r?\n(?=\s*(?:\d+[.)]\s*)?Course ID\s*:)/gi;
  const courseParts = rawText.split(courseSplit).map((part) => part.trim()).filter(Boolean);
  if (courseParts.length > 1) return courseParts.slice(1);
  if (courseParts.length === 1 && /Course ID\s*:/i.test(courseParts[0])) return courseParts;

  return [rawText.trim()];
}

const OFFERING_CORE_FIELDS = ['offering_code', 'offering_type', 'name', 'category', 'tier', 'status', 'short_description', 'fee', 'duration'];

async function extractOfferingFromText(block) {
  const prompt = `Extract one structured course/service record from this raw text block (one section of a data-collection form).
Map onto these exact JSON keys when the text supports it: ${JSON.stringify(OFFERING_CORE_FIELDS)}.
Rules:
- "offering_type" must be exactly "course" or "service" (infer from context — e.g. a "Course ID" field implies course, a "Service ID" field implies service).
- "offering_code" is the ID field (e.g. "BMTECHX001" or "BMA-BC-001").
- "status" must be exactly "active" or "inactive" (default "active" if not stated).
- "fee" is a plain number as a string (strip currency symbols and "/month"); if several fees exist (setup, monthly, one-time), put the main recurring or headline one here and record the rest inside "details".
- Never invent a value. If a field is blank, "Not Specified", "Not Applicable", or "needs_confirmation", return an empty string for it.
- Every other label: value pair in the text (Overview, extra pricing fields, Service Features, Client Requirements, Ownership, Results & Disclaimers, Policies, Links, Sales, etc.) goes into a "details" object keyed by the exact label from the text. For bulleted list fields, join the items into one string separated by " | ".
- Extract any FAQ / Frequently Asked Questions section as a "faqs" array of {"question":"...","answer":"..."} objects, one per pair. Ignore section headers and "===" divider lines.
Raw text block:
${block}
Return JSON only: {${OFFERING_CORE_FIELDS.map((field) => `"${field}":""`).join(',')},"details":{},"faqs":[]}`;
  const generated = await openRouter.generateContent({ contents: prompt, config: { responseMimeType: 'application/json', temperature: 0.1, maxOutputTokens: 3000 } });
  const parsed = JSON.parse(String(generated.text).replace(/^```json\s*|\s*```$/g, ''));
  if (!text(parsed.name)) throw new Error('Could not identify an offering name in this block.');
  return parsed;
}

router.post('/brain/offerings/import-bulk', async (req, res) => {
  try {
    if (!openRouter.isConfigured) return res.status(503).json({ error: 'OpenRouter is not configured on the API server.' });
    const brandId = Number(req.body.brand_id);
    const rawText = text(req.body.text);
    if (!brandId) return res.status(400).json({ error: 'Select a brand first.' });
    if (!rawText) return res.status(400).json({ error: 'Paste some course/service text first.' });
    const brand = await db.query(`SELECT id FROM alliance_brands WHERE id = $1`, [brandId]);
    if (!brand.rowCount) return res.status(404).json({ error: 'Brand not found.' });

    const blocks = splitOfferingBlocks(rawText);
    if (blocks.length > 60) return res.status(400).json({ error: `Detected ${blocks.length} records — paste in smaller batches (max 60 at a time).` });

    const created = [];
    const failed = [];
    for (const block of blocks) {
      try {
        const extracted = await extractOfferingFromText(block);
        const offering = await db.query(
          `INSERT INTO alliance_offerings (brand_id, offering_code, offering_type, name, category, tier, status, short_description, fee, duration, details)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
          [brandId, text(extracted.offering_code), ['course', 'service'].includes(extracted.offering_type) ? extracted.offering_type : 'course',
            text(extracted.name), text(extracted.category), text(extracted.tier),
            ['active', 'inactive'].includes(extracted.status) ? extracted.status : 'active',
            text(extracted.short_description), text(extracted.fee), text(extracted.duration),
            JSON.stringify(extracted.details && typeof extracted.details === 'object' ? extracted.details : {})]
        );
        let faqCount = 0;
        if (Array.isArray(extracted.faqs)) {
          for (const faq of extracted.faqs) {
            if (text(faq?.question) && text(faq?.answer)) {
              await db.query(`INSERT INTO alliance_offering_faqs (offering_id, question, answer) VALUES ($1,$2,$3)`, [offering.rows[0].id, text(faq.question), text(faq.answer)]);
              faqCount += 1;
            }
          }
        }
        created.push({ id: offering.rows[0].id, name: offering.rows[0].name, faq_count: faqCount });
      } catch (error) {
        failed.push({ preview: block.slice(0, 100).replace(/\s+/g, ' '), error: error.message || 'Extraction failed.' });
      }
    }
    res.json({ success: true, created, failed, total_blocks: blocks.length });
  } catch (error) {
    console.error('Alliance brain bulk offering import failed:', error);
    res.status(500).json({ error: error.message || 'Bulk import failed.' });
  }
});

router.get('/brain/brands', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, COUNT(o.id)::int AS offering_count
       FROM alliance_brands b LEFT JOIN alliance_offerings o ON o.brand_id = b.id
       GROUP BY b.id ORDER BY b.name`
    );
    res.json({ brands: result.rows });
  } catch (error) {
    console.error('Alliance brain brands list failed:', error);
    res.status(500).json({ error: 'Failed to load brands.' });
  }
});

router.post('/brain/brands', async (req, res) => {
  try {
    const code = text(req.body.code).toLowerCase();
    const name = text(req.body.name);
    if (!code || !name) return res.status(400).json({ error: 'Brand code and name are required.' });
    if (!/^[a-z][a-z0-9_]*$/.test(code)) return res.status(400).json({ error: 'Brand code must be lowercase letters, numbers, and underscores, starting with a letter.' });
    if (text(req.body.email) && !isValidEmailAddress(req.body.email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (['phone', 'whatsapp', 'escalation_phone'].some((field) => !isValidOptionalTenDigitPhone(req.body[field]))) return res.status(400).json({ error: 'Phone numbers must contain exactly 10 digits.' });
    const businessHours = normalizeBusinessHours(req.body.business_hours);
    if (businessHours === null) return res.status(400).json({ error: 'Enter a recognizable business-hours range, such as 10am-8pm or 09:00-20:00.' });
    const result = await db.query(
      `INSERT INTO alliance_brands (code, audience, name, description, phone, whatsapp, email, website, address, business_hours, languages, target_customers, primary_contact, escalation_contact, escalation_phone, policies, verified_by, last_verified_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18) RETURNING *`,
      [code, text(req.body.audience) || null, name, text(req.body.description), text(req.body.phone), text(req.body.whatsapp),
        text(req.body.email), text(req.body.website), text(req.body.address), businessHours, text(req.body.languages),
        text(req.body.target_customers), text(req.body.primary_contact), text(req.body.escalation_contact), text(req.body.escalation_phone),
        JSON.stringify(req.body.policies && typeof req.body.policies === 'object' ? req.body.policies : {}),
        text(req.body.verified_by), req.body.last_verified_date || null]
    );
    res.status(201).json({ success: true, brand: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'A brand with this code already exists.' });
    console.error('Alliance brain brand create failed:', error);
    res.status(500).json({ error: 'Failed to create brand.' });
  }
});

router.patch('/brain/brands/:id', async (req, res) => {
  try {
    if ('email' in req.body && text(req.body.email) && !isValidEmailAddress(req.body.email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (['phone', 'whatsapp', 'escalation_phone'].some((field) => field in req.body && !isValidOptionalTenDigitPhone(req.body[field]))) {
      return res.status(400).json({ error: 'Phone numbers must contain exactly 10 digits.' });
    }
    const businessHours = 'business_hours' in req.body ? normalizeBusinessHours(req.body.business_hours) : undefined;
    if (businessHours === null) return res.status(400).json({ error: 'Enter a recognizable business-hours range, such as 10am-8pm or 09:00-20:00.' });
    const fields = ['audience', 'name', 'description', 'phone', 'whatsapp', 'email', 'website', 'address', 'business_hours',
      'languages', 'target_customers', 'primary_contact', 'escalation_contact', 'escalation_phone', 'verified_by', 'last_verified_date', 'active'];
    const nullIfEmpty = new Set(['audience', 'last_verified_date']); // FK / date columns reject '' — must be NULL instead
    const sets = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) { const fieldValue = field === 'business_hours' ? businessHours : req.body[field]; values.push(nullIfEmpty.has(field) ? (fieldValue || null) : fieldValue); sets.push(`${field} = $${values.length}`); }
    }
    if ('policies' in req.body) { values.push(JSON.stringify(req.body.policies && typeof req.body.policies === 'object' ? req.body.policies : {})); sets.push(`policies = $${values.length}::jsonb`); }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });
    sets.push('updated_at = NOW()');
    values.push(req.params.id);
    const result = await db.query(`UPDATE alliance_brands SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'Brand not found.' });
    res.json({ success: true, brand: result.rows[0] });
  } catch (error) {
    console.error('Alliance brain brand update failed:', error);
    res.status(500).json({ error: 'Failed to update brand.' });
  }
});

router.delete('/brain/brands/:id', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM alliance_brands WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Brand not found.' });
    res.json({ success: true, message: 'Brand and its offerings/FAQs were removed.' });
  } catch (error) {
    console.error('Alliance brain brand delete failed:', error);
    res.status(500).json({ error: 'Failed to delete brand.' });
  }
});

router.get('/brain/brands/:id/offerings', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT o.*, (SELECT COUNT(*)::int FROM alliance_offering_faqs f WHERE f.offering_id = o.id) AS faq_count
       FROM alliance_offerings o WHERE o.brand_id = $1 ORDER BY o.name`,
      [req.params.id]
    );
    res.json({ offerings: result.rows });
  } catch (error) {
    console.error('Alliance brain offerings list failed:', error);
    res.status(500).json({ error: 'Failed to load offerings.' });
  }
});

router.post('/brain/offerings', async (req, res) => {
  try {
    const brandId = Number(req.body.brand_id);
    const name = text(req.body.name);
    if (!brandId || !name) return res.status(400).json({ error: 'Brand and offering name are required.' });
    const offeringType = ['course', 'service'].includes(req.body.offering_type) ? req.body.offering_type : 'course';
    const result = await db.query(
      `INSERT INTO alliance_offerings (brand_id, offering_code, offering_type, name, category, tier, status, short_description, fee, duration, details, verified_by, last_verified_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13) RETURNING *`,
      [brandId, text(req.body.offering_code), offeringType, name, text(req.body.category), text(req.body.tier),
        ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active', text(req.body.short_description),
        text(req.body.fee), text(req.body.duration), JSON.stringify(req.body.details && typeof req.body.details === 'object' ? req.body.details : {}),
        text(req.body.verified_by), req.body.last_verified_date || null]
    );
    res.status(201).json({ success: true, offering: result.rows[0] });
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Brand not found.' });
    console.error('Alliance brain offering create failed:', error);
    res.status(500).json({ error: 'Failed to create offering.' });
  }
});

router.patch('/brain/offerings/:id', async (req, res) => {
  try {
    const fields = ['offering_code', 'offering_type', 'name', 'category', 'tier', 'status', 'short_description', 'fee', 'duration', 'verified_by', 'last_verified_date'];
    const sets = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) { values.push(field === 'last_verified_date' ? (req.body[field] || null) : req.body[field]); sets.push(`${field} = $${values.length}`); }
    }
    if ('details' in req.body) { values.push(JSON.stringify(req.body.details && typeof req.body.details === 'object' ? req.body.details : {})); sets.push(`details = $${values.length}::jsonb`); }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });
    sets.push('updated_at = NOW()');
    values.push(req.params.id);
    const result = await db.query(`UPDATE alliance_offerings SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'Offering not found.' });
    res.json({ success: true, offering: result.rows[0] });
  } catch (error) {
    console.error('Alliance brain offering update failed:', error);
    res.status(500).json({ error: 'Failed to update offering.' });
  }
});

router.delete('/brain/offerings/:id', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM alliance_offerings WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Offering not found.' });
    res.json({ success: true, message: 'Offering and its FAQs were removed.' });
  } catch (error) {
    console.error('Alliance brain offering delete failed:', error);
    res.status(500).json({ error: 'Failed to delete offering.' });
  }
});

router.get('/brain/offerings/:id/faqs', async (req, res) => {
  try {
    const result = await db.query(`SELECT * FROM alliance_offering_faqs WHERE offering_id = $1 ORDER BY sort_order, id`, [req.params.id]);
    res.json({ faqs: result.rows });
  } catch (error) {
    console.error('Alliance brain faqs list failed:', error);
    res.status(500).json({ error: 'Failed to load FAQs.' });
  }
});

router.post('/brain/offerings/:id/faqs', async (req, res) => {
  try {
    const question = text(req.body.question);
    const answer = text(req.body.answer);
    if (!question || !answer) return res.status(400).json({ error: 'Question and answer are required.' });
    const result = await db.query(
      `INSERT INTO alliance_offering_faqs (offering_id, question, answer, sort_order) VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, question, answer, Number(req.body.sort_order) || 0]
    );
    res.status(201).json({ success: true, faq: result.rows[0] });
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Offering not found.' });
    console.error('Alliance brain faq create failed:', error);
    res.status(500).json({ error: 'Failed to add FAQ.' });
  }
});

router.patch('/brain/faqs/:id', async (req, res) => {
  try {
    const fields = ['question', 'answer', 'sort_order'];
    const sets = [];
    const values = [];
    for (const field of fields) {
      if (field in req.body) { values.push(req.body[field]); sets.push(`${field} = $${values.length}`); }
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update.' });
    values.push(req.params.id);
    const result = await db.query(`UPDATE alliance_offering_faqs SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
    if (!result.rowCount) return res.status(404).json({ error: 'FAQ not found.' });
    res.json({ success: true, faq: result.rows[0] });
  } catch (error) {
    console.error('Alliance brain faq update failed:', error);
    res.status(500).json({ error: 'Failed to update FAQ.' });
  }
});

router.delete('/brain/faqs/:id', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM alliance_offering_faqs WHERE id = $1 RETURNING id`, [req.params.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'FAQ not found.' });
    res.json({ success: true, message: 'FAQ deleted.' });
  } catch (error) {
    console.error('Alliance brain faq delete failed:', error);
    res.status(500).json({ error: 'Failed to delete FAQ.' });
  }
});

module.exports = router;
