/**
 * The platform's own WhatsApp inbox (admin panel "WhatsApp Chat").
 *
 * One number belongs to the platform itself, used for Getnera's own support
 * and sales chats. Staff pick it in WhatsApp Numbers ("Use for admin
 * WhatsApp"), which marks the inventory row platform_inbox; it then sends with
 * the inventory credential (META_INVENTORY_ACCESS_TOKEN). The older
 * PLATFORM_WA_PHONE_NUMBER_ID / PLATFORM_WA_ACCESS_TOKEN settings still work
 * when no number is picked. Its messages are stored in platform_wa_*
 * collections, never in a customer workspace, and the token stays on the server.
 *
 * Meta's rules apply: free-form messages only inside the 24-hour customer
 * service window (24 h after the customer's last message); outside it only
 * approved templates.
 */
const axios = require('axios');
const { PlatformWaContacts, PlatformWaMessages, MetaWhatsappPhoneNumbers, MetaWhatsappTemplates } = require('../models');
const { notifyStaff } = require('./realtime');
const mediaStore = require('./mediaStore');
const { runAsSystem } = require('./tenantContext');

const WINDOW_MS = 24 * 60 * 60 * 1000;
const graphBase = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || 'v19.0'}`;
const envPhoneId = () => String(process.env.PLATFORM_WA_PHONE_NUMBER_ID || '').trim() || null;
const envToken = () => String(process.env.PLATFORM_WA_ACCESS_TOKEN || '').trim() || null;
const inventoryToken = () => String(process.env.META_INVENTORY_ACCESS_TOKEN || '').trim() || null;

// The number picked in WhatsApp Numbers, kept in memory so the webhook can
// route without a database read. refreshPlatformNumber() reloads it at start
// and whenever staff change the pick.
let linkedNumber = null;
async function refreshPlatformNumber() {
  linkedNumber = await MetaWhatsappPhoneNumbers.findOne(
    { platform_inbox: true },
    { _id: 0, phone_number_id: 1, waba_id: 1, display_phone_number: 1, verified_name: 1 },
  ).lean() || null;
  return linkedNumber;
}
const platformPhoneId = () => linkedNumber?.phone_number_id || envPhoneId();
const platformToken = () => (linkedNumber ? inventoryToken() || envToken() : envToken());
const platformSource = () => (linkedNumber ? 'inventory' : envPhoneId() ? 'env' : null);

class InboxError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const digits = (value) => String(value || '').replace(/\D/g, '');
const windowOpen = (contact, now = Date.now()) => Boolean(contact?.last_inbound_at) && now - new Date(contact.last_inbound_at).getTime() < WINDOW_MS;

function changed(contactId) {
  notifyStaff('platform_inbox:changed', { contact_id: contactId ?? null });
}

// Readable text for any incoming message type.
function messageText(msg) {
  switch (msg.type) {
    case 'text': return msg.text?.body || '';
    case 'image': return msg.image?.caption || '[Photo]';
    case 'video': return msg.video?.caption || '[Video]';
    case 'audio': return '[Voice message]';
    case 'document': return msg.document?.filename ? `[Document] ${msg.document.filename}` : '[Document]';
    case 'sticker': return '[Sticker]';
    case 'location': return `[Location] ${[msg.location?.name, msg.location?.address].filter(Boolean).join(', ')}`.trim();
    case 'contacts': return '[Contact card]';
    case 'button': return msg.button?.text || '[Button reply]';
    case 'interactive': return msg.interactive?.button_reply?.title || msg.interactive?.list_reply?.title || '[Reply]';
    case 'reaction': return msg.reaction?.emoji ? `Reacted ${msg.reaction.emoji}` : '[Reaction]';
    default: return `[${msg.type || 'message'}]`;
  }
}

const mediaIdOf = (msg) => msg[msg.type]?.id || null;

// Status only moves forward; a failure is always recorded.
const STATUS_RANK = { sending: 0, sent: 1, delivered: 2, read: 3 };

async function findOrCreateContact(waId, profileName) {
  let contact = await PlatformWaContacts.findOne({ wa_id: waId }).lean();
  if (contact) {
    if (profileName && profileName !== contact.profile_name) {
      await PlatformWaContacts.updateOne({ id: contact.id }, { $set: { profile_name: profileName } });
      contact.profile_name = profileName;
    }
    return contact;
  }
  try {
    contact = (await PlatformWaContacts.create({ wa_id: waId, profile_name: profileName || null })).toObject();
  } catch (error) {
    if (error.code !== 11000) throw error;
    contact = await PlatformWaContacts.findOne({ wa_id: waId }).lean();
  }
  return contact;
}

// Copies inbound media to the media server (scope "platform") in the
// background, since Meta deletes it after about 30 days.
function copyMedia(saved, msg) {
  const mediaId = mediaIdOf(msg);
  if (!mediaId || !platformToken() || !mediaStore.enabled()) return;
  runAsSystem(() => mediaStore.saveFromWhatsApp({ mediaId, token: platformToken(), name: msg.document?.filename, scope: mediaStore.PLATFORM_SCOPE }), 'platform-inbox-media')
    .then((file) => PlatformWaMessages.updateOne({ id: saved.id }, { $set: { media_ref: file.ref } }))
    .catch((error) => console.error('[Platform inbox] Media copy failed:', error.message));
}

/** Stores one webhook `value` for the platform number: messages and statuses. */
async function handleWebhookValue(value = {}) {
  const names = new Map((value.contacts || []).map((c) => [digits(c.wa_id), c.profile?.name || null]));
  const touched = new Set();

  for (const msg of value.messages || []) {
    const waId = digits(msg.from);
    if (!waId || !msg.id) continue;
    const contact = await findOrCreateContact(waId, names.get(waId));
    const at = msg.timestamp ? new Date(Number(msg.timestamp) * 1000) : new Date();
    const text = messageText(msg);
    let saved;
    try {
      saved = await PlatformWaMessages.create({
        contact_id: contact.id, direction: 'inbound', type: msg.type || 'text', text,
        media_id: mediaIdOf(msg), wa_message_id: msg.id, status: 'received', created_at: at,
      });
    } catch (error) {
      if (error.code === 11000) continue; // Meta retried a message we already have
      throw error;
    }
    copyMedia(saved, msg);
    await PlatformWaContacts.updateOne({ id: contact.id }, {
      $set: {
        last_message_at: at, last_message_preview: text.slice(0, 160), last_message_direction: 'inbound',
        last_inbound_at: at, status: 'open', updated_at: new Date(),
      },
      $inc: { unread_count: 1 },
    });
    touched.add(contact.id);
  }

  for (const s of value.statuses || []) {
    if (!s.id || !s.status) continue;
    const message = await PlatformWaMessages.findOne({ wa_message_id: s.id }, { _id: 0, id: 1, contact_id: 1, status: 1 }).lean();
    if (!message) continue;
    if (s.status === 'failed') {
      const error = s.errors?.[0]?.title || s.errors?.[0]?.message || 'Delivery failed';
      await PlatformWaMessages.updateOne({ id: message.id }, { $set: { status: 'failed', error } });
    } else if ((STATUS_RANK[s.status] ?? -1) > (STATUS_RANK[message.status] ?? -1)) {
      await PlatformWaMessages.updateOne({ id: message.id }, { $set: { status: s.status } });
    } else {
      continue;
    }
    touched.add(message.contact_id);
  }

  for (const id of touched) changed(id);
  return { contacts: touched.size };
}

function requireConfigured() {
  if (!platformPhoneId() || !platformToken()) {
    throw new InboxError(503, 'The platform WhatsApp number is not configured (PLATFORM_WA_PHONE_NUMBER_ID and PLATFORM_WA_ACCESS_TOKEN)', 'INBOX_NOT_CONFIGURED');
  }
}

// Sends one payload to Meta and records the outbound message either way.
async function deliver(contact, { type, text, templateName }, payload, staff) {
  const record = (await PlatformWaMessages.create({
    contact_id: contact.id, direction: 'outbound', type, text, template_name: templateName || null,
    status: 'sending', sent_by: staff?.id ?? null, sent_by_name: staff?.name || null,
  })).toObject();
  let result;
  try {
    const res = await axios.post(`${graphBase()}/${platformPhoneId()}/messages`, {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: contact.wa_id, ...payload,
    }, { headers: { Authorization: `Bearer ${platformToken()}` }, timeout: 20000 });
    const wamid = res.data?.messages?.[0]?.id || null;
    await PlatformWaMessages.updateOne({ id: record.id }, { $set: { status: 'sent', wa_message_id: wamid } });
    result = { ...record, status: 'sent', wa_message_id: wamid };
  } catch (error) {
    const reason = error.response?.data?.error?.error_user_msg || error.response?.data?.error?.message || error.message || 'Meta refused the message';
    await PlatformWaMessages.updateOne({ id: record.id }, { $set: { status: 'failed', error: reason } });
    result = { ...record, status: 'failed', error: reason };
  }
  await PlatformWaContacts.updateOne({ id: contact.id }, { $set: {
    last_message_at: new Date(), last_message_preview: String(text || '').slice(0, 160), last_message_direction: 'outbound', updated_at: new Date(),
  } });
  changed(contact.id);
  if (result.status === 'failed') throw Object.assign(new InboxError(400, `Not sent: ${result.error}`, 'SEND_FAILED'), { message_record: result });
  return result;
}

async function loadContact(contactId) {
  const contact = await PlatformWaContacts.findOne({ id: Number(contactId) }).lean();
  if (!contact) throw new InboxError(404, 'Conversation not found');
  return contact;
}

/** Free-form text: only inside the 24-hour window. */
async function sendText({ contactId, text, staff }) {
  requireConfigured();
  const body = String(text || '').trim();
  if (!body) throw new InboxError(400, 'Type a message');
  if (body.length > 4096) throw new InboxError(400, 'A message can be at most 4096 characters');
  const contact = await loadContact(contactId);
  if (!windowOpen(contact)) {
    throw new InboxError(409, 'The 24-hour window is closed. Send an approved template to restart the conversation.', 'WINDOW_CLOSED');
  }
  return deliver(contact, { type: 'text', text: body }, { type: 'text', text: { body, preview_url: false } }, staff);
}

// The WABA of the platform number, from the inventory (or the env override).
async function platformWabaId() {
  if (linkedNumber?.waba_id) return linkedNumber.waba_id;
  if (process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID) return String(process.env.PLATFORM_WA_BUSINESS_ACCOUNT_ID).trim();
  const id = platformPhoneId();
  if (!id) return null;
  const phone = await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: id }, { _id: 0, waba_id: 1 }).lean();
  return phone?.waba_id || null;
}

const bodyOf = (template) => (template.components || []).find((c) => String(c.type).toUpperCase() === 'BODY')?.text || '';
// Templates that need values ({{1}}) or media headers cannot be sent from the inbox yet.
const sendable = (template) => !(template.components || []).some((c) => /\{\{\s*\w+\s*\}\}/.test(c.text || '')
  || (String(c.type).toUpperCase() === 'HEADER' && c.format && String(c.format).toUpperCase() !== 'TEXT'));

/** Approved templates of the platform number that can be sent as they are. */
async function listTemplates() {
  const wabaId = await platformWabaId();
  if (!wabaId) return [];
  const rows = await MetaWhatsappTemplates.find({ waba_id: wabaId, status: 'APPROVED' }, { _id: 0, name: 1, language: 1, category: 1, components: 1 }).sort({ name: 1 }).lean();
  return rows.filter(sendable).map((t) => ({ name: t.name, language: t.language, category: t.category, body: bodyOf(t) }));
}

async function findTemplate(name, language) {
  const match = (await listTemplates()).find((t) => t.name === name && (!language || t.language === language));
  if (!match) throw new InboxError(400, 'Choose an approved template from the list');
  return match;
}

async function sendTemplate({ contactId, name, language, staff }) {
  requireConfigured();
  const template = await findTemplate(name, language);
  const contact = await loadContact(contactId);
  return deliver(contact, { type: 'template', text: template.body || `[Template] ${template.name}`, templateName: template.name },
    { type: 'template', template: { name: template.name, language: { code: template.language } } }, staff);
}

/** A new conversation always opens with an approved template. */
async function startConversation({ phone, name, templateName, language, staff }) {
  requireConfigured();
  const waId = digits(phone);
  if (waId.length < 10 || waId.length > 15) throw new InboxError(400, 'Enter the number with its country code, for example 919876543210');
  const template = await findTemplate(templateName, language);
  const contact = await findOrCreateContact(waId, null);
  if (name && !contact.name) {
    await PlatformWaContacts.updateOne({ id: contact.id }, { $set: { name: String(name).trim().slice(0, 80) } });
  }
  const message = await deliver(contact, { type: 'template', text: template.body || `[Template] ${template.name}`, templateName: template.name },
    { type: 'template', template: { name: template.name, language: { code: template.language } } }, staff);
  return { contact_id: contact.id, message };
}

module.exports = {
  InboxError,
  WINDOW_MS,
  platformPhoneId,
  platformToken,
  platformSource,
  refreshPlatformNumber,
  windowOpen,
  handleWebhookValue,
  sendText,
  sendTemplate,
  startConversation,
  listTemplates,
  platformWabaId,
};
