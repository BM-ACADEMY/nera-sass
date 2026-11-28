/**
 * LeadOS routes: Campaigns.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
const { requirePermission, requireSection } = require('../../services/permissions');
const campaignAudience = require('../../services/campaignAudience');
const campaignStats = require('../../services/campaignStats');
const campaignSchedule = require('../../services/campaignSchedule');
const campaignUpload = require('../../services/campaignUpload');
const activity = require('../../services/activity');
const leadLabels = require('../../services/leadLabels');

// The audience label of a builder request (target_label_id, or target_tag_id
// from older builders): { id } when given and this workspace's, { missing }
// when given but not found (another workspace's label is not found either).
async function audienceLabel(body) {
  const value = campaignAudience.labelIdOf(body || {});
  if (value == null) return { id: null };
  const label = await leadLabels.find(value);
  return label ? { id: label.id, label } : { missing: true };
}
const LABEL_NOT_FOUND = { error: 'This label was not found. Choose another label.', code: 'LABEL_NOT_FOUND' };

const campaignTime = (at, timezone) => new Date(at).toLocaleString('en-IN', { timeZone: timezone || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
const multer = require('multer');

const listUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const LIST_UPLOAD_ERROR = 'We could not read this file. Upload a .csv or .xlsx file up to 5 MB.';
// Accepts one file under "file"; any multer problem becomes a plain message.
const acceptList = (req, res, next) => listUpload.single('file')(req, res, (err) => {
  if (!err) return next();
  return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'This file is larger than 5 MB. Split it into smaller lists.' : LIST_UPLOAD_ERROR, code: 'LIST_INVALID' });
});
const parseMappings = (value) => {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return {}; }
};

module.exports = function registerCampaignsRoutes(app, ctx) {
const manage = requirePermission('campaigns.manage');
const {
  CampaignImportRecipients,
  CampaignLogs,
  CampaignMessageQueue,
  Campaigns,
  Clients,
  Leads,
  NO_ID,
  Templates,
  auth,
  campaignQueueStats,
  deleteCascade,
  executeCampaign,
  internalAuth,
  rateLimiter,
  validateCampaignParameterMappings,
  validateCampaignTemplate,
} = ctx;
// ══════════════════════════════════════════════════════════
// CAMPAIGNS
// ══════════════════════════════════════════════════════════
app.get('/api/campaigns', auth, requireSection('campaigns'), async (req, res) => {
  try {
    const campaignRows = await Campaigns.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const [campaignClients, campaignTemplates, counts, tagList] = await Promise.all([
      Clients.find({ id: { $in: campaignRows.map((c) => c.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      Templates.find({ id: { $in: campaignRows.map((c) => c.template_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      campaignStats.countsFor(campaignRows.map((c) => c.id)),
      campaignAudience.listTags(),
    ]);
    const clientNames = new Map(campaignClients.map((c) => [c.id, c.name]));
    const templateNames = new Map(campaignTemplates.map((t) => [t.id, t.name]));
    const tagNames = new Map(tagList.map((t) => [t.id, t.name]));
    const rows = campaignRows.map((camp) => {
      const c = counts.get(camp.id);
      return {
        ...camp,
        brand_name: clientNames.get(camp.client_id) ?? null,
        template_name: templateNames.get(camp.template_id) ?? null,
        // Label audience name (tag_name is the older field the page reads).
        tag_name: camp.target_label_id != null ? tagNames.get(camp.target_label_id) ?? null : null,
        // Cumulative: "delivered" includes messages that were then read or answered.
        sent_count: c.sent, delivered_count: c.delivered, read_count: c.read, replied_count: c.replied,
        failed_count: c.failed, skipped_count: c.skipped,
      };
    });
    res.json({ campaigns: rows, timezone: await campaignSchedule.tenantTimezone() });
  } catch (err) {
    res.status(500).json({ error: 'Could not load your campaigns. Please refresh the page.' });
  }
});
// Audience tags in use in this workspace, for the campaign builder.
app.get('/api/campaigns/tags', auth, requireSection('campaigns'), async (req, res) => {
  try {
    res.json({ tags: await campaignAudience.listTags() });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Who can be targeted, with counts: statuses that have contacts, all contacts, tags.
app.get('/api/campaigns/audience-counts', auth, requireSection('campaigns'), async (req, res) => {
  try {
    const clientId = req.query.client_id;
    if (clientId && !(await Clients.exists({ id: Number(clientId) }))) return res.status(404).json({ error: 'This brand was not found.' });
    res.json(await campaignAudience.audienceCounts(clientId || null));
  } catch (err) {
    console.error('Audience counts error:', err.message);
    res.status(500).json({ error: 'Could not count your contacts. Please try again.' });
  }
});

// The connected number's daily sending limit: "Today: X of Y messages used".
app.get('/api/campaigns/sending-limit', auth, requireSection('campaigns'), async (req, res) => {
  try {
    const fields = { _id: 0, id: 1, phone_number_id: 1, whatsapp_number: 1 };
    const brand = req.query.client_id
      ? await Clients.findOne({ id: Number(req.query.client_id) }, fields).lean()
      : await Clients.findOne({}, fields).lean();
    const timezone = await campaignSchedule.tenantTimezone();
    if (!brand?.phone_number_id) return res.json({ connected: false, timezone });
    const budget = await campaignAudience.sendingBudget(brand.phone_number_id);
    res.json({
      connected: true, timezone, display_phone_number: brand.whatsapp_number || null,
      messaging_limit: budget.messaging_limit, tier_limit: budget.tier_limit, quality_rating: budget.quality_rating, marketing_paused: budget.marketing_paused,
      daily_limit: budget.daily_cap, used_today: budget.used_today, remaining_today: budget.remaining_today, resets_at: budget.resets_at,
    });
  } catch (err) {
    console.error('Sending limit error:', err.message);
    res.status(500).json({ error: 'Could not load your daily sending limit.' });
  }
});

// Sample contact list for a template: phone, name, whatsapp_opt_in and the
// columns the chosen template takes from the sheet.
app.get('/api/campaigns/audience/sample', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const buffer = campaignUpload.sampleWorkbook(parseMappings(req.query.mappings));
    res.setHeader('Content-Disposition', 'attachment; filename="campaign_contacts_sample.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Sample list error:', err.message);
    res.status(500).json({ error: 'Could not prepare the sample file. Please try again.' });
  }
});

// Checks an uploaded list row by row. With save=true the ready contacts are
// stored as an upload batch and its id (target_status "csv_...") is returned.
app.post('/api/campaigns/audience/upload', auth, requireSection('campaigns'), manage, acceptList, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a .csv or .xlsx file to upload.', code: 'LIST_INVALID' });
    const brand = req.body.client_id ? await Clients.findOne({ id: Number(req.body.client_id) }, { _id: 0, id: 1 }).lean() : null;
    if (!brand) return res.status(400).json({ error: 'Choose a brand first.', code: 'LIST_INVALID' });
    const filename = String(req.file.originalname || 'list').slice(0, 120);
    const { contacts, summary } = campaignUpload.parseList(req.file.buffer, filename, { mappings: parseMappings(req.body.template_parameters) });
    if (!contacts.length) {
      return res.status(400).json({ error: 'No contact in this file can be used. Check the rows listed below and upload it again.', code: 'LIST_EMPTY', summary });
    }
    if (String(req.body.save) !== 'true') return res.json({ summary });
    const saved = await campaignUpload.saveList(contacts, { clientId: brand.id, filename, by: req.user?.id ?? null });
    res.json({ summary, ...saved });
  } catch (err) {
    if (err instanceof campaignUpload.ListError) return res.status(400).json({ error: err.message, code: err.code });
    console.error('Campaign list upload error:', err.message);
    res.status(500).json({ error: 'Could not process this list. Please try again.' });
  }
});

// Preview before sending: who gets it, who is left out and why, example messages,
// the number's limits and the schedule. Nothing is queued or sent.
app.post('/api/campaigns/preview', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const { name, client_id, template_id, target_status, scheduled_at, template_parameters = {} } = req.body || {};
    const audience = await audienceLabel(req.body);
    if (audience.missing) return res.status(404).json(LABEL_NOT_FOUND);
    const timezone = await campaignSchedule.tenantTimezone();
    const schedule = campaignSchedule.parseSchedule(scheduled_at, timezone);
    const preview = await campaignAudience.previewCampaign({ name, client_id, template_id, target_status: target_status || 'all', target_label_id: audience.id, scheduled_at: schedule.at ? schedule.at.toISOString() : null, template_parameters });
    const problem = schedule.error || campaignSchedule.scheduleProblem(schedule.at);
    if (problem) { preview.blockers.push(problem); preview.can_send = false; }
    preview.timezone = timezone;
    if (preview.schedule?.at) preview.schedule.local = campaignSchedule.formatInZone(new Date(preview.schedule.at), timezone);
    res.json({ preview });
  } catch (err) {
    console.error('Campaign preview error:', err.message);
    res.status(500).json({ error: 'Could not prepare the preview. Please try again.' });
  }
});

app.post('/api/campaigns', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const { name, client_id, template_id, target_status, scheduled_at, template_parameters = {}, preview_confirmed, send_rest_later } = req.body;
    // A label audience must be one of this workspace's labels.
    const audience = await audienceLabel(req.body);
    if (audience.missing) return res.status(404).json(LABEL_NOT_FOUND);
    const hasTag = audience.id != null;

    if (!name || !client_id || !template_id || !(target_status || hasTag)) {
      return res.status(400).json({ error: 'Campaign name, brand, template, and target audience are required.' });
    }
    if (preview_confirmed !== true) {
      return res.status(400).json({ error: 'Review the preview before sending.', code: 'PREVIEW_REQUIRED' });
    }
    const timezone = await campaignSchedule.tenantTimezone();
    const schedule = campaignSchedule.parseSchedule(scheduled_at, timezone);
    const scheduleError = schedule.error || campaignSchedule.scheduleProblem(schedule.at);
    if (scheduleError) return res.status(400).json({ error: scheduleError, code: 'SCHEDULE_INVALID' });
    const runAt = schedule.at && schedule.at > new Date() ? schedule.at : null;
    const preview = await campaignAudience.previewCampaign({ name, client_id, template_id, target_status: target_status || 'all', target_label_id: audience.id, scheduled_at: runAt ? runAt.toISOString() : null, template_parameters });
    if (!preview.can_send) {
      return res.status(400).json({ error: preview.blockers[0] || 'This campaign cannot be sent yet.', code: 'CAMPAIGN_NOT_READY', blockers: preview.blockers });
    }
    // The number's daily limit: a campaign larger than what is left that day
    // is refused unless the owner agreed to send the rest on the next day(s).
    if (preview.sending?.over_limit && send_rest_later !== true) {
      const left = preview.sending.available_on_send_day;
      return res.status(409).json({
        code: 'DAILY_LIMIT_EXCEEDED',
        error: left > 0
          ? `Your WhatsApp number can send ${left} more messages ${runAt ? 'on that day' : 'today'}, but this campaign goes to ${preview.audience.will_send} contacts. Choose a smaller audience, or agree to send the rest the next day.`
          : `Your WhatsApp number has used today's limit of ${preview.sending.daily_limit} messages. Schedule the campaign for tomorrow, or agree to start it tomorrow.`,
        sending: preview.sending,
      });
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

    // Both kinds wait as "scheduled": a timed one for the scheduler (every
    // minute); an immediate one is started below, and if this process stops
    // before it starts, the scheduler picks it up (scheduled_at null, server.js).
    const campaign = (await Campaigns.create({
      name: String(name).trim().slice(0, 120), client_id: Number(client_id), template_id: Number(template_id), target_status: target_status || 'all',
      target_label_id: audience.id, target_tag_id: null, scheduled_at: runAt, status: 'scheduled', timezone,
      send_rest_later: Boolean(preview.sending?.over_limit), created_by: req.user.id, created_at: new Date(), template_parameters,
    })).toObject();

    if (!runAt) {
      // Execute with delay to ensure campaign is created first
      setTimeout(() => {
        executeCampaign(campaign.id).catch(err => {
          console.error('Auto-execute campaign error:', err);
        });
      }, 500);
    }

    const audienceSize = preview.audience?.will_send;
    await activity.log(req, runAt ? activity.EVENTS.CAMPAIGN_SCHEDULED : activity.EVENTS.CAMPAIGN_SENT, {
      targetType: 'campaign', targetId: campaign.id,
      summary: runAt
        ? `Scheduled campaign "${campaign.name}" (template "${selectedTemplate.name}") for ${campaignTime(runAt, timezone)}${audienceSize != null ? `, ${audienceSize} contacts` : ''}`
        : `Created campaign "${campaign.name}" (template "${selectedTemplate.name}") and started sending${audienceSize != null ? ` to ${audienceSize} contacts` : ''}`,
      meta: { template: selectedTemplate.name, audience: audienceSize ?? null, scheduled_at: runAt },
    });
    res.status(201).json({ campaign });
  } catch (err) {
    console.error('Create campaign error:', err);
    res.status(500).json({ error: 'Could not create the campaign. Please try again.' });
  }
});

// Live progress of one campaign, for the sending screen: queued, sent, failed,
// skipped and delivery receipts. Polled every few seconds by the page.
app.get('/api/campaigns/:id/progress', auth, requireSection('campaigns'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const campaign = await Campaigns.findOne({ id }, { _id: 0, id: 1, name: 1, status: 1, scheduled_at: 1, launched_at: 1, created_at: 1 }).lean();
    if (!campaign) return res.status(404).json({ error: 'This campaign was not found.' });
    const [queue, counts, nextRow] = await Promise.all([
      campaignQueueStats({ campaign_id: id }),
      campaignStats.countsFor([id]),
      CampaignMessageQueue.findOne({ campaign_id: id, status: 'pending', next_attempt_at: { $gt: new Date() } }, { _id: 0, next_attempt_at: 1 }).sort({ next_attempt_at: 1 }).lean(),
    ]);
    const c = counts.get(id);
    res.json({
      progress: {
        ...campaign,
        total: queue.total, queued: queue.pending + queue.processing, sent: queue.sent, failed: queue.failed, skipped: queue.skipped + queue.cancelled,
        delivered: c.delivered, read: c.read, replied: c.replied,
        waiting_until: nextRow?.next_attempt_at || null,
        server_time: new Date(),
        done: ['completed', 'failed', 'cancelled'].includes(campaign.status),
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Could not load the campaign progress.' });
  }
});

// Cancel a scheduled campaign before it starts.
app.post('/api/campaigns/:id/cancel', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = await Campaigns.updateOne({ id, status: 'scheduled' }, { $set: { status: 'cancelled', cancelled_at: new Date(), cancelled_by: req.user.id } });
    if (!result.modifiedCount) {
      const campaign = await Campaigns.findOne({ id }, { _id: 0, status: 1 }).lean();
      if (!campaign) return res.status(404).json({ error: 'This campaign was not found.' });
      return res.status(409).json({ error: campaign.status === 'cancelled' ? 'This campaign is already cancelled.' : 'This campaign has already started, so it cannot be cancelled.', code: 'NOT_SCHEDULED' });
    }
    const cancelled = await Campaigns.findOne({ id }, NO_ID).lean();
    await activity.log(req, activity.EVENTS.CAMPAIGN_CANCELLED, { targetType: 'campaign', targetId: id, summary: `Cancelled scheduled campaign "${cancelled?.name || `#${id}`}"` });
    res.json({ success: true, campaign: cancelled });
  } catch (err) {
    res.status(500).json({ error: 'Could not cancel the campaign. Please try again.' });
  }
});

// Rename or move a scheduled campaign (only before it starts).
app.patch('/api/campaigns/:id', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const campaign = await Campaigns.findOne({ id }, NO_ID).lean();
    if (!campaign) return res.status(404).json({ error: 'This campaign was not found.' });
    if (campaign.status !== 'scheduled' || !campaign.scheduled_at) {
      return res.status(409).json({ error: 'Only a campaign that is scheduled and has not started can be changed.', code: 'NOT_SCHEDULED' });
    }
    const set = {};
    if (req.body?.name != null) {
      const name = String(req.body.name).trim();
      if (!name) return res.status(400).json({ error: 'Give the campaign a name.' });
      set.name = name.slice(0, 120);
    }
    if (req.body?.scheduled_at !== undefined) {
      const timezone = await campaignSchedule.tenantTimezone();
      const schedule = campaignSchedule.parseSchedule(req.body.scheduled_at, timezone);
      if (!schedule.at) return res.status(400).json({ error: schedule.error || 'Pick a date and time.', code: 'SCHEDULE_INVALID' });
      const problem = campaignSchedule.scheduleProblem(schedule.at) || (schedule.at <= new Date() ? 'Pick a time in the future.' : null);
      if (problem) return res.status(400).json({ error: problem, code: 'SCHEDULE_INVALID' });
      set.scheduled_at = schedule.at;
      set.timezone = timezone;
    }
    if (!Object.keys(set).length) return res.status(400).json({ error: 'Nothing to change.' });
    // Only while it is still waiting: the scheduler may have just started it.
    const result = await Campaigns.updateOne({ id, status: 'scheduled' }, { $set: set });
    if (!result.matchedCount) return res.status(409).json({ error: 'This campaign has just started, so it cannot be changed.', code: 'NOT_SCHEDULED' });
    const updated = await Campaigns.findOne({ id }, NO_ID).lean();
    const edits = [];
    if (set.name !== undefined && set.name !== campaign.name) edits.push(`renamed from "${campaign.name}"`);
    if (set.scheduled_at) edits.push(`moved to ${campaignTime(set.scheduled_at, set.timezone)}`);
    await activity.log(req, activity.EVENTS.CAMPAIGN_UPDATED, {
      targetType: 'campaign', targetId: id,
      summary: `Changed campaign "${updated?.name || campaign.name}"${edits.length ? `: ${edits.join(', ')}` : ''}`,
      meta: { fields: Object.keys(set).filter((f) => f !== 'timezone'), before: { name: campaign.name, scheduled_at: campaign.scheduled_at }, after: { name: updated?.name, scheduled_at: updated?.scheduled_at } },
    });
    res.json({ campaign: updated });
  } catch (err) {
    res.status(500).json({ error: 'Could not update the campaign. Please try again.' });
  }
});

app.delete('/api/campaigns/:id', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const { id } = req.params;
    const doomedCampaign = await Campaigns.findOne({ id: Number(id) }, { _id: 0, name: 1, status: 1 }).lean();
    await deleteCascade('campaign_logs', { campaign_id: Number(id) });
    const deleted = await deleteCascade('campaigns', { id: Number(id) });
    if (deleted.length === 0) return res.status(404).json({ error: 'This campaign was not found.' });
    await activity.log(req, activity.EVENTS.CAMPAIGN_DELETED, { targetType: 'campaign', targetId: id, summary: `Deleted campaign "${doomedCampaign?.name || `#${id}`}"${doomedCampaign?.status ? ` (was ${doomedCampaign.status})` : ''}` });
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Could not delete the campaign. Please try again.' });
  }
});

// POST /api/campaigns/execute
app.post('/api/campaigns/execute', internalAuth, requireSection('campaigns'), async (req, res) => {
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
app.post('/api/campaigns/:id/retry', auth, requireSection('campaigns'), manage, async (req, res) => {
  try {
    const { id } = req.params;

    // Get campaign details
    const campaign = await Campaigns.findOne({ id }, NO_ID).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'This campaign was not found.' });
    }
    // A waiting or cancelled campaign is never sent early by a retry.
    if (campaign.status === 'cancelled' || (campaign.status === 'scheduled' && campaign.scheduled_at && new Date(campaign.scheduled_at) > new Date())) {
      return res.status(409).json({ error: campaign.status === 'cancelled' ? 'This campaign was cancelled.' : 'This campaign is scheduled and has not started yet.', code: 'NOT_RETRYABLE' });
    }
    if (campaign.status === 'completed') {
      return res.status(409).json({ error: 'This campaign has finished. Create a new campaign to send it again.', code: 'NOT_RETRYABLE' });
    }

    // Check if there are already messages in queue for this campaign
    const queuedCount = await CampaignMessageQueue.countDocuments({ campaign_id: Number(id) });

    if (queuedCount > 0) {
      // Messages already in queue, just reset status to running
      await Campaigns.updateOne({ id }, { $set: { status: 'running' } });
      await activity.log(req, activity.EVENTS.CAMPAIGN_RETRIED, { targetType: 'campaign', targetId: id, summary: `Restarted campaign "${campaign.name || `#${id}`}"` });
      return res.json({ success: true, message: 'Campaign already has messages in queue, status reset to running' });
    }

    // Re-execute the campaign (will add fresh messages to queue)
    await Campaigns.updateOne({ id }, { $set: { status: 'scheduled' } });

    // Execute and wait for result
    try {
      await executeCampaign(id);
      await activity.log(req, activity.EVENTS.CAMPAIGN_RETRIED, { targetType: 'campaign', targetId: id, summary: `Restarted campaign "${campaign.name || `#${id}`}"` });
      res.json({ success: true, message: 'Campaign retry initiated' });
    } catch (execErr) {
      console.error('Execute campaign error:', execErr);
      // Reset status to failed
      await Campaigns.updateOne({ id }, { $set: { status: 'failed' } });
      res.status(500).json({ error: 'Could not restart the campaign. Please try again in a few minutes.' });
    }
  } catch (err) {
    console.error('Campaign retry error:', err);
    res.status(500).json({ error: 'Could not restart the campaign. Please try again in a few minutes.' });
  }
});

// GET /api/campaigns/:id/queue - Get queue status for specific campaign
app.get('/api/campaigns/:id/queue', auth, requireSection('campaigns'), async (req, res) => {
  try {
    const { id } = req.params;
    res.json({ queue: await campaignQueueStats({ campaign_id: Number(id) }) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/:id/debug - Debug campaign recipients
app.get('/api/campaigns/:id/debug', auth, requireSection('campaigns'), async (req, res) => {
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
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/queue/status - Get overall queue processing status
app.get('/api/campaigns/queue/status', auth, requireSection('campaigns'), async (req, res) => {
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
app.get('/api/campaigns/:id/logs', auth, requireSection('campaigns'), async (req, res) => {
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
};
