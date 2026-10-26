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
// Name, type and size of an incoming file, kept so the chat can show a file card.
const mediaInfoOf = (msg) => {
  const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(msg.type) ? msg[msg.type] : null;
  if (!media) return {};
  return { filename: media.filename || null, mime_type: media.mime_type || null, voice: Boolean(media.voice) };
};

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
        media_id: mediaIdOf(msg), ...mediaInfoOf(msg), wa_message_id: msg.id, status: 'received', created_at: at,
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
async function deliver(contact, { type, text, templateName, preview, extra }, payload, staff) {
  const record = (await PlatformWaMessages.create({
    contact_id: contact.id, direction: 'outbound', type, text, template_name: templateName || null,
    status: 'sending', sent_by: staff?.id ?? null, sent_by_name: staff?.name || null, ...(extra || {}),
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
    last_message_at: new Date(), last_message_preview: String(preview || text || '').slice(0, 160), last_message_direction: 'outbound', updated_at: new Date(),
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

// Meta Cloud API media rules: which files go as image / video / audio and the
// size limit of each. Anything else (gif, webp, heic, zip, xlsx, ...) is sent
// as a document, which keeps its name and accepts up to 100 MB.
const MB = 1024 * 1024;
const MEDIA_KINDS = [
  { kind: 'image', types: ['image/jpeg', 'image/png'], max: 5 * MB },
  { kind: 'video', types: ['video/mp4', 'video/3gpp'], max: 16 * MB },
  { kind: 'audio', types: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'], max: 16 * MB },
];
const DOCUMENT_MAX = 100 * MB;

function mediaKind(mimeType, size) {
  const base = String(mimeType || '').split(';')[0].trim().toLowerCase();
  const match = MEDIA_KINDS.find((k) => k.types.includes(base) && size <= k.max);
  return match ? match.kind : 'document';
}

const MEDIA_PREVIEW = { image: '📷 Photo', video: '🎥 Video', audio: '🎤 Voice message', document: '📄 Document' };

// Browsers record voice notes as webm; WhatsApp plays only ogg/opus as a voice note.
async function toVoiceNote(buffer) {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { convertToWhatsAppVoiceNote } = require('./voice-note-encoder');
  const base = path.join(os.tmpdir(), `nera-voice-${Date.now()}-${Math.round(Math.random() * 1e9)}`);
  await fs.promises.writeFile(`${base}.webm`, buffer);
  try {
    await convertToWhatsAppVoiceNote(`${base}.webm`, `${base}.ogg`);
    return await fs.promises.readFile(`${base}.ogg`);
  } finally {
    await Promise.all([`${base}.webm`, `${base}.ogg`].map((p) => fs.promises.unlink(p).catch(() => {})));
  }
}

async function uploadToMeta(buffer, mimeType, filename) {
  const fd = new FormData();
  fd.append('messaging_product', 'whatsapp');
  fd.append('file', new Blob([buffer], { type: mimeType || 'application/octet-stream' }), filename || 'file');
  const res = await fetch(`${graphBase()}/${platformPhoneId()}/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${platformToken()}` }, body: fd, signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new InboxError(400, `Meta did not accept the file: ${data.error?.error_user_msg || data.error?.message || res.status}`, 'MEDIA_REJECTED');
  return data.id;
}

// Keeps an encrypted copy on the media server; Meta's copy expires after ~30 days.
function copyOutboundMedia(messageId, { buffer, mimeType, filename, waMediaId }) {
  if (!mediaStore.enabled()) return;
  runAsSystem(() => mediaStore.save({ data: buffer, mime: mimeType, name: filename, source: 'upload', scope: mediaStore.PLATFORM_SCOPE, waMediaId }), 'platform-inbox-media')
    .then((file) => PlatformWaMessages.updateOne({ id: messageId }, { $set: { media_ref: file.ref } }))
    .catch((error) => console.error('[Platform inbox] Media copy failed:', error.message));
}

/**
 * Any file, photo, video or recorded voice note, inside the 24-hour window.
 * `voice`: a browser recording, converted to an ogg/opus voice note.
 */
async function sendMedia({ contactId, buffer, mimeType, filename, caption, voice, staff }) {
  requireConfigured();
  if (!buffer?.length) throw new InboxError(400, 'Choose a file');
  if (buffer.length > DOCUMENT_MAX) throw new InboxError(400, 'A file can be at most 100 MB');
  const contact = await loadContact(contactId);
  if (!windowOpen(contact)) {
    throw new InboxError(409, 'The 24-hour window is closed. Send an approved template to restart the conversation.', 'WINDOW_CLOSED');
  }

  let data = buffer;
  let mime = String(mimeType || 'application/octet-stream');
  let name = String(filename || 'file').slice(0, 200);
  if (voice) {
    if (!/^audio\/ogg/i.test(mime)) {
      try {
        data = await toVoiceNote(buffer);
      } catch (error) {
        console.error('[Platform inbox] Voice note conversion failed:', error.message);
        throw new InboxError(400, 'Could not prepare the voice note. Please record it again.', 'VOICE_FAILED');
      }
    }
    mime = 'audio/ogg; codecs=opus';
    name = `voice-${Date.now()}.ogg`;
  }

  const kind = voice ? 'audio' : mediaKind(mime, data.length);
  const text = String(caption || '').trim().slice(0, 1024);
  const waMediaId = await uploadToMeta(data, mime, name);
  const media = { id: waMediaId };
  if (text && kind !== 'audio') media.caption = text;
  if (kind === 'document') media.filename = name;

  const label = voice ? '🎤 Voice message' : kind === 'document' ? `📄 ${name}` : MEDIA_PREVIEW[kind];
  const message = await deliver(contact, {
    type: kind,
    text,
    preview: text || label,
    extra: { media_id: waMediaId, filename: voice ? null : name, mime_type: mime, file_size: data.length, voice: Boolean(voice) },
  }, { type: kind, [kind]: media }, staff);
  copyOutboundMedia(message.id, { buffer: data, mimeType: mime, filename: name, waMediaId });
  return message;
}

/**
 * The bytes of one chat file, for the admin panel: from the media server when
 * a copy exists, otherwise from Meta (which keeps files for about 30 days).
 */
async function messageMedia(messageId) {
  const message = await PlatformWaMessages.findOne({ id: Number(messageId) }, { _id: 0, media_ref: 1, media_id: 1, mime_type: 1, filename: 1 }).lean();
  if (!message || (!message.media_ref && !message.media_id)) throw new InboxError(404, 'This message has no file');
  if (message.media_ref && mediaStore.enabled()) {
    return { buffer: await mediaStore.read(message.media_ref), mimeType: message.mime_type, filename: message.filename };
  }
  const auth = { Authorization: `Bearer ${platformToken()}` };
  const info = await fetch(`${graphBase()}/${encodeURIComponent(message.media_id)}`, { headers: auth, signal: AbortSignal.timeout(20000) });
  const meta = await info.json().catch(() => ({}));
  if (!info.ok || !meta.url) throw new InboxError(410, 'WhatsApp no longer has this file', 'MEDIA_EXPIRED');
  const file = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(120000) });
  if (!file.ok) throw new InboxError(502, 'Could not download the file from WhatsApp');
  return { buffer: Buffer.from(await file.arrayBuffer()), mimeType: meta.mime_type || message.mime_type, filename: message.filename };
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

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const MEDIA_HEADERS = ['IMAGE', 'VIDEO', 'DOCUMENT'];
// Meta's sample template: it can only be sent from Meta's public test numbers
// (error 131058), never from a real business number like the platform's.
const TEST_ONLY_TEMPLATES = new Set(['hello_world']);

const upper = (value) => String(value || '').toUpperCase();
const componentOf = (template, type) => (template.components || []).find((c) => upper(c.type) === type);
const variablesIn = (text) => [...new Set([...String(text || '').matchAll(VARIABLE)].map((m) => m[1]))];

/**
 * What staff must fill in before a template can be sent: header text value or
 * header file, body values, and values for website / offer-code buttons.
 * Meta's review samples are offered as placeholders.
 */
function templateFields(template) {
  const header = componentOf(template, 'HEADER');
  const body = componentOf(template, 'BODY');
  const named = upper(template.raw_data?.parameter_format) === 'NAMED' || variablesIn(body?.text).some((v) => !/^\d+$/.test(v));

  const bodyVars = variablesIn(body?.text);
  const bodySamples = named
    ? Object.fromEntries((body?.example?.body_text_named_params || []).map((p) => [p.param_name, p.example]))
    : Object.fromEntries((body?.example?.body_text?.[0] || []).map((value, i) => [String(i + 1), value]));

  let headerField = null;
  if (header && MEDIA_HEADERS.includes(upper(header.format))) {
    headerField = { format: upper(header.format) };
  } else if (header && upper(header.format) === 'TEXT' && variablesIn(header.text).length) {
    const sample = header.example?.header_text?.[0] || header.example?.header_text_named_params?.[0]?.example || '';
    headerField = { format: 'TEXT', name: variablesIn(header.text)[0], sample };
  }

  const buttons = (componentOf(template, 'BUTTONS')?.buttons || []).flatMap((button, index) => {
    const type = upper(button.type);
    if (type === 'URL' && /\{\{\s*1\s*\}\}/.test(button.url || '')) {
      return [{ index, type: 'URL', text: button.text, url: button.url, sample: button.example?.[0] || '' }];
    }
    if (type === 'COPY_CODE') return [{ index, type: 'COPY_CODE', text: 'Offer code', sample: button.example || '' }];
    return [];
  });

  return {
    named,
    header: headerField,
    body: bodyVars.map((name) => ({ name, sample: bodySamples[name] || '' })),
    buttons,
  };
}

/** Approved templates of the platform number, with the values each one needs. */
async function listTemplates() {
  const wabaId = await platformWabaId();
  if (!wabaId) return [];
  const rows = await MetaWhatsappTemplates.find(
    { waba_id: wabaId, status: 'APPROVED', category: { $ne: 'AUTHENTICATION' } },
    { _id: 0, name: 1, language: 1, category: 1, components: 1, 'raw_data.parameter_format': 1 },
  ).sort({ name: 1 }).lean();
  return rows.filter((t) => !TEST_ONLY_TEMPLATES.has(t.name)).map((t) => ({
    name: t.name,
    language: t.language,
    category: t.category,
    header_text: componentOf(t, 'HEADER')?.text || '',
    body: componentOf(t, 'BODY')?.text || '',
    footer: componentOf(t, 'FOOTER')?.text || '',
    fields: templateFields(t),
  }));
}

async function findTemplate(name, language) {
  const match = (await listTemplates()).find((t) => t.name === name && (!language || t.language === language));
  if (!match) throw new InboxError(400, 'Choose an approved template from the list');
  return match;
}

// Meta refuses parameters with new lines, tabs or more than 4 spaces in a row.
const cleanParam = (value) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {5,}/g, '    ').trim();

/**
 * Builds the Meta `template` payload from the staff's values and the text
 * that is saved in the chat. values = { header, header_media_id, body: {name: value}, buttons: {index: value} }.
 */
function buildTemplateMessage(template, values = {}) {
  const { fields } = template;
  const components = [];
  const textParam = (name, value) => ({ type: 'text', text: value, ...(fields.named ? { parameter_name: name } : {}) });
  const need = (value, label) => {
    const clean = cleanParam(value);
    if (!clean) throw new InboxError(400, `Fill in ${label}`, 'TEMPLATE_VALUE_MISSING');
    if (clean.length > 1024) throw new InboxError(400, `${label} is too long`, 'TEMPLATE_VALUE_TOO_LONG');
    return clean;
  };

  let headerText = template.header_text;
  if (fields.header?.format === 'TEXT') {
    const value = need(values.header, 'the header value');
    components.push({ type: 'header', parameters: [textParam(fields.header.name, value)] });
    headerText = headerText.replace(VARIABLE, value);
  } else if (fields.header) {
    const id = String(values.header_media_id || '').trim();
    if (!id) throw new InboxError(400, `Add the header ${fields.header.format.toLowerCase()}`, 'TEMPLATE_VALUE_MISSING');
    const kind = fields.header.format.toLowerCase();
    components.push({ type: 'header', parameters: [{ type: kind, [kind]: { id } }] });
  }

  const bodyValues = {};
  for (const variable of fields.body) bodyValues[variable.name] = need(values.body?.[variable.name], `{{${variable.name}}}`);
  if (fields.body.length) components.push({ type: 'body', parameters: fields.body.map((v) => textParam(v.name, bodyValues[v.name])) });

  for (const button of fields.buttons) {
    const value = need(values.buttons?.[button.index], button.type === 'URL' ? `the link for "${button.text}"` : 'the offer code');
    components.push(button.type === 'URL'
      ? { type: 'button', sub_type: 'url', index: String(button.index), parameters: [{ type: 'text', text: value }] }
      : { type: 'button', sub_type: 'copy_code', index: String(button.index), parameters: [{ type: 'coupon_code', coupon_code: value }] });
  }

  const body = template.body.replace(VARIABLE, (_m, name) => bodyValues[name] ?? `{{${name}}}`);
  const text = [headerText, body, template.footer].filter(Boolean).join('\n\n') || `[Template] ${template.name}`;
  return {
    text,
    payload: { type: 'template', template: { name: template.name, language: { code: template.language }, ...(components.length ? { components } : {}) } },
  };
}

async function sendTemplate({ contactId, name, language, values, staff }) {
  requireConfigured();
  const template = await findTemplate(name, language);
  const message = buildTemplateMessage(template, values);
  const contact = await loadContact(contactId);
  return deliver(contact, { type: 'template', text: message.text, templateName: template.name }, message.payload, staff);
}

/** A new conversation always opens with an approved template. */
async function startConversation({ phone, name, templateName, language, values, staff }) {
  requireConfigured();
  const waId = digits(phone);
  if (waId.length < 10 || waId.length > 15) throw new InboxError(400, 'Enter the number with its country code, for example 919876543210');
  const template = await findTemplate(templateName, language);
  const built = buildTemplateMessage(template, values);
  const contact = await findOrCreateContact(waId, null);
  if (name && !contact.name) {
    await PlatformWaContacts.updateOne({ id: contact.id }, { $set: { name: String(name).trim().slice(0, 80) } });
  }
  const message = await deliver(contact, { type: 'template', text: built.text, templateName: template.name }, built.payload, staff);
  return { contact_id: contact.id, message };
}

const HEADER_MEDIA_LIMITS = { IMAGE: 5, VIDEO: 16, DOCUMENT: 100 }; // MB, Meta's limits

/**
 * Uploads a template header file to Meta for the platform number and returns
 * its media id.
 */
async function uploadHeaderMedia({ buffer, mimeType, filename, format }) {
  requireConfigured();
  const kind = upper(format);
  if (!MEDIA_HEADERS.includes(kind)) throw new InboxError(400, 'Unknown header type');
  if (!buffer?.length) throw new InboxError(400, 'Choose a file');
  if (buffer.length > HEADER_MEDIA_LIMITS[kind] * 1024 * 1024) throw new InboxError(400, `A header ${kind.toLowerCase()} can be at most ${HEADER_MEDIA_LIMITS[kind]} MB`);
  return { media_id: await uploadToMeta(buffer, mimeType, filename) };
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
  templateFields,
  buildTemplateMessage,
  uploadHeaderMedia,
  sendMedia,
  messageMedia,
  mediaKind,
  platformWabaId,
};
