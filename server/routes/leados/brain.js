/**
 * LeadOS routes: AI Brain profile, knowledge documents, sandbox and on/off.
 * Shared helpers still live in server.js and arrive through `ctx`. The tenant
 * always comes from the login, and the tenant scope limits every query to it.
 */
const crypto = require('crypto');
const multer = require('multer');
const { AiReplyLogs, BrainProfiles, Clients, Tenants } = require('../../models');
const { requirePermission, requireSection } = require('../../services/permissions');
const { runAsSystem } = require('../../services/tenantContext');
const prompts = require('../../services/brainPrompt');
const brainEngine = require('../../services/brainEngine');
const brandRouter = require('../../services/brandRouter');
const activity = require('../../services/activity');

const KIND_NAMES = { faq: 'FAQ', product: 'product', policy: 'policy', brochure: 'brochure', other: 'document' };
const docLabel = (doc) => `${KIND_NAMES[String(doc?.doc_type || '').split(':')[0]] || 'document'}${doc?.title ? ` "${String(doc.title).slice(0, 80)}"` : ''}`;
// Top-level profile fields that differ (names only, never their text).
const changedProfileFields = (before, after) => [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
  .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null));

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

// Brand brains: an optional client_id names the brand (services/brandRouter.js).
// Absent = the workspace's brain, exactly as before brand brains existed.
async function brandParam(value) {
  if (value === undefined || value === null || value === '') return { clientId: null };
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) return { error: 'client_id must be a brand of this workspace', status: 400 };
  const { brands, client } = await brandRouter.loadBrands();
  if (id === client?.id || brands.some((b) => b.client_id === id)) return { clientId: id };
  return { error: 'Brand not found', status: 404 };
}

// The brain of a brand, or the workspace's brain (its own client's, else the first).
async function loadBrain(clientId = null) {
  const { brands, client } = await brandRouter.loadBrands();
  if (clientId != null) return brands.find((b) => b.client_id === clientId)?.brain || null;
  return brands.find((b) => b.client_id === (client?.id ?? null))?.brain || brands[0]?.brain || null;
}

const NOT_READY = 'This workspace cannot hold a brain per brand yet (run migration 045)';
const brandLabel = (brain) => brain?.profile?.business_name || brain?.brand_name || 'this brand';

async function brainResponse(req, brain = undefined, clientId = null) {
  const [saved, client, tenant] = await Promise.all([
    brain === undefined ? loadBrain(clientId) : brain,
    workspaceClient(),
    loadTenant(req.identity.tenantId),
  ]);
  const ownClient = clientId == null || clientId === client?.id;
  const profile = saved?.profile || { business_name: (ownClient ? client?.name : saved?.brand_name) || tenant?.name || '', timezone: tenant?.timezone || 'Asia/Kolkata' };
  return {
    client_id: saved?.client_id ?? clientId ?? null,
    brand_name: saved?.brand_name || null,
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
app.get('/api/brain', auth, requireSection('ai_brain'), async (req, res) => {
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

app.post('/api/brain', auth, requireSection('ai_brain'), manageBrain, async (req, res) => {
  try {
    const { client_id, doc_type, content } = req.body;
    const doc = await upsertOne(
      BrainDocs,
      { client_id, doc_type },
      { $set: { content, updated_at: new Date() } },
      { client_id, doc_type, content, updated_at: new Date() }
    );
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, { targetType: 'brain_doc', targetId: doc?.id, summary: `Changed AI Brain document "${String(doc_type || '').slice(0, 60)}"` });
    res.json({ doc });
  } catch (err) {
    console.error('Brain Doc Save Error:', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Brain profile ─────────────────────────────────────────
app.get('/api/brain/profile', auth, requireSection('ai_brain'), workspaceOnly, async (req, res) => {
  try {
    const target = await brandParam(req.query.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    res.json(await brainResponse(req, undefined, target.clientId));
  } catch (err) {
    console.error('[brain/profile]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// A save may be incomplete (a draft), except while the AI is on.
app.put('/api/brain/profile', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
  try {
    const target = await brandParam(req.body?.client_id ?? req.query.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const profile = prompts.cleanProfile(req.body?.profile);
    const current = await loadBrain(target.clientId);
    const missing = prompts.missingRequired(profile);
    if (current?.ai_enabled && missing.length) {
      return res.status(400).json({ error: `Turn the AI off before clearing required fields: ${missing.join(', ')}`, missing });
    }
    const set = { profile, updated_by: req.user.id, updated_at: new Date() };
    let brain;
    try {
      brain = current
        ? await BrainProfiles.findOneAndUpdate({ id: current.id }, { $set: set, $inc: { brain_version: 1 } }, { new: true, projection: { _id: 0 } }).lean()
        : (await BrainProfiles.create({ ...set, ...(target.clientId != null && { client_id: target.clientId }), version_type: 'client', brain_version: 1 })).toObject();
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: NOT_READY, code: 'BRAND_BRAINS_NOT_READY' });
      throw err;
    }
    const fields = changedProfileFields(current?.profile, profile);
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, {
      targetType: 'brain_profile', targetId: brain?.id,
      summary: fields.length ? `Changed the AI Brain profile: ${fields.slice(0, 8).join(', ')}${fields.length > 8 ? ` and ${fields.length - 8} more` : ''}` : 'Saved the AI Brain profile (no changes)',
      meta: { fields, ...(target.clientId != null && { client_id: target.clientId }) },
    });
    res.json(await brainResponse(req, brain, target.clientId));
  } catch (err) {
    console.error('[brain/profile]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Knowledge items ───────────────────────────────────────
const itemFilter = (req) => ({ id: Number(req.params.id), doc_type: /^(faq|product|policy|brochure|other):/ });

async function createDoc({ kind, title, content, clientId = null }) {
  const brandId = clientId ?? (await workspaceClient())?.id;
  if (brandId == null) return null;
  return BrainDocs.create({
    client_id: brandId,
    doc_type: `${kind}:${crypto.randomUUID()}`,
    title: String(title || '').trim().slice(0, 200),
    content: String(content || '').trim().slice(0, MAX_DOC_CHARS),
    is_active: true,
    updated_at: new Date(),
  });
}

app.post('/api/brain/docs', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
  try {
    const { kind, title, content } = req.body || {};
    if (!DOC_KINDS.includes(kind)) return res.status(400).json({ error: 'Choose a valid document type' });
    if (!String(content || '').trim()) return res.status(400).json({ error: 'Content is required' });
    const target = await brandParam(req.body?.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const doc = await createDoc({ kind, title, content, clientId: target.clientId });
    if (!doc) return res.status(409).json({ error: 'This workspace has no brand profile yet' });
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, { targetType: 'brain_doc', targetId: doc.id, summary: `Added ${docLabel(doc)} to the AI Brain` });
    res.json({ doc: doc.toObject() });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/brain/docs/upload', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, docUpload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Choose a PDF or text file' });
    const allowed = req.file.mimetype === 'application/pdf' || req.file.mimetype.startsWith('text/');
    if (!allowed) return res.status(400).json({ error: 'Only PDF and text files can be added' });
    const kind = DOC_KINDS.includes(req.body?.kind) ? req.body.kind : 'other';
    const content = (await fileText(req.file)).replace(/\n{3,}/g, '\n\n').trim();
    if (content.length < 20) return res.status(400).json({ error: 'No readable text found. A scanned PDF cannot be read.' });
    const target = await brandParam(req.body?.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const doc = await createDoc({ kind, title: req.body?.title || req.file.originalname, content, clientId: target.clientId });
    if (!doc) return res.status(409).json({ error: 'This workspace has no brand profile yet' });
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, { targetType: 'brain_doc', targetId: doc.id, summary: `Uploaded ${docLabel(doc)} to the AI Brain` });
    res.json({ doc: doc.toObject(), truncated: content.length > MAX_DOC_CHARS });
  } catch (err) {
    console.error('[brain/docs/upload]', err.message);
    res.status(400).json({ error: 'Could not read this file' });
  }
});

app.patch('/api/brain/docs/:id', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
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
    const docFields = Object.keys(set).filter((f) => f !== 'updated_at');
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, {
      targetType: 'brain_doc', targetId: doc.id,
      summary: set.is_active !== undefined && docFields.length === 1 ? `${set.is_active ? 'Turned on' : 'Turned off'} AI Brain ${docLabel(doc)}` : `Edited AI Brain ${docLabel(doc)}: ${docFields.join(', ')}`,
      meta: { fields: docFields },
    });
    res.json({ doc });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/brain/docs/:id', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
  try {
    const doomedDoc = await BrainDocs.findOne(itemFilter(req), { _id: 0, id: 1, doc_type: 1, title: 1 }).lean();
    const result = await BrainDocs.deleteOne(itemFilter(req));
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found' });
    await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, { targetType: 'brain_doc', targetId: req.params.id, summary: `Removed ${docLabel(doomedDoc)} from the AI Brain` });
    res.json({ success: true });
  } catch (err) {
    console.error('[brain/docs]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── AI reply cost: tokens and estimated USD per reply, this workspace only ─
// GET /api/brain/usage?from=YYYY-MM-DD&to=YYYY-MM-DD  (default: this month)
app.get('/api/brain/usage', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
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
app.post('/api/brain/test', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim().slice(0, 1000);
    if (!message) return res.status(400).json({ error: 'Type a test message' });
    const target = await brandParam(req.body?.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    // mode: brand (the named brand answers), auto (the router picks, as in a
    // live chat) or router (only which brand and why; no AI call).
    const mode = ['brand', 'auto', 'router'].includes(req.body?.mode) ? req.body.mode : (target.clientId != null ? 'brand' : 'auto');
    const history = Array.isArray(req.body?.history) ? req.body.history : [];
    const result = await brainEngine.testReply({
      clientId: mode === 'brand' ? target.clientId : null,
      mode,
      profile: req.body?.profile || null,
      profileClientId: target.clientId,
      message,
      history,
    });
    if (result.error) return res.status(result.status || 400).json(result.missing ? { error: result.error, missing: result.missing } : { error: result.error });
    res.json(result);
  } catch (err) {
    console.error('[brain/test]', err.message);
    res.status(502).json({ error: 'The AI could not answer. Please try again.' });
  }
});

// ── Turn the AI Brain on or off ───────────────────────────
// Off also stops every AI reply, including the older flow.
app.post('/api/brain/ai-toggle', auth, requireSection('ai_brain'), workspaceOnly, adminOnly, async (req, res) => {
  try {
    const enabled = req.body?.enabled === true;
    const target = await brandParam(req.body?.client_id);
    if (target.error) return res.status(target.status).json({ error: target.error });
    const current = await loadBrain(target.clientId);
    const tenantId = req.identity.tenantId;
    if (enabled) {
      const missing = current?.version_type === 'nera' ? [] : prompts.missingRequired(current?.profile);
      if (!current || missing.length) return res.status(400).json({ error: `Fill these first: ${(missing.length ? missing : Object.values(prompts.REQUIRED_FIELDS)).join(', ')}`, missing });
      if (!process.env.N8N_BRAIN_WEBHOOK_URL) return res.status(409).json({ error: 'AI Brain replies are not set up on the server yet', code: 'AI_BRAIN_NOT_CONFIGURED' });
    }
    if (current) await BrainProfiles.updateOne({ id: current.id }, { $set: { ai_enabled: enabled, updated_by: req.user.id, updated_at: new Date() } });
    // The workspace switch (also read by the older flow) stays on while any brand's AI is on.
    const anyOn = enabled || Boolean(await BrainProfiles.exists({ ai_enabled: true }));
    await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: { ai_enabled: anyOn, updated_at: new Date() } }), 'ai-brain');
    const scope = target.clientId != null ? `for ${brandLabel(current)}` : 'for the workspace';
    await activity.log(req, enabled ? activity.EVENTS.AI_TURNED_ON : activity.EVENTS.AI_TURNED_OFF, {
      targetType: 'brain_profile', targetId: current?.id,
      summary: enabled ? `Turned AI replies on ${scope}` : `Turned AI replies off ${scope}`,
      meta: { before: { ai_enabled: Boolean(current?.ai_enabled) }, after: { ai_enabled: enabled }, ...(target.clientId != null && { client_id: target.clientId }) },
    });
    res.json(await brainResponse(req, undefined, target.clientId));
  } catch (err) {
    console.error('[brain/ai-toggle]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// ── Brand brains (several brands on one WhatsApp number) ──
// GET /api/brain/brands: the workspace's brands, each with its own brain.
app.get('/api/brain/brands', auth, requireSection('ai_brain'), workspaceOnly, async (req, res) => {
  try {
    const { brands, client } = await brandRouter.loadBrands();
    const list = brands.map((b) => {
      const missing = b.brain.version_type === 'nera' ? [] : prompts.missingRequired(b.brain.profile);
      return {
        client_id: b.client_id,
        name: b.name,
        ai_enabled: Boolean(b.brain.ai_enabled),
        filled: !missing.length,
        missing,
        workspace_client: b.client_id === (client?.id ?? null),
        route_keywords: b.brain.profile?.route_keywords || [],
        route_ad_keywords: b.brain.profile?.route_ad_keywords || [],
      };
    });
    if (!list.length && client) {
      list.push({ client_id: client.id, name: client.name || '', ai_enabled: false, filled: false, missing: Object.values(prompts.REQUIRED_FIELDS), workspace_client: true, route_keywords: [], route_ad_keywords: [] });
    }
    res.json({ brands: list, multi: list.length > 1, max: brandRouter.MAX_BRANDS });
  } catch (err) {
    console.error('[brain/brands]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/brain/brands { name }: another brand on this number gets its own
// brain (AI off, empty profile). The workspace's current brain becomes the
// brain of the workspace's own brand first.
app.post('/api/brain/brands', auth, requireSection('ai_brain'), workspaceOnly, manageBrain, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (name.length < 2) return res.status(400).json({ error: 'Type the brand name' });
    const { brains, brands, client } = await brandRouter.loadBrands();
    if (!client) return res.status(409).json({ error: 'This workspace has no brand profile yet' });
    if (brands.length >= brandRouter.MAX_BRANDS) return res.status(400).json({ error: `Up to ${brandRouter.MAX_BRANDS} brands per workspace` });
    if (brands.some((b) => b.name.toLowerCase() === name.toLowerCase())) return res.status(409).json({ error: 'A brand with this name already exists' });
    const tenant = await loadTenant(req.identity.tenantId);
    try {
      const own = brains.find((b) => b.client_id === client.id);
      const legacy = brains.find((b) => b.client_id == null);
      if (!own && legacy) await BrainProfiles.updateOne({ id: legacy.id }, { $set: { client_id: client.id, updated_at: new Date() } });
      else if (!own) {
        await BrainProfiles.create({ client_id: client.id, profile: { business_name: client.name || '', timezone: tenant?.timezone || 'Asia/Kolkata' }, ai_enabled: false, version_type: 'client', brain_version: 1, updated_by: req.user.id });
      }
      // An id from the clients counter: never the id of a real client, so the
      // documents keyed by it can only ever be this brand's.
      const brandId = await Clients.nextId();
      const brain = (await BrainProfiles.create({
        client_id: brandId,
        brand_name: name,
        profile: { business_name: name, timezone: tenant?.timezone || 'Asia/Kolkata' },
        ai_enabled: false, version_type: 'client', brain_version: 1, updated_by: req.user.id,
      })).toObject();
      await activity.log(req, activity.EVENTS.AI_BRAIN_UPDATED, { targetType: 'brain_profile', targetId: brain.id, summary: `Added the brand "${name}" to the AI Brain`, meta: { client_id: brandId } });
      res.json({ client_id: brandId, name });
    } catch (err) {
      if (err.code === 11000) return res.status(409).json({ error: NOT_READY, code: 'BRAND_BRAINS_NOT_READY' });
      throw err;
    }
  } catch (err) {
    console.error('[brain/brands]', err.message);
    res.status(500).json({ error: 'Server error' });
  }
});
};
