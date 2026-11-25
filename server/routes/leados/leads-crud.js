/**
 * LeadOS routes: Lead create, update, delete and tags.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
const { currentTenantId } = require('../../services/tenantContext');
const { postToN8n } = require('../../services/n8n');
const aiAutomation = require('../../services/aiAutomation');
const consent = require('../../services/consent');
const { requirePermission } = require('../../services/permissions');
const { normalizeSourceKind } = require('../../services/leadSources');

// Statuses a lead can be given on the Leads page.
const LEAD_STATUSES = ['new', 'hot', 'warm', 'cold', 'converted', 'lost'];
// Sources a person can pick when adding a lead by hand (stored as these
// words). "website" is no longer a source and is refused.
const ADD_LEAD_SOURCES = { manual: 'Manual', whatsapp: 'WhatsApp' };
const MAX_BULK = 500;

module.exports = function registerLeadsCrudRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  LeadTags,
  Leads,
  Messages,
  NO_ID,
  Payments,
  SalesTasks,
  auth,
  axios,
  deleteCascade,
  evaluateLeadBrandAndSchedule,
  getLeadOSBrand,
  insertIgnore,
  Users,
} = ctx;

// assigned_to from a request: null to unassign, or a team member of this
// workspace. Users is tenant-scoped, so another workspace's user is not found.
async function resolveAssignee(value) {
  if (value === null || value === '' || value === undefined) return { value: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return { error: 'Choose a team member from the list.' };
  const user = await Users.findOne({ id, is_platform_staff: { $ne: true }, is_active: { $ne: false } }, { _id: 0, id: 1 }).lean();
  if (!user) return { error: 'That team member is not in this workspace.' };
  return { value: user.id };
}

function addLeadSource(value) {
  if (value == null || String(value).trim() === '') return 'Manual';
  const kind = normalizeSourceKind(value);
  return kind === 'manual' || kind === 'whatsapp' ? ADD_LEAD_SOURCES[kind] : null;
}
// POST /api/leads
app.post('/api/leads', auth, async (req, res) => {
  try {
    const { name, phone, source, interest, assigned_to, whatsapp_opt_in, opt_in_source, opt_in_text } = req.body;
    const leadOSBrand = await getLeadOSBrand();
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    // Strip formatting (spaces/dashes/parens) so this matches the digits-only format
    // every phone-matching query in the app expects. Does not add/assume a country code.
    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (!normalizedPhone) return res.status(400).json({ error: 'Enter a valid phone number' });
    // Marketing consent is recorded only when the agent says the contact gave
    // it, with the wording they agreed to. Checked before the lead is created.
    const wantsOptIn = whatsapp_opt_in === true || whatsapp_opt_in === 'true';
    const consentText = String(opt_in_text || '').trim();
    if (wantsOptIn && !consentText) return res.status(400).json({ error: 'opt_in_text is required: the wording the contact agreed to' });

    const leadSource = addLeadSource(source);
    if (!leadSource) return res.status(400).json({ error: 'Choose Manual or WhatsApp as the source.' });
    const assignee = await resolveAssignee(assigned_to);
    if (assignee.error) return res.status(400).json({ error: assignee.error });

    const createdLead = await Leads.create({
      name, phone: normalizedPhone, source: leadSource, client_id: leadOSBrand.id, interest: interest || '',
      assigned_to: assignee.value, status: 'new', score: 0, created_at: new Date(),
    });
    const rows = [createdLead.toObject()];

    if (wantsOptIn) {
      const recorded = await consent.recordOptIn({ leadId: rows[0].id, phone: normalizedPhone, source: opt_in_source || 'manual', text: consentText, by: req.user.id });
      rows[0].whatsapp_opt_in = true;
      rows[0].whatsapp_opt_in_at = recorded.opt_in_at;
    }

    // n8n sends the welcome template back through /api/internal/send-template;
    // it never receives a WhatsApp credential.
    if (process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
      postToN8n(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
        lead_id: rows[0].id,
        tenant_id: currentTenantId(),
        name: rows[0].name,
        phone: rows[0].phone,
        client_id: rows[0].client_id,
      }).catch(e => console.error('[n8n Webhook Error]', e.message));
    }

    evaluateLeadBrandAndSchedule(rows[0].id).catch(console.error);

    res.status(201).json({ lead: rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/bulk  { ids, action: 'assign' | 'status', assigned_to, status }
// The Leads page's bulk actions. Only this workspace's leads are changed.
app.post('/api/leads/bulk', auth, async (req, res) => {
  try {
    const { ids, action } = req.body || {};
    const leadIds = Array.isArray(ids) ? [...new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0))] : [];
    if (!leadIds.length) return res.status(400).json({ error: 'Select at least one lead.' });
    if (leadIds.length > MAX_BULK) return res.status(400).json({ error: `Select up to ${MAX_BULK} leads at a time.` });
    const set = { updated_at: new Date() };
    if (action === 'assign') {
      const assignee = await resolveAssignee(req.body.assigned_to);
      if (assignee.error) return res.status(400).json({ error: assignee.error });
      set.assigned_to = assignee.value;
    } else if (action === 'status') {
      const status = String(req.body.status || '').trim().toLowerCase();
      if (!LEAD_STATUSES.includes(status)) return res.status(400).json({ error: 'Choose a status from the list.' });
      set.status = status;
    } else {
      return res.status(400).json({ error: 'Unknown bulk action.' });
    }
    const result = await Leads.updateMany({ id: { $in: leadIds } }, { $set: set });
    res.json({ success: true, updated: result.matchedCount ?? result.n ?? 0 });
  } catch (err) {
    console.error('Bulk lead update error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// PATCH /api/leads/:id
app.patch('/api/leads/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, status, score, assigned_to, interest, notes } = req.body;
    const updates = {};

    if (name !== undefined) updates.name = name;
    if (phone !== undefined) updates.phone = String(phone).replace(/\D/g, '');
    if (email !== undefined) updates.email = email;
    if (status !== undefined) updates.status = status;
    if (score !== undefined) updates.score = score;
    if (assigned_to !== undefined) {
      const assignee = await resolveAssignee(assigned_to);
      if (assignee.error) return res.status(400).json({ error: assignee.error });
      updates.assigned_to = assignee.value;
    }
    if (interest !== undefined) updates.interest = interest;
    if (notes !== undefined) updates.notes = notes;

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const lead = await Leads.findOneAndUpdate({ id: req.params.id }, { $set: { ...updates, updated_at: new Date() } }, { new: true, projection: NO_ID }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ lead });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/:id/ai   { paused: boolean }
// A person takes over a chat (paused) or hands it back to the AI, which also
// clears the handover flag and draft.
app.post('/api/leads/:id/ai', auth, async (req, res) => {
  try {
    if (typeof req.body?.paused !== 'boolean') return res.status(400).json({ error: 'paused must be true or false' });
    const found = await aiAutomation.setAiPaused(req.params.id, req.body.paused);
    if (!found) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, ai_paused: req.body.paused });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', auth, requirePermission('leads.delete'), async (req, res) => {
  try {
    const { id } = req.params;
    await Messages.deleteMany({ conversation_id: { $in: await Conversations.distinct('id', { lead_id: id }) } });
    await Conversations.deleteMany({ lead_id: id });
    await Payments.deleteMany({ lead_id: id });
    // sales_tasks has no ON DELETE CASCADE (unlike every other lead_id FK), so it
    // would block the delete below if left out.
    await SalesTasks.deleteMany({ lead_id: id });

    const deleted = await deleteCascade('leads', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Lead not found' });

    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/leads/:id/tags', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { tagId } = req.body;
    await insertIgnore(LeadTags, { lead_id: id, tag_id: tagId, assigned_at: new Date() });
    res.json({ success: true });
  } catch (err) {
    console.error('Add lead tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/leads/:id/tags/:tagId', auth, async (req, res) => {
  try {
    const { id, tagId } = req.params;
    await LeadTags.deleteMany({ lead_id: id, tag_id: tagId });
    res.json({ success: true });
  } catch (err) {
    console.error('Remove lead tag error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/migrate-flow-step — one-time migration
app.post('/api/leads/migrate-flow-step', auth, async (req, res) => {
  try {
    // 1. Add flow_step to leads
    await Leads.updateMany({ flow_step: null }, { $set: { flow_step: 'welcome' } });

    // 2. brain_docs has no doc_type constraint in MongoDB, so nothing else to migrate
    
    res.json({ success: true, message: 'DB migration successful! flow_step added and constraints updated.' });
  } catch (err) {
    console.error('Migration error:', err);
    res.status(500).json({ error: err.message });
  }
});
};
