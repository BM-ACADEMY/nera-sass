const ensureAllianceSchema = require('../db/alliance-schema');
const { createAllianceEmailTransport, getAllianceEmailConfig, isAllianceSenderAllowed, allowedAllianceFromAddresses } = require('./alliance-email');
const {
  AllianceTouches,
  AllianceProspects,
  AllianceCampaigns,
  AllianceCampaignProspects,
  AllianceCampaignTemplates,
  AllianceDomains,
  AllianceBulkSendLimits,
  AllianceEmailEvents,
} = require('../models');

let interval;
let processing = false;

const CLOSED_PROSPECT_STATUSES = ['converted', 'closed', 'not_interested', 'unsubscribed', 'complete', 'completed'];
const ACTIVE_TOUCH_STATUSES = ['scheduled', 'processing', 'paused', 'failed'];
const DAY_MS = 24 * 60 * 60 * 1000;
// prospect.status NOT IN (...) — a NULL status never matches, exactly as in SQL
const isOpenProspect = (prospect) => prospect && prospect.status != null && !CLOSED_PROSPECT_STATUSES.includes(prospect.status);
const pairKey = (campaignId, prospectId) => `${campaignId}:${prospectId}`;
const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; };

async function mapById(model, ids, projection) {
  const unique = [...new Set(ids.filter((id) => id !== null && id !== undefined))];
  if (!unique.length) return new Map();
  return new Map((await model.find({ id: { $in: unique } }, projection).lean()).map((doc) => [doc.id, doc]));
}

// Inserts a touch unless (campaign_id, prospect_id, touch_no) already exists (ON CONFLICT DO NOTHING).
async function insertTouchIfMissing(doc) {
  if (await AllianceTouches.exists({ campaign_id: doc.campaign_id, prospect_id: doc.prospect_id, touch_no: doc.touch_no })) return false;
  try {
    await AllianceTouches.create(doc);
    return true;
  } catch (error) {
    if (error.code === 11000) return false;
    throw error;
  }
}

// enrollment.next_touch_at = earliest scheduled touch, for every enrollment that has one.
async function refreshNextTouchAt(match = {}) {
  const due = await AllianceTouches.aggregate([
    { $match: { ...match, status: 'scheduled' } },
    { $group: { _id: { campaign_id: '$campaign_id', prospect_id: '$prospect_id' }, next_touch_at: { $min: '$scheduled_at' } } },
  ]);
  if (!due.length) return;
  await AllianceCampaignProspects.bulkWrite(due.map((row) => ({
    updateOne: {
      filter: { campaign_id: row._id.campaign_id, prospect_id: row._id.prospect_id },
      update: { $set: { next_touch_at: row.next_touch_at } },
    },
  })));
}

async function reconcileEmailFollowups() {
  const stoppedTouches = await AllianceTouches.find(
    { status: 'cancelled', sent_at: null, error_message: 'Recipient replied; follow-ups stopped.' },
    { id: 1, prospect_id: 1, campaign_id: 1 }
  ).lean();
  const stoppedEnrollments = await AllianceCampaignProspects.find(
    { stop_reason: 'recipient_replied' },
    { _id: 1, prospect_id: 1, campaign_id: 1 }
  ).lean();
  const all = [...stoppedTouches, ...stoppedEnrollments];
  if (!all.length) return;
  const prospects = await mapById(AllianceProspects, all.map((r) => r.prospect_id), { id: 1, status: 1, suppressed: 1 });
  const campaigns = await mapById(AllianceCampaigns, all.map((r) => r.campaign_id), { id: 1, status: 1 });
  const eligible = (row) => {
    const prospect = prospects.get(row.prospect_id);
    const campaign = campaigns.get(row.campaign_id);
    return campaign && campaign.status !== 'stopped' && prospect && prospect.suppressed === false && isOpenProspect(prospect);
  };

  const touchIds = stoppedTouches.filter(eligible).map((t) => t.id);
  if (touchIds.length) {
    await AllianceTouches.updateMany(
      { id: { $in: touchIds } },
      { $set: { status: 'scheduled', processing_started_at: null, error_message: null } }
    );
  }
  const enrollmentIds = stoppedEnrollments.filter(eligible).map((e) => e._id);
  if (enrollmentIds.length) {
    await AllianceCampaignProspects.updateMany(
      { _id: { $in: enrollmentIds } },
      { $set: { enrollment_status: 'in_sequence', stopped_at: null, stop_reason: null } }
    );
  }
}

async function recoverMissingEmailFollowups() {
  const campaigns = await AllianceCampaigns.find({ status: { $in: ['running', 'completed'] } }, { id: 1, started_at: 1, sender_domain_id: 1 }).lean();
  if (campaigns.length) {
    const campaignById = new Map(campaigns.map((c) => [c.id, c]));
    const firstTouches = await AllianceTouches.find(
      { campaign_id: { $in: [...campaignById.keys()] }, touch_no: 1, status: 'sent', sent_at: { $ne: null } },
      { campaign_id: 1, prospect_id: 1, sent_at: 1 }
    ).lean();
    if (firstTouches.length) {
      const templates = await AllianceCampaignTemplates.find(
        { campaign_id: { $in: [...new Set(firstTouches.map((t) => t.campaign_id))] }, touch_no: { $gt: 1 } }
      ).lean();
      const enrollments = new Set((await AllianceCampaignProspects.find(
        { campaign_id: { $in: [...new Set(firstTouches.map((t) => t.campaign_id))] }, enrollment_status: 'in_sequence' },
        { campaign_id: 1, prospect_id: 1 }
      ).lean()).map((e) => pairKey(e.campaign_id, e.prospect_id)));
      const prospects = await mapById(AllianceProspects, firstTouches.map((t) => t.prospect_id), { id: 1, status: 1, suppressed: 1 });
      const existing = new Set((await AllianceTouches.find(
        { campaign_id: { $in: [...new Set(firstTouches.map((t) => t.campaign_id))] } },
        { campaign_id: 1, prospect_id: 1, touch_no: 1 }
      ).lean()).map((t) => `${pairKey(t.campaign_id, t.prospect_id)}:${t.touch_no}`));

      for (const first of firstTouches) {
        const prospect = prospects.get(first.prospect_id);
        if (!enrollments.has(pairKey(first.campaign_id, first.prospect_id))) continue;
        if (!prospect || prospect.suppressed !== false || !isOpenProspect(prospect)) continue;
        const campaign = campaignById.get(first.campaign_id);
        for (const template of templates.filter((t) => t.campaign_id === first.campaign_id)) {
          if (existing.has(`${pairKey(first.campaign_id, first.prospect_id)}:${template.touch_no}`)) continue;
          const base = new Date(campaign.started_at || first.sent_at || Date.now());
          await insertTouchIfMissing({
            prospect_id: first.prospect_id,
            campaign_id: first.campaign_id,
            touch_no: template.touch_no,
            channel: 'email',
            domain_id: campaign.sender_domain_id ?? null,
            subject: template.subject,
            message_body: template.body,
            status: 'scheduled',
            scheduled_at: new Date(base.getTime() + Number(template.delay_days || 0) * DAY_MS),
          });
        }
      }
    }
  }

  const reopen = await AllianceTouches.distinct('campaign_id', { status: 'scheduled' });
  if (reopen.length) {
    await AllianceCampaigns.updateMany(
      { status: 'completed', id: { $in: reopen } },
      { $set: { status: 'running', completed_at: null } }
    );
  }
  await refreshNextTouchAt();
}

async function finalizeEmailCampaigns() {
  const inSequence = await AllianceCampaignProspects.find({ enrollment_status: 'in_sequence' }, { _id: 1, campaign_id: 1, prospect_id: 1 }).lean();
  if (inSequence.length) {
    const campaignIds = [...new Set(inSequence.map((e) => e.campaign_id))];
    const touches = await AllianceTouches.find(
      { campaign_id: { $in: campaignIds } },
      { campaign_id: 1, prospect_id: 1, touch_no: 1, status: 1 }
    ).lean();
    const templates = await AllianceCampaignTemplates.find({ campaign_id: { $in: campaignIds } }, { campaign_id: 1, touch_no: 1 }).lean();
    const touchesByPair = new Map();
    for (const touch of touches) {
      const key = pairKey(touch.campaign_id, touch.prospect_id);
      if (!touchesByPair.has(key)) touchesByPair.set(key, []);
      touchesByPair.get(key).push(touch);
    }
    const completedIds = inSequence.filter((enrollment) => {
      const own = touchesByPair.get(pairKey(enrollment.campaign_id, enrollment.prospect_id)) || [];
      if (!own.some((t) => t.status === 'sent')) return false;
      const expected = templates.filter((t) => t.campaign_id === enrollment.campaign_id);
      if (!expected.every((template) => own.some((t) => t.touch_no === template.touch_no))) return false;
      return !own.some((t) => ACTIVE_TOUCH_STATUSES.includes(t.status));
    }).map((e) => e._id);
    if (completedIds.length) {
      await AllianceCampaignProspects.updateMany(
        { _id: { $in: completedIds } },
        { $set: { enrollment_status: 'completed', next_touch_at: null } }
      );
    }
  }

  // Campaigns with at least one enrollment whose prospect is still open
  const enrollments = await AllianceCampaignProspects.find({}, { campaign_id: 1, prospect_id: 1 }).lean();
  const prospects = await mapById(AllianceProspects, enrollments.map((e) => e.prospect_id), { id: 1, status: 1 });
  const campaignsWithOpenProspects = new Set(enrollments.filter((e) => isOpenProspect(prospects.get(e.prospect_id))).map((e) => e.campaign_id));
  const campaignsWithActiveTouches = new Set(await AllianceTouches.distinct('campaign_id', { status: { $in: ACTIVE_TOUCH_STATUSES } }));

  const running = await AllianceCampaigns.find({ status: 'running' }, { id: 1 }).lean();
  const toComplete = running.map((c) => c.id).filter((id) => !campaignsWithOpenProspects.has(id) && !campaignsWithActiveTouches.has(id));
  if (toComplete.length) {
    await AllianceCampaigns.updateMany({ id: { $in: toComplete }, status: 'running' }, { $set: { status: 'completed', completed_at: new Date() } });
  }
  if (campaignsWithOpenProspects.size) {
    await AllianceCampaigns.updateMany(
      { status: 'completed', id: { $in: [...campaignsWithOpenProspects] } },
      { $set: { status: 'running', completed_at: null } }
    );
  }
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function renderTemplate(value, prospect) {
  const customFields = typeof prospect.custom_fields === 'string'
    ? JSON.parse(prospect.custom_fields || '{}')
    : (prospect.custom_fields || {});
  const aliases = { org: 'business_name', status: 'prospect_status' };
  return String(value || '')
    .replace(/\\r\\n|\\n|\\r/g, '\n')
    .replace(/\{\{([a-z][a-z0-9_]*)\}\}/gi, (token, key) => {
      const resolved = prospect[aliases[key] || key] ?? customFields[key];
      if (resolved === undefined || resolved === null || resolved === '') {
        if (key === 'name') return prospect.business_name || 'there';
        if (key === 'org') return prospect.business_name || 'your organisation';
        return token;
      }
      return String(resolved);
    });
}

function textToHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

// Resets each sender's daily counter once per day.
async function resetDailySenderCounters() {
  await AllianceDomains.updateMany({ last_reset: { $lt: startOfUtcDay() } }, { $set: { sent_today: 0, last_reset: new Date() } });
}

// Joins one touch with its campaign, enrollment, prospect and sender domain.
// Returns null when any of them is missing (the SQL used inner joins).
async function loadTouchContext(touch) {
  const campaign = await AllianceCampaigns.findOne({ id: touch.campaign_id }).lean();
  if (!campaign) return null;
  const [enrollment, prospect, domain] = await Promise.all([
    AllianceCampaignProspects.findOne({ campaign_id: touch.campaign_id, prospect_id: touch.prospect_id }).lean(),
    AllianceProspects.findOne({ id: touch.prospect_id }).lean(),
    campaign.sender_domain_id != null ? AllianceDomains.findOne({ id: campaign.sender_domain_id }).lean() : null,
  ]);
  if (!enrollment || !prospect || !domain) return null;
  return { campaign, enrollment, prospect, domain };
}

async function claimDueTouch() {
  await resetDailySenderCounters();
  await AllianceTouches.updateMany(
    { status: 'processing', processing_started_at: { $lt: new Date(Date.now() - 15 * 60 * 1000) } },
    { $set: { status: 'scheduled', processing_started_at: null, error_message: 'Recovered after interrupted email processing.' } }
  );

  const candidates = await AllianceTouches.find(
    { channel: 'email', status: 'scheduled', scheduled_at: { $lte: new Date() } },
    { id: 1, campaign_id: 1, prospect_id: 1, touch_no: 1, subject: 1, message_body: 1 }
  ).sort({ scheduled_at: 1, id: 1 }).lean();

  for (const candidate of candidates) {
    const context = await loadTouchContext(candidate);
    if (!context) continue;
    // Atomically claim (replaces FOR UPDATE SKIP LOCKED)
    const claimed = await AllianceTouches.updateOne(
      { id: candidate.id, status: 'scheduled' },
      { $set: { status: 'processing', processing_started_at: new Date(), error_message: null } }
    );
    if (!claimed.modifiedCount) continue;

    const { campaign, enrollment, prospect: p, domain: d } = context;
    const policy = await AllianceBulkSendLimits.findOne({ channel: 'email' }).lean();
    const contactedCount = (await AllianceTouches.distinct('prospect_id', { campaign_id: candidate.campaign_id, channel: 'email', status: 'sent' })).length;
    const touch = {
      id: candidate.id,
      campaign_id: candidate.campaign_id,
      prospect_id: candidate.prospect_id,
      touch_no: candidate.touch_no,
      subject: candidate.subject,
      message_body: candidate.message_body,
      name: p.name, business_name: p.business_name, email: p.email, phone: p.phone, audience: p.audience,
      industry: p.industry, location: p.location, source: p.source, channel: p.channel, channel_pref: p.channel_pref,
      consent: p.consent, consent_source: p.consent_source, ai_score: p.ai_score, created_at: p.created_at,
      custom_fields: p.custom_fields, prospect_status: p.status, suppressed: p.suppressed,
      campaign_name: campaign.name, campaign_status: campaign.status, started_at: campaign.started_at, sender_domain_id: campaign.sender_domain_id,
      enrollment_status: enrollment.enrollment_status,
      inbox_email: d.inbox_email, sender_status: d.status, daily_cap: d.daily_cap, sent_today: d.sent_today,
      bulk_limit_mode: policy?.limit_mode ?? null, bulk_custom_limit: policy?.custom_limit ?? null,
      contacted_count: contactedCount,
    };

    if (touch.campaign_status === 'scheduled') {
      await AllianceCampaigns.updateOne(
        { id: touch.campaign_id, status: 'scheduled' },
        [{ $set: { status: 'running', started_at: { $ifNull: ['$started_at', '$$NOW'] } } }]
      );
      touch.campaign_status = 'running';
    }
    const stopReason = touch.campaign_status !== 'running' ? 'campaign_not_running'
      : touch.suppressed ? 'suppressed'
        : ['converted', 'closed', 'not_interested', 'unsubscribed'].includes(touch.prospect_status) ? `prospect_${touch.prospect_status}`
          : ['stopped', 'completed'].includes(touch.enrollment_status) ? `enrollment_${touch.enrollment_status}`
            : touch.sender_status !== 'active' ? 'sender_not_active'
              : Number(touch.sent_today) >= Number(touch.daily_cap) ? 'sender_daily_cap_reached'
                : Number(touch.touch_no) === 1 && touch.bulk_limit_mode === 'custom' && Number(touch.contacted_count) >= Number(touch.bulk_custom_limit) ? 'bulk_send_limit_reached'
                  : !touch.email ? 'missing_email' : null;
    if (stopReason) {
      const retryable = ['campaign_not_running', 'sender_not_active', 'sender_daily_cap_reached'].includes(stopReason);
      await AllianceTouches.updateOne(
        { id: touch.id },
        { $set: retryable
          ? { status: 'scheduled', error_message: stopReason, processing_started_at: null, scheduled_at: new Date(Date.now() + 5 * 60 * 1000) }
          : { status: 'cancelled', error_message: stopReason, processing_started_at: null } }
      );
      if (!retryable) {
        await AllianceCampaignProspects.updateMany(
          { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id },
          { $set: { enrollment_status: 'stopped', stopped_at: new Date(), stop_reason: stopReason } }
        );
      }
      return null;
    }
    return touch;
  }
  return null;
}

async function scheduleRemainingTouches(touch) {
  const campaign = await AllianceCampaigns.findOne({ id: touch.campaign_id }, { started_at: 1 }).lean();
  if (campaign) {
    const templates = await AllianceCampaignTemplates.find({ campaign_id: touch.campaign_id, touch_no: { $gt: 1 } }).lean();
    const base = new Date(campaign.started_at || touch.sent_at || Date.now());
    for (const template of templates) {
      await insertTouchIfMissing({
        prospect_id: touch.prospect_id,
        campaign_id: template.campaign_id,
        touch_no: template.touch_no,
        channel: 'email',
        domain_id: touch.sender_domain_id ?? null,
        subject: template.subject,
        message_body: template.body,
        status: 'scheduled',
        scheduled_at: new Date(base.getTime() + Number(template.delay_days || 0) * DAY_MS),
      });
    }
  }
  await refreshNextTouchAt({ campaign_id: touch.campaign_id, prospect_id: touch.prospect_id });
}

async function finalEligibilityCheck(touch) {
  await resetDailySenderCounters();
  const context = await loadTouchContext(touch);
  if (!context) return 'campaign_or_enrollment_missing';
  const state = {
    campaign_status: context.campaign.status,
    prospect_status: context.prospect.status,
    suppressed: context.prospect.suppressed,
    enrollment_status: context.enrollment.enrollment_status,
    sender_status: context.domain.status,
    sent_today: context.domain.sent_today,
    daily_cap: context.domain.daily_cap,
  };
  if (state.campaign_status !== 'running') return 'campaign_not_running';
  if (state.suppressed) return 'suppressed';
  if (['converted', 'closed', 'not_interested', 'unsubscribed'].includes(state.prospect_status)) return `prospect_${state.prospect_status}`;
  if (['stopped', 'completed'].includes(state.enrollment_status)) return `enrollment_${state.enrollment_status}`;
  if (state.sender_status !== 'active') return 'sender_not_active';
  if (Number(state.sent_today) >= Number(state.daily_cap)) return 'sender_daily_cap_reached';
  return null;
}

async function deliverTouch(touch, io) {
  const config = getAllianceEmailConfig();
  let deliveryRecorded = false;
  try {
    const stoppedBecause = await finalEligibilityCheck(touch);
    if (stoppedBecause) {
      const retryable = ['campaign_not_running', 'sender_not_active', 'sender_daily_cap_reached'].includes(stoppedBecause);
      await AllianceTouches.updateOne(
        { id: touch.id, status: 'processing' },
        { $set: retryable
          ? { status: 'scheduled', processing_started_at: null, error_message: stoppedBecause, scheduled_at: new Date(Date.now() + 5 * 60 * 1000) }
          : { status: 'cancelled', processing_started_at: null, error_message: stoppedBecause } }
      );
      if (!retryable) await AllianceCampaignProspects.updateMany(
        { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id },
        { $set: { enrollment_status: 'stopped', stopped_at: new Date(), stop_reason: stoppedBecause, next_touch_at: null } }
      );
      return;
    }
    if (!isAllianceSenderAllowed(touch.inbox_email, config)) {
      throw new Error(`Selected sender ${touch.inbox_email} is not an allowed Zoho SMTP sender. Configured senders: ${[...allowedAllianceFromAddresses(config)].join(', ') || 'none'}.`);
    }
    const subject = renderTemplate(touch.subject, touch);
    const body = renderTemplate(touch.message_body, touch);
    const transporter = createAllianceEmailTransport();
    const result = await transporter.sendMail({
      from: { name: config.fromName, address: touch.inbox_email },
      to: touch.email,
      replyTo: config.replyTo,
      subject,
      text: body,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6">${textToHtml(body)}</div>`,
      headers: {
        'X-Alliance-Campaign-ID': String(touch.campaign_id),
        'X-Alliance-Prospect-ID': String(touch.prospect_id),
        'List-Unsubscribe': `<mailto:${config.replyTo}?subject=unsubscribe>`,
      },
    });
    await AllianceTouches.updateOne(
      { id: touch.id },
      { $set: {
        status: 'sent', sent_at: new Date(), processing_started_at: null,
        provider_message_id: result.messageId || null, subject, message_body: body,
      } }
    );
    await AllianceDomains.updateOne({ id: touch.sender_domain_id }, { $inc: { sent_today: 1 } });
    await AllianceCampaignProspects.updateMany(
      { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id },
      { $set: { enrollment_status: 'in_sequence', next_touch_at: null }, $max: { current_touch: touch.touch_no } }
    );
    await AllianceEmailEvents.create({
      touch_id: touch.id,
      campaign_id: touch.campaign_id,
      prospect_id: touch.prospect_id,
      provider_message_id: result.messageId || null,
      event_type: 'sent',
      event_payload: { accepted: result.accepted, rejected: result.rejected, response: result.response },
    });
    deliveryRecorded = true;
    await scheduleRemainingTouches(touch);
    io?.emit('alliance_campaign_updated', { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id, touch_id: touch.id, status: 'sent' });
  } catch (error) {
    const reason = error.response || error.message || 'Zoho email delivery failed.';
    if (deliveryRecorded) {
      await AllianceEmailEvents.create({
        touch_id: touch.id,
        campaign_id: touch.campaign_id,
        prospect_id: touch.prospect_id,
        event_type: 'followup_schedule_failed',
        event_payload: { error: String(reason).slice(0, 2000) },
      });
      console.error('[Alliance email follow-up scheduling]', reason);
      return;
    }
    await AllianceTouches.updateOne(
      { id: touch.id },
      { $set: { status: 'failed', error_message: String(reason).slice(0, 2000), processing_started_at: null } }
    );
    await AllianceEmailEvents.create({
      touch_id: touch.id,
      campaign_id: touch.campaign_id,
      prospect_id: touch.prospect_id,
      event_type: 'failed',
      event_payload: { error: String(reason).slice(0, 2000) },
    });
    io?.emit('alliance_campaign_updated', { campaign_id: touch.campaign_id, prospect_id: touch.prospect_id, touch_id: touch.id, status: 'failed', error: reason });
    console.error('[Alliance email delivery]', reason);
  }
}

async function processAllianceEmailQueue(io) {
  if (processing) return;
  processing = true;
  try {
    await reconcileEmailFollowups();
    await recoverMissingEmailFollowups();
    for (let count = 0; count < 20; count += 1) {
      const touch = await claimDueTouch();
      if (!touch) break;
      await deliverTouch(touch, io);
    }
    await finalizeEmailCampaigns();
  } finally {
    processing = false;
  }
}

async function startAllianceEmailWorker(io) {
  await ensureAllianceSchema();
  if (interval) return;
  setTimeout(() => processAllianceEmailQueue(io).catch((error) => console.error('[Alliance email worker]', error)), 2000);
  interval = setInterval(() => processAllianceEmailQueue(io).catch((error) => console.error('[Alliance email worker]', error)), 30000);
}

module.exports = { startAllianceEmailWorker, processAllianceEmailQueue };
