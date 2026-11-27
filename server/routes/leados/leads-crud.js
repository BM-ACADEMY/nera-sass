/**
 * LeadOS routes: Lead create, update and delete.
 * Moved out of server.js unchanged; shared helpers still live in server.js and
 * arrive through `ctx`.
 */
const { currentTenantId } = require('../../services/tenantContext');
const { postToN8n } = require('../../services/n8n');
const aiAutomation = require('../../services/aiAutomation');
const consent = require('../../services/consent');
const { requirePermission, can } = require('../../services/permissions');
const { normalizeSourceKind } = require('../../services/leadSources');
const activity = require('../../services/activity');

// Statuses a lead can be given on the Leads page.
const LEAD_STATUSES = ['new', 'hot', 'warm', 'cold', 'converted', 'lost'];
// Sources a person can pick when adding a lead by hand (stored as these
// words). "website" is no longer a source and is refused.
const ADD_LEAD_SOURCES = { manual: 'Manual', whatsapp: 'WhatsApp' };
const MAX_BULK = 500;
const MAX_NOTE = 1000;

// Lead fields whose old and new values are shown in the activity log; other
// edited fields (name, phone, email, notes...) are listed by name only.
const LOGGED_VALUES = ['status', 'assigned_to', 'score'];

// Who last changed a lead by hand ("Updated by" on the Leads page). Platform
// staff working in a workspace show as "Getnera team", as in the activity log.
function changedBy(req) {
  const staff = req?.identity?.kind === 'staff';
  return {
    updated_by_user_id: req?.user?.id ?? null,
    updated_by_name: staff ? 'Getnera team' : (req?.user?.name || req?.user?.email || null),
    updated_by_at: new Date(),
  };
}

async function staffName(id) {
  if (id == null || id === '') return null;
  const user = await require('../../models').Users.findOne({ id: Number(id) }, { _id: 0, name: 1, email: 1 }).lean().catch(() => null);
  return user ? (user.name || user.email) : `user #${id}`;
}

// One activity entry per kind of change: status, assignment, other fields.
async function logLeadEdit(req, before, after, updates) {
  const name = activity.leadName(after);
  const changed = (field) => updates[field] !== undefined && String(before[field] ?? '') !== String(after[field] ?? '');
  const values = (fields) => ({
    before: Object.fromEntries(fields.map((f) => [f, before[f] ?? null])),
    after: Object.fromEntries(fields.map((f) => [f, after[f] ?? null])),
  });
  if (changed('status')) {
    await activity.log(req, activity.EVENTS.LEAD_STATUS_CHANGED, {
      targetType: 'lead', targetId: after.id,
      summary: `Changed status of lead ${name} from "${before.status || 'none'}" to "${after.status || 'none'}"`,
      meta: { fields: ['status'], ...values(['status']) },
    });
  }
  if (changed('assigned_to')) {
    const to = await staffName(after.assigned_to);
    await activity.log(req, activity.EVENTS.LEAD_ASSIGNED, {
      targetType: 'lead', targetId: after.id,
      summary: to ? `Assigned lead ${name} to ${to}` : `Unassigned lead ${name}`,
      meta: { fields: ['assigned_to'], ...values(['assigned_to']) },
    });
  }
  const others = Object.keys(updates).filter((f) => f !== 'status' && f !== 'assigned_to' && (f !== 'score' || changed('score')));
  if (others.length) {
    const shown = others.filter((f) => LOGGED_VALUES.includes(f));
    await activity.log(req, activity.EVENTS.LEAD_UPDATED, {
      targetType: 'lead', targetId: after.id,
      summary: `Edited lead ${name}: ${others.join(', ')}`,
      meta: { fields: others, ...(shown.length ? values(shown) : {}) },
    });
  }
}
module.exports = function registerLeadsCrudRoutes(app, ctx) {
const {
  Clients,
  Conversations,
  LeadNotes,
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

// The lead a request may work on, or null (answered with 404). Every team
// member of a workspace sees all of its leads (GET /api/leads and
// GET /api/leads/:id have no per-member filter); the tenant scope keeps other
// workspaces' leads out. Notes and the activity timeline go through here, so
// a future "own leads only" rule needs one change.
async function visibleLead(req, id) {
  const leadId = Number(id);
  if (!Number.isInteger(leadId) || leadId <= 0) return null;
  return Leads.findOne({ id: leadId }, { _id: 0, id: 1, name: 1, assigned_to: 1 }).lean();
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
      assigned_to: assignee.value, status: 'new', score: 0, created_at: new Date(), ...changedBy(req),
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

    await activity.log(req, activity.EVENTS.LEAD_CREATED, { targetType: 'lead', targetId: rows[0].id, summary: `Added lead ${activity.leadName(rows[0])} (source: ${rows[0].source})`, meta: { source: rows[0].source, opt_in: wantsOptIn } });
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
    const set = { updated_at: new Date(), ...changedBy(req) };
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
    const updated = result.matchedCount ?? result.n ?? 0;
    // One summary entry per bulk action (count and ids, no lead details).
    if (updated) {
      const assign = action === 'assign';
      const to = assign ? await staffName(set.assigned_to) : null;
      // Ids of this workspace's leads only (the tenant scope limits the read).
      const ownIds = await Leads.distinct('id', { id: { $in: leadIds } });
      await activity.log(req, assign ? activity.EVENTS.LEADS_BULK_ASSIGNED : activity.EVENTS.LEADS_BULK_STATUS_CHANGED, {
        targetType: 'lead', targetId: null,
        summary: assign
          ? (to ? `Assigned ${updated} lead${updated === 1 ? '' : 's'} to ${to}` : `Unassigned ${updated} lead${updated === 1 ? '' : 's'}`)
          : `Changed the status of ${updated} lead${updated === 1 ? '' : 's'} to "${set.status}"`,
        meta: { count: updated, ids: ownIds.slice(0, 100), fields: [assign ? 'assigned_to' : 'status'], after: assign ? { assigned_to: set.assigned_to } : { status: set.status } },
      });
    }
    res.json({ success: true, updated });
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

    const before = await Leads.findOne({ id: req.params.id }, { _id: 0, id: 1, name: 1, status: 1, assigned_to: 1, score: 1 }).lean();
    const lead = await Leads.findOneAndUpdate({ id: req.params.id }, { $set: { ...updates, updated_at: new Date(), ...changedBy(req) } }, { new: true, projection: NO_ID }).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (before) await logLeadEdit(req, before, lead, updates);
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
    const aiLead = await Leads.findOne({ id: req.params.id }, { _id: 0, id: 1, name: 1 }).lean();
    await activity.log(req, req.body.paused ? activity.EVENTS.CHAT_AI_PAUSED : activity.EVENTS.CHAT_AI_RESUMED, {
      targetType: 'lead', targetId: req.params.id,
      summary: req.body.paused ? `Took over the chat with ${activity.leadName(aiLead)} (AI paused)` : `Handed the chat with ${activity.leadName(aiLead)} back to the AI`,
    });
    res.json({ success: true, ai_paused: req.body.paused });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id
app.delete('/api/leads/:id', auth, requirePermission('leads.delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const doomedLead = await Leads.findOne({ id }, { _id: 0, id: 1, name: 1 }).lean();
    await Messages.deleteMany({ conversation_id: { $in: await Conversations.distinct('id', { lead_id: id }) } });
    await Conversations.deleteMany({ lead_id: id });
    await Payments.deleteMany({ lead_id: id });
    // sales_tasks has no ON DELETE CASCADE (unlike every other lead_id FK), so it
    // would block the delete below if left out.
    await SalesTasks.deleteMany({ lead_id: id });

    const deleted = await deleteCascade('leads', { id });
    if (deleted.length === 0) return res.status(404).json({ error: 'Lead not found' });

    await activity.log(req, activity.EVENTS.LEAD_DELETED, { targetType: 'lead', targetId: id, summary: `Deleted lead ${activity.leadName(doomedLead || { id })} and its chat history` });
    res.json({ success: true, message: 'Lead deleted successfully' });
  } catch (err) {
    console.error('Delete lead error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Labels on a lead (and the older /tags calls): routes/leados/labels.js.

// ── Notes (remarks the team keeps about a lead) ─────────────────────────
// Everyone who can see the lead reads and adds notes; a note is deleted by
// its author, or by an Owner/Admin (leads.notes.delete_any). The note text is
// never written to the activity log.
const noteOut = (req, row, names) => ({
  id: row.id,
  lead_id: row.lead_id,
  note: row.note,
  user_id: row.user_id ?? null,
  author_name: row.author_name || names.get(row.user_id) || 'Team member',
  created_at: row.created_at,
  can_delete: (row.user_id != null && row.user_id === req.user?.id) || can(req.identity, 'leads.notes.delete_any'),
});

// GET /api/leads/:id/notes — newest first.
app.get('/api/leads/:id/notes', auth, async (req, res) => {
  try {
    const lead = await visibleLead(req, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const rows = await LeadNotes.find({ lead_id: lead.id }, { _id: 0, id: 1, lead_id: 1, user_id: 1, author_name: 1, note: 1, created_at: 1 })
      .sort({ created_at: -1, id: -1 }).limit(200).lean();
    // Names for notes written before author_name was stored.
    const missing = [...new Set(rows.filter((r) => !r.author_name && r.user_id != null).map((r) => r.user_id))];
    const names = new Map(missing.length
      ? (await Users.find({ id: { $in: missing } }, { _id: 0, id: 1, name: 1, email: 1 }).lean()).map((u) => [u.id, u.name || u.email])
      : []);
    res.json({ notes: rows.map((row) => noteOut(req, row, names)) });
  } catch (err) {
    console.error('List lead notes error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/leads/:id/notes  { note }
app.post('/api/leads/:id/notes', auth, async (req, res) => {
  try {
    const lead = await visibleLead(req, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (typeof req.body?.note !== 'string') return res.status(400).json({ error: 'Write a note first.' });
    const text = req.body.note.trim();
    if (!text) return res.status(400).json({ error: 'Write a note first.' });
    if (text.length > MAX_NOTE) return res.status(400).json({ error: `Keep the note to ${MAX_NOTE} characters or fewer.` });
    const saved = (await LeadNotes.create({
      lead_id: lead.id, user_id: req.user?.id ?? null, author_name: changedBy(req).updated_by_name, note: text, created_at: new Date(),
    })).toObject();
    await activity.log(req, activity.EVENTS.LEAD_NOTE_ADDED, { targetType: 'lead', targetId: lead.id, summary: `Added a note to lead ${activity.leadName(lead)}` });
    res.status(201).json({ note: noteOut(req, saved, new Map()) });
  } catch (err) {
    console.error('Add lead note error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// DELETE /api/leads/:id/notes/:noteId
app.delete('/api/leads/:id/notes/:noteId', auth, async (req, res) => {
  try {
    const lead = await visibleLead(req, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const noteId = Number(req.params.noteId);
    if (!Number.isInteger(noteId) || noteId <= 0) return res.status(404).json({ error: 'Note not found' });
    const note = await LeadNotes.findOne({ id: noteId, lead_id: lead.id }, { _id: 0, id: 1, user_id: 1 }).lean();
    if (!note) return res.status(404).json({ error: 'Note not found' });
    const own = note.user_id != null && note.user_id === req.user?.id;
    if (!own && !can(req.identity, 'leads.notes.delete_any')) return res.status(403).json({ error: 'You can delete only your own notes.' });
    await LeadNotes.deleteOne({ id: note.id, lead_id: lead.id });
    await activity.log(req, activity.EVENTS.LEAD_NOTE_DELETED, { targetType: 'lead', targetId: lead.id, summary: `Deleted a note from lead ${activity.leadName(lead)}` });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete lead note error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/leads/:id/activity — who did what to this lead, newest first: the
// workspace activity log limited to this lead and the bulk changes that
// included it. Anyone who can see the lead may read it.
app.get('/api/leads/:id/activity', auth, async (req, res) => {
  try {
    const lead = await visibleLead(req, req.params.id);
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    const tenantId = currentTenantId() ?? req.user?.tenant_id ?? null;
    if (tenantId == null) return res.json({ events: [] });
    res.json({ events: await activity.forLead(tenantId, lead.id, { limit: req.query.limit }) });
  } catch (err) {
    console.error('Lead activity error:', err);
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
