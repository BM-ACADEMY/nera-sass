const axios = require('axios');
const {
  AllianceWhatsappCampaigns,
  AllianceWhatsappCampaignRecipients,
  AllianceWhatsappFollowupJobs,
  AllianceProspects,
  AllianceInboxContacts,
  AllianceInboxConversations,
  AllianceInboxMessages,
  AllianceInboxSettings,
  AllianceBulkSendLimits,
  Templates,
} = require('../models');
const ensureAllianceSchema = require('../db/alliance-schema');

let interval;
let followupInterval;
let processing = false;
let followupProcessing = false;

const APPROVED_CONSENT_SOURCES = new Set(['website_form', 'click_to_whatsapp_ad', 'qr_code_optin', 'inbound_whatsapp_optin', 'event_registration', 'customer_request', 'written_consent']);
const APPROVED_CONSENT_SCOPES = new Set(['marketing', 'service', 'both']);
const NON_CONSENT_SOURCE_PATTERN = /(scrap|purchas|directory|research)/i;

const tokenFor = (settings) => process.env[settings?.access_token_env || 'ALLIANCE_WA_ACCESS_TOKEN'];
const valueFor = (field, prospect) => {
  const customFields = typeof prospect.custom_fields === 'string'
    ? JSON.parse(prospect.custom_fields || '{}')
    : (prospect.custom_fields || {});
  const resolved = prospect[field] ?? customFields[field] ?? (field === 'name' ? prospect.business_name : null);
  return resolved === null || resolved === undefined || resolved === '' ? 'there' : String(resolved);
};

const phoneValidationReason = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) return 'invalid_e164_phone_format';
  if (digits.startsWith('91') && !/^91[6-9]\d{9}$/.test(digits)) {
    return 'invalid_india_mobile_format_expected_91_plus_10_digits_starting_6_to_9';
  }
  return null;
};

const CLOSED_PROSPECT_STATUSES = ['converted', 'closed', 'complete', 'completed', 'not_interested', 'unsubscribed'];
// p.status NOT IN (...) — a NULL status never matches, exactly as in SQL
const isOpenProspect = (prospect) => prospect && prospect.status != null && !CLOSED_PROSPECT_STATUSES.includes(prospect.status);
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const NO_ID = { _id: 0 };

async function mapById(model, ids, projection) {
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined))];
  if (!unique.length) return new Map();
  return new Map((await model.find({ id: { $in: unique } }, projection).lean()).map((doc) => [doc.id, doc]));
}

// last_inbound_at of the prospect's inbox conversation (LEFT JOIN contacts/conversations).
async function lastInboundAt(prospectId) {
  const contact = await AllianceInboxContacts.findOne({ prospect_id: prospectId }, { id: 1 }).lean();
  if (!contact) return null;
  const conversation = await AllianceInboxConversations.findOne({ contact_id: contact.id }, { last_inbound_at: 1 }).lean();
  return conversation?.last_inbound_at ?? null;
}

// INSERT INTO alliance_whatsapp_followup_jobs ... ON CONFLICT DO NOTHING
async function insertFollowupJob(doc) {
  try {
    return (await AllianceWhatsappFollowupJobs.create(doc)).toObject();
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

const prospectFields = (p) => ({
  name: p.name, business_name: p.business_name, location: p.location, phone: p.phone, email: p.email,
  audience: p.audience, industry: p.industry, source: p.source, channel: p.channel, channel_pref: p.channel_pref,
  ai_score: p.ai_score, created_at: p.created_at, custom_fields: p.custom_fields,
  consent: p.consent, consent_source: p.consent_source, consent_at: p.consent_at, consent_evidence: p.consent_evidence,
  consent_scope: p.consent_scope, suppressed: p.suppressed,
});

// Cancels queued recipients beyond the custom WhatsApp bulk-send limit, per campaign.
async function enforceBulkSendLimit() {
  const policy = await AllianceBulkSendLimits.findOne({ channel: 'whatsapp', limit_mode: 'custom' }, { custom_limit: 1 }).lean();
  if (!policy) return;
  const queued = await AllianceWhatsappCampaignRecipients.find({ status: 'queued' }, { id: 1, campaign_id: 1, scheduled_at: 1 })
    .sort({ scheduled_at: 1, id: 1 }).lean();
  if (!queued.length) return;
  const sentTotals = new Map((await AllianceWhatsappCampaignRecipients.aggregate([
    { $match: { status: { $in: ['sent', 'delivered', 'read'] } } },
    { $group: { _id: '$campaign_id', total: { $sum: 1 } } },
  ])).map((row) => [row._id, row.total]));
  const positions = new Map();
  const overLimit = [];
  for (const recipient of queued) {
    const position = (positions.get(recipient.campaign_id) || 0) + 1;
    positions.set(recipient.campaign_id, position);
    const allowed = Math.max(Number(policy.custom_limit) - (sentTotals.get(recipient.campaign_id) || 0), 0);
    if (position > allowed) overLimit.push(recipient.id);
  }
  if (overLimit.length) {
    await AllianceWhatsappCampaignRecipients.updateMany(
      { id: { $in: overLimit } },
      { $set: { status: 'cancelled', error_message: 'bulk_send_limit_reached' } }
    );
  }
}

async function claimRecipient() {
  await enforceBulkSendLimit();
  const activeCampaignIds = await AllianceWhatsappCampaigns.distinct('id', { status: { $in: ['scheduled', 'running'] } });
  if (!activeCampaignIds.length) return null;
  const candidates = await AllianceWhatsappCampaignRecipients.find(
    { status: 'queued', scheduled_at: { $lte: new Date() }, campaign_id: { $in: activeCampaignIds } },
    { id: 1, campaign_id: 1, prospect_id: 1 }
  ).sort({ scheduled_at: 1, id: 1 }).lean();

  for (const recipient of candidates) {
    const [c, p] = await Promise.all([
      AllianceWhatsappCampaigns.findOne({ id: recipient.campaign_id }).lean(),
      AllianceProspects.findOne({ id: recipient.prospect_id }).lean(),
    ]);
    if (!c || !p) continue;
    // Atomically claim the recipient (replaces FOR UPDATE SKIP LOCKED)
    const claimed = await AllianceWhatsappCampaignRecipients.updateOne(
      { id: recipient.id, status: 'queued' },
      { $set: { status: 'sending', error_message: null } }
    );
    if (!claimed.modifiedCount) continue;

    const [template, settings, last_inbound_at] = await Promise.all([
      c.template_id != null ? Templates.findOne({ id: c.template_id }, { buttons: 1 }).lean() : null,
      AllianceInboxSettings.findOne({ phone_number_id: c.phone_number_id }, { access_token_env: 1, active: 1 }).lean(),
      lastInboundAt(p.id),
    ]);
    const row = {
      id: recipient.id,
      campaign_id: recipient.campaign_id,
      prospect_id: recipient.prospect_id,
      template_name: c.template_name,
      template_language: c.template_language,
      template_body: c.template_body,
      parameter_mapping: c.parameter_mapping,
      template_buttons: template?.buttons ?? null,
      phone_number_id: c.phone_number_id,
      campaign_name: c.name,
      campaign_created_at: c.created_at,
      followup_template_id: c.followup_template_id,
      followup_delay_days: c.followup_delay_days,
      followup_delay_minutes: c.followup_delay_minutes,
      ...prospectFields(p),
      prospect_status: p.status,
      status: p.status,
      access_token_env: settings?.access_token_env ?? null,
      sender_active: settings ? settings.active : null,
      last_inbound_at,
    };
    const reason = !row.phone ? 'missing_phone' : phoneValidationReason(row.phone) || (!row.consent ? 'whatsapp_consent_missing'
      : !APPROVED_CONSENT_SOURCES.has(String(row.consent_source || '').toLowerCase()) ? 'whatsapp_consent_source_not_approved'
        : !row.consent_at ? 'whatsapp_consent_timestamp_missing'
          : !String(row.consent_evidence || '').trim() ? 'whatsapp_consent_evidence_missing'
            : !APPROVED_CONSENT_SCOPES.has(String(row.consent_scope || '').toLowerCase()) ? 'whatsapp_consent_scope_invalid'
              : NON_CONSENT_SOURCE_PATTERN.test(String(row.source || '')) ? 'whatsapp_consent_disallowed_for_scraped_purchased_directory_or_researched_source'
      : row.suppressed ? 'suppressed' : ['converted','closed','complete','completed','not_interested','unsubscribed'].includes(row.prospect_status) ? `prospect_${row.prospect_status}`
        : row.last_inbound_at && new Date(row.last_inbound_at) >= new Date(row.campaign_created_at) ? 'recipient_replied'
          : row.sender_active === false ? 'sender_inactive' : null);
    if (reason) {
      await AllianceWhatsappCampaignRecipients.updateOne({ id: row.id }, { $set: { status: 'skipped', error_message: reason } });
      return { skipped: true };
    }
    await AllianceWhatsappCampaigns.updateOne(
      { id: row.campaign_id },
      [{ $set: { status: 'running', started_at: { $ifNull: ['$started_at', '$$NOW'] }, updated_at: '$$NOW' } }]
    );
    return row;
  }
  return null;
}

async function storeInboxMessageUnsafe(job, waMessageId, rendered) {
  let contact = await AllianceInboxContacts.findOne({ prospect_id: job.prospect_id }).sort({ id: 1 }).lean();
  if (!contact) {
    contact = await AllianceInboxContacts.findOne({ $or: [{ wa_id: job.phone }, { phone: job.phone }] }).sort({ id: 1 }).lean();
  }
  let contactId;
  if (contact) {
    const [phoneTaken, waIdTaken] = await Promise.all([
      AllianceInboxContacts.exists({ id: { $ne: contact.id }, phone: job.phone }),
      AllianceInboxContacts.exists({ id: { $ne: contact.id }, wa_id: job.phone }),
    ]);
    await AllianceInboxContacts.updateOne({ id: contact.id }, { $set: {
      name: (job.name || job.business_name) ?? contact.name,
      prospect_id: contact.prospect_id ?? job.prospect_id,
      phone: phoneTaken ? contact.phone : job.phone,
      wa_id: waIdTaken ? contact.wa_id : job.phone,
      source: 'alliance_bulk',
      custom_fields: { ...(contact.custom_fields || {}), business_name: job.business_name ?? null },
      updated_at: new Date(),
    } });
    contactId = contact.id;
  } else {
    contactId = (await AllianceInboxContacts.create({
      wa_id: job.phone,
      phone: job.phone,
      name: job.name || job.business_name,
      source: 'alliance_bulk',
      prospect_id: job.prospect_id,
      custom_fields: { business_name: job.business_name ?? null },
    })).id;
  }

  let conversation = await AllianceInboxConversations.findOneAndUpdate(
    { contact_id: contactId },
    { $set: { last_message: rendered, last_message_at: new Date(), updated_at: new Date() } },
    { new: true, projection: { id: 1 } }
  ).lean();
  if (!conversation) {
    conversation = await AllianceInboxConversations.create({
      contact_id: contactId, phone_number_id: job.phone_number_id, last_message: rendered, last_message_at: new Date(),
    });
  }

  const rawPayload = {
    purpose: job.followup_no ? 'automated_followup' : 'bulk_campaign',
    campaign_id: job.campaign_id,
    template_name: job.template_name,
    buttons: Array.isArray(job.template_buttons) ? job.template_buttons : [],
    sender_type: 'automation',
  };
  const existing = waMessageId ? await AllianceInboxMessages.findOne({ wa_msg_id: waMessageId }, { id: 1 }).lean() : null;
  let message;
  if (existing) {
    message = await AllianceInboxMessages.findOneAndUpdate({ id: existing.id }, { $set: { status: 'sent' } }, { new: true, projection: NO_ID }).lean();
  } else {
    message = (await AllianceInboxMessages.create({
      conversation_id: conversation.id,
      contact_id: contactId,
      wa_msg_id: waMessageId,
      direction: 'outbound',
      msg_type: 'template',
      content: rendered,
      status: 'sent',
      raw_payload: rawPayload,
      sent_at: new Date(),
    })).toObject();
  }
  if (message) message.template_buttons = message.raw_payload?.buttons ?? null;
  return { contactId, message: message || null };
}

async function storeInboxMessageSafely(job, waMessageId, rendered) {
  try {
    return await storeInboxMessageUnsafe(job, waMessageId, rendered);
  } catch (error) {
    // Meta already accepted the message. Inbox mirroring is secondary and
    // must not mark a real send failed or cause a duplicate retry.
    console.error('[Alliance WhatsApp inbox mirror]', {
      campaign_id: job.campaign_id,
      prospect_id: job.prospect_id,
      followup_no: job.followup_no || null,
      wa_msg_id: waMessageId,
      error: error.message,
    });
    return { contactId: null, message: null };
  }
}

const storeInboxMessage = storeInboxMessageSafely;

async function completeCampaignIfDone(campaignId) {
  const [pendingRecipient, pendingJob] = await Promise.all([
    AllianceWhatsappCampaignRecipients.exists({ campaign_id: campaignId, status: { $in: ['queued', 'sending'] } }),
    AllianceWhatsappFollowupJobs.exists({ campaign_id: campaignId, status: { $in: ['pending', 'claimed', 'sending'] } }),
  ]);
  if (pendingRecipient || pendingJob) return;
  await AllianceWhatsappCampaigns.updateOne(
    { id: campaignId },
    { $set: { status: 'completed', completed_at: new Date(), updated_at: new Date() } }
  );
}

async function sendRecipient(job, io) {
  let waMessageId = null;
  try {
    const token = tokenFor(job);
    if (!token || !job.phone_number_id) throw new Error('Alliance WhatsApp credentials are not configured.');
    const mapping = Array.isArray(job.parameter_mapping) ? job.parameter_mapping : [];
    const parameters = mapping.map((field) => valueFor(field,job));
    const payload = { messaging_product:'whatsapp',recipient_type:'individual',to:job.phone,type:'template',template:{ name:job.template_name,language:{code:job.template_language || 'en'},...(parameters.length?{components:[{type:'body',parameters:parameters.map((text)=>({type:'text',text}))}]}:{}) } };
    const response = await axios.post(`https://graph.facebook.com/v19.0/${job.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});
    waMessageId = response.data?.messages?.[0]?.id || null;
    await AllianceWhatsappCampaignRecipients.updateOne({ id: job.id }, { $set: { status: 'sent', wa_msg_id: waMessageId, sent_at: new Date() } });
    if(job.followup_template_id){
      const delayMinutes = Number(job.followup_delay_minutes)||(Number(job.followup_delay_days)||4)*1440;
      await insertFollowupJob({
        campaign_id: job.campaign_id, prospect_id: job.prospect_id, followup_no: 1,
        scheduled_at: new Date(Date.now() + delayMinutes * MINUTE_MS), activity_cutoff_at: new Date(), trigger_source: 'initial_campaign',
      });
    }
    const rendered = mapping.reduce((body,field,index)=>body.replaceAll(`{{${index+1}}}`,valueFor(field,job)),job.template_body);
    const inbox = await storeInboxMessageSafely(job,waMessageId,rendered);
    io?.emit('alliance_campaign_updated',{campaign_id:job.campaign_id,prospect_id:job.prospect_id,channel:'whatsapp',status:'sent'});
    if(inbox.contactId) io?.emit('alliance_contacts_changed',{contact_id:String(inbox.contactId)});
    if(inbox.message) io?.emit('alliance_outgoing_message',{lead_id:String(inbox.contactId),message:{...inbox.message,type:inbox.message.msg_type,timestamp:inbox.message.sent_at,sender_type:'automation'}});
  } catch (error) {
    const reason=error.response?.data?.error?.message||error.message||'WhatsApp send failed.';
    await AllianceWhatsappCampaignRecipients.updateOne(
      { id: job.id },
      { $set: {
        status: waMessageId ? 'sent' : 'failed',
        error_message: String(waMessageId ? `Meta accepted the message, but Inbox logging failed: ${reason}` : reason).slice(0,2000),
      } }
    );
  }
  await completeCampaignIfDone(job.campaign_id);
}

async function processAllianceWhatsAppCampaigns(io) {
  if (processing) return; processing=true;
  try { for(let count=0;count<20;count+=1){const job=await claimRecipient();if(!job)break;if(job.skipped)continue;await sendRecipient(job,io);} }
  finally { processing=false; }
}

// Safety net for WhatsApp campaign follow-up reminders. The n8n workflow
// (AllianceOS_WhatsApp_Followups_n8n.json) normally claims and sends these
// every minute, but this local runner guarantees reminders still go out if
// that workflow is inactive or n8n is unavailable. claimAllianceWhatsAppFollowups
// claims each job atomically with a claimed-by marker, so it's safe to run
// alongside n8n without double-sending.
async function processAllianceWhatsAppFollowups(io) {
  if (followupProcessing) return; followupProcessing = true;
  try {
    const jobs = await claimAllianceWhatsAppFollowups(20, 'internal-fallback');
    for (const job of jobs) {
      try { await sendAllianceWhatsAppFollowup(job.id, io); }
      catch (error) { console.error('[Alliance WhatsApp followup fallback]', error.response?.data || error.message); }
    }
  } finally { followupProcessing = false; }
}

async function startAllianceWhatsAppCampaignWorker(io){
  await ensureAllianceSchema();
  if(!interval){setTimeout(()=>processAllianceWhatsAppCampaigns(io).catch(console.error),5000);interval=setInterval(()=>processAllianceWhatsAppCampaigns(io).catch(console.error),30000);interval.unref?.();}
  if(!followupInterval){setTimeout(()=>processAllianceWhatsAppFollowups(io).catch(console.error),8000);followupInterval=setInterval(()=>processAllianceWhatsAppFollowups(io).catch(console.error),60000);followupInterval.unref?.();}
}

// Campaigns that still accept automatic reminders, and prospects that may receive them.
async function reminderEligibility(rows) {
  const campaigns = await mapById(AllianceWhatsappCampaigns, rows.map((r) => r.campaign_id));
  const prospects = await mapById(AllianceProspects, rows.map((r) => r.prospect_id), { id: 1, status: 1, suppressed: 1 });
  return (row) => {
    const c = campaigns.get(row.campaign_id);
    const p = prospects.get(row.prospect_id);
    if (!c || c.followup_template_id == null || c.status === 'stopped') return null;
    if (!p || p.suppressed !== false || !isOpenProspect(p)) return null;
    return c;
  };
}

async function claimAllianceWhatsAppFollowups(limit=20,claimId='n8n'){
  await AllianceWhatsappFollowupJobs.updateMany(
    { status: 'claimed', claimed_at: { $lt: new Date(Date.now() - 15 * MINUTE_MS) } },
    { $set: { status: 'pending', claimed_at: null, claim_id: null } }
  );

  const failedRecipients = await AllianceWhatsappCampaignRecipients.find({ status: 'failed' }, { campaign_id: 1, prospect_id: 1, error_message: 1 }).lean();
  for (const recipient of failedRecipients) {
    await AllianceWhatsappFollowupJobs.updateMany(
      { campaign_id: recipient.campaign_id, prospect_id: recipient.prospect_id, status: { $in: ['pending', 'claimed'] } },
      { $set: {
        status: 'cancelled',
        error_message: (`Initial WhatsApp delivery failed: ${recipient.error_message ?? 'Meta reported failure.'}`).slice(0, 2000),
      } }
    );
  }

  // Repair reminders skipped by the former SQL column collision where the
  // prospect status (`in_process`) overwrote the actual reminder job status.
  await AllianceWhatsappFollowupJobs.updateMany(
    { status: 'skipped', error_message: 'job_in_process' },
    { $set: { status: 'pending', claimed_at: null, claim_id: null, error_message: null } }
  );

  // Recover an initial reminder if Meta accepted the campaign message but the
  // process stopped before the original reminder job could be persisted.
  const sentRecipients = await AllianceWhatsappCampaignRecipients.find(
    { status: { $in: ['sent', 'delivered', 'read'] }, sent_at: { $ne: null } },
    { campaign_id: 1, prospect_id: 1, sent_at: 1 }
  ).lean();
  if (sentRecipients.length) {
    const eligibleCampaign = await reminderEligibility(sentRecipients);
    const withJobs = new Set((await AllianceWhatsappFollowupJobs.find(
      { campaign_id: { $in: [...new Set(sentRecipients.map((r) => r.campaign_id))] } },
      { campaign_id: 1, prospect_id: 1 }
    ).lean()).map((j) => `${j.campaign_id}:${j.prospect_id}`));
    for (const recipient of sentRecipients) {
      const c = eligibleCampaign(recipient);
      if (!c || withJobs.has(`${c.id}:${recipient.prospect_id}`)) continue;
      const delayMinutes = Number(c.followup_delay_minutes) || Math.max(Number(c.followup_delay_days ?? 4), 1) * 1440;
      await insertFollowupJob({
        campaign_id: c.id, prospect_id: recipient.prospect_id, followup_no: 1,
        scheduled_at: new Date(new Date(recipient.sent_at).getTime() + delayMinutes * MINUTE_MS),
        activity_cutoff_at: recipient.sent_at, trigger_source: 'initial_recovery',
      });
    }
  }

  const campaignsWithOpenJobs = await AllianceWhatsappFollowupJobs.distinct('campaign_id', { status: { $in: ['pending', 'claimed', 'sending'] } });
  if (campaignsWithOpenJobs.length) {
    await AllianceWhatsappCampaigns.updateMany(
      { status: 'completed', id: { $in: campaignsWithOpenJobs } },
      { $set: { status: 'running', completed_at: null, updated_at: new Date() } }
    );
  }

  // Recover campaigns created under the former one-reminder rule. For each
  // latest sent reminder with no future job, create the next inactivity check.
  const sentJobs = await AllianceWhatsappFollowupJobs.find({ status: 'sent', sent_at: { $ne: null } }, { campaign_id: 1, prospect_id: 1, followup_no: 1, sent_at: 1 }).lean();
  if (sentJobs.length) {
    const eligibleCampaign = await reminderEligibility(sentJobs);
    const highestNo = new Map((await AllianceWhatsappFollowupJobs.aggregate([
      { $match: { campaign_id: { $in: [...new Set(sentJobs.map((j) => j.campaign_id))] } } },
      { $group: { _id: { campaign_id: '$campaign_id', prospect_id: '$prospect_id' }, max: { $max: '$followup_no' } } },
    ])).map((row) => [`${row._id.campaign_id}:${row._id.prospect_id}`, row.max]));
    for (const job of sentJobs) {
      const c = eligibleCampaign(job);
      if (!c) continue;
      if ((highestNo.get(`${job.campaign_id}:${job.prospect_id}`) ?? job.followup_no) > job.followup_no) continue;
      const repeatDays = Math.max(Number(c.followup_repeat_days ?? 4), 1);
      await insertFollowupJob({
        campaign_id: job.campaign_id, prospect_id: job.prospect_id, followup_no: job.followup_no + 1,
        scheduled_at: new Date(new Date(job.sent_at).getTime() + repeatDays * DAY_MS),
        activity_cutoff_at: job.sent_at, trigger_source: 'recurring_inactivity',
      });
    }
  }

  // Claim due jobs one by one (replaces FOR UPDATE SKIP LOCKED)
  const max = Math.min(Math.max(Number(limit)||20,1),100);
  const claimedIds = [];
  const due = await AllianceWhatsappFollowupJobs.find({ status: 'pending', scheduled_at: { $lte: new Date() } }, { id: 1 })
    .sort({ scheduled_at: 1, id: 1 }).limit(max).lean();
  for (const job of due) {
    const claimed = await AllianceWhatsappFollowupJobs.updateOne(
      { id: job.id, status: 'pending' },
      { $set: { status: 'claimed', claimed_at: new Date(), claim_id: String(claimId).slice(0,255) } }
    );
    if (claimed.modifiedCount) claimedIds.push(job.id);
  }
  if (!claimedIds.length) return [];

  const jobs = await AllianceWhatsappFollowupJobs.find({ id: { $in: claimedIds } }).sort({ scheduled_at: 1 }).lean();
  const campaigns = await mapById(AllianceWhatsappCampaigns, jobs.map((j) => j.campaign_id));
  const prospects = await mapById(AllianceProspects, jobs.map((j) => j.prospect_id));
  return jobs.filter((j) => campaigns.has(j.campaign_id) && prospects.has(j.prospect_id)).map((j) => {
    const c = campaigns.get(j.campaign_id);
    const p = prospects.get(j.prospect_id);
    return {
      id: j.id, followup_no: j.followup_no, scheduled_at: j.scheduled_at,
      prospect_id: p.id, name: p.name, business_name: p.business_name, phone: p.phone, email: p.email,
      audience: p.audience, industry: p.industry, location: p.location, status: p.status, consent_source: p.consent_source,
      campaign_id: c.id, campaign_name: c.name, template_name: c.followup_template_name, language: c.followup_template_language,
      template_body: c.followup_template_body, parameter_mapping: c.followup_parameter_mapping,
    };
  });
}

async function scheduleAllianceInactivityReminder(prospectId, activityAt = new Date()) {
  if (!prospectId) return null;
  const prospect = await AllianceProspects.findOne({ id: prospectId }, { id: 1, status: 1 }).lean();
  if (!prospect) return null;
  const recipients = await AllianceWhatsappCampaignRecipients.find({ prospect_id: prospectId }, { campaign_id: 1, sent_at: 1 }).lean();
  const campaigns = await mapById(AllianceWhatsappCampaigns, recipients.map((r) => r.campaign_id));
  const latest = recipients
    .map((r) => ({ r, c: campaigns.get(r.campaign_id) }))
    .filter(({ c }) => c && c.followup_template_id != null && c.status !== 'stopped')
    .sort((a, b) => new Date(b.r.sent_at || b.c.started_at || b.c.created_at || 0) - new Date(a.r.sent_at || a.c.started_at || a.c.created_at || 0))[0];
  if (!latest || ['converted','closed','complete','completed','not_interested','unsubscribed'].includes(prospect.status)) {
    return null;
  }
  const delayMinutes = Math.trunc(
    latest.c.followup_delay_minutes ?? (latest.c.followup_delay_days != null ? latest.c.followup_delay_days * 1440 : 5760)
  );
  await AllianceWhatsappFollowupJobs.updateMany(
    { prospect_id: prospectId, status: { $in: ['pending', 'claimed'] } },
    { $set: { status: 'cancelled', error_message: 'Replaced by a newer admin activity timer.' } }
  );
  const highest = await AllianceWhatsappFollowupJobs.findOne({ campaign_id: latest.c.id, prospect_id: prospectId }, { followup_no: 1 })
    .sort({ followup_no: -1 }).lean();
  const activity = new Date(activityAt);
  const job = await AllianceWhatsappFollowupJobs.create({
    campaign_id: latest.c.id,
    prospect_id: prospectId,
    followup_no: Number(highest?.followup_no || 0) + 1,
    scheduled_at: new Date(activity.getTime() + delayMinutes * MINUTE_MS),
    activity_cutoff_at: activity,
    trigger_source: 'admin_outbound',
  });
  return { id: job.id, scheduled_at: job.scheduled_at, followup_no: job.followup_no };
}

async function loadFollowupJob(jobId) {
  const j = await AllianceWhatsappFollowupJobs.findOne({ id: jobId }, NO_ID).lean();
  if (!j) return null;
  const [c, p] = await Promise.all([
    AllianceWhatsappCampaigns.findOne({ id: j.campaign_id }).lean(),
    AllianceProspects.findOne({ id: j.prospect_id }).lean(),
  ]);
  if (!c || !p) return null;
  const [template, settings, last_inbound_at] = await Promise.all([
    c.followup_template_id != null ? Templates.findOne({ id: c.followup_template_id }, { buttons: 1 }).lean() : null,
    AllianceInboxSettings.findOne({ phone_number_id: c.phone_number_id }, { access_token_env: 1 }).lean(),
    lastInboundAt(p.id),
  ]);
  return {
    ...j,
    job_status: j.status,
    campaign_status: c.status,
    campaign_name: c.name,
    phone_number_id: c.phone_number_id,
    template_name: c.followup_template_name,
    template_language: c.followup_template_language,
    template_body: c.followup_template_body,
    parameter_mapping: c.followup_parameter_mapping,
    template_buttons: template?.buttons ?? null,
    followup_repeat_days: c.followup_repeat_days,
    max_followups: c.max_followups,
    campaign_created_at: c.created_at,
    ...prospectFields(p),
    prospect_status: p.status,
    access_token_env: settings?.access_token_env ?? null,
    last_inbound_at,
  };
}

async function sendAllianceWhatsAppFollowup(jobId,io){
  const job=await loadFollowupJob(jobId);if(!job)throw Object.assign(new Error('Follow-up job not found.'),{status:404});
  const consentAuditValid=job.consent&&APPROVED_CONSENT_SOURCES.has(String(job.consent_source||'').toLowerCase())&&job.consent_at&&String(job.consent_evidence||'').trim()&&APPROVED_CONSENT_SCOPES.has(String(job.consent_scope||'').toLowerCase())&&!NON_CONSENT_SOURCE_PATTERN.test(String(job.source||''));
  const reason=!['claimed','pending'].includes(job.job_status)?`job_${job.job_status}`:job.campaign_status==='stopped'?'campaign_stopped':!consentAuditValid?'whatsapp_consent_audit_invalid':job.suppressed?'suppressed':['converted','closed','complete','completed','not_interested','unsubscribed'].includes(job.prospect_status)?`prospect_${job.prospect_status}`:job.last_inbound_at&&new Date(job.last_inbound_at)>new Date(job.activity_cutoff_at||job.campaign_created_at)?'recipient_replied_after_latest_activity':null;
  if(reason){await AllianceWhatsappFollowupJobs.updateOne({id:job.id},{$set:{status:'skipped',error_message:reason}});return{sent:false,skipped:true,reason};}
  await AllianceWhatsappFollowupJobs.updateOne({id:job.id},{$set:{status:'sending',error_message:null}});
  try{
    const token=tokenFor(job);if(!token)throw new Error('Alliance WhatsApp access token is missing.');
    const mapping=Array.isArray(job.parameter_mapping)?job.parameter_mapping:[];
    const parameters=mapping.map(field=>valueFor(field,job));
    const payload={messaging_product:'whatsapp',to:job.phone,type:'template',template:{name:job.template_name,language:{code:job.template_language||'en'},...(parameters.length?{components:[{type:'body',parameters:parameters.map(text=>({type:'text',text}))}]}:{})}};
    const response=await axios.post(`https://graph.facebook.com/v19.0/${job.phone_number_id}/messages`,payload,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},timeout:20000});
    const waMessageId=response.data?.messages?.[0]?.id||null;
    await AllianceWhatsappFollowupJobs.updateOne({id:job.id},{$set:{status:'sent',wa_msg_id:waMessageId,sent_at:new Date()}});
    const rendered=mapping.reduce((body,field,index)=>body.replaceAll(`{{${index+1}}}`,valueFor(field,job)),job.template_body);
    const inbox=await storeInboxMessage(job,waMessageId,rendered);
    const repeatDays=Math.min(Math.max(Number(job.followup_repeat_days)||4,1),30);const nextNo=Number(job.followup_no)+1;const withinLimit=Number(job.max_followups)===0||nextNo<=Number(job.max_followups);
    if(withinLimit){
      await insertFollowupJob({
        campaign_id: job.campaign_id, prospect_id: job.prospect_id, followup_no: nextNo,
        scheduled_at: new Date(Date.now() + repeatDays * DAY_MS), activity_cutoff_at: new Date(), trigger_source: 'recurring_inactivity',
      });
    }
    io?.emit('alliance_campaign_updated',{campaign_id:job.campaign_id,prospect_id:job.prospect_id,channel:'whatsapp_followup',status:'sent'});if(inbox.contactId)io?.emit('alliance_contacts_changed',{contact_id:String(inbox.contactId)});if(inbox.message)io?.emit('alliance_outgoing_message',{lead_id:String(inbox.contactId),message:{...inbox.message,type:inbox.message.msg_type,timestamp:inbox.message.sent_at,sender_type:'automation'}});return{sent:true,wa_msg_id:waMessageId,next_followup_scheduled:withinLimit};
  }catch(error){const reason=error.response?.data?.error?.message||error.message;await AllianceWhatsappFollowupJobs.updateOne({id:job.id},{$set:{status:'failed',error_message:String(reason).slice(0,2000)}});throw error;}
}
module.exports={startAllianceWhatsAppCampaignWorker,processAllianceWhatsAppCampaigns,processAllianceWhatsAppFollowups,claimAllianceWhatsAppFollowups,sendAllianceWhatsAppFollowup,scheduleAllianceInactivityReminder};
