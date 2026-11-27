/**
 * LeadOS routes: lead labels (services/leadLabels.js).
 *
 *   GET    /api/labels                          every member: labels with lead counts
 *   POST   /api/labels                          owner/admin: { name, color }
 *   PATCH  /api/labels/:id                      owner/admin: { name?, color? }
 *   DELETE /api/labels/:id                      owner/admin: also takes it off every lead
 *   GET    /api/leads/:id/labels                every member
 *   PUT    /api/leads/:id/labels                every member: { label_ids: [...] } (exact set)
 *   POST   /api/leads/:id/labels/:labelId       every member
 *   DELETE /api/leads/:id/labels/:labelId       every member
 *   POST   /api/leads/:id/tags  { tagId }       older inbox calls, same as POST .../labels/:labelId
 *   DELETE /api/leads/:id/tags/:tagId           older inbox calls, same as DELETE .../labels/:labelId
 *
 * Everything runs in the caller's tenant: another workspace's label or lead
 * is "not found" (404).
 */
const { requirePermission } = require('../../services/permissions');
const leadLabels = require('../../services/leadLabels');
const activity = require('../../services/activity');

module.exports = function registerLabelsRoutes(app, ctx) {
const { auth } = ctx;
const manage = requirePermission('labels.manage');

const fail = (res, err, fallback) => {
  if (err instanceof leadLabels.LabelError) return res.status(err.status).json({ error: err.message, code: err.code });
  console.error(`${fallback}:`, err.message);
  return res.status(500).json({ error: `${fallback}. Please try again.` });
};

const logAdded = (req, lead, label) => activity.log(req, activity.EVENTS.LEAD_LABEL_ADDED, {
  targetType: 'lead', targetId: lead.id,
  summary: `Added label "${label.name}" to lead ${activity.leadName(lead)}`,
  meta: { label_id: label.id, label_name: label.name },
});
const logRemoved = (req, lead, label) => activity.log(req, activity.EVENTS.LEAD_LABEL_REMOVED, {
  targetType: 'lead', targetId: lead.id,
  summary: `Removed label "${label.name}" from lead ${activity.leadName(lead)}`,
  meta: { label_id: label.id, label_name: label.name },
});

app.get('/api/labels', auth, async (req, res) => {
  try {
    res.json({ labels: await leadLabels.list(), colors: leadLabels.COLORS });
  } catch (err) {
    fail(res, err, 'Could not load your labels');
  }
});

app.post('/api/labels', auth, manage, async (req, res) => {
  try {
    const label = await leadLabels.create({ name: req.body?.name, color: req.body?.color, userId: req.user?.id ?? null });
    await activity.log(req, activity.EVENTS.LABEL_CREATED, {
      targetType: 'label', targetId: label.id, summary: `Created label "${label.name}"`, meta: { color: label.color },
    });
    res.status(201).json({ label: { ...label, lead_count: 0 } });
  } catch (err) {
    fail(res, err, 'Could not create the label');
  }
});

app.patch('/api/labels/:id', auth, manage, async (req, res) => {
  try {
    const result = await leadLabels.update(req.params.id, { name: req.body?.name, color: req.body?.color });
    if (!result) return res.status(404).json({ error: 'Label not found', code: 'NOT_FOUND' });
    const { before, after } = result;
    const changes = [];
    if (before.name !== after.name) changes.push(`renamed "${before.name}" to "${after.name}"`);
    if (before.color !== after.color) changes.push(`colour ${before.color} to ${after.color}`);
    if (changes.length) {
      await activity.log(req, activity.EVENTS.LABEL_UPDATED, {
        targetType: 'label', targetId: after.id, summary: `Changed label "${after.name}": ${changes.join(', ')}`,
        meta: { before, after },
      });
    }
    res.json({ label: after });
  } catch (err) {
    fail(res, err, 'Could not change the label');
  }
});

app.delete('/api/labels/:id', auth, manage, async (req, res) => {
  try {
    const result = await leadLabels.remove(req.params.id);
    if (!result) return res.status(404).json({ error: 'Label not found', code: 'NOT_FOUND' });
    await activity.log(req, activity.EVENTS.LABEL_DELETED, {
      targetType: 'label', targetId: result.label.id,
      summary: `Deleted label "${result.label.name}" (was on ${result.removed_links} lead${result.removed_links === 1 ? '' : 's'})`,
      meta: { removed_links: result.removed_links },
    });
    res.json({ success: true, removed_links: result.removed_links });
  } catch (err) {
    fail(res, err, 'Could not delete the label');
  }
});

app.get('/api/leads/:id/labels', auth, async (req, res) => {
  try {
    const { Leads } = require('../../models');
    const leadId = leadLabels.toId(req.params.id);
    if (!leadId || !(await Leads.exists({ id: leadId }))) return res.status(404).json({ error: 'Lead not found', code: 'NOT_FOUND' });
    res.json({ labels: (await leadLabels.labelsForLeads([leadId])).get(leadId) || [] });
  } catch (err) {
    fail(res, err, 'Could not load the lead\'s labels');
  }
});

app.put('/api/leads/:id/labels', auth, async (req, res) => {
  try {
    const result = await leadLabels.setForLead(req.params.id, req.body?.label_ids, req.user?.id ?? null);
    for (const label of result.added) await logAdded(req, result.lead, label);
    for (const label of result.removed) await logRemoved(req, result.lead, label);
    res.json({ labels: result.labels });
  } catch (err) {
    fail(res, err, 'Could not save the lead\'s labels');
  }
});

const addLabel = (param) => async (req, res) => {
  try {
    const result = await leadLabels.attach(req.params.id, param(req), req.user?.id ?? null);
    if (result.added) await logAdded(req, result.lead, result.label);
    res.json({ success: true, added: result.added, label: result.label });
  } catch (err) {
    fail(res, err, 'Could not add the label');
  }
};
const removeLabel = (param) => async (req, res) => {
  try {
    const result = await leadLabels.detach(req.params.id, param(req));
    if (result.removed) await logRemoved(req, result.lead, result.label);
    res.json({ success: true, removed: result.removed });
  } catch (err) {
    fail(res, err, 'Could not remove the label');
  }
};

app.post('/api/leads/:id/labels/:labelId', auth, addLabel((req) => req.params.labelId));
app.delete('/api/leads/:id/labels/:labelId', auth, removeLabel((req) => req.params.labelId));
// Older callers (inbox): "tags" are labels now.
app.post('/api/leads/:id/tags', auth, addLabel((req) => req.body?.tagId ?? req.body?.labelId));
app.delete('/api/leads/:id/tags/:tagId', auth, removeLabel((req) => req.params.tagId));
};
