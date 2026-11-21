/**
 * Turns an approved WhatsApp template into what the customer actually reads
 * (header, body with its values, footer, and the buttons), so the inbox shows
 * the message instead of "[Template] name".
 *
 * A template is looked up only in the WABA of the brand that sent it (and in
 * its language), never across workspaces: two brands, or two workspaces, can
 * have a template with the same name and different text.
 */
const { MetaWhatsappTemplates, MetaWhatsappPhoneNumbers, Clients, Templates } = require('../models');
const { currentTenantId } = require('./tenantContext');

const VARIABLE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;
const upper = (v) => String(v || '').toUpperCase();
const part = (components, type) => (components || []).find((c) => upper(c.type) === type);

// Fills {{1}} / {{name}} from an array (by position) or an object (by name).
function fill(text, params) {
  const list = Array.isArray(params) ? params : null;
  return String(text || '').replace(VARIABLE, (match, key) => {
    const value = list ? list[Number(key) - 1] : params?.[key];
    return value == null || value === '' ? match : String(value);
  });
}

// Only what the inbox shows: label, and the link / number when there is one.
function cleanButtons(buttons) {
  return (Array.isArray(buttons) ? buttons : []).slice(0, 10).map((b) => ({
    type: upper(b?.type) || 'QUICK_REPLY',
    text: String(b?.text || '').slice(0, 60),
    ...(b?.url ? { url: String(b.url) } : {}),
    ...(b?.phone_number ? { phone_number: String(b.phone_number) } : {}),
  }));
}

/** The WABA of a brand (by brand id or by its phone number id), or null. */
async function wabaOf({ wabaId, clientId, phoneNumberId } = {}) {
  if (wabaId) return String(wabaId);
  let phoneId = phoneNumberId || null;
  if (!phoneId && clientId != null) {
    phoneId = (await Clients.findOne({ id: clientId }, { _id: 0, phone_number_id: 1 }).lean())?.phone_number_id || null;
  }
  if (!phoneId) return null;
  return (await MetaWhatsappPhoneNumbers.findOne({ phone_number_id: String(phoneId) }, { _id: 0, waba_id: 1 }).lean())?.waba_id || null;
}

// Same language first, then the same base language (en for en_US), and any
// language only when the send did not say which (old rows): English first.
function pickLanguage(rows, language) {
  if (!rows.length) return null;
  if (!language) return rows.find((t) => /^en(_|$)/i.test(String(t.language || ''))) || rows[0];
  const base = String(language).split('_')[0].toLowerCase();
  return rows.find((t) => t.language === language)
    || rows.find((t) => String(t.language || '').split('_')[0].toLowerCase() === base)
    || null;
}

/**
 * Template definition by name, in the brand's WABA and language, or null.
 * scope = { clientId, phoneNumberId, wabaId }. Outside a workspace (system
 * jobs) the WABA must be known; inside one, the workspace's own rows are the
 * fallback when the brand has no WABA on record.
 */
async function findDefinition(name, language, scope = {}) {
  if (!name) return null;
  const tenantId = currentTenantId();
  const wabaId = await wabaOf(scope);
  if (!wabaId && !tenantId) return null;

  const meta = await MetaWhatsappTemplates.find(
    { name, ...(wabaId ? { waba_id: wabaId } : {}) },
    { _id: 0, language: 1, components: 1 },
  ).lean();
  const picked = pickLanguage(meta, language);
  if (picked) {
    const header = part(picked.components, 'HEADER');
    return {
      header: !header?.format || upper(header.format) === 'TEXT' ? header?.text || '' : '',
      body: part(picked.components, 'BODY')?.text || '',
      footer: part(picked.components, 'FOOTER')?.text || '',
      buttons: cleanButtons(part(picked.components, 'BUTTONS')?.buttons),
    };
  }
  // Templates written in Getnera (before or without a Meta sync): only inside
  // the workspace, and for the brand when it is known.
  if (!tenantId) return null;
  const own = await Templates.find(
    { name, ...(scope.clientId != null ? { $or: [{ client_id: scope.clientId }, { client_id: null }] } : {}) },
    { _id: 0, language: 1, header_format: 1, header: 1, body: 1, footer: 1, buttons: 1 },
  ).lean();
  const mine = pickLanguage(own, language);
  if (!mine) return null;
  return {
    header: upper(mine.header_format || 'TEXT') === 'TEXT' ? mine.header || '' : '',
    body: mine.body || '',
    footer: mine.footer || '',
    buttons: cleanButtons(mine.buttons),
  };
}

/**
 * { text, buttons } for a template send, or null when the definition is
 * unknown. params = array (positional body values) or { header, body } where
 * each is an array (positional) or an object (named).
 */
async function renderTemplate(name, language, params, scope = {}) {
  try {
    const def = await findDefinition(name, language, scope);
    if (!def || !def.body) return null;
    const split = params && !Array.isArray(params) && (params.body || params.header) ? params : { body: params };
    const text = [fill(def.header, split.header), fill(def.body, split.body), def.footer].filter(Boolean).join('\n\n');
    return { text, buttons: def.buttons };
  } catch {
    return null;
  }
}

/** Message text for a template send; `fallback` (or the name) when unknown. */
async function renderTemplateText(name, language, params, fallback, scope = {}) {
  const shown = await renderTemplate(name, language, params, scope);
  return shown?.text || fallback || name || '';
}

// Old rows hold "[Template] name", "[Template: name]" or the bare name.
function placeholderName(content) {
  const text = String(content || '').trim();
  const bracket = text.match(/^\[template(?::\s*([a-z0-9_]+))?\]\s*([a-z0-9_]*)$/i);
  if (bracket) return bracket[1] || bracket[2] || null;
  return /^[a-z0-9_]+$/.test(text) && text.includes('_') ? text : null;
}

// Only the bracket form marks a text row as a template (n8n used to store
// template sends as text); a bare word with "_" in a text row is just text.
const bracketName = (content) => (/^\s*\[template/i.test(String(content || '')) ? placeholderName(content) : null);

/**
 * For messages already stored: swaps a placeholder for the template text,
 * marks n8n template rows as templates, and adds the template's buttons.
 * scope = the lead's brand ({ clientId }), so the lookup stays in its WABA.
 */
async function resolvePlaceholders(rows, scope = {}) {
  const cache = new Map();
  const lookup = async (name, language) => {
    const key = `${name}\u0000${language || ''}`;
    if (!cache.has(key)) cache.set(key, await renderTemplate(name, language || null, null, scope));
    return cache.get(key);
  };
  for (const row of rows) {
    const type = row.type || row.msg_type;
    const placeholder = type === 'template' ? placeholderName(row.content) : type === 'text' || !type ? bracketName(row.content) : null;
    if (type !== 'template' && !placeholder) continue;
    if (type !== 'template') {
      if (row.type) row.type = 'template';
      row.msg_type = 'template';
    }
    const name = row.template_name || placeholder;
    if (!name) continue;
    row.template_name = name;
    const shown = await lookup(name, row.template_language);
    if (!shown) continue;
    if (placeholder) row.content = shown.text;
    if (shown.buttons?.length) row.template_buttons = shown.buttons;
  }
  return rows;
}

module.exports = { renderTemplate, renderTemplateText, resolvePlaceholders, placeholderName, findDefinition, wabaOf };
