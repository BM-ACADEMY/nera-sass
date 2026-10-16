/**
 * LeadOS routes: Campaigns.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerCampaignsRoutes(app, ctx) {
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
app.get('/api/campaigns', auth, async (req, res) => {
  try {
    const campaignRows = await Campaigns.find({}, NO_ID).sort({ created_at: -1 }).lean();
    const [campaignClients, campaignTemplates, logCounts] = await Promise.all([
      Clients.find({ id: { $in: campaignRows.map((c) => c.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      Templates.find({ id: { $in: campaignRows.map((c) => c.template_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean(),
      CampaignLogs.aggregate([
        { $match: { campaign_id: { $in: campaignRows.map((c) => c.id) }, status: { $in: ['sent', 'delivered', 'read', 'replied'] } } },
        { $group: { _id: { campaign_id: '$campaign_id', status: '$status' }, count: { $sum: 1 } } },
      ]),
    ]);
    const clientNames = new Map(campaignClients.map((c) => [c.id, c.name]));
    const templateNames = new Map(campaignTemplates.map((t) => [t.id, t.name]));
    const logCount = (campaignId, status) => logCounts.find((c) => c._id.campaign_id === campaignId && c._id.status === status)?.count || 0;
    const rows = campaignRows.map((camp) => ({
      ...camp,
      brand_name: clientNames.get(camp.client_id) ?? null,
      template_name: templateNames.get(camp.template_id) ?? null,
      sent_count: logCount(camp.id, 'sent'),
      delivered_count: logCount(camp.id, 'delivered'),
      read_count: logCount(camp.id, 'read'),
      replied_count: logCount(camp.id, 'replied'),
    }));
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

    // Determine initial status
    const initialStatus = scheduled_at && new Date(scheduled_at) > new Date() ? 'scheduled' : 'scheduled';

    const campaign = (await Campaigns.create({
      name, client_id, template_id, target_status, scheduled_at: scheduled_at || null, status: initialStatus,
      created_by: req.user.id, created_at: new Date(), template_parameters,
    })).toObject();

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
    await deleteCascade('campaign_logs', { campaign_id: Number(id) });
    const deleted = await deleteCascade('campaigns', { id: Number(id) });
    if (deleted.length === 0) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, message: 'Campaign deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

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
    const campaign = await Campaigns.findOne({ id }, NO_ID).lean();
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if there are already messages in queue for this campaign
    const queuedCount = await CampaignMessageQueue.countDocuments({ campaign_id: Number(id) });

    if (queuedCount > 0) {
      // Messages already in queue, just reset status to running
      await Campaigns.updateOne({ id }, { $set: { status: 'running' } });
      return res.json({ success: true, message: 'Campaign already has messages in queue, status reset to running' });
    }

    // Re-execute the campaign (will add fresh messages to queue)
    await Campaigns.updateOne({ id }, { $set: { status: 'scheduled' } });

    // Execute and wait for result
    try {
      await executeCampaign(id);
      res.json({ success: true, message: 'Campaign retry initiated' });
    } catch (execErr) {
      console.error('Execute campaign error:', execErr);
      // Reset status to failed
      await Campaigns.updateOne({ id }, { $set: { status: 'failed' } });
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
    res.json({ queue: await campaignQueueStats({ campaign_id: Number(id) }) });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/campaigns/:id/debug - Debug campaign recipients
app.get('/api/campaigns/:id/debug', auth, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/campaigns/queue/status - Get overall queue processing status
app.get('/api/campaigns/queue/status', auth, async (req, res) => {
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
app.get('/api/campaigns/:id/logs', auth, async (req, res) => {
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
