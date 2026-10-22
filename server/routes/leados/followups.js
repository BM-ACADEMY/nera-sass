/**
 * LeadOS routes: Follow-up engine (WF02), lead export and lead list.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
module.exports = function registerFollowupsRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  FACEBOOK_SOURCE,
  LeadExportJobs,
  LeadNotes,
  LeadTags,
  Leads,
  Messages,
  NO_ID,
  auth,
  axios,
  enrichLeadRows,
  escapeRegex,
  fs,
  leadExportFilter,
  leadExportReady,
  leadInboxMessages,
  models,
  openRouter,
  phoneTailRegex,
  processLeadExportJob,
  socialPageId,
  trigramSimilarity,
} = ctx;
// ═══════════════════════════════════════════════════════════════════
// FOLLOWUP ENGINE APIs (WF02)
// ═══════════════════════════════════════════════════════════════════

// GET /api/followups/due - Get leads due for follow-up
app.get('/api/followups/due', auth, async (req, res) => {
  try {
    const dueLeads = await Leads.find(
      { next_follow_up: { $ne: null, $lte: new Date() }, status: { $nin: ['lost', 'converted', null] } },
      { id: 1, name: 1, phone: 1, email: 1, status: 1, client_id: 1, touch_count: 1, next_follow_up: 1, last_contact: 1 }
    ).sort({ next_follow_up: 1 }).limit(100).lean();
    const dueClients = new Map((await Clients.find({ id: { $in: dueLeads.map((l) => l.client_id).filter((id) => id != null) } }, { id: 1, name: 1 }).lean()).map((c) => [c.id, c.name]));
    const rows = dueLeads.map((l) => ({
      lead_id: l.id, name: l.name, phone: l.phone, email: l.email, lead_status: l.status, client_id: l.client_id,
      touch_count: l.touch_count, next_follow_up: l.next_follow_up, last_contact: l.last_contact ?? null,
      brand: dueClients.get(l.client_id) ?? null,
    }));
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
    const ruleLead = await Leads.findOne({ id: lead_id }, { client_id: 1 }).lean();
    const rows = ruleLead?.client_id != null ? await models.FollowupRules.find(
      { client_id: ruleLead.client_id, stage: stage || 'new', touch_count: { $lte: Number(touch_count) || 0 } },
      NO_ID
    ).sort({ touch_count: -1 }).limit(1).lean() : [];

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
    const lastOutbound = await Messages.findOne(
      { conversation_id: { $in: await Conversations.distinct('id', { lead_id }) }, direction: 'outbound', sent_at: { $ne: null } },
      { sent_at: 1 }
    ).sort({ sent_at: -1 }).lean();

    const lastMessageAt = lastOutbound?.sent_at;
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
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    if (!leadRow) {
      return res.status(404).json({ error: 'Lead not found' });
    }
    const leadClient = leadRow.client_id != null ? await Clients.findOne({ id: leadRow.client_id }, { wa_access_token: 1, phone_number_id: 1, whatsapp_status: 1 }).lean() : null;
    const lead = {
      ...leadRow,
      wa_access_token: leadClient?.wa_access_token ?? null,
      phone_number_id: leadClient?.phone_number_id ?? null,
      whatsapp_status: leadClient?.whatsapp_status ?? null,
    };
    if (lead.client_id && lead.whatsapp_status !== 'verified') {
      return res.status(403).json({ error: 'WhatsApp is disabled for this brand until verification succeeds' });
    }
    const waToken = lead.wa_access_token;
    const phoneId = lead.phone_number_id;

    if (!waToken || !phoneId) {
      return res.status(409).json({ error: 'WhatsApp is not connected for this workspace. Connect WhatsApp in Settings first.', code: 'WHATSAPP_NOT_CONNECTED' });
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
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    const leadRes = { rows: leadRow ? [leadRow] : [] };
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
    const leadRow = await Leads.findOne({ id: lead_id }, NO_ID).lean();
    const leadRes = { rows: leadRow ? [leadRow] : [] };
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

    await LeadNotes.create({ lead_id, user_id: req.user.id, note, created_at: new Date() });

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
      await Leads.updateOne({ id: lead_id }, [{ $set: { touch_count: { $add: [{ $ifNull: ['$touch_count', 0] }, 1] }, updated_at: '$$NOW' } }]);
    }

    // Set next follow-up
    if (delay_hours) {
      await Leads.updateOne({ id: lead_id }, { $set: {
        next_follow_up: new Date(Date.now() + Number(delay_hours) * 60 * 60 * 1000), last_contact: new Date(), updated_at: new Date(),
      } });
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
    const totalRecords = await Leads.countDocuments(leadExportFilter(filters));
    const userId = req.user.id || req.user.user_id || null;
    const createdJob = await LeadExportJobs.create({ user_id: userId, mode, filters, total_records: totalRecords });
    const job = { id: createdJob.id, status: createdJob.status, total_records: createdJob.total_records };
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
  const exportJob = await LeadExportJobs.findOne(
    { id: req.params.id, user_id: userId ?? null },
    { _id: 0, id: 1, status: 1, total_records: 1, processed_records: 1, error_message: 1, created_at: 1, completed_at: 1 }
  ).lean();
  if (!exportJob) return res.status(404).json({ error: 'Export not found' });
  res.json(exportJob);
});

app.get('/api/leads/exports/:id/download', auth, async (req, res) => {
  await leadExportReady;
  const userId = req.user.id || req.user.user_id || null;
  const job = await LeadExportJobs.findOne({ id: req.params.id, user_id: userId ?? null }, { _id: 0, status: 1, file_path: 1, mode: 1 }).lean();
  if (!job) return res.status(404).json({ error: 'Export not found' });
  if (job.status !== 'completed' || !job.file_path || !fs.existsSync(job.file_path)) return res.status(409).json({ error: 'Export is not ready' });
  res.download(job.file_path, `leads_export_${job.mode}_${new Date().toISOString().slice(0, 10)}.csv`);
});

// GET /api/leads
app.get('/api/leads/facebook-filter-options', auth, async (req, res) => {
  try {
    const nullsLast = (a, b) => (a == null ? (b == null ? 0 : 1) : b == null ? -1 : String(a).localeCompare(String(b)));
    const blank = (value) => value == null || String(value).trim() === '';
    const fbLeads = await Leads.find({ source: FACEBOOK_SOURCE }, { campaign_name: 1, ad_name: 1 }).lean();
    const optionKeys = new Map();
    for (const l of fbLeads) {
      if (blank(l.campaign_name) && blank(l.ad_name)) continue;
      const option = { campaign_name: l.campaign_name ?? null, ad_name: l.ad_name ?? null };
      optionKeys.set(JSON.stringify(option), option);
    }
    const options = [...optionKeys.values()].sort((a, b) => nullsLast(a.campaign_name, b.campaign_name) || nullsLast(a.ad_name, b.ad_name));
    const firstFilled = (...values) => values.find((value) => value != null && value !== '') ?? null;
    const pageKeys = new Map();
    for (const account of await models.BrandSocialAccounts.find({ is_active: true, platform: /^(facebook|instagram)$/i }).lean()) {
      if (blank(account.account_name)) continue;
      const page = {
        platform: account.platform,
        page_name: account.account_name,
        brand_name: account.brand_name,
        page_id: String(account.platform).toLowerCase() === 'instagram'
          ? firstFilled(account.instagram_business_id, account.account_id, account.facebook_page_id)
          : firstFilled(account.facebook_page_id, account.account_id, account.instagram_business_id),
      };
      pageKeys.set(JSON.stringify(page), page);
    }
    const pages = [...pageKeys.values()].sort((a, b) => String(a.platform).localeCompare(String(b.platform)) || String(a.page_name).localeCompare(String(b.page_name)));
    res.json({ options, pages: pages.filter(page => page.page_id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/leads', auth, async (req, res) => {
  try {
    const { status, brand, search, source, campaign_name, ad_name, meta_page_id, from, to, tag_id, limit = 100, offset = 0 } = req.query;
    const and = [];

    if (status && status !== 'all') {
      if (String(status).toLowerCase() === 'cold') {
        // Legacy leads with no status have always been displayed as Cold in the
        // UI, so include them in the Cold tab as well.
        and.push({ $or: [{ status: null }, { status: /^\s*$/ }, { status: /^\s*cold\s*$/i }] });
      } else {
        and.push({ status: new RegExp(`^\\s*${escapeRegex(String(status))}\\s*$`, 'i') });
      }
    }
    if (brand && brand !== 'All Brands') {
      const brandIds = await Clients.distinct('id', { name: new RegExp(escapeRegex(brand), 'i') });
      and.push({ client_id: { $in: brandIds } });
    }
    if (source && source !== 'all') {
      const normalizedSource = String(source).toLowerCase();
      if (['facebook', 'whatsapp', 'website', 'xls_sheet'].includes(normalizedSource)) {
        and.push(leadExportFilter({ source: normalizedSource }));
      } else {
        and.push({ source: new RegExp(`^\\s*${escapeRegex(String(source).trim())}\\s*$`, 'i') });
      }
    }
    if (campaign_name) and.push({ source: FACEBOOK_SOURCE }, { campaign_name });
    if (ad_name) and.push({ source: FACEBOOK_SOURCE }, { ad_name });
    if (meta_page_id) {
      const pageAccounts = (await models.BrandSocialAccounts.find({ is_active: true }).lean())
        .filter((account) => socialPageId(account) === String(meta_page_id));
      const pageClientIds = await Clients.distinct('id', { name: { $in: pageAccounts.map((account) => account.brand_name) } });
      and.push({ source: FACEBOOK_SOURCE }, { client_id: { $in: pageClientIds } });
    }
    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) return res.status(400).json({ error: 'Invalid from date' });
      and.push({ created_at: { $gte: fromDate } });
    }
    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) return res.status(400).json({ error: 'Invalid to date' });
      and.push({ created_at: { $lte: toDate } });
    }
    if (tag_id) {
      and.push({ id: { $in: await LeadTags.distinct('lead_id', { tag_id }) } });
    }

    const candidates = await Leads.find(and.length ? { $and: and } : {}, { id: 1, name: 1, phone: 1, created_at: 1 }).lean();
    let ordered;
    if (search) {
      const term = String(search);
      const pattern = new RegExp(escapeRegex(term), 'i');
      const digits = term.replace(/[^0-9]/g, '');
      const phoneMatches = (lead) => digits !== '' && String(lead.phone ?? '').replace(/[^0-9]/g, '').includes(digits);
      ordered = candidates
        .map((lead) => ({ lead, nameScore: trigramSimilarity(lead.name, term), phoneScore: trigramSimilarity(lead.phone ?? '', term), phoneHit: phoneMatches(lead) }))
        .filter(({ lead, nameScore, phoneHit }) => pattern.test(lead.name ?? '') || pattern.test(lead.phone ?? '') || nameScore > 0.3 || phoneHit)
        .sort((a, b) => Number(b.phoneHit) - Number(a.phoneHit) || b.nameScore - a.nameScore || b.phoneScore - a.phoneScore)
        .map(({ lead }) => lead);
    } else {
      const lastMessageAt = new Map((await Conversations.aggregate([
        { $match: { lead_id: { $in: candidates.map((l) => l.id) } } },
        { $group: { _id: '$lead_id', last: { $max: '$last_message_at' } } },
      ])).map((row) => [row._id, row.last]));
      const activity = (lead) => new Date(lastMessageAt.get(lead.id) ?? lead.created_at ?? 0).getTime();
      ordered = [...candidates].sort((a, b) => activity(b) - activity(a));
    }
    const pageIds = ordered.slice(Number(offset) || 0, (Number(offset) || 0) + (Number(limit) || 100)).map((lead) => lead.id);
    const pageLeads = new Map((await Leads.find({ id: { $in: pageIds } }, NO_ID).lean()).map((lead) => [lead.id, lead]));
    const filteredTotal = pageIds.length ? ordered.length : 0;
    const rows = (await enrichLeadRows(pageIds.map((id) => pageLeads.get(id)).filter(Boolean)))
      .map((row) => ({ ...row, filtered_total: filteredTotal }));
    res.json({ leads: rows, total: filteredTotal });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id
app.get('/api/leads/:id', auth, async (req, res) => {
  try {
    const leadRow = await Leads.findOne({ id: req.params.id }, NO_ID).lean();
    if (!leadRow) return res.status(404).json({ error: 'Lead not found' });
    const leadClient = leadRow.client_id != null ? await Clients.findOne({ id: leadRow.client_id }, { name: 1, phone_number_id: 1, wa_access_token: 1 }).lean() : null;
    const [enriched] = await enrichLeadRows([leadRow]);
    const lead = {
      ...leadRow,
      brand_name: leadClient?.name ?? null,
      phone_number_id: leadClient?.phone_number_id ?? null,
      wa_access_token: leadClient?.wa_access_token ?? null,
      assigned_name: enriched.assigned_name,
      tags: enriched.tags,
    };

    // Join conversations (thread) → messages (individual) for this lead
    const conversations = await leadInboxMessages(await Conversations.distinct('id', { lead_id: leadRow.id }));

    res.json({ lead, conversations });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id/messages
app.get('/api/leads/:id/messages', auth, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const messageLead = await Leads.findOne({ id: req.params.id }, { phone: 1 }).lean();
    const conversationFilter = [{ lead_id: req.params.id }];
    if (messageLead && messageLead.phone != null) conversationFilter.push({ lead_id: null, phone: phoneTailRegex(messageLead.phone) });
    const conversationIds = await Conversations.distinct('id', { $or: conversationFilter });
    const messages = await leadInboxMessages(conversationIds, { sort: { sent_at: -1 }, skip: parseInt(offset) || 0, limit: parseInt(limit) || 100 });

    res.json({ messages: messages.reverse() });
  } catch (err) {
    console.error('Messages fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});
};
