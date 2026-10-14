const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const axios = require('axios');
const {
  AllianceAudiences,
  AllianceAudienceFields,
  AllianceKb,
  AllianceObjections,
  AllianceBulkSendLimits,
  AllianceDomains,
  AllianceSequences,
  AllianceTemplates,
  AllianceProspects,
  AllianceProspectTags,
  AllianceContactTags,
  AllianceInboxTags,
  AllianceInboxContacts,
  AllianceInboxConversations,
  AllianceInboxMessages,
  AllianceInboxSettings,
  AllianceCampaigns,
  AllianceCampaignProspects,
  AllianceCampaignTemplates,
  AllianceTouches,
  AllianceReplies,
  AllianceEmailInbound,
  AllianceEmailAttachments,
  AllianceEmailSyncState,
  AllianceEmailEvents,
  AllianceWhatsappCampaigns,
  AllianceWhatsappCampaignRecipients,
  AllianceWhatsappFollowupJobs,
  AllianceSuppression,
  AllianceNumbers,
  AlliancePromptRules,
  AllianceBrands,
  AllianceOfferings,
  AllianceOfferingFaqs,
  Templates,
  MetaWhatsappPhoneNumbers,
} = require('../models');
const { NO_ID, ieq, escapeRegex, upsertOne, insertIgnore } = require('../db/mongo');
const { deleteCascade, updateKeyCascade, assertReferenceExists } = require('../db/cascade');

const DAY_MS = 24 * 60 * 60 * 1000;
const isDuplicateKey = (error) => error && (error.code === 11000 || error.code === '23505');
const SENDER_FIELDS = { _id: 0, id: 1, inbox_email: 1, provider: 1, credential_ref: 1, warmup_stage: 1, daily_cap: 1, sent_today: 1, reputation: 1, status: 1, last_reset: 1, created_at: 1 };

// Active audiences with their active custom fields (json_agg ... ORDER BY sort_order, id)
async function audiencesWithFields(filter, projection = NO_ID, fieldProjection = { _id: 0, id: 1, field_key: 1, label: 1, data_type: 1, required: 1, sample_value: 1, sort_order: 1 }) {
  const audiences = await AllianceAudiences.find(filter, projection).sort({ created_at: 1, id: 1 }).lean();
  const fields = await AllianceAudienceFields.find({ audience_id: { $in: audiences.map((a) => a.id) }, active: true }, { ...fieldProjection, audience_id: 1 })
    .sort({ sort_order: 1, id: 1 }).lean();
  return audiences.map((audience) => ({
    ...audience,
    fields: fields.filter((f) => f.audience_id === audience.id).map(({ audience_id, ...field }) => field),
  }));
}
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

async function getBulkSendLimit(channel) {
  const policy = await AllianceBulkSendLimits.findOne({ channel }, { _id: 0, channel: 1, limit_mode: 1, custom_limit: 1, updated_at: 1 }).lean();
  return policy || { channel, limit_mode: 'unlimited', custom_limit: null };
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
  const [audience] = await audiencesWithFields({ code, active: true }, NO_ID,
    { _id: 0, field_key: 1, label: 1, data_type: 1, required: 1, sample_value: 1, sort_order: 1 });
  if (!audience) return null;
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
    // Current ISO week (Monday 00:00 UTC), like date_trunc('week', NOW())
    const now = new Date();
    const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const previousStart = new Date(weekStart.getTime() - 7 * DAY_MS);
    const weekEnd = new Date(weekStart.getTime() + 7 * DAY_MS);
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + DAY_MS);
    const inRange = (value, from, to) => value != null && new Date(value) >= from && new Date(value) < to;
    const inWeek = (value) => inRange(value, weekStart, weekEnd);
    const SENT_WA = ['sent', 'delivered', 'read'];

    const [touches, waRecipients, replyRows, emailEvents, prospects, audiencesList, emailCampaigns, waCampaigns] = await Promise.all([
      AllianceTouches.find({}, { prospect_id: 1, campaign_id: 1, channel: 1, status: 1, sent_at: 1, scheduled_at: 1 }).lean(),
      AllianceWhatsappCampaignRecipients.find({}, { prospect_id: 1, campaign_id: 1, status: 1, sent_at: 1, scheduled_at: 1 }).lean(),
      AllianceReplies.find({}, { prospect_id: 1, channel: 1, created_at: 1 }).lean(),
      AllianceEmailEvents.find({ event_type: { $in: ['delivered', 'opened', 'clicked'] }, occurred_at: { $gte: weekStart, $lt: weekEnd } }, { prospect_id: 1 }).lean(),
      AllianceProspects.find({}, { id: 1, status: 1, audience: 1, updated_at: 1, created_at: 1, suppressed: 1 }).lean(),
      AllianceAudiences.find({ active: true }, { id: 1, code: 1, label: 1, created_at: 1 }).sort({ created_at: 1, id: 1 }).lean(),
      AllianceCampaigns.find({}, { id: 1, name: 1, audience: 1, channel: 1, status: 1, created_at: 1 }).lean(),
      AllianceWhatsappCampaigns.find({}, { id: 1, name: 1, audience: 1, status: 1, created_at: 1 }).lean(),
    ]);
    const sentTouches = touches.filter((t) => t.status === 'sent' && t.sent_at != null);
    const sentWa = waRecipients.filter((r) => SENT_WA.includes(r.status) && r.sent_at != null);
    const sentTimes = [...sentTouches.map((t) => t.sent_at), ...sentWa.map((r) => r.sent_at)];

    const periodResult = { rows: [{ week_start: weekStart, previous_start: previousStart, week_end: weekEnd }] };
    const sentResult = { rows: [{
      previous: sentTimes.filter((at) => inRange(at, previousStart, weekStart)).length,
      current: sentTimes.filter((at) => inWeek(at)).length,
    }] };
    const replyResult = { rows: [{
      replies: replyRows.filter((r) => inWeek(r.created_at)).length,
      replies_today: replyRows.filter((r) => inRange(r.created_at, dayStart, dayEnd)).length,
    }] };

    const prospectsUpdatedThisWeek = prospects.filter((p) => inWeek(p.updated_at));
    const funnelResult = { rows: [{
      contacted: new Set([
        ...sentTouches.filter((t) => inWeek(t.sent_at)).map((t) => t.prospect_id),
        ...sentWa.filter((r) => inWeek(r.sent_at)).map((r) => r.prospect_id),
      ]).size,
      delivered: new Set([
        ...emailEvents.map((e) => e.prospect_id ?? null),
        ...waRecipients.filter((r) => ['delivered', 'read'].includes(r.status) && inWeek(r.sent_at)).map((r) => r.prospect_id),
      ]).size,
      replied: prospectsUpdatedThisWeek.filter((p) => ['replied', 'interested', 'not_interested'].includes(p.status)).length,
      interested: prospectsUpdatedThisWeek.filter((p) => p.status === 'interested').length,
      closed: prospectsUpdatedThisWeek.filter((p) => ['converted', 'closed'].includes(p.status)).length,
      interested_today: prospects.filter((p) => p.status === 'interested' && inRange(p.updated_at, dayStart, dayEnd)).length,
    }] };

    const channelResult = { rows: ['email', 'whatsapp'].map((channel) => ({
      channel,
      sent: sentTouches.filter((t) => t.channel === channel && inWeek(t.sent_at)).length
        + (channel === 'whatsapp' ? sentWa.filter((r) => inWeek(r.sent_at)).length : 0),
      replied: replyRows.filter((r) => r.channel === channel && inWeek(r.created_at)).length,
    })) };

    const audienceResult = { rows: audiencesList.map((a) => ({
      code: a.code,
      label: a.label,
      interested: prospectsUpdatedThisWeek.filter((p) => p.audience === a.code && p.status === 'interested').length,
    })) };

    const operationsResult = { rows: [{
      total_prospects: prospects.length,
      prospects_added: prospects.filter((p) => inWeek(p.created_at)).length,
      suppressed: prospects.filter((p) => p.suppressed === true).length,
      active_campaigns: emailCampaigns.filter((c) => ['running', 'ready'].includes(c.status)).length
        + waCampaigns.filter((c) => ['running', 'scheduled'].includes(c.status)).length,
      failed_messages: touches.filter((t) => t.status === 'failed' && inWeek(t.sent_at ?? t.scheduled_at)).length
        + waRecipients.filter((r) => r.status === 'failed' && inWeek(r.scheduled_at)).length,
    }] };

    const dayKey = (value) => new Date(value).toISOString().slice(0, 10);
    const dailyResult = { rows: Array.from({ length: 7 }, (_, index) => {
      const day = new Date(weekStart.getTime() + index * DAY_MS);
      const key = dayKey(day);
      return {
        day,
        sent: sentTimes.filter((at) => inWeek(at) && dayKey(at) === key).length,
        replies: replyRows.filter((r) => inWeek(r.created_at) && dayKey(r.created_at) === key).length,
      };
    }) };

    const statusCounts = new Map();
    for (const c of [...emailCampaigns, ...waCampaigns]) statusCounts.set(c.status, (statusCounts.get(c.status) || 0) + 1);
    const campaignStatusResult = { rows: [...statusCounts]
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count || String(a.status).localeCompare(String(b.status))) };

    const prospectStatus = new Map(prospects.map((p) => [p.id, p.status]));
    const recentCampaigns = [
      ...emailCampaigns.map((c) => ({ kind: 'email', c })),
      ...waCampaigns.map((c) => ({ kind: 'whatsapp', c })),
    ].sort((a, b) => new Date(b.c.created_at || 0) - new Date(a.c.created_at || 0)).slice(0, 8);
    const enrollments = await AllianceCampaignProspects.find(
      { campaign_id: { $in: recentCampaigns.filter((r) => r.kind === 'email').map((r) => r.c.id) } },
      { campaign_id: 1, prospect_id: 1 }
    ).lean();
    const campaignPerformanceResult = { rows: recentCampaigns.map(({ kind, c }) => {
      if (kind === 'email') {
        const enrolled = new Set(enrollments.filter((e) => e.campaign_id === c.id).map((e) => e.prospect_id));
        return {
          row_id: `email-${c.id}`, id: c.id, name: c.name, audience: c.audience, channel: c.channel, status: c.status, created_at: c.created_at,
          prospects: enrolled.size,
          sent: touches.filter((t) => t.campaign_id === c.id && t.status === 'sent').length,
          replies: new Set(replyRows.filter((r) => enrolled.has(r.prospect_id)).map((r) => r.prospect_id)).size,
          interested: [...enrolled].filter((id) => prospectStatus.get(id) === 'interested').length,
        };
      }
      const recipients = waRecipients.filter((r) => r.campaign_id === c.id);
      const recipientProspects = new Set(recipients.map((r) => r.prospect_id));
      return {
        row_id: `whatsapp-${c.id}`, id: c.id, name: c.name, audience: c.audience, channel: 'whatsapp', status: c.status, created_at: c.created_at,
        prospects: recipients.length,
        sent: recipients.filter((r) => SENT_WA.includes(r.status)).length,
        replies: new Set(replyRows.filter((r) => r.channel === 'whatsapp' && recipientProspects.has(r.prospect_id)).map((r) => r.prospect_id)).size,
        interested: [...recipientProspects].filter((id) => prospectStatus.get(id) === 'interested').length,
      };
    }) };
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
    const limits = await AllianceBulkSendLimits.find({}, { _id: 0, channel: 1, limit_mode: 1, custom_limit: 1, updated_at: 1 }).sort({ channel: 1 }).lean();
    res.json({ limits });
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
    const limitFields = { limit_mode: mode, custom_limit: mode === 'custom' ? customLimit : null, updated_by: req.user?.id || null, updated_at: new Date() };
    const saved = await upsertOne(AllianceBulkSendLimits, { channel }, { $set: limitFields }, limitFields);
    const limit = { channel: saved.channel, limit_mode: saved.limit_mode, custom_limit: saved.custom_limit, updated_at: saved.updated_at };
    res.json({ success: true, limit, message: `${channel === 'email' ? 'Email' : 'WhatsApp'} bulk-send limit updated.` });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update bulk-send limit.' });
  }
});

router.get('/audiences', async (req, res) => {
  try {
    const audiences = await audiencesWithFields(
      { active: true },
      { _id: 0, id: 1, code: 1, label: 1, brand: 1, default_channel: 1, column_config: 1, active: 1 }
    );
    res.json({ audiences });
  } catch (error) {
    console.error('Alliance audience list failed:', error);
    res.status(500).json({ error: 'Failed to load audience configuration.' });
  }
});

router.get('/email-settings', async (_req, res) => {
  try {
    const senders = await AllianceDomains.find({}, SENDER_FIELDS).sort({ created_at: -1 }).lean();
    res.json({ config: publicAllianceEmailConfig(), senders });
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
    const senderFields = {
      provider: config.provider, credential_ref: 'env:ALLIANCE_EMAIL_SMTP_PASSWORD',
      warmup_stage: warmupStage, daily_cap: dailyCap, status,
    };
    await upsertOne(AllianceDomains, { inbox_email: config.from }, { $set: senderFields }, { ...senderFields, reputation: 'unknown' });
    const sender = await AllianceDomains.findOne({ inbox_email: config.from }, SENDER_FIELDS).lean();
    res.json({ success: true, sender });
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

  let createdAudience = null;
  try {
    createdAudience = (await AllianceAudiences.create({
      code, label, brand: brand || null, default_channel: defaultChannel, column_config: systemColumns,
    })).toObject();
    for (const field of normalizedFields) {
      await AllianceAudienceFields.create({
        audience_id: createdAudience.id, field_key: field.fieldKey, label: field.label, data_type: field.dataType,
        required: field.required, sample_value: field.sampleValue || null, sort_order: field.sortOrder,
      });
    }
    const channelCadences = [
      ...(['email','both'].includes(defaultChannel) ? [{ channel:'email', cadence:[[1,0,'Introduction and one clear ask'],[2,2,'Short friendly reminder'],[3,5,'New angle and proof'],[4,9,'Polite break-up message']] }] : []),
      ...(['whatsapp','both'].includes(defaultChannel) ? [{ channel:'whatsapp', cadence:[[1,0,'Approved introduction template'],[2,4,'One gentle follow-up']] }] : []),
    ];
    for (const { channel, cadence } of channelCadences) {
      for (const [touchNo, delayDays, purpose] of cadence) {
        if (!(await AllianceSequences.exists({ audience: code, channel, touch_no: touchNo }))) {
          await insertIgnore(AllianceSequences, { audience: code, channel, touch_no: touchNo, delay_days: delayDays, purpose });
        }
        if (channel === 'email') {
          const subject = touchNo === 1 ? 'Introduction for {{org}}' : `Follow-up ${touchNo} for {{org}}`;
          const messageType = touchNo === 1 ? 'introduction' : 'follow-up message';
          if (!(await AllianceTemplates.exists({ audience: code, channel: 'email', touch_no: touchNo }))) {
            await insertIgnore(AllianceTemplates, {
              audience: code, channel: 'email', touch_no: touchNo, template_name: `Touch ${touchNo}`, subject,
              body: `Hi {{name}},\n\nAdd your ${messageType} for {{org}} here.\n\nTo stop receiving these, reply "unsubscribe".`,
              provider_status: 'draft', active: true,
            });
          }
        }
      }
    }
    res.status(201).json({ audience: { ...createdAudience, fields: normalizedFields } });
  } catch (error) {
    // Roll back the partially created audience
    if (createdAudience) {
      await AllianceAudienceFields.deleteMany({ audience_id: createdAudience.id }).catch(() => {});
      await AllianceAudiences.deleteOne({ id: createdAudience.id }).catch(() => {});
    }
    if (isDuplicateKey(error)) return res.status(409).json({ error: 'That audience code already exists.' });
    console.error('Alliance audience create failed:', error);
    res.status(500).json({ error: 'Failed to create audience.' });
  }
});

router.post('/prospects/import', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Select a CSV or XLSX file.' });

  const defaultAudience = text(req.body.audience || req.body.type).toLowerCase();
  const requestedChannel = text(req.body.channel || 'auto').toLowerCase();
  if (!CHANNELS.has(requestedChannel)) return res.status(400).json({ error: 'Select a valid channel.' });

  const [audienceConfig] = await audiencesWithFields({ code: defaultAudience, active: true }, NO_ID,
    { _id: 0, field_key: 1, data_type: 1, required: 1 });
  if (!audienceConfig) return res.status(400).json({ error: 'Select a valid audience.' });
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

  const created = { prospects: [], contacts: [], conversations: [], messages: [], campaign: null };
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
    const campaignName = text(req.body.campaign) || `Import ${new Date().toISOString().slice(0, 10)}`;
    const createdCampaign = await AllianceCampaigns.create({
      name: campaignName, audience: defaultAudience, channel: requestedChannel, created_by: req.user?.id || null,
    });
    created.campaign = createdCampaign.id;
    const campaign = { id: createdCampaign.id, name: createdCampaign.name };

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

      const contactMatch = [...(email ? [{ email: ieq(email) }] : []), ...(phone ? [{ phone }] : [])];
      const suppression = contactMatch.length ? await AllianceSuppression.exists({ $or: contactMatch }) : null;
      if (suppression) {
        report.suppressed += 1;
        continue;
      }

      const duplicate = contactMatch.length ? await AllianceProspects.exists({ $or: contactMatch }) : null;
      if (duplicate) {
        report.duplicates += 1;
        continue;
      }

      const createdProspect = await AllianceProspects.create({
        campaign_id: campaign.id, audience, name: name || null, business_name: businessName, phone, email,
        industry: text(valueFrom(row, ['industry'])) || null, location: text(valueFrom(row, ['location'])) || null,
        channel_pref: channelPref || null, channel, consent,
        consent_source: consent ? consentSource : null,
        consent_at: consent ? consentAt : null, consent_evidence: consent ? consentEvidence : null, consent_scope: consent ? consentScope : null,
        source: leadSource, custom_fields: customFields,
      });
      const prospectId = createdProspect.id;
      created.prospects.push(prospectId);
      await insertIgnore(AllianceCampaignProspects, { campaign_id: campaign.id, prospect_id: prospectId });
      const existingContact = phone ? await AllianceInboxContacts.findOne({ phone }).lean() : null;
      let contact;
      if (existingContact) {
        contact = await AllianceInboxContacts.findOneAndUpdate(
          { id: existingContact.id },
          { $set: {
            prospect_id: prospectId,
            wa_id: existingContact.wa_id ?? phone,
            name: name || existingContact.name,
            source: 'file_upload',
            custom_fields: { ...(existingContact.custom_fields || {}), business_name: businessName, audience, email },
            updated_at: new Date(),
          } },
          { new: true, projection: NO_ID }
        ).lean();
      } else {
        contact = (await AllianceInboxContacts.create({
          prospect_id: prospectId, wa_id: phone, phone, name: name || businessName, profile_name: name || businessName,
          source: 'file_upload', custom_fields: { business_name: businessName, audience, email },
        })).toObject();
        created.contacts.push(contact.id);
      }
      const activeSettings = await AllianceInboxSettings.findOne({ active: true }, { phone_number_id: 1 }).sort({ id: 1 }).lean();
      const phoneNumberId = activeSettings?.phone_number_id || process.env.ALLIANCE_WA_PHONE_NUMBER_ID || 'unconfigured';
      const welcomeEligible = Boolean(phone && consent);
      let conversation = await AllianceInboxConversations.findOneAndUpdate(
        { contact_id: contact.id },
        { $set: { phone_number_id: phoneNumberId, updated_at: new Date() } },
        { new: true, projection: NO_ID }
      ).lean();
      if (!conversation) {
        conversation = (await AllianceInboxConversations.create({
          contact_id: contact.id, phone_number_id: phoneNumberId, welcome_status: welcomeEligible ? 'queued' : 'not_eligible',
        })).toObject();
        created.conversations.push(conversation.id);
      }
      if (welcomeEligible) {
        const template = (await AllianceTemplates.find(
          { audience, channel: 'whatsapp', touch_no: 1, active: true, template_name: { $ne: null } },
          { template_name: 1, body: 1, language: 1, provider_status: 1, updated_at: 1 }
        ).sort({ updated_at: -1 }).lean()).find((t) => String(t.provider_status ?? 'approved').toLowerCase() === 'approved');
        if (template) {
          const welcomeMessage = await AllianceInboxMessages.create({
            conversation_id: conversation.id, contact_id: contact.id, direction: 'outbound', msg_type: 'template',
            content: template.body, status: 'queued',
            raw_payload: { purpose: 'welcome', template_name: template.template_name, language: template.language || 'en', prospect_id: prospectId },
          });
          created.messages.push(welcomeMessage.id);
          await AllianceInboxConversations.updateOne({ id: conversation.id }, { $set: { welcome_template_name: template.template_name } });
          report.welcome_queued = (report.welcome_queued || 0) + 1;
        } else {
          await AllianceInboxConversations.updateOne(
            { id: conversation.id },
            { $set: { welcome_status: 'missing_template', welcome_error: 'No approved WhatsApp touch-1 template is configured for this audience.' } }
          );
          report.welcome_missing_template = (report.welcome_missing_template || 0) + 1;
        }
      } else {
        report.welcome_not_eligible = (report.welcome_not_eligible || 0) + 1;
      }
      report.imported += 1;
    }

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
    // Roll back what this import created
    await AllianceInboxMessages.deleteMany({ id: { $in: created.messages } }).catch(() => {});
    await AllianceInboxConversations.deleteMany({ id: { $in: created.conversations } }).catch(() => {});
    await AllianceInboxContacts.deleteMany({ id: { $in: created.contacts } }).catch(() => {});
    if (created.prospects.length) await deleteCascade('alliance_prospects', { id: { $in: created.prospects } }).catch(() => {});
    if (created.campaign) await deleteCascade('alliance_campaigns', { id: created.campaign }).catch(() => {});
    console.error('Alliance prospect import failed:', error);
    res.status(500).json({ error: 'Failed to import AllianceOS prospects.' });
  }
});

// Mongo filter equivalent of the prospect list/export WHERE clauses.
async function buildProspectFilter(query) {
  const and = [];
  if (query.audience) and.push({ audience: query.audience });
  const campaignName = text(query.campaign_name);
  if (campaignName) {
    const campaignIds = await AllianceCampaigns.distinct('id', { name: campaignName });
    const enrolledIds = await AllianceCampaignProspects.distinct('prospect_id', { campaign_id: { $in: campaignIds } });
    and.push({ $or: [{ campaign_id: { $in: campaignIds } }, { id: { $in: enrolledIds } }] });
  }
  if (query.status) and.push({ status: query.status });
  if (query.channel && ['email', 'whatsapp'].includes(query.channel)) and.push({ channel: { $in: [query.channel, 'both'] } });
  if (query.tag) {
    const tagged = await AllianceProspectTags.distinct('prospect_id', { tag_id: query.tag });
    const contactIds = await AllianceContactTags.distinct('contact_id', { tag_id: query.tag });
    const viaContacts = await AllianceInboxContacts.distinct('prospect_id', { id: { $in: contactIds } });
    and.push({ id: { $in: [...tagged, ...viaContacts] } });
  }
  if (query.search) {
    const search = String(query.search);
    const pattern = new RegExp(escapeRegex(search), 'i');
    const digits = search.replace(/[^0-9]/g, '');
    const or = [{ business_name: pattern }, { name: pattern }, { email: pattern }];
    if (digits) or.push({ phone: new RegExp(digits.split('').join('\\D*')) });
    and.push({ $or: or });
  }
  // created_at compared as an Asia/Kolkata calendar date
  if (query.dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(query.dateFrom)) {
    and.push({ created_at: { $gte: new Date(`${query.dateFrom}T00:00:00+05:30`) } });
  }
  if (query.dateTo && /^\d{4}-\d{2}-\d{2}$/.test(query.dateTo)) {
    and.push({ created_at: { $lt: new Date(new Date(`${query.dateTo}T00:00:00+05:30`).getTime() + DAY_MS) } });
  }
  return and.length ? { $and: and } : {};
}

const PROSPECT_LIST_FIELDS = {
  _id: 0, id: 1, name: 1, business_name: 1, location: 1, industry: 1, audience: 1, channel: 1, status: 1, current_touch: 1,
  ai_score: 1, email: 1, phone: 1, source: 1, consent: 1, consent_source: 1, custom_fields: 1, updated_at: 1, campaign_id: 1, created_at: 1,
};

// Adds campaign_name (linked campaign names) and tags (prospect + inbox-contact tags) to each prospect.
async function enrichProspects(prospects) {
  const ids = prospects.map((p) => p.id);
  const enrollments = await AllianceCampaignProspects.find({ prospect_id: { $in: ids } }, { campaign_id: 1, prospect_id: 1 }).lean();
  const campaignIds = [...new Set([...prospects.map((p) => p.campaign_id), ...enrollments.map((e) => e.campaign_id)].filter((id) => id != null))];
  const campaignNames = new Map((await AllianceCampaigns.find({ id: { $in: campaignIds } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
  const prospectTags = await AllianceProspectTags.find({ prospect_id: { $in: ids } }, { prospect_id: 1, tag_id: 1 }).lean();
  const contacts = await AllianceInboxContacts.find({ prospect_id: { $in: ids } }, { id: 1, prospect_id: 1 }).lean();
  const contactTags = await AllianceContactTags.find({ contact_id: { $in: contacts.map((c) => c.id) } }, { contact_id: 1, tag_id: 1 }).lean();
  const contactProspect = new Map(contacts.map((c) => [c.id, c.prospect_id]));
  const tagIds = [...new Set([...prospectTags.map((t) => t.tag_id), ...contactTags.map((t) => t.tag_id)])];
  const tags = new Map((await AllianceInboxTags.find({ id: { $in: tagIds } }, { id: 1, name: 1, color: 1 }).lean()).map((t) => [t.id, t]));
  return prospects.map((p) => {
    const names = new Set();
    if (p.campaign_id != null && campaignNames.has(p.campaign_id)) names.add(campaignNames.get(p.campaign_id));
    enrollments.filter((e) => e.prospect_id === p.id && campaignNames.has(e.campaign_id)).forEach((e) => names.add(campaignNames.get(e.campaign_id)));
    const ownTagIds = new Set([
      ...prospectTags.filter((t) => t.prospect_id === p.id).map((t) => t.tag_id),
      ...contactTags.filter((t) => contactProspect.get(t.contact_id) === p.id).map((t) => t.tag_id),
    ]);
    return {
      ...p,
      campaign_name: names.size ? [...names].sort().join(', ') : null,
      tags: [...ownTagIds].filter((id) => tags.has(id)).map((id) => ({ id, name: tags.get(id).name, color: tags.get(id).color })),
    };
  });
}

router.get('/prospects', async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  try {
    const filter = await buildProspectFilter(req.query);
    const total = await AllianceProspects.countDocuments(filter);
    const prospects = await enrichProspects(
      await AllianceProspects.find(filter, PROSPECT_LIST_FIELDS).sort({ created_at: -1 }).skip(offset).limit(limit).lean()
    );
    res.json({ prospects, count: prospects.length, total, limit, offset });
  } catch (error) {
    console.error('Alliance prospect list failed:', error);
    res.status(500).json({ error: 'Failed to load AllianceOS prospects.' });
  }
});

router.get('/prospects/export', async (req, res) => {
  try {
    const filter = await buildProspectFilter(req.query);
    const result = { rows: await enrichProspects(
      await AllianceProspects.find(filter, PROSPECT_LIST_FIELDS).sort({ created_at: -1 }).lean()
    ) };

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
  try {
    if (newCode !== code) {
      const duplicate = await AllianceAudiences.exists({ code: newCode });
      if (duplicate) throw Object.assign(new Error('That audience code already exists.'), { status: 409 });
    }
    for (const field of normalizedFields) {
      if (field.originalFieldKey !== field.fieldKey && !/^[a-z][a-z0-9_]*$/.test(field.originalFieldKey)) {
        throw Object.assign(new Error(`Invalid original field key: ${field.originalFieldKey}`), { status: 400 });
      }
    }
    const updatedAudience = await AllianceAudiences.findOneAndUpdate(
      { code, active: true },
      { $set: { code: newCode, label, brand: brand || null, default_channel: defaultChannel, column_config: systemColumns, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    if (!updatedAudience) return res.status(404).json({ error: 'Audience not found.' });
    const audienceId = updatedAudience.id;
    if (newCode !== code) {
      for (const model of [AllianceProspects, AllianceCampaigns, AllianceSequences, AllianceTemplates, AllianceKb, AllianceObjections, AllianceWhatsappCampaigns]) {
        await model.updateMany({ audience: code }, { $set: { audience: newCode } });
      }
      // ON UPDATE CASCADE (alliance_brands.audience, alliance_prompt_rules.audience)
      await updateKeyCascade('alliance_audiences', 'code', code, newCode);
    }
    for (const field of normalizedFields) {
      if (field.originalFieldKey === field.fieldKey) continue;
      const affected = await AllianceProspects.find(
        { audience: newCode, [`custom_fields.${field.originalFieldKey}`]: { $exists: true } },
        { id: 1, custom_fields: 1 }
      ).lean();
      for (const prospect of affected) {
        const { [field.originalFieldKey]: oldValue, ...rest } = prospect.custom_fields || {};
        const nextFields = { ...rest, [field.fieldKey]: rest[field.fieldKey] ?? oldValue ?? null };
        await AllianceProspects.updateOne({ id: prospect.id }, { $set: { custom_fields: nextFields, updated_at: new Date() } });
      }
    }
    await AllianceAudienceFields.updateMany({ audience_id: audienceId }, { $set: { active: false } });
    for (const field of normalizedFields) {
      const fieldValues = {
        label: field.label, data_type: field.dataType, required: field.required,
        sample_value: field.sampleValue, sort_order: field.sortOrder, active: true,
      };
      await upsertOne(AllianceAudienceFields, { audience_id: audienceId, field_key: field.fieldKey }, { $set: fieldValues }, fieldValues);
    }
    res.json({ success: true, audience: { ...updatedAudience, fields: normalizedFields }, message: newCode === code ? 'Audience configuration updated.' : `Audience renamed to ${newCode}.` });
  } catch (error) {
    console.error('Alliance audience update failed:', error);
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Failed to update audience configuration.' });
  }
});

router.delete('/audiences/:code', async (req, res) => {
  const code = text(req.params.code).toLowerCase();
  try {
    const audience = await AllianceAudiences.findOne({ code, active: true }, { id: 1, label: 1 }).lean();
    if (!audience) return res.status(404).json({ error: 'Audience not found.' });
    const usage = {
      prospects: await AllianceProspects.countDocuments({ audience: code }),
      campaigns: await AllianceCampaigns.countDocuments({ audience: code }),
    };
    if (usage.prospects || usage.campaigns) {
      return res.status(409).json({ error: `This audience is used by ${usage.prospects} prospect(s) and ${usage.campaigns} campaign(s). Remove those records before deleting the audience.` });
    }
    await AllianceSequences.deleteMany({ audience: code });
    await AllianceTemplates.deleteMany({ audience: code });
    await deleteCascade('alliance_audiences', { id: audience.id });
    res.json({ success: true, message: `Audience "${audience.label}" deleted.` });
  } catch (error) {
    console.error('Alliance audience delete failed:', error);
    res.status(500).json({ error: 'Failed to delete audience.' });
  }
});

router.post('/prospects/repair-imported-names', async (req, res) => {
  try {
    const result = { rows: await AllianceProspects.find({}, { _id: 0, id: 1, name: 1, business_name: 1, industry: 1, location: 1, source: 1 }).sort({ id: 1 }).lean() };
    result.rowCount = result.rows.length;
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

      await AllianceProspects.updateOne(
        { id: prospect.id },
        { $set: { business_name: businessName, name, industry, location, source, updated_at: new Date() } }
      );
      repairedIds.push(prospect.id);
      repaired += 1;
      if (encodingChanged) encodingRepairs += 1;
    }

    if (repairedIds.length) {
      const repairedProspects = new Map((await AllianceProspects.find({ id: { $in: repairedIds } }, { id: 1, name: 1, business_name: 1 }).lean())
        .map((p) => [p.id, p]));
      const contacts = await AllianceInboxContacts.find({ prospect_id: { $in: repairedIds }, source: 'file_upload' }, { id: 1, prospect_id: 1, custom_fields: 1 }).lean();
      for (const contact of contacts) {
        const p = repairedProspects.get(contact.prospect_id);
        if (!p) continue;
        await AllianceInboxContacts.updateOne({ id: contact.id }, { $set: {
          name: p.name ?? p.business_name ?? null,
          profile_name: p.name ?? p.business_name ?? null,
          custom_fields: { ...(contact.custom_fields || {}), business_name: p.business_name ?? null },
          updated_at: new Date(),
        } });
      }
    }

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
    console.error('Alliance prospect name repair failed:', error);
    res.status(500).json({ error: 'Failed to repair imported prospect names.' });
  }
});

router.post('/prospects', async (req, res) => {
  try {
    const audience = text(req.body.audience).toLowerCase();
    const [config] = await audiencesWithFields({ code: audience, active: true }, { _id: 0, id: 1, default_channel: 1 },
      { _id: 0, field_key: 1, data_type: 1, required: 1 });
    if (!config) return res.status(400).json({ error: 'Select a valid audience.' });
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

    const contactMatch = [...(email ? [{ email: ieq(email) }] : []), ...(phone ? [{ phone }] : [])];
    const suppression = contactMatch.length ? await AllianceSuppression.exists({ $or: contactMatch }) : null;
    if (suppression) return res.status(409).json({ error: 'This contact is on the do-not-contact list.' });

    const prospect = (await AllianceProspects.create({
      audience, name: text(req.body.name) || null, business_name: businessName, phone, email,
      industry: text(req.body.industry) || null, location: text(req.body.location) || null, channel_pref: channel,
      channel, consent, consent_source: consent ? consentSource : null, consent_at: consent ? new Date() : null,
      source: text(req.body.source) || 'manual_entry', custom_fields: customFields,
    })).toObject();
    req.app.get('io')?.emit('alliance_contacts_changed', { prospect_id: prospect.id, created: 1 });
    res.status(201).json({ success: true, prospect });
  } catch (error) {
    if (isDuplicateKey(error)) return res.status(409).json({ error: 'Another prospect already uses this email or phone.' });
    console.error('Alliance prospect create failed:', error);
    res.status(500).json({ error: 'Failed to create prospect.' });
  }
});

router.patch('/prospects/:id', async (req, res) => {
  try {
    const existing = await AllianceProspects.findOne({ id: req.params.id }, NO_ID).lean();
    if (!existing) return res.status(404).json({ error: 'Prospect not found.' });
    const audience = text(req.body.audience ?? existing.audience).toLowerCase();
    const audienceExists = await AllianceAudiences.exists({ code: audience, active: true });
    if (!audienceExists) return res.status(400).json({ error: 'Select a valid audience.' });
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

    const prospect = await AllianceProspects.findOneAndUpdate(
      { id: req.params.id },
      { $set: {
        audience, name: text(req.body.name ?? existing.name) || null, business_name: businessName, email, phone,
        industry: text(req.body.industry ?? existing.industry) || null, location: text(req.body.location ?? existing.location) || null,
        source: text(req.body.source ?? existing.source) || 'manual_edit', channel, channel_pref: channel, consent: Boolean(consent),
        consent_source: consent ? consentSource : null,
        consent_at: consent ? (existing.consent_at ?? new Date()) : null,
        custom_fields: req.body.custom_fields && typeof req.body.custom_fields === 'object' ? req.body.custom_fields : existing.custom_fields,
        updated_at: new Date(),
      } },
      { new: true, projection: NO_ID }
    ).lean();
    res.json({ prospect });
  } catch (error) {
    if (isDuplicateKey(error)) return res.status(409).json({ error: 'Another prospect already uses this email or phone.' });
    console.error('Alliance prospect update failed:', error);
    res.status(500).json({ error: 'Failed to update prospect.' });
  }
});

router.delete('/prospects/:id', async (req, res) => {
  try {
    const [deleted] = await deleteCascade('alliance_prospects', { id: req.params.id });
    if (!deleted) return res.status(404).json({ error: 'Prospect not found.' });
    res.json({ success: true, deleted: { id: deleted.id, business_name: deleted.business_name } });
  } catch (error) {
    console.error('Alliance prospect delete failed:', error);
    res.status(500).json({ error: 'Failed to delete prospect.' });
  }
});

router.post('/prospects/bulk-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'No prospect IDs provided.' });
    const deleted = await deleteCascade('alliance_prospects', { id: { $in: ids.map(Number).filter(Number.isFinite) } });
    res.json({ success: true, deleted: deleted.length });
  } catch (error) {
    console.error('Alliance bulk delete failed:', error);
    res.status(500).json({ error: 'Failed to delete prospects.' });
  }
});

router.post('/prospects/:id/tags', async (req, res) => {
  try {
    const { tagId } = req.body;
    if (!tagId) return res.status(400).json({ error: 'tagId is required' });
    await assertReferenceExists('alliance_prospects', 'id', Number(req.params.id), 'alliance_prospect_tags');
    await assertReferenceExists('alliance_inbox_tags', 'id', Number(tagId), 'alliance_prospect_tags');
    await insertIgnore(AllianceProspectTags, { prospect_id: req.params.id, tag_id: tagId, created_at: new Date() });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to assign tag' });
  }
});

router.delete('/prospects/:id/tags/:tagId', async (req, res) => {
  try {
    await AllianceProspectTags.deleteMany({ prospect_id: req.params.id, tag_id: req.params.tagId });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove tag' });
  }
});

const OPEN_PROSPECT_STATUS = { $nin: ['converted', 'closed', 'not_interested', 'unsubscribed', null] };

// Prospects eligible for an email campaign, narrowed by the campaign-builder filters.
function campaignProspectFilter(query) {
  const filter = { email: { $ne: null }, suppressed: false, status: OPEN_PROSPECT_STATUS };
  const and = [];
  if (query.audience) filter.audience = text(query.audience).toLowerCase();
  if (query.industry) filter.industry = text(query.industry);
  if (query.status) and.push({ status: text(query.status) });
  if (query.source) filter.source = text(query.source);
  if (query.location) filter.location = text(query.location);
  const dateFrom = text(query.dateFrom);
  const dateTo = text(query.dateTo);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) and.push({ created_at: { $gte: new Date(`${dateFrom}T00:00:00+05:30`) } });
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) and.push({ created_at: { $lt: new Date(new Date(`${dateTo}T00:00:00+05:30`).getTime() + DAY_MS) } });
  if (query.tag) filter.tags = text(query.tag);
  if (query.search) {
    const pattern = new RegExp(escapeRegex(text(query.search)), 'i');
    and.push({ $or: [{ name: pattern }, { business_name: pattern }, { email: pattern }] });
  }
  if (and.length) filter.$and = and;
  return filter;
}

router.get('/campaign-builder/options', async (req, res) => {
  try {
    const audience = text(req.query.audience).toLowerCase();
    const facetFilter = { email: { $ne: null }, suppressed: false, status: OPEN_PROSPECT_STATUS, ...(audience ? { audience } : {}) };
    const facetValues = async (field) => (await AllianceProspects.distinct(field, facetFilter))
      .filter((value) => value != null && String(value).trim() !== '')
      .sort((a, b) => String(a).localeCompare(String(b)));
    const [audiences, industries, statuses, sources, locations, senders] = await Promise.all([
      AllianceAudiences.find({ active: true }, { _id: 0, code: 1, label: 1, brand: 1 }).sort({ label: 1 }).lean(),
      facetValues('industry'),
      facetValues('status'),
      facetValues('source'),
      facetValues('location'),
      AllianceDomains.find({ status: 'active' }, { _id: 0, id: 1, inbox_email: 1, provider: 1, daily_cap: 1, sent_today: 1, status: 1 }).sort({ inbox_email: 1 }).lean(),
    ]);
    res.json({ audiences, industries, statuses, sources, locations, senders });
  } catch (error) {
    console.error('Alliance campaign options failed:', error);
    res.status(500).json({ error: 'Failed to load campaign builder options.' });
  }
});

router.get('/replies', async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 100);
    const search = text(req.query.search).toLowerCase();
    const replyStatus = text(req.query.reply_status);
    // Email replies matching the reply-level filters (LEFT JOIN alliance_email_inbound)
    const emailReplies = await AllianceReplies.find(
      { channel: 'email', ...(replyStatus ? { $or: [{ status: replyStatus }, { ai_intent: replyStatus }] } : {}) },
      { prospect_id: 1, email_inbound_id: 1, status: 1, ai_intent: 1, created_at: 1 }
    ).lean();
    const inboundById = new Map((await AllianceEmailInbound.find(
      { id: { $in: emailReplies.map((r) => r.email_inbound_id).filter((id) => id != null) } },
      { id: 1, campaign_id: 1, received_at: 1, subject: 1 }
    ).lean()).map((ei) => [ei.id, ei]));
    const dateFrom = req.query.date_from ? new Date(`${req.query.date_from}T00:00:00Z`) : null;
    const dateTo = req.query.date_to ? new Date(new Date(`${req.query.date_to}T00:00:00Z`).getTime() + DAY_MS) : null;
    const matchingProspectIds = new Set(emailReplies.filter((r) => {
      const ei = inboundById.get(r.email_inbound_id);
      if (req.query.campaign && ei?.campaign_id !== Number(req.query.campaign)) return false;
      if (dateFrom && !(ei?.received_at && new Date(ei.received_at) >= dateFrom)) return false;
      if (dateTo && !(ei?.received_at && new Date(ei.received_at) < dateTo)) return false;
      return true;
    }).map((r) => r.prospect_id));
    const prospectFilter = { id: { $in: [...matchingProspectIds] } };
    if (req.query.audience) prospectFilter.audience = text(req.query.audience);
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      prospectFilter.$or = [{ name: pattern }, { business_name: pattern }, { email: pattern }, { phone: pattern }];
    }
    const matchingProspects = await AllianceProspects.find(prospectFilter, { id: 1, name: 1, business_name: 1, email: 1, phone: 1, audience: 1, status: 1 }).lean();
    const audienceInfo = new Map((await AllianceAudiences.find({}, { code: 1, label: 1, brand: 1 }).lean()).map((a) => [a.code, a]));
    const lastSent = new Map((await AllianceTouches.aggregate([
      { $match: { prospect_id: { $in: matchingProspects.map((p) => p.id) }, channel: 'email', status: 'sent' } },
      { $group: { _id: '$prospect_id', last: { $max: '$sent_at' } } },
    ])).map((row) => [row._id, row.last]));
    const allEmailReplies = await AllianceReplies.find({ channel: 'email', prospect_id: { $in: matchingProspects.map((p) => p.id) } }, { prospect_id: 1, email_inbound_id: 1, status: 1, ai_intent: 1, created_at: 1 }).lean();
    const allInbound = new Map((await AllianceEmailInbound.find(
      { id: { $in: allEmailReplies.map((r) => r.email_inbound_id).filter((id) => id != null) } },
      { id: 1, received_at: 1, subject: 1 }
    ).lean()).map((ei) => [ei.id, ei]));
    const epoch = new Date(0);
    const conversations = matchingProspects.map((p) => {
      const latest = allEmailReplies.filter((r) => r.prospect_id === p.id)
        .map((r) => ({ r, ei: allInbound.get(r.email_inbound_id) }))
        .sort((a, b) => new Date(b.ei?.received_at ?? b.r.created_at ?? 0) - new Date(a.ei?.received_at ?? a.r.created_at ?? 0))[0];
      const lastReply = latest?.ei?.received_at ?? null;
      const lastEmailSent = lastSent.get(p.id) ?? null;
      const audience = audienceInfo.get(p.audience);
      return {
        prospect_id: p.id, name: p.name, business_name: p.business_name, email: p.email, phone: p.phone, audience: p.audience,
        lead_status: p.status, audience_label: audience?.label ?? null, brand: audience?.brand ?? null,
        reply_status: latest?.r.status ?? null, ai_intent: latest?.r.ai_intent ?? null,
        last_reply_received: lastReply, last_subject: latest?.ei?.subject ?? null,
        last_email_sent: lastEmailSent,
        last_activity: new Date(Math.max((lastReply ? new Date(lastReply) : epoch).getTime(), (lastEmailSent ? new Date(lastEmailSent) : epoch).getTime())),
      };
    }).sort((a, b) => b.last_activity - a.last_activity || b.prospect_id - a.prospect_id);
    const total = conversations.length;
    const pageRows = conversations.slice((page - 1) * limit, page * limit);
    const replyCampaignIds = await AllianceEmailInbound.distinct('campaign_id', { campaign_id: { $ne: null } });
    const [sync, campaigns, audiences] = await Promise.all([
      AllianceEmailSyncState.findOne({}, { _id: 0, mailbox: 1, last_checked_at: 1, last_success_at: 1, last_error: 1 }).sort({ updated_at: -1 }).lean(),
      AllianceCampaigns.find({ id: { $in: replyCampaignIds } }, { _id: 0, id: 1, name: 1 }).sort({ name: 1 }).lean(),
      AllianceAudiences.find({ active: true }, { _id: 0, code: 1, label: 1 }).sort({ label: 1 }).lean(),
    ]);
    res.json({ conversations: pageRows, total, page, limit, sync: sync || null,
      filters: { campaigns, audiences, statuses: ['new','drafted','sent','interested','question','objection','not_interested','other'] } });
  } catch (error) {
    console.error('Alliance email replies failed:', error);
    res.status(500).json({ error: 'Failed to load Alliance email replies.' });
  }
});

router.get('/reply-conversations/:prospectId', async (req, res) => {
  try {
    const prospectRow = await AllianceProspects.findOne(
      { id: req.params.prospectId },
      { _id: 0, id: 1, name: 1, business_name: 1, email: 1, phone: 1, audience: 1, status: 1 }
    ).lean();
    if (!prospectRow) return res.status(404).json({ error: 'Lead not found.' });
    const prospectAudience = prospectRow.audience ? await AllianceAudiences.findOne({ code: prospectRow.audience }, { label: 1, brand: 1 }).lean() : null;
    const prospect = { ...prospectRow, audience_label: prospectAudience?.label ?? null, brand: prospectAudience?.brand ?? null };
    const prospectId = prospectRow.id;

    const touches = await AllianceTouches.find({ prospect_id: prospectId, channel: 'email', sent_at: { $ne: null } }).lean();
    const inboundRows = await AllianceEmailInbound.find({ prospect_id: prospectId }).lean();
    const approvedReplies = await AllianceReplies.find({ prospect_id: prospectId, channel: 'email', status: 'sent', approved_at: { $ne: null } }).lean();
    const repliesByInbound = new Map((await AllianceReplies.find({ email_inbound_id: { $in: inboundRows.map((ei) => ei.id) } }).lean()).map((r) => [r.email_inbound_id, r]));
    const approvedInbound = new Map((await AllianceEmailInbound.find({ id: { $in: approvedReplies.map((r) => r.email_inbound_id) } }).lean()).map((ei) => [ei.id, ei]));
    const campaignIds = [...touches.map((t) => t.campaign_id), ...inboundRows.map((ei) => ei.campaign_id), ...[...approvedInbound.values()].map((ei) => ei.campaign_id)];
    const campaignNames = new Map((await AllianceCampaigns.find({ id: { $in: campaignIds.filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const events = await AllianceEmailEvents.find({ touch_id: { $in: touches.map((t) => t.id) } }, { touch_id: 1, event_type: 1 }).lean();
    const attachments = await AllianceEmailAttachments.find(
      { inbound_id: { $in: inboundRows.map((ei) => ei.id) } },
      { id: 1, inbound_id: 1, filename: 1, content_type: 1, size_bytes: 1, attachment_index: 1 }
    ).sort({ attachment_index: 1 }).lean();

    const sent = touches.map((t) => ({
      direction: 'outbound', message_type: 'campaign', id: t.id, subject: t.subject, body: t.message_body, occurred_at: t.sent_at,
      status: t.status, provider_message_id: t.provider_message_id, touch_no: t.touch_no, campaign_name: campaignNames.get(t.campaign_id) ?? null,
      events: [...new Set(events.filter((e) => e.touch_id === t.id).map((e) => e.event_type))].sort(),
    }));
    const inbound = inboundRows.map((ei) => {
      const r = repliesByInbound.get(ei.id);
      return {
        direction: 'inbound', message_type: 'reply', id: ei.id, subject: ei.subject, body: r?.body ?? ei.text_body ?? null,
        occurred_at: ei.received_at, status: r?.status ?? ei.processing_status, provider_message_id: ei.message_id,
        campaign_id: ei.campaign_id ?? null, campaign_name: campaignNames.get(ei.campaign_id) ?? null,
        reply_id: r?.id ?? null, ai_intent: r?.ai_intent ?? null, ai_draft: r?.ai_draft ?? null,
        attachments: attachments.filter((a) => a.inbound_id === ei.id)
          .map((a) => ({ id: a.id, filename: a.filename, content_type: a.content_type, size_bytes: a.size_bytes })),
      };
    });
    const approved = approvedReplies.filter((r) => approvedInbound.has(r.email_inbound_id)).map((r) => {
      const ei = approvedInbound.get(r.email_inbound_id);
      return {
        direction: 'outbound', message_type: 'approved_reply', id: r.id,
        subject: /^re:/i.test(ei.subject || '') ? ei.subject : `Re: ${ei.subject ?? 'Your reply'}`,
        body: r.ai_draft, occurred_at: r.approved_at, status: r.status, provider_message_id: null,
        campaign_id: ei.campaign_id ?? null, campaign_name: campaignNames.get(ei.campaign_id) ?? null, events: ['sent'],
      };
    });
    const messages = [...sent, ...inbound, ...approved].sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    res.json({ prospect, messages });
  } catch (error) {
    console.error('Alliance conversation failed:', error);
    res.status(500).json({ error: 'Failed to load email conversation.' });
  }
});

router.get('/reply-attachments/:id', async (req, res) => {
  try {
    const attachment = await AllianceEmailAttachments.findOne({ id: req.params.id }, { filename: 1, content_type: 1, content: 1 }).lean();
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });
    res.setHeader('Content-Type', attachment.content_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${String(attachment.filename).replace(/["\r\n]/g, '_')}"`);
    res.send(Buffer.isBuffer(attachment.content) ? attachment.content : Buffer.from(attachment.content?.buffer ?? attachment.content ?? []));
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
    const replyRow = await AllianceReplies.findOne({ id: req.params.id }, { id: 1, status: 1, prospect_id: 1, email_inbound_id: 1 }).lean();
    const replyProspect = replyRow ? await AllianceProspects.findOne({ id: replyRow.prospect_id }, { email: 1, name: 1, business_name: 1 }).lean() : null;
    const replyInbound = replyRow?.email_inbound_id != null
      ? await AllianceEmailInbound.findOne({ id: replyRow.email_inbound_id }, { message_id: 1, message_references: 1, subject: 1, campaign_id: 1 }).lean()
      : null;
    const replyCampaign = replyInbound?.campaign_id != null ? await AllianceCampaigns.findOne({ id: replyInbound.campaign_id }, { sender_domain_id: 1 }).lean() : null;
    const replyDomain = replyCampaign?.sender_domain_id != null ? await AllianceDomains.findOne({ id: replyCampaign.sender_domain_id }).lean() : null;
    if (!replyRow || !replyProspect || !replyInbound || !replyCampaign || !replyDomain) return res.status(404).json({ error: 'Reply record not found.' });
    const reply = {
      id: replyRow.id, status: replyRow.status, prospect_id: replyRow.prospect_id,
      email: replyProspect.email, name: replyProspect.name, business_name: replyProspect.business_name,
      message_id: replyInbound.message_id, message_references: replyInbound.message_references, subject: replyInbound.subject,
      campaign_id: replyInbound.campaign_id, sender_domain_id: replyCampaign.sender_domain_id,
      inbox_email: replyDomain.inbox_email, sender_status: replyDomain.status, sent_today: replyDomain.sent_today, daily_cap: replyDomain.daily_cap,
    };
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
    await AllianceReplies.updateOne(
      { id: reply.id },
      { $set: { ai_draft: body, status: 'sent', approved_by: req.user?.id || null, approved_at: new Date() } }
    );
    await AllianceEmailEvents.create({
      campaign_id: reply.campaign_id, prospect_id: reply.prospect_id, provider_message_id: sent.messageId || null, event_type: 'reply_sent',
      event_payload: JSON.parse(JSON.stringify({ recipient: reply.email, accepted: sent.accepted, rejected: sent.rejected, response: sent.response, reply_id: reply.id })),
    });
    await AllianceDomains.updateOne({ id: reply.sender_domain_id }, { $inc: { sent_today: 1 } });
    res.json({ success: true, message: `Reply submitted to Zoho for ${reply.email}.`, provider_message_id: sent.messageId || null });
  } catch (error) {
    console.error('Alliance approved email reply failed:', error.response || error.message);
    res.status(502).json({ error: error.response || error.message || 'Failed to send approved reply.' });
  }
});

router.get('/campaign-builder/prospects', async (req, res) => {
  try {
    const filter = campaignProspectFilter(req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 5000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const total = await AllianceProspects.countDocuments(filter);
    const prospects = await AllianceProspects.find(filter, {
      _id: 0, id: 1, name: 1, business_name: 1, email: 1, phone: 1, audience: 1, industry: 1, location: 1, status: 1, source: 1,
      channel: 1, channel_pref: 1, consent: 1, consent_source: 1, custom_fields: 1, tags: 1, ai_score: 1, created_at: 1,
    }).sort({ created_at: -1 }).skip(offset).limit(limit).lean();
    res.json({ prospects, total, limit, offset });
  } catch (error) {
    console.error('Alliance campaign prospect selection failed:', error);
    res.status(500).json({ error: 'Failed to load eligible email prospects.' });
  }
});

async function baseEmailSequence(audience) {
  const sequences = await AllianceSequences.find({ audience, channel: 'email', active: true }, { touch_no: 1, delay_days: 1, purpose: 1 }).sort({ touch_no: 1 }).lean();
  const templates = await AllianceTemplates.find({ audience, channel: 'email', active: true }, { touch_no: 1, subject: 1, body: 1 }).lean();
  return sequences.flatMap((s) => templates.filter((t) => t.touch_no === s.touch_no)
    .map((t) => ({ touch_no: s.touch_no, delay_days: s.delay_days, purpose: s.purpose, subject: t.subject, body: t.body })));
}

router.get('/campaign-builder/templates', async (req, res) => {
  try {
    const audience = text(req.query.audience).toLowerCase();
    const audienceRow = await AllianceAudiences.findOne({ code: audience, active: true }, { _id: 0, code: 1, label: 1, brand: 1 }).lean();
    if (!audienceRow) return res.status(400).json({ error: 'Select a valid audience.' });
    res.json({ audience: audienceRow, templates: await baseEmailSequence(audience), ai_configured: openRouter.isConfigured });
  } catch (error) {
    res.status(500).json({ error: 'Failed to load email sequence templates.' });
  }
});

router.post('/campaign-builder/ai-suggestion', async (req, res) => {
  try {
    const audience = text(req.body.audience).toLowerCase();
    const objective = text(req.body.objective);
    const requestedTouchNo = Math.max(1, Number(req.body.touch_no) || 1);
    const audienceRow = await AllianceAudiences.findOne({ code: audience, active: true }, { _id: 0, code: 1, label: 1, brand: 1 }).lean();
    if (!audienceRow) return res.status(400).json({ error: 'Select a valid audience.' });
    const audienceResult = { rows: [audienceRow] };
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
  try {
    const template = await AllianceTemplates.findOneAndUpdate(
      { audience, channel: 'email', touch_no: touchNo, active: true },
      { $set: { subject, body, updated_at: new Date() } },
      { new: true, projection: NO_ID }
    ).lean();
    if (!template) throw Object.assign(new Error(`Touch ${touchNo} is not configured for this audience.`), { status: 404 });
    await AllianceSequences.updateMany(
      { audience, channel: 'email', touch_no: touchNo, active: true },
      { $set: { delay_days: delayDays, ...(purpose ? { purpose } : {}) } }
    );
    res.json({ success: true, template, message: `Touch ${touchNo} saved as the default template.` });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to save email template.' });
  }
});

router.post('/campaign-builder/templates', async (req, res) => {
  const audience = text(req.body.audience).toLowerCase();
  if (!audience) return res.status(400).json({ error: 'Select a target audience first.' });
  let createdSequence = null;
  try {
    const audienceRow = await AllianceAudiences.exists({ code: audience, active: true });
    if (!audienceRow) throw Object.assign(new Error('Select a valid target audience.'), { status: 400 });
    const lastTouch = await AllianceSequences.findOne({ audience, channel: 'email' }, { touch_no: 1 }).sort({ touch_no: -1 }).lean();
    const touchNo = Number(lastTouch?.touch_no || 0) + 1;
    if (touchNo > 10) throw Object.assign(new Error('A maximum of 10 email touches is supported.'), { status: 400 });
    const lastDelay = await AllianceSequences.findOne({ audience, channel: 'email', active: true }, { delay_days: 1 }).sort({ delay_days: -1 }).lean();
    const delayDays = Math.min(Number(lastDelay?.delay_days ?? -2) + 2, 30);
    createdSequence = await AllianceSequences.create({ audience, channel: 'email', touch_no: touchNo, delay_days: delayDays, purpose: `Follow-up touch ${touchNo}`, active: true });
    await AllianceTemplates.create({
      audience, channel: 'email', touch_no: touchNo, subject: `Follow-up for {{org}}`,
      body: `Hi {{name}},\n\nAdd your message for {{org}} here.\n\nTo stop receiving these, reply "unsubscribe".`,
      provider_status: 'draft', active: true,
    });
    const templates = await baseEmailSequence(audience);
    res.status(201).json({ success: true, templates, touch_no: touchNo, message: `Touch ${touchNo} created for ${audience}.` });
  } catch (error) {
    if (createdSequence) await AllianceSequences.deleteOne({ id: createdSequence.id }).catch(() => {});
    res.status(error.status || 500).json({ error: error.message || 'Unable to create email touch.' });
  }
});

router.delete('/campaign-builder/templates/:touchNo', async (req, res) => {
  const audience = text(req.query.audience).toLowerCase();
  const touchNo = Math.max(1, Number(req.params.touchNo) || 1);
  if (!audience) return res.status(400).json({ error: 'Target audience is required.' });
  try {
    const lastActive = await AllianceSequences.findOne({ audience, channel: 'email', active: true }, { touch_no: 1 }).sort({ touch_no: -1 }).lean();
    if (Number(lastActive?.touch_no ?? NaN) !== touchNo) throw Object.assign(new Error('Delete the last touch first to keep the sequence order valid.'), { status: 409 });
    if (touchNo === 1) throw Object.assign(new Error('An email sequence must keep at least one touch.'), { status: 409 });
    await AllianceTemplates.deleteMany({ audience, channel: 'email', touch_no: touchNo });
    await AllianceSequences.deleteMany({ audience, channel: 'email', touch_no: touchNo });
    res.json({ success: true, templates: await baseEmailSequence(audience), message: `Touch ${touchNo} deleted.` });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || 'Unable to delete email touch.' });
  }
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
  let campaign = null;
  try {
    assertBulkSendLimit(await getBulkSendLimit('email'), prospectIds.length);
    const eligibleCount = await AllianceProspects.countDocuments({
      id: { $in: prospectIds }, audience, email: { $ne: null }, suppressed: false, status: OPEN_PROSPECT_STATUS,
    });
    if (eligibleCount !== prospectIds.length) {
      return res.status(400).json({ error: 'Some selected leads are no longer eligible or do not match the selected audience.' });
    }
    const senderId = Number(req.body.sender_domain_id);
    const sender = Number.isFinite(senderId) ? await AllianceDomains.exists({ id: senderId, status: 'active' }) : null;
    if (!sender) {
      return res.status(400).json({ error: 'Select an active email sender.' });
    }
    campaign = (await AllianceCampaigns.create({
      name, audience, channel: 'email', objective: text(req.body.objective) || null, sender_domain_id: senderId, created_by: req.user?.id || null,
    })).toObject();
    await AllianceCampaignProspects.insertMany(prospectIds.map((prospectId) => ({ campaign_id: campaign.id, prospect_id: prospectId })));
    for (const [index, template] of templates.entries()) {
      const touchNo = touchNumbers[index];
      const subject = text(template.subject);
      const body = text(template.body);
      if (!subject || !body) throw new Error(`Touch ${touchNo} subject and body are required.`);
      await AllianceCampaignTemplates.create({
        campaign_id: campaign.id, touch_no: touchNo, delay_days: Math.min(Math.max(Number(template.delay_days) || 0, 0), 30),
        subject, body, ai_generated: Boolean(req.body.ai_generated),
      });
    }
    res.status(201).json({ success: true, campaign, selected_count: prospectIds.length, message: 'Draft email campaign created. Review readiness before starting.' });
  } catch (error) {
    if (campaign) await deleteCascade('alliance_campaigns', { id: campaign.id }).catch(() => {});
    console.error('Alliance email campaign create failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create email campaign.' });
  }
});

// Campaign prospects joined with their prospect rows (inner join), with the effective channel.
async function campaignEnrollments(campaign) {
  const enrollments = await AllianceCampaignProspects.find({ campaign_id: campaign.id }).lean();
  const prospects = new Map((await AllianceProspects.find({ id: { $in: enrollments.map((e) => e.prospect_id) } }).lean()).map((p) => [p.id, p]));
  return enrollments.filter((e) => prospects.has(e.prospect_id)).map((e) => {
    const p = prospects.get(e.prospect_id);
    return { enrollment: e, prospect: p, channel: campaign.channel === 'auto' ? p.channel : campaign.channel };
  });
}

async function getCampaignReadiness(_queryable, campaignId) {
  const campaign = await AllianceCampaigns.findOne({ id: campaignId }, NO_ID).lean();
  if (!campaign) return null;
  const rows = await campaignEnrollments(campaign);
  const stats = {
    total: rows.length,
    eligible: rows.filter((r) => r.prospect.suppressed === false).length,
    email: rows.filter((r) => r.channel === 'email' && r.prospect.email != null && r.prospect.suppressed === false).length,
    whatsapp: rows.filter((r) => r.channel === 'whatsapp' && r.prospect.consent === true && r.prospect.suppressed === false).length,
  };
  const channels = [...new Set(rows.filter((r) => r.prospect.suppressed === false).map((r) => r.channel))];
  const missingTemplates = [];
  const missingSenders = [];
  const missingSequences = [];
  for (const channel of channels) {
    const expected = await AllianceSequences.countDocuments({ audience: campaign.audience, channel, active: true });
    const available = channel === 'email'
      ? await AllianceCampaignTemplates.countDocuments({ campaign_id: campaign.id })
      : await AllianceTemplates.countDocuments({ audience: campaign.audience, channel, active: true });
    if (!expected) missingSequences.push(channel);
    if (available < expected) missingTemplates.push(channel);

    const sender = channel === 'email'
      ? await AllianceDomains.findOne(
        { id: campaign.sender_domain_id, status: 'active', $expr: { $lt: ['$sent_today', '$daily_cap'] } },
        { inbox_email: 1 }
      ).lean()
      : await AllianceNumbers.findOne({ status: 'active', quality_rating: 'green', $expr: { $lt: ['$sent_today', '$daily_cap'] } }, { id: 1 }).lean();
    if (!sender) missingSenders.push(channel);
    if (channel === 'email' && sender && !isAllianceSenderAllowed(sender.inbox_email, getAllianceEmailConfig())) {
      missingSenders.push('email configuration');
    }
  }
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
    const total = await AllianceCampaigns.countDocuments();
    const campaignRows = await AllianceCampaigns.find({}, { _id: 0, id: 1, name: 1, audience: 1, channel: 1, status: 1, created_at: 1, started_at: 1, completed_at: 1 })
      .sort({ created_at: -1 }).skip(offset).limit(limit).lean();
    const ids = campaignRows.map((c) => c.id);
    const enrollments = await AllianceCampaignProspects.find({ campaign_id: { $in: ids } }, { campaign_id: 1, prospect_id: 1 }).lean();
    const prospectStatus = new Map((await AllianceProspects.find({ id: { $in: enrollments.map((e) => e.prospect_id) } }, { id: 1, status: 1 }).lean()).map((p) => [p.id, p.status]));
    const sentCounts = new Map((await AllianceTouches.aggregate([
      { $match: { campaign_id: { $in: ids }, status: 'sent' } },
      { $group: { _id: '$campaign_id', count: { $sum: 1 } } },
    ])).map((row) => [row._id, row.count]));
    const repliedCounts = new Map((await AllianceEmailInbound.aggregate([
      { $match: { campaign_id: { $in: ids }, prospect_id: { $ne: null } } },
      { $group: { _id: '$campaign_id', prospects: { $addToSet: '$prospect_id' } } },
    ])).map((row) => [row._id, row.prospects.length]));
    const campaigns = campaignRows.map((c) => {
      const enrolled = [...new Set(enrollments.filter((e) => e.campaign_id === c.id && prospectStatus.has(e.prospect_id)).map((e) => e.prospect_id))];
      return {
        ...c,
        prospects: enrolled.length,
        in_sequence: enrolled.filter((id) => prospectStatus.get(id) === 'in_sequence').length,
        replied: repliedCounts.get(c.id) || 0,
        interested: enrolled.filter((id) => prospectStatus.get(id) === 'interested').length,
        sent: sentCounts.get(c.id) || 0,
      };
    });
    res.json({ campaigns, total, limit, offset });
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
    const campaignRow = await AllianceCampaigns.findOne({ id: campaignId }, NO_ID).lean();
    if (!campaignRow) return res.status(404).json({ error: 'Campaign not found.' });
    const [audienceRow, senderRow, touches, enrollments] = await Promise.all([
      campaignRow.audience ? AllianceAudiences.findOne({ code: campaignRow.audience }, { label: 1 }).lean() : null,
      campaignRow.sender_domain_id != null ? AllianceDomains.findOne({ id: campaignRow.sender_domain_id }, { inbox_email: 1 }).lean() : null,
      AllianceTouches.find({ campaign_id: campaignId }, { id: 1, prospect_id: 1, touch_no: 1, status: 1, error_message: 1, sent_at: 1 }).lean(),
      AllianceCampaignProspects.find({ campaign_id: campaignId }).lean(),
    ]);
    const enrolledIds = [...new Set(enrollments.map((e) => e.prospect_id))];
    const replyRows = await AllianceReplies.find({ prospect_id: { $in: enrolledIds } }, { prospect_id: 1 }).lean();
    const latestFailure = touches.filter((t) => t.status === 'failed' && t.error_message != null).sort((a, b) => b.id - a.id)[0];
    const countTouches = (status) => touches.filter((t) => t.status === status).length;
    const campaign = {
      ...campaignRow,
      audience_label: audienceRow?.label ?? null,
      sender_email: senderRow?.inbox_email ?? null,
      prospects: enrolledIds.length,
      sent: countTouches('sent'),
      failed: countTouches('failed'),
      processing: countTouches('processing'),
      cancelled: countTouches('cancelled'),
      latest_touch_error: latestFailure?.error_message ?? null,
      replied: new Set(replyRows.map((r) => r.prospect_id)).size,
    };
    const templates = await AllianceCampaignTemplates.find({ campaign_id: campaignId }, { _id: 0, touch_no: 1, delay_days: 1, subject: 1, body: 1 }).sort({ touch_no: 1 }).lean();
    const touchNumbers = [...new Set(touches.map((t) => t.touch_no))].sort((a, b) => a - b);
    const touchStats = touchNumbers.map((touchNo) => {
      const ofTouch = touches.filter((t) => t.touch_no === touchNo);
      return {
        touch_no: touchNo,
        sent: ofTouch.filter((t) => t.status === 'sent').length,
        pending: ofTouch.filter((t) => ['scheduled', 'paused'].includes(t.status)).length,
        processing: ofTouch.filter((t) => t.status === 'processing').length,
        failed: ofTouch.filter((t) => t.status === 'failed').length,
        cancelled: ofTouch.filter((t) => t.status === 'cancelled').length,
      };
    });
    // Recipients (campaign enrollments joined with prospects), filtered by search/status
    const prospectFilter = { id: { $in: enrolledIds } };
    if (text(req.query.search)) {
      const pattern = new RegExp(escapeRegex(text(req.query.search)), 'i');
      prospectFilter.$or = [{ name: pattern }, { business_name: pattern }, { email: pattern }];
    }
    if (text(req.query.status)) prospectFilter.status = text(req.query.status);
    const matchingProspects = new Map((await AllianceProspects.find(prospectFilter, { id: 1, name: 1, business_name: 1, email: 1, audience: 1, status: 1 }).lean())
      .map((p) => [p.id, p]));
    const matchingEnrollments = enrollments.filter((e) => matchingProspects.has(e.prospect_id))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const recipients = matchingEnrollments.slice(offset, offset + limit).map((e) => {
      const p = matchingProspects.get(e.prospect_id);
      const own = touches.filter((t) => t.prospect_id === e.prospect_id);
      const latest = [...own].sort((a, b) => b.touch_no - a.touch_no || b.id - a.id)[0];
      return {
        id: p.id, name: p.name, business_name: p.business_name, email: p.email, audience: p.audience, prospect_status: p.status,
        enrollment_status: e.enrollment_status, current_touch: e.current_touch, next_touch_at: e.next_touch_at,
        delivery_status: p.status, stop_reason: e.stop_reason,
        error_message: latest?.error_message ?? null, last_sent_at: latest?.sent_at ?? null,
        sent_count: own.filter((t) => t.status === 'sent').length,
        reply_count: replyRows.filter((r) => r.prospect_id === e.prospect_id).length,
      };
    });
    res.json({ campaign, templates, touch_stats: touchStats, recipients, total: matchingEnrollments.length, limit, offset });
  } catch (error) {
    console.error('Alliance email campaign detail failed:', error);
    res.status(500).json({ error: 'Failed to load email campaign detail.' });
  }
});

router.get('/campaigns/:id', async (req, res) => {
  try {
    const readiness = await getCampaignReadiness(null, req.params.id);
    if (!readiness) return res.status(404).json({ error: 'Campaign not found.' });
    const campaignId = readiness.campaign.id;
    const touches = (await AllianceTouches.aggregate([
      { $match: { campaign_id: campaignId } },
      { $group: { _id: { touch_no: '$touch_no', channel: '$channel', status: '$status' }, count: { $sum: 1 } } },
      { $project: { _id: 0, touch_no: '$_id.touch_no', channel: '$_id.channel', status: '$_id.status', count: 1 } },
    ])).sort((a, b) => a.touch_no - b.touch_no || String(a.channel).localeCompare(String(b.channel)) || String(a.status).localeCompare(String(b.status)));
    const withProspect = async (rows) => {
      const prospects = new Map((await AllianceProspects.find({ id: { $in: rows.map((t) => t.prospect_id) } }, { id: 1, email: 1, business_name: 1 }).lean()).map((p) => [p.id, p]));
      return rows.filter((t) => prospects.has(t.prospect_id)).map((t) => ({ t, p: prospects.get(t.prospect_id) }));
    };
    const failedTouches = await withProspect(await AllianceTouches.find({ campaign_id: campaignId, status: 'failed' }).sort({ id: -1 }).lean());
    const failures = failedTouches.slice(0, 20).map(({ t, p }) => ({
      id: t.id, touch_no: t.touch_no, error_message: t.error_message, email: p.email, business_name: p.business_name,
    }));
    const sentTouches = (await withProspect(await AllianceTouches.find({ campaign_id: campaignId, channel: 'email', status: 'sent' }).sort({ sent_at: -1 }).lean())).slice(0, 20);
    const sentEvents = await AllianceEmailEvents.find({ touch_id: { $in: sentTouches.map(({ t }) => t.id) }, event_type: 'sent' }, { touch_id: 1, event_payload: 1, id: 1 }).sort({ id: -1 }).lean();
    const deliveries = sentTouches.map(({ t, p }) => ({
      id: t.id, touch_no: t.touch_no, status: t.status, sent_at: t.sent_at, provider_message_id: t.provider_message_id,
      email: p.email, business_name: p.business_name,
      event_payload: sentEvents.find((e) => e.touch_id === t.id)?.event_payload ?? null,
    }));
    res.json({ ...readiness, touches, failures, deliveries });
  } catch (error) {
    console.error('Alliance campaign detail failed:', error);
    res.status(500).json({ error: 'Failed to load campaign details.' });
  }
});

router.post('/campaigns/:id/start', async (req, res) => {
  try {
    const requestedStart = req.body?.scheduled_at ? new Date(req.body.scheduled_at) : null;
    if (requestedStart && Number.isNaN(requestedStart.getTime())) {
      return res.status(400).json({ error: 'scheduled_at must be a valid date and time.' });
    }
    const scheduling = requestedStart && requestedStart.getTime() > Date.now();
    if (req.body?.scheduled_at && !scheduling) {
      return res.status(400).json({ error: 'Scheduled campaign time must be in the future.' });
    }
    const readiness = await getCampaignReadiness(null, req.params.id);
    if (!readiness) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    if (!readiness.ready) {
      return res.status(409).json({ error: 'Campaign is not ready to start.', readiness });
    }
    assertBulkSendLimit(await getBulkSendLimit('email'), Number(readiness.stats.eligible));
    if (!['draft', 'ready', 'paused', 'scheduled'].includes(readiness.campaign.status)) {
      return res.status(409).json({ error: `Campaign cannot start from ${readiness.campaign.status} status.` });
    }
    const campaignId = readiness.campaign.id;
    const startAt = scheduling ? requestedStart : new Date();

    const resuming = readiness.campaign.status === 'paused';
    const rescheduling = readiness.campaign.status === 'scheduled';
    if (resuming) {
      await AllianceTouches.updateMany(
        { campaign_id: campaignId, status: { $in: ['paused', 'failed'] }, sent_at: null },
        { $set: { status: 'scheduled', error_message: null, scheduled_at: startAt } }
      );
    } else if (rescheduling) {
      await AllianceTouches.updateMany(
        { campaign_id: campaignId, status: 'scheduled', sent_at: null },
        { $set: { scheduled_at: startAt, error_message: null } }
      );
    } else {
      const campaignRow = readiness.campaign;
      const firstCampaignTemplate = campaignRow.channel === 'email'
        ? await AllianceCampaignTemplates.findOne({ campaign_id: campaignId, touch_no: 1 }).lean()
        : null;
      for (const { prospect, channel } of await campaignEnrollments(campaignRow)) {
        if (prospect.suppressed !== false) continue;
        const audienceTemplate = await AllianceTemplates.findOne({ audience: prospect.audience, channel, touch_no: 1, active: true }).lean();
        if (await AllianceTouches.exists({ campaign_id: campaignId, prospect_id: prospect.id, touch_no: 1 })) continue;
        await insertIgnore(AllianceTouches, {
          prospect_id: prospect.id, campaign_id: campaignId, touch_no: 1, channel,
          subject: firstCampaignTemplate?.subject ?? audienceTemplate?.subject ?? null,
          message_body: firstCampaignTemplate?.body ?? audienceTemplate?.body ?? null,
          status: 'scheduled', scheduled_at: startAt,
        });
      }
    }
    const enrolledProspectIds = await AllianceCampaignProspects.distinct('prospect_id', { campaign_id: campaignId });
    await AllianceProspects.updateMany(
      { id: { $in: enrolledProspectIds }, suppressed: false },
      { $set: { status: 'pending', updated_at: new Date() } }
    );
    await AllianceCampaignProspects.updateMany(
      { campaign_id: campaignId, enrollment_status: { $ne: 'stopped' } },
      { $set: { enrollment_status: 'in_sequence' } }
    );
    await AllianceCampaigns.updateOne({ id: campaignId }, [{ $set: {
      status: scheduling ? 'scheduled' : 'running',
      scheduled_start_at: scheduling ? requestedStart : null,
      started_at: scheduling ? null : { $ifNull: ['$started_at', '$$NOW'] },
    } }]);
    res.json({
      success: true,
      resumed: resuming,
      scheduled: Boolean(scheduling),
      scheduled_at: scheduling ? requestedStart.toISOString() : null,
      message: scheduling ? `Campaign scheduled for ${requestedStart.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}.` : resuming ? 'Campaign resumed. Unsent paused or failed touches were restored.' : 'Campaign started and first touches scheduled.'
    });
  } catch (error) {
    console.error('Alliance campaign start failed:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to start campaign.' });
  }
});

router.post('/campaigns/:id/pause', async (req, res) => {
  try {
    const result = await AllianceCampaigns.updateOne(
      { id: req.params.id, status: { $in: ['running', 'scheduled'] } },
      { $set: { status: 'paused' } }
    );
    if (!result.matchedCount) {
      return res.status(409).json({ error: 'Only a running or scheduled campaign can be paused.' });
    }
    await AllianceTouches.updateMany({ campaign_id: req.params.id, status: 'scheduled' }, { $set: { status: 'paused' } });
    res.json({ success: true, message: 'Campaign paused. Scheduled touches will not send.' });
  } catch (error) {
    console.error('Alliance campaign pause failed:', error);
    res.status(500).json({ error: 'Failed to pause campaign.' });
  }
});

router.post('/campaigns/:id/stop', async (req, res) => {
  try {
    const result = await AllianceCampaigns.updateOne(
      { id: req.params.id, status: { $in: ['draft', 'ready', 'scheduled', 'running', 'paused'] } },
      { $set: { status: 'cancelled', completed_at: new Date() } }
    );
    if (!result.matchedCount) {
      return res.status(409).json({ error: 'This campaign cannot be stopped from its current status.' });
    }
    await AllianceTouches.updateMany(
      { campaign_id: req.params.id, status: { $in: ['scheduled', 'paused'] }, sent_at: null },
      { $set: { status: 'cancelled', error_message: 'Campaign stopped by user.' } }
    );
    await AllianceCampaignProspects.updateMany(
      { campaign_id: req.params.id, enrollment_status: { $nin: ['completed', null] } },
      { $set: { enrollment_status: 'stopped', stopped_at: new Date(), stop_reason: 'campaign_stopped' } }
    );
    res.json({ success: true, message: 'Campaign stopped permanently. All unsent touches were cancelled.' });
  } catch (error) {
    console.error('Alliance campaign stop failed:', error);
    res.status(500).json({ error: 'Failed to stop campaign.' });
  }
});

router.delete('/campaigns/:id', async (req, res) => {
  try {
    const campaign = await AllianceCampaigns.findOne({ id: req.params.id }, { id: 1, name: 1, status: 1 }).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }
    if (['scheduled', 'running', 'paused'].includes(campaign.status)) {
      return res.status(409).json({ error: 'Stop this campaign before deleting it permanently.' });
    }

    // These collections use SET NULL for audit/history safety, so explicitly remove
    // campaign-owned records before deleting the campaign itself.
    await deleteCascade('alliance_email_inbound', { campaign_id: campaign.id });
    await deleteCascade('alliance_touches', { campaign_id: campaign.id });
    await deleteCascade('alliance_campaigns', { id: campaign.id });
    res.json({ success: true, message: `Campaign "${campaign.name}" was permanently deleted.` });
  } catch (error) {
    console.error('Alliance campaign delete failed:', error);
    res.status(500).json({ error: 'Failed to delete campaign.' });
  }
});

router.post('/campaigns/:id/test-email', async (req, res) => {
  try {
    const recipient = normalizeEmail(req.body.email);
    const touchNo = Math.min(Math.max(Number(req.body.touch_no) || 1, 1), 10);
    if (!recipient) return res.status(400).json({ error: 'Enter a valid test email address.' });
    const testCampaign = await AllianceCampaigns.findOne({ id: req.params.id }, { id: 1, name: 1, audience: 1, sender_domain_id: 1 }).lean();
    const testDomain = testCampaign?.sender_domain_id != null ? await AllianceDomains.findOne({ id: testCampaign.sender_domain_id }, { inbox_email: 1, status: 1 }).lean() : null;
    if (!testCampaign || !testDomain) return res.status(404).json({ error: 'Campaign not found.' });
    const [campaignTemplate, audienceTemplate] = await Promise.all([
      AllianceCampaignTemplates.findOne({ campaign_id: testCampaign.id, touch_no: touchNo }, { subject: 1, body: 1 }).lean(),
      AllianceTemplates.findOne({ audience: testCampaign.audience, channel: 'email', touch_no: touchNo, active: true }, { subject: 1, body: 1 }).lean(),
    ]);
    let sampleProspect = null;
    for (const enrollment of await AllianceCampaignProspects.find({ campaign_id: testCampaign.id }, { prospect_id: 1 }).sort({ created_at: 1 }).lean()) {
      sampleProspect = await AllianceProspects.findOne({ id: enrollment.prospect_id }, { id: 1, name: 1, business_name: 1, location: 1 }).lean();
      if (sampleProspect) break;
    }
    const preview = {
      campaign_id: testCampaign.id, campaign_name: testCampaign.name, audience: testCampaign.audience, sender_domain_id: testCampaign.sender_domain_id,
      inbox_email: testDomain.inbox_email, sender_status: testDomain.status,
      subject: campaignTemplate?.subject ?? audienceTemplate?.subject ?? null,
      body: campaignTemplate?.body ?? audienceTemplate?.body ?? null,
      prospect_id: sampleProspect?.id ?? null, name: sampleProspect?.name ?? null,
      business_name: sampleProspect?.business_name ?? null, location: sampleProspect?.location ?? null,
    };
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
    await AllianceEmailEvents.create({
      campaign_id: preview.campaign_id, prospect_id: preview.prospect_id || null, provider_message_id: sent.messageId || null,
      event_type: 'test_sent',
      event_payload: JSON.parse(JSON.stringify({ recipient, touch_no: touchNo, accepted: sent.accepted, rejected: sent.rejected, response: sent.response })),
    });
    res.json({ success: true, message: `Test touch ${touchNo} submitted to Zoho for ${recipient}.`, provider_message_id: sent.messageId || null });
  } catch (error) {
    console.error('Alliance campaign test email failed:', error.response || error.message);
    res.status(502).json({ error: error.response || error.message || 'Failed to send test email.' });
  }
});

// Prospects with complete, auditable WhatsApp consent (mirrors the SQL eligibility rules).
const WHATSAPP_ELIGIBLE_FILTER = (closedStatuses = ['converted', 'closed', 'not_interested', 'unsubscribed']) => ({
  phone: { $ne: null },
  consent: true,
  consent_source: { $in: [...WHATSAPP_CONSENT_SOURCES] },
  consent_at: { $ne: null },
  consent_evidence: /\S/,
  consent_scope: { $in: [...CONSENT_SCOPES] },
  source: { $not: /(scrap|purchas|directory|research)/i },
  suppressed: false,
  status: { $nin: [...closedStatuses, null] },
});
const lowerContains = (value) => new RegExp(escapeRegex(String(value).toLowerCase()), 'i');

router.get('/whatsapp-campaigns/prospects', async (req, res) => {
  try {
    const filter = WHATSAPP_ELIGIBLE_FILTER();
    const and = [];
    if (text(req.query.audience)) filter.audience = text(req.query.audience);
    if (text(req.query.search)) {
      const pattern = lowerContains(text(req.query.search));
      and.push({ $or: [{ name: pattern }, { business_name: pattern }, { phone: new RegExp(escapeRegex(text(req.query.search).toLowerCase())) }] });
    }
    if (text(req.query.dateFrom)) and.push({ created_at: { $gte: new Date(`${text(req.query.dateFrom)}T00:00:00Z`) } });
    if (text(req.query.dateTo)) and.push({ created_at: { $lt: new Date(new Date(`${text(req.query.dateTo)}T00:00:00Z`).getTime() + DAY_MS) } });
    if (and.length) filter.$and = and;
    const limit=Math.min(Math.max(Number(req.query.limit)||20,1),5000);const offset=Math.max(Number(req.query.offset)||0,0);
    const total = await AllianceProspects.countDocuments(filter);
    const prospects = await AllianceProspects.find(filter, {
      _id: 0, id: 1, name: 1, business_name: 1, phone: 1, email: 1, audience: 1, industry: 1, location: 1, status: 1, source: 1, channel: 1,
      channel_pref: 1, consent: 1, consent_source: 1, consent_at: 1, consent_evidence: 1, consent_scope: 1, ai_score: 1, campaign_id: 1,
      custom_fields: 1, created_at: 1,
    }).sort({ created_at: -1 }).skip(offset).limit(limit).lean();
    res.json({ prospects, total });
  }catch(error){console.error('Alliance WhatsApp prospects failed:',error);res.status(500).json({error:'Failed to load WhatsApp-eligible prospects.'});}
});

// Per-campaign recipient and reminder statistics
async function whatsappCampaignStats(campaignIds) {
  const recipients = await AllianceWhatsappCampaignRecipients.find({ campaign_id: { $in: campaignIds } }, { id: 1, campaign_id: 1, status: 1, error_message: 1 }).lean();
  const jobs = await AllianceWhatsappFollowupJobs.find({ campaign_id: { $in: campaignIds } }, { id: 1, campaign_id: 1, status: 1, scheduled_at: 1, error_message: 1 }).lean();
  return new Map(campaignIds.map((campaignId) => {
    const rs = recipients.filter((r) => r.campaign_id === campaignId);
    const js = jobs.filter((j) => j.campaign_id === campaignId);
    const count = (statuses) => rs.filter((r) => statuses.includes(r.status)).length;
    const pendingJobs = js.filter((j) => ['pending', 'claimed'].includes(j.status) && j.scheduled_at != null);
    const latestError = rs.filter((r) => r.error_message != null).sort((a, b) => b.id - a.id)[0];
    const latestReminderError = js.filter((j) => j.error_message != null).sort((a, b) => b.id - a.id)[0];
    return [campaignId, {
      recipients: rs.length,
      sent: count(['sent', 'delivered', 'read']),
      delivered: count(['delivered']),
      read: count(['read']),
      failed: count(['failed']),
      skipped: count(['skipped']),
      pending: count(['queued', 'sending']),
      cancelled: count(['cancelled']),
      latest_error: latestError?.error_message ?? null,
      next_followup_at: pendingJobs.length ? new Date(Math.min(...pendingJobs.map((j) => new Date(j.scheduled_at).getTime()))) : null,
      reminders_sent_total: js.filter((j) => j.status === 'sent').length,
      reminders_failed_total: js.filter((j) => j.status === 'failed').length,
      reminders_pending_total: js.filter((j) => ['pending', 'claimed', 'sending'].includes(j.status)).length,
      reminders_skipped_total: js.filter((j) => j.status === 'skipped').length,
      reminder_jobs_total: js.length,
      latest_reminder_error: latestReminderError?.error_message ?? null,
    }];
  }));
}

router.get('/whatsapp-campaigns', async (_req,res)=>{
  try{
    const campaignRows = await AllianceWhatsappCampaigns.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const stats = await whatsappCampaignStats(campaignRows.map((c) => c.id));
    const campaigns = campaignRows.map((c) => {
      const { recipients, sent, delivered, read, failed, skipped, latest_error, next_followup_at } = stats.get(c.id);
      return { ...c, recipients, sent, delivered, read, failed, skipped, latest_error, next_followup_at };
    });
    res.json({campaigns});
  }
  catch(error){res.status(500).json({error:'Failed to load WhatsApp campaigns.'});}
});

const INVALID_INDIA_MOBILE = 'Likely invalid Indian mobile format: expected country code 91 followed by a 10-digit mobile number starting with 6, 7, 8, or 9.';
const UNKNOWN_DELIVERY_FAILURE = 'Meta reported delivery failure without details. The number may not be registered on WhatsApp or may be unreachable.';
function recipientErrorMessage(recipient, prospect, inboxMessage) {
  const stored = recipient.error_message === 'Meta reported message delivery failed without additional details.' ? null : recipient.error_message;
  if (stored != null) return stored;
  if (recipient.status !== 'failed') return null;
  const digits = String(prospect.phone ?? '').replace(/[^0-9]/g, '');
  const phoneHint = digits.startsWith('91') && !/^91[6-9][0-9]{9}$/.test(digits) ? INVALID_INDIA_MOBILE : UNKNOWN_DELIVERY_FAILURE;
  const metaError = inboxMessage?.raw_payload?.status_event?.errors?.[0];
  if (metaError) {
    const detail = [
      metaError.code != null ? `Meta ${metaError.code}` : null,
      metaError.title, metaError.message, metaError.error_data?.details,
    ].filter((part) => part != null).join(': ');
    if (detail) return detail;
  }
  return phoneHint;
}

router.get('/whatsapp-campaigns/:id',async(req,res)=>{
  try{
    const campaignRow = await AllianceWhatsappCampaigns.findOne({ id: req.params.id }, NO_ID).lean();
    if(!campaignRow)return res.status(404).json({error:'WhatsApp campaign not found.'});
    const { latest_error, ...campaignStats } = (await whatsappCampaignStats([campaignRow.id])).get(campaignRow.id);
    const campaign = { ...campaignRow, ...campaignStats };

    const limit=Math.min(Math.max(Number(req.query.limit)||25,1),500);
    const offset=Math.max(Number(req.query.offset)||0,0);
    const recipientFilter = { campaign_id: campaignRow.id };
    if (text(req.query.status)) recipientFilter.status = text(req.query.status);
    const allRecipients = await AllianceWhatsappCampaignRecipients.find(recipientFilter, NO_ID).sort({ id: 1 }).lean();
    const prospectFilter = { id: { $in: allRecipients.map((r) => r.prospect_id) } };
    if (text(req.query.search)) {
      const pattern = lowerContains(text(req.query.search));
      prospectFilter.$or = [{ name: pattern }, { business_name: pattern }, { phone: new RegExp(escapeRegex(text(req.query.search).toLowerCase())) }];
    }
    const prospects = new Map((await AllianceProspects.find(prospectFilter, { id: 1, name: 1, business_name: 1, phone: 1, audience: 1, location: 1 }).lean()).map((p) => [p.id, p]));
    const matching = allRecipients.filter((r) => prospects.has(r.prospect_id));
    const pageRecipients = matching.slice(offset, offset + limit);
    const inboxMessages = new Map((await AllianceInboxMessages.find(
      { wa_msg_id: { $in: pageRecipients.map((r) => r.wa_msg_id).filter(Boolean) } },
      { wa_msg_id: 1, raw_payload: 1 }
    ).lean()).map((m) => [m.wa_msg_id, m]));
    const jobs = await AllianceWhatsappFollowupJobs.find(
      { campaign_id: campaignRow.id, prospect_id: { $in: pageRecipients.map((r) => r.prospect_id) } },
      { id: 1, prospect_id: 1, status: 1, scheduled_at: 1, error_message: 1 }
    ).lean();
    const recipients = pageRecipients.map((r) => {
      const p = prospects.get(r.prospect_id);
      const ownJobs = jobs.filter((j) => j.prospect_id === r.prospect_id);
      const latestJob = [...ownJobs].sort((a, b) => b.id - a.id)[0];
      const pendingJobs = ownJobs.filter((j) => ['pending', 'claimed'].includes(j.status) && j.scheduled_at != null);
      return {
        id: r.id, prospect_id: r.prospect_id, status: r.status, reshare_status: r.reshare_status, reshare_updated_at: r.reshare_updated_at,
        wa_msg_id: r.wa_msg_id, sent_at: r.sent_at, scheduled_at: r.scheduled_at,
        error_message: recipientErrorMessage(r, p, r.wa_msg_id ? inboxMessages.get(r.wa_msg_id) : null),
        name: p.name, business_name: p.business_name, phone: p.phone, audience: p.audience, location: p.location,
        reminders_sent: ownJobs.filter((j) => j.status === 'sent').length,
        next_reminder_at: pendingJobs.length ? new Date(Math.min(...pendingJobs.map((j) => new Date(j.scheduled_at).getTime()))) : null,
        reminder_status: latestJob?.status ?? null,
        reminder_scheduled_at: latestJob?.scheduled_at ?? null,
        reminder_error: latestJob?.error_message ?? null,
      };
    });
    res.json({campaign,recipients,total:matching.length,limit,offset});
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
    const targetIds = await AllianceWhatsappCampaignRecipients.distinct('id', { campaign_id: req.params.id, id: { $in: recipientIds }, status: 'failed' });
    if (targetIds.length) {
      await AllianceWhatsappCampaignRecipients.updateMany(
        { id: { $in: targetIds } },
        { $set: { reshare_status: reshareStatus, reshare_updated_at: new Date(), reshare_updated_by: req.user?.id || null } }
      );
    }
    const updatedRecipients = await AllianceWhatsappCampaignRecipients.find({ id: { $in: targetIds } }, { _id: 0, id: 1, reshare_status: 1, reshare_updated_at: 1 }).lean();
    if (!updatedRecipients.length) return res.status(404).json({ error: 'No failed recipients were found for this campaign.' });
    res.json({ success: true, message: `${updatedRecipients.length} failed lead${updatedRecipients.length === 1 ? '' : 's'} updated.`, recipients: updatedRecipients });
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
    
    const result = await AllianceWhatsappCampaignRecipients.updateMany(
      { campaign_id: req.params.id, id: { $in: recipientIds }, status: 'failed' },
      { $set: { status: 'queued', error_message: null } }
    );
    if (result.modifiedCount) {
      await AllianceWhatsappCampaigns.updateOne({ id: req.params.id }, { $set: { status: 'running', updated_at: new Date() } });
    }
    if (!result.modifiedCount) return res.status(404).json({ error: 'No failed recipients were updated.' });
    res.json({ success: true, message: `${result.modifiedCount} failed lead${result.modifiedCount === 1 ? '' : 's'} queued for retry.` });
  } catch (error) {
    console.error('Alliance WhatsApp retry failed leads error:', error);
    res.status(500).json({ error: 'Failed to retry failed leads.' });
  }
});

const getAllianceWhatsAppSettings = async () => {
  const settings = await AllianceInboxSettings.findOne({ active: true }, NO_ID).sort({ id: 1 }).lean();
  if (settings) return settings;
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
  let createdCampaign=null;
  try{
    const templateRow=await Templates.findOne({ id: templateId },{ _id: 0, id: 1, name: 1, language: 1, body: 1, status: 1, category: 1, header_format: 1 }).lean();
    const template={ rows: templateRow ? [templateRow] : [], rowCount: templateRow ? 1 : 0 };
    if(!template.rowCount||String(template.rows[0].status).toLowerCase()!=='approved')throw Object.assign(new Error('Select a Meta-approved registered template.'),{status:409});
    const variableCount=Math.max(0,...[...String(template.rows[0].body).matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1])));
    const validMappingField=(field)=>/^[a-z][a-z0-9_]*$/.test(field)&&!['__proto__','constructor','prototype'].includes(field);
    if(mapping.length!==variableCount||mapping.some(field=>!validMappingField(field)))throw Object.assign(new Error(`Map all ${variableCount} template variables before scheduling.`),{status:400});
    let followup=null;if(followupTemplateId){followup=await Templates.findOne({ id: followupTemplateId },{ _id: 0, id: 1, name: 1, language: 1, body: 1, status: 1 }).lean();if(!followup||String(followup.status).toLowerCase()!=='approved')throw Object.assign(new Error('Select a Meta-approved follow-up template.'),{status:409});const count=Math.max(0,...[...String(followup.body).matchAll(/\{\{(\d+)\}\}/g)].map(match=>Number(match[1])));if(followupMapping.length!==count||followupMapping.some(field=>!validMappingField(field)))throw Object.assign(new Error(`Map all ${count} follow-up variables.`),{status:400});}
    const settings=await getAllianceWhatsAppSettings();
    if(!settings)throw Object.assign(new Error('Configure ALLIANCE_WA_PHONE_NUMBER_ID or an active Alliance WhatsApp number.'),{status:409});
    if(!process.env[settings.access_token_env||'ALLIANCE_WA_ACCESS_TOKEN'])throw Object.assign(new Error('Alliance WhatsApp access token is missing.'),{status:409});
    const eligibleIds=await AllianceProspects.distinct('id',{ id: { $in: prospectIds }, ...WHATSAPP_ELIGIBLE_FILTER(['converted','closed','complete','completed','not_interested','unsubscribed']) });
    const eligible={ rows: eligibleIds.map((id)=>({ id })), rowCount: eligibleIds.length };
    if(!eligible.rowCount)throw Object.assign(new Error('No selected leads have valid WhatsApp consent.'),{status:409});
    if(eligible.rowCount!==prospectIds.length)throw Object.assign(new Error(`${prospectIds.length-eligible.rowCount} selected lead${prospectIds.length-eligible.rowCount===1?' is':'s are'} missing valid WhatsApp consent evidence. Nothing was scheduled. Correct consent_source, consent_at, consent_evidence, and consent_scope, then try again.`),{status:409});
    assertBulkSendLimit(await getBulkSendLimit('whatsapp'),eligible.rowCount);
    const scheduledAt=req.body.scheduled_at?new Date(req.body.scheduled_at):new Date();if(Number.isNaN(scheduledAt.getTime()))throw Object.assign(new Error('Enter a valid schedule date and time.'),{status:400});
    createdCampaign=(await AllianceWhatsappCampaigns.create({
      name, audience: text(req.body.audience)||null, template_id: templateId, template_name: template.rows[0].name,
      template_language: template.rows[0].language||'en', template_body: template.rows[0].body, parameter_mapping: mapping,
      phone_number_id: settings.phone_number_id, status: 'scheduled', scheduled_at: scheduledAt, created_by: req.user?.id||null,
      followup_template_id: followup?.id||null, followup_template_name: followup?.name||null, followup_template_language: followup?.language||null,
      followup_template_body: followup?.body||null, followup_parameter_mapping: followupMapping, followup_delay_days: followupDelay,
      followup_delay_minutes: followupDelayMinutes, followup_repeat_days: followupRepeat, max_followups: maxFollowups,
    })).toObject();
    const recipientIds=await AllianceWhatsappCampaignRecipients.allocIds(eligible.rows.length);
    await AllianceWhatsappCampaignRecipients.insertMany(eligible.rows.map((row,index)=>({ id: recipientIds[index], campaign_id: createdCampaign.id, prospect_id: row.id, scheduled_at: scheduledAt })));
    setImmediate(()=>processAllianceWhatsAppCampaigns(req.app.get('io')).catch(error=>console.error('[Alliance WhatsApp bulk]',error)));
    res.status(201).json({success:true,campaign:createdCampaign,recipients:eligible.rowCount,message:`WhatsApp campaign scheduled for ${eligible.rowCount} opted-in leads.`});
  }catch(error){if(createdCampaign)await deleteCascade('alliance_whatsapp_campaigns',{ id: createdCampaign.id }).catch(()=>{});console.error('Alliance WhatsApp campaign create failed:',error.message);res.status(error.status||500).json({error:error.message||'Failed to create WhatsApp campaign.'});}
});

router.post('/whatsapp-campaigns/test',async(req,res)=>{
  try{const templateId=Number(req.body.template_id);const phone=normalizePhone(req.body.phone);const mapping=Array.isArray(req.body.sample_values)?req.body.sample_values.map(text):[];if(!templateId||!phone)return res.status(400).json({error:'Template and test phone number are required.'});
    const [template,settings]=await Promise.all([Templates.findOne({ id: templateId },{ _id: 0, name: 1, language: 1, body: 1, status: 1 }).lean(),getAllianceWhatsAppSettings()]);if(!template||String(template.status).toLowerCase()!=='approved')return res.status(409).json({error:'Select an approved template.'});if(!settings)return res.status(409).json({error:'Alliance WhatsApp number is not configured.'});const token=process.env[settings.access_token_env||'ALLIANCE_WA_ACCESS_TOKEN'];if(!token)return res.status(409).json({error:'Alliance WhatsApp access token is missing.'});
    const payload={messaging_product:'whatsapp',to:phone,type:'template',template:{name:template.name,language:{code:template.language||'en'},...(mapping.length?{components:[{type:'body',parameters:mapping.map(value=>({type:'text',text:value||'Test'}))}]}:{})}};const response=await axios.post(`https://graph.facebook.com/v19.0/${settings.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});res.json({success:true,message:'Test template submitted to Meta.',wa_msg_id:response.data?.messages?.[0]?.id||null});
  }catch(error){res.status(502).json({error:error.response?.data?.error?.message||error.message||'Test send failed.'});}
});

router.post('/whatsapp-campaigns/:id/pause',async(req,res)=>{
  try{
    const result=await AllianceWhatsappCampaigns.updateOne({ id: req.params.id, status: { $in: ['scheduled','running'] } },{ $set: { status: 'paused', updated_at: new Date() } });
    if(!result.matchedCount)return res.status(409).json({error:'Only a scheduled or running campaign can be paused.'});
    res.json({success:true,message:'WhatsApp campaign paused. Queued messages will not send until resumed.'});
  }catch(error){console.error('Alliance WhatsApp campaign pause failed:',error);res.status(500).json({error:'Failed to pause campaign.'});}
});

router.post('/whatsapp-campaigns/:id/resume',async(req,res)=>{
  try{
    const result=await AllianceWhatsappCampaigns.updateOne({ id: req.params.id, status: 'paused' },{ $set: { status: 'running', updated_at: new Date() } });
    if(!result.matchedCount)return res.status(409).json({error:'Only a paused campaign can be resumed.'});
    setImmediate(()=>processAllianceWhatsAppCampaigns(req.app.get('io')).catch(error=>console.error('[Alliance WhatsApp bulk]',error)));
    res.json({success:true,message:'WhatsApp campaign resumed.'});
  }catch(error){console.error('Alliance WhatsApp campaign resume failed:',error);res.status(500).json({error:'Failed to resume campaign.'});}
});

router.post('/whatsapp-campaigns/:id/stop',async(req,res)=>{try{await AllianceWhatsappCampaigns.updateOne({ id: req.params.id, status: { $in: ['scheduled','running','paused','completed'] } },{ $set: { status: 'stopped', completed_at: new Date(), updated_at: new Date() } });await AllianceWhatsappCampaignRecipients.updateMany({ campaign_id: req.params.id, status: 'queued' },{ $set: { status: 'cancelled', error_message: 'Campaign stopped by user.' } });await AllianceWhatsappFollowupJobs.updateMany({ campaign_id: req.params.id, status: { $in: ['pending','claimed'] } },{ $set: { status: 'cancelled', error_message: 'Campaign stopped by user.' } });res.json({success:true,message:'WhatsApp campaign and reminders stopped.'});}catch(error){res.status(500).json({error:'Failed to stop campaign.'});}});

router.delete('/whatsapp-campaigns/:id',async(req,res)=>{
  try{
    const campaign=await AllianceWhatsappCampaigns.findOne({ id: req.params.id },{ id: 1, name: 1, status: 1 }).lean();
    if(!campaign)return res.status(404).json({error:'WhatsApp campaign not found.'});
    if(['scheduled','running','paused'].includes(campaign.status))return res.status(409).json({error:'Stop this campaign before deleting it.'});
    await deleteCascade('alliance_whatsapp_campaigns',{ id: campaign.id });
    res.json({success:true,message:'WhatsApp campaign deleted. Existing Alliance Inbox messages were preserved.'});
  }catch(error){console.error('Alliance WhatsApp campaign delete failed:',error);res.status(500).json({error:'Failed to delete WhatsApp campaign.'});}
});

// ── AI Brain: brands, offerings (courses/services), and FAQs the AI reply
// suggestions (email + WhatsApp) read from. See alliance-brain-context.js.

router.get('/prompt-rules', async (_req, res) => {
  try {
    const rules = await AlliancePromptRules.find({}, NO_ID).sort({ priority: 1, id: 1 }).lean();
    const labels = new Map((await AllianceAudiences.find({}, { code: 1, label: 1 }).lean()).map((a) => [a.code, a.label]));
    res.json({ rules: rules.map((rule) => ({ ...rule, audience_label: labels.get(rule.audience) ?? null })) });
  } catch (error) { res.status(500).json({ error: 'Failed to load AI prompt rules.' }); }
});

router.post('/campaigns/:id/retry-failed', async (req, res) => {
  try {
    const retryCampaign = await AllianceCampaigns.findOne({ id: req.params.id }, { id: 1, status: 1, sender_domain_id: 1 }).lean();
    const retryDomain = retryCampaign?.sender_domain_id != null ? await AllianceDomains.findOne({ id: retryCampaign.sender_domain_id }, { inbox_email: 1 }).lean() : null;
    if (!retryCampaign || !retryDomain) return res.status(404).json({ error: 'Campaign not found.' });
    if (retryCampaign.status !== 'running') return res.status(409).json({ error: 'Resume or start the campaign before retrying failed emails.' });
    const config = getAllianceEmailConfig();
    if (!isAllianceSenderAllowed(retryDomain.inbox_email, config)) return res.status(409).json({ error: `Selected sender is not allowed by the Zoho SMTP configuration. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.` });
    const retried = (await AllianceTouches.updateMany(
      { campaign_id: retryCampaign.id, channel: 'email', status: 'failed', sent_at: null },
      { $set: { status: 'scheduled', scheduled_at: new Date(), error_message: null, processing_started_at: null } }
    )).modifiedCount;
    res.json({ success:true, retried, message:retried ? `${retried} failed email${retried===1?'':'s'} queued for retry.` : 'No failed emails need retrying.' });
  } catch (error) {
    console.error('Alliance campaign retry failed:', error);
    res.status(500).json({ error: 'Failed to retry campaign emails.' });
  }
});

router.get('/number-health', async (_req, res) => {
  try {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    await AllianceDomains.updateMany({ last_reset: { $lt: today } }, { $set: { sent_today: 0, last_reset: new Date() } });

    // ── WhatsApp senders ──
    const [settingsRows, numberRows, waCampaignRows] = await Promise.all([
      AllianceInboxSettings.find({}).lean(),
      AllianceNumbers.find({}).lean(),
      AllianceWhatsappCampaigns.find({}, { id: 1, phone_number_id: 1 }).lean(),
    ]);
    const senderIds = [...new Set([
      ...settingsRows.map((s) => s.phone_number_id),
      ...numberRows.map((n) => n.phone_number_id),
      ...waCampaignRows.map((c) => c.phone_number_id),
      process.env.ALLIANCE_WA_PHONE_NUMBER_ID || null,
    ].filter((id) => id != null && id !== ''))];
    const metaNumbers = new Map((await MetaWhatsappPhoneNumbers.find({ phone_number_id: { $in: senderIds } }).lean()).map((m) => [m.phone_number_id, m]));
    const SENT_STATUSES = ['sent', 'delivered', 'read'];
    const [todayRecipients, todayJobs, todayInbox, inboxConversations] = await Promise.all([
      AllianceWhatsappCampaignRecipients.find({ sent_at: { $gte: today }, status: { $in: SENT_STATUSES } }, { id: 1, campaign_id: 1, wa_msg_id: 1 }).lean(),
      AllianceWhatsappFollowupJobs.find({ sent_at: { $gte: today }, status: 'sent' }, { id: 1, campaign_id: 1, wa_msg_id: 1 }).lean(),
      AllianceInboxMessages.find({ direction: 'outbound', sent_at: { $gte: today }, status: { $in: SENT_STATUSES } }, { id: 1, conversation_id: 1, wa_msg_id: 1 }).lean(),
      AllianceInboxConversations.find({}, { id: 1, phone_number_id: 1 }).lean(),
    ]);
    const campaignSender = new Map(waCampaignRows.map((c) => [c.id, c.phone_number_id]));
    const conversationSender = new Map(inboxConversations.map((c) => [c.id, c.phone_number_id]));
    const sentToday = (phoneNumberId) => new Set([
      ...todayRecipients.filter((r) => campaignSender.get(r.campaign_id) === phoneNumberId).map((r) => r.wa_msg_id ?? `recipient:${r.id}`),
      ...todayJobs.filter((j) => campaignSender.get(j.campaign_id) === phoneNumberId).map((j) => j.wa_msg_id ?? `followup:${j.id}`),
      ...todayInbox.filter((m) => conversationSender.get(m.conversation_id) === phoneNumberId).map((m) => m.wa_msg_id ?? `inbox:${m.id}`),
    ]).size;
    const numberList = senderIds.flatMap((phoneNumberId) => {
      const s = settingsRows.find((row) => row.phone_number_id === phoneNumberId);
      const m = metaNumbers.get(phoneNumberId);
      const matchingNumbers = numberRows.filter((row) => row.phone_number_id === phoneNumberId);
      return (matchingNumbers.length ? matchingNumbers : [null]).map((n) => ({
        sortActive: s ? s.active !== false : true,
        sortCreated: s?.created_at ?? n?.created_at ?? m?.last_synced_at ?? null,
        row: {
          id: phoneNumberId,
          label: n?.label ?? m?.verified_name ?? s?.verified_name ?? 'WhatsApp sender',
          phone_number: n?.phone_number ?? m?.display_phone_number ?? s?.display_phone_number ?? null,
          phone_number_id: phoneNumberId,
          quality_rating: (m?.quality_rating || n?.quality_rating) ? String(m?.quality_rating || n?.quality_rating).toLowerCase() : null,
          warmup_stage: n?.warmup_stage ?? null,
          daily_cap: n?.daily_cap ?? null,
          status: n?.status ?? ((s ? s.active !== false : true) ? 'active' : 'inactive'),
          paused_until: n?.paused_until ?? null,
          last_reset: n?.last_reset ?? null,
          connection_status: m?.connection_status ?? null,
          last_synced_at: m?.last_synced_at ?? null,
          sent_today: sentToday(phoneNumberId),
          quality_monitored: Boolean(m?.quality_rating) || n?.quality_rating != null,
          cap_configured: Boolean(n),
        },
      }));
    }).sort((a, b) => Number(b.sortActive) - Number(a.sortActive)
      || (a.sortCreated == null ? 1 : b.sortCreated == null ? -1 : new Date(a.sortCreated) - new Date(b.sortCreated)))
      .map((entry) => entry.row);
    const numbers = { rows: numberList };

    // ── Email senders ──
    const BOUNCE_SUBJECT = /(delivery status notification|undeliver|mail delivery failed|returned mail|failure notice|delivery failure)/i;
    const BOUNCE_FROM = /(mailer-daemon|postmaster)/i;
    const isBounce = (inbound) => BOUNCE_SUBJECT.test(inbound.subject ?? '') || BOUNCE_FROM.test(inbound.from_email ?? '');
    const [domainRows, emailCampaignRows, failedToday, inboundToday, syncRows] = await Promise.all([
      AllianceDomains.find({}, NO_ID).lean(),
      AllianceCampaigns.find({}, { id: 1, sender_domain_id: 1 }).lean(),
      AllianceTouches.find({ channel: 'email', status: 'failed', scheduled_at: { $gte: today } }, { campaign_id: 1 }).lean(),
      AllianceEmailInbound.find({ received_at: { $gte: today } }, { campaign_id: 1, subject: 1, from_email: 1, to_email: 1 }).lean(),
      AllianceEmailSyncState.find({}).lean(),
    ]);
    const campaignDomain = new Map(emailCampaignRows.map((c) => [c.id, c.sender_domain_id]));
    const domainList = domainRows.map((d) => {
      const sync = syncRows.find((row) => String(row.mailbox ?? '').toLowerCase() === String(d.inbox_email ?? '').toLowerCase());
      return {
        id: d.id, inbox_email: d.inbox_email, provider: d.provider, warmup_stage: d.warmup_stage, daily_cap: d.daily_cap,
        sent_today: d.sent_today, reputation: d.reputation, status: d.status, last_reset: d.last_reset, created_at: d.created_at,
        failed_today: failedToday.filter((t) => campaignDomain.get(t.campaign_id) === d.id).length,
        replies_today: inboundToday.filter((ei) => campaignDomain.has(ei.campaign_id) && campaignDomain.get(ei.campaign_id) === d.id && !isBounce(ei)).length,
        bounce_notices_today: inboundToday.filter((ei) => String(ei.to_email ?? '').toLowerCase() === String(d.inbox_email ?? '').toLowerCase() && isBounce(ei)).length,
        imap_last_checked_at: sync?.last_checked_at ?? null,
        imap_last_success_at: sync?.last_success_at ?? null,
        imap_last_error: sync?.last_error ?? null,
      };
    }).sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || new Date(a.created_at || 0) - new Date(b.created_at || 0));
    const domains = { rows: domainList };
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
    const audiences = { rows: await AllianceAudiences.find({ active: true }, { _id: 0, code: 1, label: 1, brand: 1 }).sort({ label: 1 }).lean() };
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
    await assertReferenceExists('alliance_audiences', 'code', rule.audience, 'alliance_prompt_rules');
    const created = await AlliancePromptRules.create(rule);
    res.status(201).json({ rule: created.toObject() });
  } catch (dbError) { if(dbError.code==='23503')return res.status(400).json({error:'Select a valid audience.'}); res.status(500).json({error:'Failed to create AI prompt rule.'}); }
});

router.patch('/prompt-rules/:id', async (req, res) => {
  const { rule, error } = validatePromptRule(req.body); if (error) return res.status(400).json({ error });
  try {
    await assertReferenceExists('alliance_audiences', 'code', rule.audience, 'alliance_prompt_rules');
    const updated = await AlliancePromptRules.findOneAndUpdate({ id: req.params.id }, { $set: { ...rule, updated_at: new Date() } }, { new: true, projection: NO_ID }).lean();
    if(!updated)return res.status(404).json({error:'AI prompt rule not found.'}); res.json({rule:updated});
  } catch (dbError) { if(dbError.code==='23503')return res.status(400).json({error:'Select a valid audience.'}); res.status(500).json({error:'Failed to update AI prompt rule.'}); }
});

router.delete('/prompt-rules/:id', async (req, res) => {
  try { const result=await AlliancePromptRules.deleteOne({ id: req.params.id }); if(!result.deletedCount)return res.status(404).json({error:'AI prompt rule not found.'}); res.json({success:true}); }
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
    const brand = await AllianceBrands.exists({ id: brandId });
    if (!brand) return res.status(404).json({ error: 'Brand not found.' });

    const blocks = splitOfferingBlocks(rawText);
    if (blocks.length > 60) return res.status(400).json({ error: `Detected ${blocks.length} records — paste in smaller batches (max 60 at a time).` });

    const created = [];
    const failed = [];
    for (const block of blocks) {
      try {
        const extracted = await extractOfferingFromText(block);
        const createdOffering = await AllianceOfferings.create({
          brand_id: brandId, offering_code: text(extracted.offering_code),
          offering_type: ['course', 'service'].includes(extracted.offering_type) ? extracted.offering_type : 'course',
          name: text(extracted.name), category: text(extracted.category), tier: text(extracted.tier),
          status: ['active', 'inactive'].includes(extracted.status) ? extracted.status : 'active',
          short_description: text(extracted.short_description), fee: text(extracted.fee), duration: text(extracted.duration),
          details: extracted.details && typeof extracted.details === 'object' ? extracted.details : {},
        });
        const offering = { rows: [createdOffering] };
        let faqCount = 0;
        if (Array.isArray(extracted.faqs)) {
          for (const faq of extracted.faqs) {
            if (text(faq?.question) && text(faq?.answer)) {
              await AllianceOfferingFaqs.create({ offering_id: offering.rows[0].id, question: text(faq.question), answer: text(faq.answer) });
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
    const brands = await AllianceBrands.find({}, NO_ID).sort({ name: 1 }).lean();
    const offeringCounts = new Map((await AllianceOfferings.aggregate([{ $group: { _id: '$brand_id', count: { $sum: 1 } } }])).map((row) => [row._id, row.count]));
    res.json({ brands: brands.map((brand) => ({ ...brand, offering_count: offeringCounts.get(brand.id) || 0 })) });
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
    await assertReferenceExists('alliance_audiences', 'code', text(req.body.audience) || null, 'alliance_brands');
    const brand = (await AllianceBrands.create({
      code, audience: text(req.body.audience) || null, name, description: text(req.body.description), phone: text(req.body.phone),
      whatsapp: text(req.body.whatsapp), email: text(req.body.email), website: text(req.body.website), address: text(req.body.address),
      business_hours: businessHours, languages: text(req.body.languages), target_customers: text(req.body.target_customers),
      primary_contact: text(req.body.primary_contact), escalation_contact: text(req.body.escalation_contact),
      escalation_phone: text(req.body.escalation_phone),
      policies: req.body.policies && typeof req.body.policies === 'object' ? req.body.policies : {},
      verified_by: text(req.body.verified_by), last_verified_date: req.body.last_verified_date || null,
    })).toObject();
    res.status(201).json({ success: true, brand });
  } catch (error) {
    if (isDuplicateKey(error)) return res.status(409).json({ error: 'A brand with this code already exists.' });
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
    const changes = {};
    for (const field of fields) {
      if (field in req.body) { const fieldValue = field === 'business_hours' ? businessHours : req.body[field]; changes[field] = nullIfEmpty.has(field) ? (fieldValue || null) : fieldValue; }
    }
    if ('policies' in req.body) changes.policies = req.body.policies && typeof req.body.policies === 'object' ? req.body.policies : {};
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'No fields to update.' });
    if ('audience' in changes) await assertReferenceExists('alliance_audiences', 'code', changes.audience, 'alliance_brands');
    changes.updated_at = new Date();
    const brand = await AllianceBrands.findOneAndUpdate({ id: req.params.id }, { $set: changes }, { new: true, projection: NO_ID }).lean();
    if (!brand) return res.status(404).json({ error: 'Brand not found.' });
    res.json({ success: true, brand });
  } catch (error) {
    console.error('Alliance brain brand update failed:', error);
    res.status(500).json({ error: 'Failed to update brand.' });
  }
});

router.delete('/brain/brands/:id', async (req, res) => {
  try {
    const deleted = await deleteCascade('alliance_brands', { id: req.params.id });
    if (!deleted.length) return res.status(404).json({ error: 'Brand not found.' });
    res.json({ success: true, message: 'Brand and its offerings/FAQs were removed.' });
  } catch (error) {
    console.error('Alliance brain brand delete failed:', error);
    res.status(500).json({ error: 'Failed to delete brand.' });
  }
});

router.get('/brain/brands/:id/offerings', async (req, res) => {
  try {
    const offerings = await AllianceOfferings.find({ brand_id: req.params.id }, NO_ID).sort({ name: 1 }).lean();
    const faqCounts = new Map((await AllianceOfferingFaqs.aggregate([
      { $match: { offering_id: { $in: offerings.map((o) => o.id) } } },
      { $group: { _id: '$offering_id', count: { $sum: 1 } } },
    ])).map((row) => [row._id, row.count]));
    res.json({ offerings: offerings.map((o) => ({ ...o, faq_count: faqCounts.get(o.id) || 0 })) });
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
    await assertReferenceExists('alliance_brands', 'id', Number(brandId), 'alliance_offerings');
    const offering = (await AllianceOfferings.create({
      brand_id: brandId, offering_code: text(req.body.offering_code), offering_type: offeringType, name,
      category: text(req.body.category), tier: text(req.body.tier),
      status: ['active', 'inactive'].includes(req.body.status) ? req.body.status : 'active',
      short_description: text(req.body.short_description), fee: text(req.body.fee), duration: text(req.body.duration),
      details: req.body.details && typeof req.body.details === 'object' ? req.body.details : {},
      verified_by: text(req.body.verified_by), last_verified_date: req.body.last_verified_date || null,
    })).toObject();
    res.status(201).json({ success: true, offering });
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Brand not found.' });
    console.error('Alliance brain offering create failed:', error);
    res.status(500).json({ error: 'Failed to create offering.' });
  }
});

router.patch('/brain/offerings/:id', async (req, res) => {
  try {
    const fields = ['offering_code', 'offering_type', 'name', 'category', 'tier', 'status', 'short_description', 'fee', 'duration', 'verified_by', 'last_verified_date'];
    const changes = {};
    for (const field of fields) {
      if (field in req.body) changes[field] = field === 'last_verified_date' ? (req.body[field] || null) : req.body[field];
    }
    if ('details' in req.body) changes.details = req.body.details && typeof req.body.details === 'object' ? req.body.details : {};
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'No fields to update.' });
    changes.updated_at = new Date();
    const offering = await AllianceOfferings.findOneAndUpdate({ id: req.params.id }, { $set: changes }, { new: true, projection: NO_ID }).lean();
    if (!offering) return res.status(404).json({ error: 'Offering not found.' });
    res.json({ success: true, offering });
  } catch (error) {
    console.error('Alliance brain offering update failed:', error);
    res.status(500).json({ error: 'Failed to update offering.' });
  }
});

router.delete('/brain/offerings/:id', async (req, res) => {
  try {
    const deleted = await deleteCascade('alliance_offerings', { id: req.params.id });
    if (!deleted.length) return res.status(404).json({ error: 'Offering not found.' });
    res.json({ success: true, message: 'Offering and its FAQs were removed.' });
  } catch (error) {
    console.error('Alliance brain offering delete failed:', error);
    res.status(500).json({ error: 'Failed to delete offering.' });
  }
});

router.get('/brain/offerings/:id/faqs', async (req, res) => {
  try {
    const faqs = await AllianceOfferingFaqs.find({ offering_id: req.params.id }, NO_ID).sort({ sort_order: 1, id: 1 }).lean();
    res.json({ faqs });
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
    await assertReferenceExists('alliance_offerings', 'id', Number(req.params.id), 'alliance_offering_faqs');
    const faq = (await AllianceOfferingFaqs.create({ offering_id: req.params.id, question, answer, sort_order: Number(req.body.sort_order) || 0 })).toObject();
    res.status(201).json({ success: true, faq });
  } catch (error) {
    if (error.code === '23503') return res.status(400).json({ error: 'Offering not found.' });
    console.error('Alliance brain faq create failed:', error);
    res.status(500).json({ error: 'Failed to add FAQ.' });
  }
});

router.patch('/brain/faqs/:id', async (req, res) => {
  try {
    const fields = ['question', 'answer', 'sort_order'];
    const changes = {};
    for (const field of fields) {
      if (field in req.body) changes[field] = req.body[field];
    }
    if (!Object.keys(changes).length) return res.status(400).json({ error: 'No fields to update.' });
    const faq = await AllianceOfferingFaqs.findOneAndUpdate({ id: req.params.id }, { $set: changes }, { new: true, projection: NO_ID }).lean();
    if (!faq) return res.status(404).json({ error: 'FAQ not found.' });
    res.json({ success: true, faq });
  } catch (error) {
    console.error('Alliance brain faq update failed:', error);
    res.status(500).json({ error: 'Failed to update FAQ.' });
  }
});

router.delete('/brain/faqs/:id', async (req, res) => {
  try {
    const result = await AllianceOfferingFaqs.deleteOne({ id: req.params.id });
    if (!result.deletedCount) return res.status(404).json({ error: 'FAQ not found.' });
    res.json({ success: true, message: 'FAQ deleted.' });
  } catch (error) {
    console.error('Alliance brain faq delete failed:', error);
    res.status(500).json({ error: 'Failed to delete FAQ.' });
  }
});

module.exports = router;
