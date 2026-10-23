// UNTESTED. Add to server/routes/leados/internal.js (same file as save-conversation, send-reply, etc).
// Model and field names are taken from the repo; the dev must check each one against the real schema.
// Uses the router, internalAuth, internalPlatformAuth and tenantCanSend already imported in that file.

// 1. Everything WF1/WF3/WF5 need in one call
router.get('/context', internalAuth, async (req, res) => {
  try {
    const lead = await Leads.findOne({ id: Number(req.query.lead_id) }).lean();
    if (!lead) return res.status(404).json({ error: 'lead not found' });   // tenant scope makes other tenants' leads 404
    const limit = Math.min(Number(req.query.limit) || 10, 30);
    const [brain, messages] = await Promise.all([
      BrainDocs.find({ client_id: lead.client_id }).lean(),
      Conversations.find({ lead_id: lead.id }).sort({ id: -1 }).limit(limit).lean(),
    ]);
    res.json({
      business_name: req.tenant?.name,
      language: req.tenant?.ai_language || null,
      tone: req.tenant?.ai_tone || null,
      rules: req.tenant?.ai_rules || null,
      scoring_rules: req.tenant?.scoring_rules || null,
      supervised: !!req.tenant?.ai_supervised,
      brain: brain.map(b => ({ doc_type: b.doc_type, content: b.content })),
      lead: { id: lead.id, name: lead.name, status: lead.status, score: lead.score, interest: lead.interest },
      messages: messages.reverse().map(m => ({ direction: m.direction, content: m.message, at: m.created_at })),
    });
  } catch (e) { res.status(500).json({ error: 'context failed' }); }
});

// 2. Handover: AI could not or should not answer. Always lands in the human inbox.
router.post('/handover', internalAuth, async (req, res) => {
  try {
    const { lead_id, reason, draft, mode } = req.body || {};
    const lead = await Leads.findOne({ id: Number(lead_id) });
    if (!lead) return res.status(404).json({ error: 'lead not found' });
    if (mode !== 'notify') lead.ai_paused = true;              // AI stays quiet until a person resumes it
    lead.needs_human = true;
    lead.handover_reason = String(reason || '').slice(0, 300);
    lead.ai_draft = String(draft || '').slice(0, 2000);        // person can approve the draft with one tap
    await lead.save();
    // assignment (round robin / owner) and notification: reuse the existing assign + notify helpers here
    io.emit('lead:handover', { lead_id: lead.id, reason: lead.handover_reason });   // io is already tenant-routed
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'handover failed' }); }
});

// 3. Follow-ups due (platform key, no tenant header). Server applies plan gate, quota, opt-out, quiet hours.
router.get('/followups/due', internalPlatformAuth, async (req, res) => {
  try {
    const now = new Date();
    const leads = await runAsSystem(() => Leads.find({
      next_followup_due: { $lte: now }, opted_out: { $ne: true }, sales_followup_stopped: { $ne: true },
    }).limit(100).lean());
    const items = [];
    for (const l of leads) {
      if (!(await tenantCanSend(l.tenant_id))) continue;
      if (!(await planAllowsFollowup(l.tenant_id))) continue;           // WRITE: Pro and above only
      const lastInbound = l.last_inbound_at ? new Date(l.last_inbound_at) : null;
      items.push({
        tenant_id: l.tenant_id, lead_id: l.id, name: l.name,
        step: (l.followup_step || 0) + 1,                                  // steps 1,2,3 = day 2, 5, 10
        in_window: !!lastInbound && (now - lastInbound) < 24 * 3600 * 1000,
        template: 'follow_up', language: l.language || 'en',
      });
    }
    res.json({ items });
  } catch (e) { res.status(500).json({ error: 'due failed' }); }
});

router.post('/followups/mark', internalAuth, async (req, res) => {
  const { lead_id, step } = req.body || {};
  const lead = await Leads.findOne({ id: Number(lead_id) });
  if (!lead) return res.status(404).json({ error: 'lead not found' });
  lead.followup_step = Number(step);
  const days = { 1: 3, 2: 5 }[Number(step)];                              // gap to the next step; none after step 3
  lead.next_followup_due = days ? new Date(Date.now() + days * 86400000) : null;
  await lead.save();
  res.json({ ok: true });
});

// Also required on the existing server, before it calls n8n (webhook-whatsapp.js ~line 360-410):
//  - check tenantCanSend, plan state, monthly AI quota, hourly cap, ai_paused; if any fails, skip n8n and handover
//  - replace the hardcoded 60 s debounce with a per-tenant setting
//  - send { tenant_id, lead_id, message_id, message } to /webhook/nera-ai-reply
//  - on a new lead, post { tenant_id, lead_id, name, delay_seconds } to /webhook/nera-new-lead
//  - after each AI reply, post { tenant_id, lead_id } to /webhook/nera-lead-capture
//  - count the AI reply only after send-reply succeeds
