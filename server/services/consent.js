/**
 * Marketing consent per contact (plan N1).
 *
 * The `whatsapp_consents` collection is the source of truth: one row per
 * (tenant, phone) with the current status, how/when/with which text the
 * contact opted in, how/when they opted out, and the full event history.
 * The lead row mirrors the booleans (`whatsapp_opt_in`, `whatsapp_opt_out`,
 * `opted_out`) so existing filters and the inbox keep working.
 *
 * Opting out cancels every queued marketing message for the contact at once.
 * All functions run inside the caller's tenant context.
 */
const { Leads, WhatsappConsents, CampaignMessageQueue } = require('../models');
const { phoneTailRegex, NO_ID } = require('../db/mongo');

const SOURCE_PATTERN = /^[a-z][a-z0-9_]{0,39}$/;
const MAX_TEXT = 2000;

const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');
const phoneKeyOf = (phone) => digitsOf(phone).slice(-10);

function cleanSource(source, fallback = 'manual') {
  const value = String(source || '').trim().toLowerCase();
  return SOURCE_PATTERN.test(value) ? value : fallback;
}

const cleanText = (text) => String(text ?? '').trim().slice(0, MAX_TEXT);

/** The consent row for a phone (or lead), or null. */
async function getConsent({ phone, leadId } = {}) {
  let key = phoneKeyOf(phone);
  if (!key && leadId != null) {
    const lead = await Leads.findOne({ id: Number(leadId) }, { _id: 0, phone: 1 }).lean();
    key = phoneKeyOf(lead?.phone);
  }
  if (!key) return null;
  return WhatsappConsents.findOne({ phone_key: key }, NO_ID).lean();
}

async function resolvePhone({ phone, leadId }) {
  let digits = digitsOf(phone);
  let lead = null;
  if (leadId != null) {
    lead = await Leads.findOne({ id: Number(leadId) }, { _id: 0, id: 1, phone: 1 }).lean();
    if (!digits) digits = digitsOf(lead?.phone);
  }
  const key = digits.slice(-10);
  if (key.length < 10) throw Object.assign(new Error('A phone number with at least 10 digits is required'), { status: 400, code: 'INVALID_PHONE' });
  return { digits, key, leadId: lead?.id ?? (leadId != null ? Number(leadId) : null) };
}

async function upsertConsent(key, set, event, leadId, digits) {
  const now = event.at;
  const existing = await WhatsappConsents.findOneAndUpdate(
    { phone_key: key },
    { $set: { ...set, phone: digits, ...(leadId != null ? { lead_id: leadId } : {}), updated_at: now }, $push: { events: event } },
    { new: true, projection: NO_ID },
  ).lean();
  if (existing) return existing;
  try {
    return (await WhatsappConsents.create({
      phone: digits, phone_key: key, lead_id: leadId ?? null, ...set, events: [event], created_at: now, updated_at: now,
    })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    return WhatsappConsents.findOneAndUpdate(
      { phone_key: key },
      { $set: { ...set, updated_at: now }, $push: { events: event } },
      { new: true, projection: NO_ID },
    ).lean();
  }
}

/**
 * Records that the contact agreed to marketing messages.
 * `text` is the wording they agreed to (checkbox label, keyword, form field).
 */
async function recordOptIn({ phone, leadId, source, text, by = null, at = new Date() }) {
  const { digits, key, leadId: resolvedLeadId } = await resolvePhone({ phone, leadId });
  const event = { type: 'opt_in', source: cleanSource(source), text: cleanText(text), at, by: by ?? null };
  const consent = await upsertConsent(key, {
    status: 'opted_in', opt_in_source: event.source, opt_in_at: at, opt_in_text: event.text, opt_in_by: event.by,
  }, event, resolvedLeadId, digits);
  await Leads.updateMany({ phone: phoneTailRegex(key) }, {
    $set: { whatsapp_opt_in: true, whatsapp_opt_in_at: at, whatsapp_opt_out: false, opted_out: false, updated_at: at },
  });
  return consent;
}

/**
 * Records that the contact asked us to stop. Every queued marketing message
 * for the number is cancelled and the AI follow-up schedule is cleared.
 */
async function recordOptOut({ phone, leadId, source, text, by = null, at = new Date() }) {
  const { digits, key, leadId: resolvedLeadId } = await resolvePhone({ phone, leadId });
  const event = { type: 'opt_out', source: cleanSource(source, 'inbound_keyword'), text: cleanText(text), at, by: by ?? null };
  const consent = await upsertConsent(key, {
    status: 'opted_out', opt_out_source: event.source, opt_out_at: at, opt_out_text: event.text, opt_out_by: event.by,
  }, event, resolvedLeadId, digits);
  await Leads.updateMany({ phone: phoneTailRegex(key) }, {
    $set: { whatsapp_opt_out: true, whatsapp_opt_out_at: at, opted_out: true, opted_out_at: at, ai_followup_due: null, updated_at: at },
  });
  const cancelled = await CampaignMessageQueue.updateMany(
    { phone: phoneTailRegex(key), kind: 'marketing', status: { $in: ['pending', 'processing'] } },
    { $set: { status: 'cancelled', skip_reason: 'Contact opted out', processed_at: at } },
  );
  return { ...consent, cancelled_queued: cancelled.modifiedCount || 0 };
}

/** Is the contact opted out? Works from a lead row (mirror flags) or the consent row. */
function optedOut(lead, consent) {
  if (consent?.status === 'opted_out') return true;
  if (consent?.status === 'opted_in') return false;
  return Boolean(lead?.opted_out || lead?.whatsapp_opt_out);
}

/**
 * May marketing be sent to this contact? { allowed, code, message }.
 * Codes: CONTACT_OPTED_OUT, CONSENT_REQUIRED.
 */
async function marketingAllowed({ lead, phone }) {
  const consent = await getConsent({ phone: phone || lead?.phone, leadId: lead?.id });
  if (optedOut(lead, consent)) {
    return { allowed: false, code: 'CONTACT_OPTED_OUT', message: 'This contact asked us to stop marketing messages', consent };
  }
  if (consent?.status !== 'opted_in') {
    return { allowed: false, code: 'CONSENT_REQUIRED', message: 'This contact has not opted in to marketing messages', consent };
  }
  return { allowed: true, consent };
}

module.exports = {
  SOURCE_PATTERN,
  digitsOf,
  phoneKeyOf,
  cleanSource,
  getConsent,
  recordOptIn,
  recordOptOut,
  optedOut,
  marketingAllowed,
};
