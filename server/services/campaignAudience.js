/**
 * Who a campaign goes to, and what the owner sees before sending (plan N4).
 *
 * resolveAudience() is the single definition of an audience. executeCampaign
 * (the send) and previewCampaign (the preview) both call it, so what the owner
 * sees is what is queued. Opt-in is never decided here: the preview only
 * reports who the send queue will let through; the queue re-checks consent,
 * STOP, the number's marketing pause and the daily cap at send time
 * (services/sendPolicy.js, services/whatsappSendQueue.js).
 *
 * Audience kinds, in order: an uploaded list (target_status "csv_..."), a tag
 * (target_tag_id), a lead status, or everyone of the brand ("all").
 * Every query runs inside the caller's tenant context.
 */
const { Leads, LeadTags, CampaignImportRecipients, WhatsappConsents, AllianceInboxTags, Clients, Templates, MetaWhatsappPhoneNumbers } = require('../models');
const { NO_ID } = require('../db/mongo');
const consent = require('./consent');
const numberHealth = require('./numberHealth');
const { renderCampaignBody, validateCampaignTemplate, validateCampaignParameterMappings } = require('./campaignTemplates');

const LEAD_FIELDS = { _id: 0, id: 1, phone: 1, name: 1, email: 1, status: 1, source: 1, interest: 1, score: 1, opted_out: 1, whatsapp_opt_out: 1 };
const SAMPLE_SIZE = 3;

const maskPhone = (phone) => {
  const digits = consent.digitsOf(phone);
  return digits.length > 4 ? `${'•'.repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : '••••';
};

/** The leads of an audience. `campaign` = { client_id, target_status, target_tag_id }. */
async function resolveAudience(campaign) {
  const target = String(campaign.target_status || 'all');
  if (target.startsWith('csv_')) {
    // A custom upload is an exact audience.
    const recipients = await CampaignImportRecipients.find({ batch_id: target }, NO_ID).lean();
    const byId = new Map((await Leads.find({ id: { $in: recipients.map((r) => r.lead_id) } }, LEAD_FIELDS).lean()).map((l) => [l.id, l]));
    return recipients
      .filter((r) => byId.has(r.lead_id) && String(byId.get(r.lead_id).phone ?? '').trim() !== '')
      .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0) || a.lead_id - b.lead_id)
      .map((r) => ({ ...byId.get(r.lead_id), template_parameters: r.template_parameters }));
  }
  const filter = { client_id: campaign.client_id };
  if (campaign.target_tag_id != null && campaign.target_tag_id !== '') {
    const links = await LeadTags.find({ tag_id: Number(campaign.target_tag_id) }, { _id: 0, lead_id: 1 }).lean();
    filter.id = { $in: links.map((link) => link.lead_id) };
  }
  if (target && target !== 'all') filter.status = target;
  return Leads.find(filter, LEAD_FIELDS).lean();
}

/** Tags in use in this workspace, with how many leads carry each: [{ id, name, color, lead_count }]. */
async function listTags(clientId = null) {
  const counts = await LeadTags.aggregate([{ $group: { _id: '$tag_id', lead_count: { $sum: 1 } } }]);
  if (!counts.length) return [];
  const names = new Map((await AllianceInboxTags.find({ id: { $in: counts.map((c) => c._id) } }, { _id: 0, id: 1, name: 1, color: 1 }).lean()).map((t) => [t.id, t]));
  void clientId;
  return counts
    .filter((c) => names.has(c._id))
    .map((c) => ({ id: c._id, name: names.get(c._id).name, color: names.get(c._id).color, lead_count: c.lead_count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Splits an audience by what the send queue will do with each contact.
 * Mirrors consent.marketingAllowed() with one consent query for the whole list.
 */
async function classify(leads) {
  const keys = [...new Set(leads.map((lead) => consent.phoneKeyOf(lead.phone)).filter((key) => key.length === 10))];
  const rows = keys.length ? await WhatsappConsents.find({ phone_key: { $in: keys } }, { _id: 0, phone_key: 1, status: 1 }).lean() : [];
  const byKey = new Map(rows.map((row) => [row.phone_key, row]));
  const result = { eligible: [], opted_out: 0, no_consent: 0, invalid_phone: 0 };
  for (const lead of leads) {
    if (consent.digitsOf(lead.phone).length < 10) { result.invalid_phone += 1; continue; }
    const row = byKey.get(consent.phoneKeyOf(lead.phone));
    if (consent.optedOut(lead, row)) result.opted_out += 1;
    else if (row?.status !== 'opted_in') result.no_consent += 1;
    else result.eligible.push(lead);
  }
  return result;
}

const STATUS_LABELS = Object.freeze({
  new: 'New leads', hot: 'Hot leads', warm: 'Warm leads', cold: 'Cold leads', contacted: 'Contacted', qualified: 'Qualified',
  interested: 'Interested', converted: 'Converted', lost: 'Lost', unqualified: 'Unqualified',
});
const statusLabel = (status) => STATUS_LABELS[status] || `${String(status).charAt(0).toUpperCase()}${String(status).slice(1).replace(/_/g, ' ')} leads`;

/**
 * Who can be targeted, with counts, for the campaign builder: lead statuses
 * that have contacts (zero-count statuses are left out), all contacts, and
 * tags. Runs inside the caller's tenant.
 */
async function audienceCounts(clientId) {
  const match = clientId != null && clientId !== '' ? { client_id: Number(clientId) } : {};
  const rows = await Leads.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  const statuses = rows
    .filter((row) => row._id != null && String(row._id).trim() !== '' && row.count > 0)
    .map((row) => ({ value: String(row._id), label: statusLabel(row._id), count: row.count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { total, statuses, tags: (await listTags()).filter((tag) => tag.lead_count > 0) };
}

const TIER_LABELS = Object.freeze({ TIER_50: 50, TIER_250: 250, TIER_1K: 1000, TIER_10K: 10000, TIER_100K: 100000, TIER_UNLIMITED: null });

/**
 * What the number may still send: the daily cap (bounded by Meta's messaging
 * tier) and what is left of it on the send day. Counters are per UTC day (the
 * cap resets at 05:30 IST). A send on a later day has the whole cap.
 */
async function sendingBudget(phoneNumberId, { at = null, now = new Date() } = {}) {
  const number = await numberHealth.summary(phoneNumberId, now);
  let tier = number.messaging_limit;
  if (!tier) {
    const meta = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(phoneNumberId) }, { _id: 0, raw_data: 1 }).lean().catch(() => null);
    tier = meta?.raw_data?.messaging_limit_tier || null;
  }
  const sameDay = !at || at <= now || numberHealth.utcDay(at) === numberHealth.utcDay(now);
  return {
    phone_number_id: number.phone_number_id, quality_rating: number.quality_rating, marketing_paused: number.marketing_paused,
    messaging_limit: tier, tier_limit: tier && tier in TIER_LABELS ? TIER_LABELS[tier] : null,
    daily_cap: number.daily_cap, used_today: number.templates_today, remaining_today: number.remaining_today,
    same_day: sameDay, available: sameDay ? number.remaining_today : number.daily_cap,
    resets_at: numberHealth.nextUtcMidnight(now).toISOString(),
  };
}

/**
 * The preview: nothing is queued or sent. Returns what the owner must check
 * before pressing Send: audience size and who is left out and why, example
 * messages, template status, the number's limits and the schedule.
 */
async function previewCampaign(input) {
  const warnings = [];
  const brand = input.client_id != null ? await Clients.findOne({ id: Number(input.client_id) }, { _id: 0, id: 1, name: 1, phone_number_id: 1, whatsapp_status: 1 }).lean() : null;
  const template = input.template_id != null ? await Templates.findOne({ id: Number(input.template_id) }, NO_ID).lean() : null;
  const out = { template: null, audience: null, sample: [], sending: null, schedule: null, warnings, can_send: true, blockers: [] };
  const block = (message) => { out.blockers.push(message); out.can_send = false; };

  if (!brand) block('Choose a brand.');
  if (!template) {
    block('Choose a template.');
  } else {
    const approved = ['approved', 'active'].includes(String(template.status).toLowerCase());
    out.template = { id: template.id, name: template.name, category: template.category, status: template.status, language: template.language, body: template.body };
    if (!approved) block('Only Meta-approved templates can be used for campaigns.');
    if (template.client_id && brand && Number(template.client_id) !== Number(brand.id)) block('This template belongs to another brand.');
    const templateError = validateCampaignTemplate(template) || validateCampaignParameterMappings(template, input.template_parameters || {});
    if (templateError) block(templateError);
  }
  if (brand && brand.whatsapp_status !== 'verified') block('WhatsApp is not verified for this brand yet.');

  const target = String(input.target_status || 'all');
  const hasTag = input.target_tag_id != null && input.target_tag_id !== '';
  if (!target && !hasTag) block('Choose who should receive it.');
  const leads = brand ? await resolveAudience({ client_id: brand.id, target_status: target, target_tag_id: hasTag ? input.target_tag_id : null }) : [];
  const sorted = await classify(leads);
  out.audience = {
    kind: target.startsWith('csv_') ? 'uploaded_list' : hasTag ? 'tag' : target === 'all' ? 'all' : 'status',
    total: leads.length,
    will_send: sorted.eligible.length,
    left_out: { opted_out: sorted.opted_out, no_consent: sorted.no_consent, invalid_phone: sorted.invalid_phone },
  };
  if (!leads.length) block('Nobody matches this audience.');
  else if (!sorted.eligible.length) block('Nobody in this audience has agreed to receive marketing messages.');
  else if (sorted.no_consent + sorted.opted_out + sorted.invalid_phone > 0) {
    warnings.push(`${sorted.no_consent + sorted.opted_out + sorted.invalid_phone} of ${leads.length} contacts will be skipped: they have not opted in, asked us to stop, or have no valid number.`);
  }

  if (template) {
    out.sample = sorted.eligible.slice(0, SAMPLE_SIZE).map((lead) => ({
      name: lead.name || '', phone: maskPhone(lead.phone),
      message: renderCampaignBody({
        template_body: template.body, template_parameters: input.template_parameters || {}, name: lead.name, phone: lead.phone,
        campaign_name: input.name || '', brand_name: brand?.name || '', recipient_parameters: lead.template_parameters || {},
        recipient_data: { recipient_email: lead.email || '', lead_status: lead.status || '', lead_source: lead.source || '', lead_interest: lead.interest || '', lead_score: lead.score ?? '' },
      }),
    }));
  }

  const at = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (brand?.phone_number_id) {
    const budget = await sendingBudget(brand.phone_number_id, { at: at && !Number.isNaN(at.getTime()) ? at : null });
    const willSend = sorted.eligible.length;
    out.sending = {
      quality_rating: budget.quality_rating, marketing_paused: budget.marketing_paused, messaging_limit: budget.messaging_limit,
      tier_limit: budget.tier_limit, daily_limit: budget.daily_cap, used_today: budget.used_today, remaining_today: budget.remaining_today,
      available_on_send_day: budget.available, over_limit: willSend > budget.available, overflow: Math.max(0, willSend - budget.available),
      days_needed: budget.daily_cap > 0 ? Math.max(1, Math.ceil(Math.max(0, willSend - budget.available) / budget.daily_cap) + (budget.available > 0 ? 1 : 0)) : null,
    };
    if (budget.marketing_paused) {
      block('Marketing is paused on your WhatsApp number. It resumes when Meta rates the number healthy again.');
    } else if (out.sending.over_limit) {
      warnings.push(budget.available > 0
        ? `Your number can send ${budget.available} more messages ${budget.same_day ? 'today' : 'that day'}, but ${willSend} contacts will receive this. The first ${budget.available} go out ${budget.same_day ? 'now' : 'then'} and the rest ${out.sending.days_needed > 2 ? `over the next ${out.sending.days_needed - 1} days` : 'the next day'}.`
        : `Your number has used today's limit of ${budget.daily_cap} messages. This campaign would start tomorrow${out.sending.days_needed > 1 ? ` and take ${out.sending.days_needed} days` : ''}.`);
    }
  } else if (brand) {
    block('No WhatsApp number is connected for this brand.');
  }

  if (at && Number.isNaN(at.getTime())) block('The schedule is not a valid date.');
  else out.schedule = { immediate: !at || at <= new Date(), at: at && at > new Date() ? at.toISOString() : null };
  return out;
}

module.exports = { resolveAudience, listTags, classify, previewCampaign, maskPhone, audienceCounts, sendingBudget, statusLabel };
