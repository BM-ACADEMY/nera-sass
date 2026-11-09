/**
 * LeadOS routes: AI Brain profile, knowledge documents, sandbox and on/off.
 * Shared helpers still live in server.js and arrive through `ctx`. The tenant
 * always comes from the login, and the tenant scope limits every query to it.
 */
const crypto = require('crypto');
const multer = require('multer');
const { AiReplyLogs, BrainProfiles, Clients, Tenants } = require('../../models');
const { requirePermission } = require('../../services/permissions');
const { runAsSystem } = require('../../services/tenantContext');
const prompts = require('../../services/brainPrompt');
const brainEngine = require('../../services/brainEngine');

const DOC_KINDS = ['faq', 'product', 'policy', 'brochure', 'other'];
const MAX_DOC_CHARS = 10000;
const docUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

async function fileText(file) {
  if (file.mimetype !== 'application/pdf') return file.buffer.toString('utf8');
  // Loaded on use: its native canvas binding must not stop the server from starting.
  const pdf = require('pdf-parse');
  if (typeof pdf === 'function') return (await pdf(file.buffer)).text;
  const parser = new pdf.PDFParse({ data: file.buffer });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

module.exports = function registerBrainRoutes(app, ctx) {
const {
  BrainDocs,
  NO_ID,
  auth,
  upsertOne,
} = ctx;
const manageBrain = requirePermission('ai_brain.manage');
const adminOnly = requirePermission('tenant.settings');
const NO_DOC_ID = { _id: 0 };
// A brain belongs to one workspace; platform staff have no tenant to resolve here.
const workspaceOnly = (req, res, next) => (req.identity?.kind === 'tenant' ? next() : res.status(403).json({ error: 'This is for a workspace login' }));

const loadTenant = (id) => runAsSystem(() => Tenants.findOne({ id }, { _id: 0 }).lean(), 'ai-brain');
const workspaceClient = () => Clients.findOne({}, { _id: 0, id: 1, name: 1 }).sort({ id: 1 }).lean();
const loadBrain = () => BrainProfiles.findOne({}, { _id: 0 }).lean();

async function brainResponse(req, brain = undefined) {
  const [saved, client, tenant] = await Promise.all([
    brain === undefined ? loadBrain() : brain,
    workspaceClient(),
    loadTenant(req.identity.tenantId),
  ]);
  const profile = saved?.profile || { business_name: client?.name || tenant?.name || '', timezone: tenant?.timezone || 'Asia/Kolkata' };
  return {
    profile,
    version_type: saved?.version_type || 'client',
    brain_version: saved?.brain_version || 0,
    ai_enabled: Boolean(saved?.ai_enabled),
    missing: prompts.missingRequired(profile),
    updated_at: saved?.updated_at || null,
    // ABM's own server keeps its multi-brand editor; DISABLED_MODULES is empty there.
    legacy_editor: !String(process.env.DISABLED_MODULES || '').trim(),
  };
}

// ══════════════════════════════════════════════════════════
// AI BRAIN (brain_docs table)
// ══════════════════════════════════════════════════════════
app.get('/api/brain', auth, async (req, res) => {
  try {
    const { client_id } = req.query;
    const rows = client_id
      ? await BrainDocs.find({ client_id }, NO_ID).sort({ doc_type: 1 }).lean()
      : await BrainDocs.find({}, NO_ID).sort({ client_id: 1, doc_type: 1 }).lean();
    res.json({ docs: rows });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain', auth, manageBrain, async (req, res) => {
  try {
    const { client_id, doc_type, content } = req.body;
    const doc = await upsertOne(
      BrainDocs,
      { client_id, doc_type },
      { $set: { content, updated_at: new Date() } },
      { client_id, doc_type, content, updated_at: new Date() }
    );
    res.json({ doc });
  } catch (err) {
    console.error('Brain Doc Save Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Brain profile ─────────────────────────────────────────
app.get('/api/brain/profile', auth, workspaceOnly, async (req, res) => {
  try {
    res.json(await brainResponse(req));
  } catch (err) {
    console.error('[brain/profile]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// A save may be incomplete (a draft), except while the AI is on.
app.put('/api/brain/profile', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const profile = prompts.cleanProfile(req.body?.profile);
    const current = await loadBrain();
    const missing = prompts.missingRequired(profile);
    if (current?.ai_enabled && missing.length) {
      return res.status(400).json({ error: `Turn the AI off before clearing required fields: ${missing.join(', ')}`, missing });
    }
    const set = { profile, updated_by: req.user.id, updated_at: new Date() };
    const brain = current
      ? await BrainProfiles.findOneAndUpdate({}, { $set: set, $inc: { brain_version: 1 } }, { new: true, projection: { _id: 0 } }).lean()
      : (await BrainProfiles.create({ ...set, version_type: 'client', brain_version: 1 })).toObject();
    res.json(await brainResponse(req, brain));
  } catch (err) {
    console.error('[brain/profile]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Knowledge items ───────────────────────────────────────
const itemFilter = (req) => ({ id: Number(req.params.id), doc_type: /^(faq|product|policy|brochure|other):/ });

async function createDoc({ kind, title, content }) {
  const client = await workspaceClient();
  if (!client) return null;
  return BrainDocs.create({
    client_id: client.id,
    doc_type: `${kind}:${crypto.randomUUID()}`,
    title: String(title || '').trim().slice(0, 200),
    content: String(content || '').trim().slice(0, MAX_DOC_CHARS),
    is_active: true,
    updated_at: new Date(),
  });
}

app.post('/api/brain/docs', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const { kind, title, content } = req.body || {};
    if (!DOC_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose a valid document type' });
    if (!String(content || '').trim()) return res.status(400).json({ error: 'Content is required' });
    const doc = await createDoc({ kind, title, content });
    if (!doc) return res.status(409).json({ error: 'This workspace has no brand profile yet' });
    res.json({ doc: doc.toObject() });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain/docs/upload', auth, workspaceOnly, manageBrain, docUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF or text file' });
    const allowed = req.file.mimetype === 'application/pdf' || req.file.mimetype.startsWith('text/');
    if (!allowed) return res.status(400).json({ error: 'Only PDF and text files can be added' });
    const kind = DOC_KINDS.includes(req.body?.kind) ? req.body.kind : 'other';
    const content = (await fileText(req.file)).replace(/\n{3,}/g, '\n\n').trim();
    if (content.length < 20) return res.status(400).json({ error: 'No readable text found. A scanned PDF cannot be read.' });
    const doc = await createDoc({ kind, title: req.body?.title || req.file.originalname, content });
    if (!doc) return res.status(409).json({ error: 'This workspace has no brand profile yet' });
    res.json({ doc: doc.toObject(), truncated: content.length > MAX_DOC_CHARS });
  } catch (err) {
    console.error('[brain/docs/upload]', err.message);
    res.status(400).json({ error: 'Could not read this file' });
  }
});

app.patch('/api/brain/docs/:id', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const set = { updated_at: new Date() };
    if (req.body?.title !== undefined) set.title = String(req.body.title).trim().slice(0, 200);
    if (req.body?.content !== undefined) {
      set.content = String(req.body.content).trim().slice(0, MAX_DOC_CHARS);
      if (!set.content) return res.status(400).json({ error: 'Content is required' });
    }
    if (req.body?.is_active !== undefined) set.is_active = Boolean(req.body.is_active);
    const doc = await BrainDocs.findOneAndUpdate(itemFilter(req), { $set: set }, { new: true, projection: NO_DOC_ID }).lean();
    if (!doc) return res.status(404).json({ error: 'Document not found' });
    res.json({ doc });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/brain/docs/:id', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const result = await BrainDocs.deleteOne(itemFilter(req));
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── AI reply cost: tokens and estimated USD per reply, this workspace only ─
// GET /api/brain/usage?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: this month)
app.get('/api/brain/usage', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const now = new Date();
    const from = req.query.from ? new Date(`${req.query.from}T00:00:00Z`) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = req.query.to ? new Date(`${req.query.to}T23:59:59.999Z`) : now;
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return res.status(400).json({ error: 'from and to must be dates (YYYY-MM-DD)' });
    // The tenant-scope plugin adds the workspace filter to this aggregate.
    const rows = await AiReplyLogs.aggregate([
      { $match: { created_at: { $gte: from, $lte: to }, status: { $in: ['sent', 'failed', 'no_send'] } } },
      { $group: {
        _id: { language: '$language', status: '$status' },
        replies: { $sum: 1 },
        prompt_tokens: { $sum: { $ifNull: ['$prompt_tokens', 0] } },
        completion_tokens: { $sum: { $ifNull: ['$completion_tokens', 0] } },
        cost_usd: { $sum: { $ifNull: ['$cost_usd', 0] } },
        unknown_cost: { $sum: { $cond: [{ $eq: ['$cost_usd', null] }, 1, 0] } },
      } },
    ]);
    const total = { replies: 0, sent_replies: 0, prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, replies_without_cost: 0 };
    const byLanguage = {};
    for (const row of rows) {
      const lang = row._id.language || 'unknown';
      const bucket = byLanguage[lang] || (byLanguage[lang] = { replies: 0, cost_usd: 0 });
      bucket.replies += row.replies;
      bucket.cost_usd += row.cost_usd;
      total.replies += row.replies;
      if (row._id.status === 'sent') total.sent_replies += row.replies;
      total.prompt_tokens += row.prompt_tokens;
      total.completion_tokens += row.completion_tokens;
      total.cost_usd += row.cost_usd;
      total.replies_without_cost += row.unknown_cost;
    }
    // Every model call is counted (a failed or unsent draft was still billed);
    // the average is per reply actually sent.
    const round = (n) => Number(n.toFixed(6));
    res.json({
      from, to,
      ...total,
      cost_usd: round(total.cost_usd),
      cost_per_sent_reply_usd: total.sent_replies ? round(total.cost_usd / total.sent_replies) : null,
      by_language: Object.fromEntries(Object.entries(byLanguage).map(([k, v]) => [k, { replies: v.replies, cost_usd: round(v.cost_usd) }])),
      note: 'Estimated from the provider token counts and the AI_PRICE_* environment prices.',
    });
  } catch (err) {
    console.error('[brain/usage]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Sandbox: never sends to WhatsApp and stores nothing ───
app.post('/api/brain/test', auth, workspaceOnly, manageBrain, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'Type a test message' });
    const saved = await loadBrain();
    const profile = prompts.cleanProfile(req.body?.profile || saved?.profile);
    const missing = prompts.missingRequired(profile);
    if (saved?.version_type !== 'nera' && missing.length) return res.status(400).json({ error: `Fill these first: ${missing.join(', ')}`, missing });
    const client = await workspaceClient();
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    res.json(await brainEngine.sandbox({ brain: { ...saved, profile, version_type: saved?.version_type || 'client' }, clientId: client?.id, message, history }));
  } catch (err) {
    console.error('[brain/test]', err.message);
    res.status(502).json({ error: 'The AI could not answer. Please try again.' });
  }
});

// ── Turn the AI Brain on or off ───────────────────────────
// Off also stops every AI reply, including the older flow.
app.post('/api/brain/ai-toggle', auth, workspaceOnly, adminOnly, async (req, res) => {
  try {
    const enabled = req.body?.enabled === true;
    const current = await loadBrain();
    const tenantId = req.identity.tenantId;
    if (enabled) {
      const missing = current?.version_type === 'nera' ? [] : prompts.missingRequired(current?.profile);
      if (!current || missing.length) return res.status(400).json({ error: `Fill these first: ${(missing.length ? missing : Object.values(prompts.REQUIRED_FIELDS)).join(', ')}`, missing });
      if (!process.env.N8N_BRAIN_WEBHOOK_URL) return res.status(409).json({ error: 'AI Brain replies are not set up on the server yet', code: 'AI_BRAIN_NOT_CONFIGURED' });
    }
    if (current) await BrainProfiles.updateOne({}, { $set: { ai_enabled: enabled, updated_by: req.user.id, updated_at: new Date() } });
    await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: { ai_enabled: enabled, updated_at: new Date() } }), 'ai-brain');
    res.json(await brainResponse(req));
  } catch (err) {
    console.error('[brain/ai-toggle]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
