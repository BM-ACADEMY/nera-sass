/**
 * LeadOS routes: Lead create, update, delete and tags.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
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
} = ctx;
// POST /api/leads
app.post('/api/leads', auth, async (req, res) => {
  try {
    const { name, phone, source, interest, assigned_to } = req.body;
    const leadOSBrand = await getLeadOSBrand();
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' });
    // Strip formatting (spaces/dashes/parens) so this matches the digits-only format
    // every phone-matching query in the app expects. Does not add/assume a country code.
    const normalizedPhone = String(phone).replace(/\D/g, '');
    if (!normalizedPhone) return res.status(400).json({ error: 'Enter a valid phone number' });

    const createdLead = await Leads.create({
      name, phone: normalizedPhone, source: source || 'Manual', client_id: leadOSBrand.id, interest: interest || '',
      assigned_to: assigned_to || null, status: 'new', score: 0, created_at: new Date(),
    });
    const rows = [createdLead.toObject()];

    // Trigger n8n webhook for new leads to send welcome template.
    // Prefer this brand's own WhatsApp credentials (kept current via the
    // integrations/reconnect flow) over the static .env pair, which can go
    // stale — matches the lookup already done for bulk import (see /api/leads/import).
    if (process.env.N8N_NEW_LEAD_WEBHOOK_URL) {
      Clients.findOne({ id: rows[0].client_id }, { phone_number_id: 1, wa_access_token: 1 }).lean()
        .then(webhookClient => {
          const phoneNumberId = webhookClient?.phone_number_id || process.env.WA_PHONE_NUMBER_ID;
          const waAccessToken = webhookClient?.wa_access_token || process.env.META_PAGE_ACCESS_TOKEN;
          return axios.post(process.env.N8N_NEW_LEAD_WEBHOOK_URL, {
            lead_id: rows[0].id,
            name: rows[0].name,
            phone: rows[0].phone,
            client_id: rows[0].client_id,
            phone_number_id: phoneNumberId,
            wa_access_token: waAccessToken
          });
        })
        .catch(e => console.error('[n8n Webhook Error]', e.message));
    }

    evaluateLeadBrandAndSchedule(rows[0].id).catch(console.error);

    res.status(201).json({ lead: rows[0] });
  } catch (err) {
    console.error(err);
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
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;
    if (interest !== undefined) updates.interest = interest;
    if (notes !== undefined) updates.notes = notes;

    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const lead = await Leads.findOneAndUpdate({ id: req.params.id }, { $set: { ...updates, updated_at: new Date() } }, { new: true, projection: NO_ID }).lean();
    res.json({ lead: lead || undefined });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', auth, async (req, res) => {
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
