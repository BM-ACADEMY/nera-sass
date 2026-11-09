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
const { Leads, LeadTags, CampaignImportRecipients, WhatsappConsents, AllianceInboxTags, Clients, Templates } = require('../models');
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

  if (brand?.phone_number_id) {
    const number = await numberHealth.summary(brand.phone_number_id);
    const block1 = await numberHealth.marketingBlock(brand.phone_number_id);
    out.sending = {
      quality_rating: number.quality_rating, marketing_paused: number.marketing_paused,
      daily_limit: number.daily_cap, remaining_today: number.remaining_today,
      days_needed: number.daily_cap > 0 ? Math.max(1, Math.ceil(sorted.eligible.length / number.daily_cap)) : null,
    };
    if (block1) {
      block('Marketing is paused on your WhatsApp number. It resumes when Meta rates the number healthy again.');
    } else if (sorted.eligible.length > number.remaining_today) {
      warnings.push(`Your number can send ${number.remaining_today} more marketing messages today. The rest go out over the next ${out.sending.days_needed} day(s), automatically.`);
    }
  } else if (brand) {
    block('No WhatsApp number is connected for this brand.');
  }

  const at = input.scheduled_at ? new Date(input.scheduled_at) : null;
  if (at && Number.isNaN(at.getTime())) block('The schedule is not a valid date.');
  else out.schedule = { immediate: !at || at <= new Date(), at: at && at > new Date() ? at.toISOString() : null };
  return out;
}

module.exports = { resolveAudience, listTags, classify, previewCampaign, maskPhone };
