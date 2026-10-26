/**
 * Admin inbox for the platform's own WhatsApp number (/api/admin/inbox/*).
 * Founder and ops staff only (platform.inbox). The Meta token never leaves
 * the server: the browser only ever sees conversations and messages.
 */
const { PlatformWaContacts, PlatformWaMessages, MetaWhatsappPhoneNumbers, Clients, Users, Tenants } = require('../models');
const { escapeRegex } = require('../db/mongo');
const inbox = require('../services/platformInbox');
const mediaStore = require('../services/mediaStore');
const multer = require('multer');

const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
// Labels stored for incoming files without a caption; the file itself is shown instead.
const MEDIA_PLACEHOLDER = /^\[(Photo|Video|Voice message|Sticker|Document)\]( .*)?$/;

const SEND_LIMIT = 30; // messages per staff member per minute
const sendLog = new Map();

function rateLimited(staffId) {
  const now = Date.now();
  const recent = (sendLog.get(staffId) || []).filter((t) => now - t < 60000);
  if (recent.length >= SEND_LIMIT) return true;
  recent.push(now);
  sendLog.set(staffId, recent);
  return false;
}

const presentContact = (c) => ({
  id: c.id,
  wa_id: c.wa_id,
  name: c.name || c.profile_name || null,
  profile_name: c.profile_name || null,
  note: c.note || '',
  status: c.status || 'open',
  unread_count: c.unread_count || 0,
  last_message_at: c.last_message_at || null,
  last_message_preview: c.last_message_preview || '',
  last_message_direction: c.last_message_direction || null,
  window_open: inbox.windowOpen(c),
  window_closes_at: c.last_inbound_at ? new Date(new Date(c.last_inbound_at).getTime() + inbox.WINDOW_MS) : null,
});

const presentMessage = (m) => ({
  id: m.id,
  direction: m.direction,
  type: m.type,
  text: MEDIA_TYPES.has(m.type) && MEDIA_PLACEHOLDER.test(m.text || '') ? '' : m.text || '',
  template_name: m.template_name || null,
  // Signed media-server link when a copy exists; otherwise the panel loads
  // the file through /inbox/messages/:id/media.
  media_url: m.media_ref && mediaStore.enabled() ? mediaStore.signedUrl(m.media_ref) : null,
  has_media: Boolean(m.media_ref || m.media_id),
  filename: m.filename || null,
  mime_type: m.mime_type || null,
  file_size: m.file_size || null,
  voice: Boolean(m.voice),
  status: m.status,
  error: m.error || null,
  sent_by_name: m.sent_by_name || null,
  created_at: m.created_at,
});

const staffOf = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });
const last10 = (value) => String(value || '').replace(/\D/g, '').slice(-10);

// Workspaces whose brand, owner or login uses this phone number.
async function workspacesForNumber(waId) {
  const tail = last10(waId);
  if (tail.length < 10) return [];
  const [brands, users] = await Promise.all([
    Clients.find({}, { _id: 0, tenant_id: 1, name: 1, whatsapp_number: 1, phone: 1 }).lean(),
    Users.find({ tenant_id: { $ne: null } }, { _id: 0, tenant_id: 1, name: 1, phone: 1 }).lean(),
  ]);
  const hits = new Map();
  for (const b of brands) {
    if ([b.whatsapp_number, b.phone].some((p) => last10(p) === tail)) hits.set(b.tenant_id, 'Brand number');
  }
  for (const u of users) {
    if (last10(u.phone) === tail && !hits.has(u.tenant_id)) hits.set(u.tenant_id, `Login: ${u.name || 'user'}`);
  }
  if (!hits.size) return [];
  const tenants = await Tenants.find({ id: { $in: [...hits.keys()] } }, { _id: 0, id: 1, name: 1, status: 1 }).lean();
  return tenants.map((t) => ({ tenant_id: t.id, name: t.name, status: t.status, matched_by: hits.get(t.id) }));
}

module.exports = function registerAdminInboxRoutes(router, { permit, fail }) {
  const can = permit('platform.inbox');

  router.get('/inbox/status', can, async (req, res) => {
    try {
      const phoneId = inbox.platformPhoneId();
      const [phone, unread] = await Promise.all([
        phoneId ? MetaWhatsappPhoneNumbers.findOne({ phone_number_id: phoneId }, { _id: 0, display_phone_number: 1, verified_name: 1, connection_status: 1, profile_picture_url: 1 }).lean() : null,
        PlatformWaContacts.aggregate([{ $match: { unread_count: { $gt: 0 } } }, { $group: { _id: null, conversations: { $sum: 1 }, messages: { $sum: '$unread_count' } } }]),
      ]);
      return res.json({
        configured: Boolean(phoneId && inbox.platformToken()),
        source: inbox.platformSource(),
        missing: [
          !phoneId && 'PLATFORM_WA_PHONE_NUMBER_ID',
          phoneId && !inbox.platformToken() && (inbox.platformSource() === 'inventory' ? 'META_INVENTORY_ACCESS_TOKEN' : 'PLATFORM_WA_ACCESS_TOKEN'),
        ].filter(Boolean),
        number: phone ? { ...phone } : (phoneId ? { display_phone_number: null } : null),
        unread_conversations: unread[0]?.conversations || 0,
        unread_messages: unread[0]?.messages || 0,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/conversations', can, async (req, res) => {
    try {
      const filter = {};
      if (req.query.filter === 'unread') filter.unread_count = { $gt: 0 };
      if (req.query.filter === 'open' || req.query.filter === 'closed') filter.status = req.query.filter;
      const q = String(req.query.search || '').trim();
      if (q) {
        const re = { $regex: escapeRegex(q), $options: 'i' };
        filter.$or = [{ name: re }, { profile_name: re }, { wa_id: { $regex: escapeRegex(q.replace(/\D/g, '') || q) } }, { last_message_preview: re }];
      }
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await PlatformWaContacts.find(filter, { _id: 0 }).sort({ last_message_at: -1, id: -1 }).limit(limit).lean();
      return res.json({ conversations: rows.map(presentContact) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/conversations/:id', can, async (req, res) => {
    try {
      const contact = await PlatformWaContacts.findOne({ id: Number(req.params.id) }, { _id: 0 }).lean();
      if (!contact) return res.status(404).json({ error: 'Conversation not found' });
      return res.json({ conversation: presentContact(contact), workspaces: await workspacesForNumber(contact.wa_id) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/conversations/:id/messages', can, async (req, res) => {
    try {
      const filter = { contact_id: Number(req.params.id) };
      if (req.query.before) filter.id = { $lt: Number(req.query.before) };
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const rows = await PlatformWaMessages.find(filter, { _id: 0 }).sort({ id: -1 }).limit(limit).lean();
      return res.json({ messages: rows.reverse().map(presentMessage), has_more: rows.length === limit });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/inbox/conversations/:id/read', can, async (req, res) => {
    try {
      await PlatformWaContacts.updateOne({ id: Number(req.params.id) }, { $set: { unread_count: 0 } });
      return res.json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.patch('/inbox/conversations/:id', can, async (req, res) => {
    try {
      const changes = {};
      if (req.body?.name !== undefined) changes.name = String(req.body.name || '').trim().slice(0, 80) || null;
      if (req.body?.note !== undefined) changes.note = String(req.body.note || '').slice(0, 2000);
      if (req.body?.status !== undefined) {
        if (!['open', 'closed'].includes(req.body.status)) return res.status(400).json({ error: 'Status must be open or closed' });
        changes.status = req.body.status;
      }
      if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
      const contact = await PlatformWaContacts.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { ...changes, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
      if (!contact) return res.status(404).json({ error: 'Conversation not found' });
      return res.json({ conversation: presentContact(contact) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/templates', can, async (req, res) => {
    try {
      return res.json({ templates: await inbox.listTemplates() });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Header image / video / document for a template, uploaded to Meta first.
  router.post('/inbox/template-media', can, fileUpload.single('file'), async (req, res) => {
    try {
      return res.status(201).json(await inbox.uploadHeaderMedia({
        buffer: req.file?.buffer, mimeType: req.file?.mimetype, filename: req.file?.originalname, format: req.body?.format,
      }));
    } catch (error) {
      if (error instanceof inbox.InboxError) return res.status(error.status).json({ error: error.message, code: error.code });
      return fail(res, error);
    }
  });

  router.get('/inbox/messages/:id/media', can, async (req, res) => {
    try {
      const file = await inbox.messageMedia(req.params.id);
      res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
      res.setHeader('Cache-Control', 'private, max-age=3600');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.send(file.buffer);
    } catch (error) {
      if (error instanceof inbox.InboxError) return res.status(error.status).json({ error: error.message, code: error.code });
      return fail(res, error);
    }
  });

  const sendRoute = (path, handler, ...middleware) => router.post(path, can, ...middleware, async (req, res) => {
    try {
      if (rateLimited(req.user.id)) return res.status(429).json({ error: 'Too many messages in a minute. Wait a moment.', code: 'RATE_LIMITED' });
      return res.status(201).json(await handler(req));
    } catch (error) {
      if (error instanceof inbox.InboxError) {
        return res.status(error.status).json({ error: error.message, code: error.code, message: error.message_record ? presentMessage(error.message_record) : undefined });
      }
      return fail(res, error);
    }
  });

  sendRoute('/inbox/conversations/:id/messages', async (req) => ({
    message: presentMessage(await inbox.sendText({ contactId: req.params.id, text: req.body?.text, staff: staffOf(req) })),
  }));

  // Photos, videos, documents, any file and recorded voice notes.
  sendRoute('/inbox/conversations/:id/media', async (req) => ({
    message: presentMessage(await inbox.sendMedia({
      contactId: req.params.id, buffer: req.file?.buffer, mimeType: req.file?.mimetype, filename: req.file?.originalname,
      caption: req.body?.caption, voice: req.body?.voice === '1', staff: staffOf(req),
    })),
  }), fileUpload.single('file'));

  sendRoute('/inbox/conversations/:id/template', async (req) => ({
    message: presentMessage(await inbox.sendTemplate({ contactId: req.params.id, name: req.body?.name, language: req.body?.language, values: req.body?.values, staff: staffOf(req) })),
  }));

  sendRoute('/inbox/conversations', async (req) => {
    const result = await inbox.startConversation({
      phone: req.body?.phone, name: req.body?.name, templateName: req.body?.template_name, language: req.body?.language, values: req.body?.values, staff: staffOf(req),
    });
    return { contact_id: result.contact_id, message: presentMessage(result.message) };
  });
};
