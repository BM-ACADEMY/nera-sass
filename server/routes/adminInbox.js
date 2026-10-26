/**
 * Admin inbox for the platform's own WhatsApp number (/api/admin/inbox/*).
 * Founder and ops staff only (platform.inbox). The Meta token never leaves
 * the server: the browser only ever sees conversations and messages.
 */
const { PlatformWaContacts, PlatformWaMessages, PlatformQuickReplies, MetaWhatsappPhoneNumbers, Clients, Users, Tenants } = require('../models');
const { escapeRegex } = require('../db/mongo');
const inbox = require('../services/platformInbox');
const mediaStore = require('../services/mediaStore');
const multer = require('multer');

const fileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024, files: 1 } });
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'document', 'sticker']);
// Labels stored for incoming files without a caption; the file itself is shown instead.
const MEDIA_PLACEHOLDER = /^\[(Photo|Video|Voice message|Sticker|Document)\]( .*)?$/;
// Location and contact messages are drawn as cards; their stored label is not shown.
const CARD_PLACEHOLDER = /^\[(Location|Contact card)\]/;
const LABEL_MAX = 10;
const URL_PATTERN = /https?:\/\/[^\s<>"')]+/gi;

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
  assigned_to: c.assigned_to ?? null,
  assigned_name: c.assigned_name || null,
  labels: c.labels || [],
});

const hiddenText = (m) => (MEDIA_TYPES.has(m.type) && MEDIA_PLACEHOLDER.test(m.text || '')) || (['location', 'contacts'].includes(m.type) && CARD_PLACEHOLDER.test(m.text || ''));

// `quote`: the message this one replies to, when it is in the chat.
const presentMessage = (m, quote = null) => ({
  id: m.id,
  direction: m.direction,
  type: m.type,
  text: hiddenText(m) ? '' : m.text || '',
  template_name: m.template_name || null,
  // Signed media-server link when a copy exists; otherwise the panel loads
  // the file through /inbox/messages/:id/media.
  media_url: m.media_ref && mediaStore.enabled() ? mediaStore.signedUrl(m.media_ref) : null,
  has_media: Boolean(m.media_ref || m.media_id),
  filename: m.filename || null,
  mime_type: m.mime_type || null,
  file_size: m.file_size || null,
  voice: Boolean(m.voice),
  location: m.location || null,
  contacts: m.contacts || null,
  interactive: m.interactive || null,
  reactions: m.reactions || {},
  can_reply: Boolean(m.wa_message_id),
  reply_to: quote ? {
    id: quote.id,
    direction: quote.direction,
    type: quote.type,
    text: hiddenText(quote) ? '' : (quote.text || '').slice(0, 200),
    filename: quote.filename || null,
  } : null,
  status: m.status,
  error: m.error || null,
  sent_by_name: m.sent_by_name || null,
  created_at: m.created_at,
});

const staffOf = (req) => ({ id: req.user.id, name: req.user.name || req.user.email });

// Messages with the messages they quote.
async function presentMessages(rows) {
  const ids = [...new Set(rows.map((m) => m.reply_to_wa_id).filter(Boolean))];
  const quotes = ids.length
    ? new Map((await PlatformWaMessages.find({ wa_message_id: { $in: ids } }, { _id: 0 }).lean()).map((q) => [q.wa_message_id, q]))
    : new Map();
  return rows.map((m) => presentMessage(m, m.reply_to_wa_id ? quotes.get(m.reply_to_wa_id) : null));
}
const presentOne = async (m) => (await presentMessages([m]))[0];

// Staff who may work in the inbox, for assigning chats.
const inboxStaff = () => Users.find(
  { is_platform_staff: true, is_active: { $ne: false }, staff_role: { $in: ['founder', 'ops'] } },
  { _id: 0, id: 1, name: 1, email: 1, staff_role: 1 },
).sort({ name: 1 }).lean();

// Trimmed, at most LABEL_MAX, each label once whatever its case.
function cleanLabels(labels) {
  const seen = new Map();
  for (const raw of Array.isArray(labels) ? labels : []) {
    const label = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    if (label && !seen.has(label.toLowerCase())) seen.set(label.toLowerCase(), label);
  }
  return [...seen.values()].slice(0, LABEL_MAX);
}
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
      if (req.query.filter === 'mine') filter.assigned_to = req.user.id;
      if (req.query.filter === 'unassigned') filter.assigned_to = null;
      if (req.query.label) filter.labels = String(req.query.label);
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
      return res.json({ messages: await presentMessages(rows.reverse()), has_more: rows.length === limit });
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
      if (req.body?.assigned_to !== undefined) {
        if (req.body.assigned_to === null || req.body.assigned_to === '') {
          Object.assign(changes, { assigned_to: null, assigned_name: null });
        } else {
          const staff = (await inboxStaff()).find((s) => s.id === Number(req.body.assigned_to));
          if (!staff) return res.status(400).json({ error: 'Choose a staff member who can use WhatsApp Chat' });
          Object.assign(changes, { assigned_to: staff.id, assigned_name: staff.name || staff.email });
        }
      }
      if (req.body?.labels !== undefined) changes.labels = cleanLabels(req.body.labels);
      if (!Object.keys(changes).length) return res.status(400).json({ error: 'Nothing to update' });
      const contact = await PlatformWaContacts.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { ...changes, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
      if (!contact) return res.status(404).json({ error: 'Conversation not found' });
      return res.json({ conversation: presentContact(contact) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/staff', can, async (req, res) => {
    try {
      return res.json({ staff: (await inboxStaff()).map((s) => ({ id: s.id, name: s.name || s.email, role: s.staff_role })) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.get('/inbox/labels', can, async (req, res) => {
    try {
      const labels = await PlatformWaContacts.distinct('labels');
      return res.json({ labels: labels.filter(Boolean).sort((x, y) => x.localeCompare(y)) });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Photos and videos, documents and links shared in one chat.
  router.get('/inbox/conversations/:id/shared', can, async (req, res) => {
    try {
      const contactId = Number(req.params.id);
      const [files, texts] = await Promise.all([
        PlatformWaMessages.find({ contact_id: contactId, type: { $in: [...MEDIA_TYPES] }, $or: [{ media_ref: { $ne: null } }, { media_id: { $ne: null } }] }, { _id: 0 }).sort({ id: -1 }).limit(300).lean(),
        PlatformWaMessages.find({ contact_id: contactId, text: { $regex: 'https?://' } }, { _id: 0, id: 1, text: 1, direction: 1, created_at: 1 }).sort({ id: -1 }).limit(300).lean(),
      ]);
      const presented = files.map((m) => presentMessage(m));
      const links = texts.flatMap((m) => (m.text.match(URL_PATTERN) || []).map((url) => ({ message_id: m.id, url, direction: m.direction, created_at: m.created_at })));
      return res.json({
        media: presented.filter((m) => ['image', 'video', 'sticker'].includes(m.type)),
        documents: presented.filter((m) => ['document', 'audio'].includes(m.type)),
        links,
      });
    } catch (error) {
      return fail(res, error);
    }
  });

  // Saved replies ("/" in the message box).
  const presentQuickReply = (q) => ({ id: q.id, shortcut: q.shortcut, text: q.text });
  const quickReplyInput = (body = {}) => {
    const shortcut = String(body.shortcut || '').trim().replace(/^\//, '').toLowerCase();
    const text = String(body.text || '').trim();
    if (!/^[a-z0-9_-]{1,30}$/.test(shortcut)) return { error: 'Shortcut: 1 to 30 letters, numbers, - or _ (no spaces)' };
    if (!text || text.length > 4096) return { error: 'The reply text must be 1 to 4096 characters' };
    return { shortcut, text };
  };

  router.get('/inbox/quick-replies', can, async (req, res) => {
    try {
      const rows = await PlatformQuickReplies.find({}, { _id: 0 }).sort({ shortcut: 1 }).lean();
      return res.json({ quick_replies: rows.map(presentQuickReply) });
    } catch (error) {
      return fail(res, error);
    }
  });

  router.post('/inbox/quick-replies', can, async (req, res) => {
    try {
      const input = quickReplyInput(req.body);
      if (input.error) return res.status(400).json({ error: input.error });
      const row = await PlatformQuickReplies.create({ ...input, created_by: req.user.id });
      return res.status(201).json({ quick_reply: presentQuickReply(row) });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'That shortcut is already used' });
      return fail(res, error);
    }
  });

  router.patch('/inbox/quick-replies/:id', can, async (req, res) => {
    try {
      const input = quickReplyInput(req.body);
      if (input.error) return res.status(400).json({ error: input.error });
      const row = await PlatformQuickReplies.findOneAndUpdate({ id: Number(req.params.id) }, { $set: { ...input, updated_at: new Date() } }, { new: true, projection: { _id: 0 } }).lean();
      if (!row) return res.status(404).json({ error: 'Quick reply not found' });
      return res.json({ quick_reply: presentQuickReply(row) });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'That shortcut is already used' });
      return fail(res, error);
    }
  });

  router.delete('/inbox/quick-replies/:id', can, async (req, res) => {
    try {
      await PlatformQuickReplies.deleteOne({ id: Number(req.params.id) });
      return res.json({ deleted: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  // "typing…" for the customer while staff write; never fails the page.
  router.post('/inbox/conversations/:id/typing', can, async (req, res) => {
    try {
      return res.json(await inbox.sendTyping({ contactId: req.params.id }));
    } catch {
      return res.json({ sent: false });
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
        return res.status(error.status).json({ error: error.message, code: error.code, message: error.message_record ? await presentOne(error.message_record) : undefined });
      }
      return fail(res, error);
    }
  });

  sendRoute('/inbox/conversations/:id/messages', async (req) => ({
    message: await presentOne(await inbox.sendText({ contactId: req.params.id, text: req.body?.text, replyTo: req.body?.reply_to, staff: staffOf(req) })),
  }));

  sendRoute('/inbox/conversations/:id/location', async (req) => ({
    message: await presentOne(await inbox.sendLocation({
      contactId: req.params.id, latitude: req.body?.latitude, longitude: req.body?.longitude, name: req.body?.name, address: req.body?.address,
      replyTo: req.body?.reply_to, staff: staffOf(req),
    })),
  }));

  sendRoute('/inbox/conversations/:id/contact', async (req) => ({
    message: await presentOne(await inbox.sendContactCard({ contactId: req.params.id, name: req.body?.name, phone: req.body?.phone, email: req.body?.email, replyTo: req.body?.reply_to, staff: staffOf(req) })),
  }));

  sendRoute('/inbox/conversations/:id/interactive', async (req) => ({
    message: await presentOne(await inbox.sendInteractive({
      contactId: req.params.id, kind: req.body?.kind, body: req.body?.body, header: req.body?.header, footer: req.body?.footer,
      buttons: req.body?.buttons, buttonText: req.body?.button_text, rows: req.body?.rows, replyTo: req.body?.reply_to, staff: staffOf(req),
    })),
  }));

  sendRoute('/inbox/messages/:id/reaction', async (req) => inbox.sendReaction({ messageId: req.params.id, emoji: req.body?.emoji }));

  // Photos, videos, documents, any file and recorded voice notes.
  sendRoute('/inbox/conversations/:id/media', async (req) => ({
    message: await presentOne(await inbox.sendMedia({
      contactId: req.params.id, buffer: req.file?.buffer, mimeType: req.file?.mimetype, filename: req.file?.originalname,
      caption: req.body?.caption, voice: req.body?.voice === '1', replyTo: req.body?.reply_to, staff: staffOf(req),
    })),
  }), fileUpload.single('file'));

  sendRoute('/inbox/conversations/:id/template', async (req) => ({
    message: await presentOne(await inbox.sendTemplate({ contactId: req.params.id, name: req.body?.name, language: req.body?.language, values: req.body?.values, staff: staffOf(req) })),
  }));

  sendRoute('/inbox/conversations', async (req) => {
    const result = await inbox.startConversation({
      phone: req.body?.phone, name: req.body?.name, templateName: req.body?.template_name, language: req.body?.language, values: req.body?.values, staff: staffOf(req),
    });
    return { contact_id: result.contact_id, message: await presentOne(result.message) };
  });
};
