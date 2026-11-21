/**
 * Turns an approved WhatsApp template into the text a customer actually reads,
 * so the inbox shows the message instead of "[Template] name".
 */
const { MetaWhatsappTemplates, Templates } = require('../models');

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

/** Template definition by name (+ language when known), or null. */
async function findDefinition(name, language) {
  if (!name) return null;
  const meta = await MetaWhatsappTemplates.find({ name }, { _id: 0, language: 1, components: 1 }).lean();
  const picked = meta.find((t) => language && t.language === language) || meta[0];
  if (picked) {
    return {
      header: part(picked.components, 'HEADER')?.format === 'TEXT' || !part(picked.components, 'HEADER')?.format ? part(picked.components, 'HEADER')?.text || '' : '',
      body: part(picked.components, 'BODY')?.text || '',
      footer: part(picked.components, 'FOOTER')?.text || '',
    };
  }
  const own = await Templates.findOne({ name }, { _id: 0, header_format: 1, header: 1, body: 1, footer: 1 }).lean();
  if (!own) return null;
  return { header: upper(own.header_format) === 'TEXT' ? own.header || '' : '', body: own.body || '', footer: own.footer || '' };
}

/**
 * Message text for a template send. params = array (positional body values)
 * or { header, body } where each is an array/object. Falls back to `fallback`
 * (or the template name) when the definition is unknown.
 */
async function renderTemplateText(name, language, params, fallback) {
  try {
    const def = await findDefinition(name, language);
    if (!def || !def.body) return fallback || name || '';
    const split = params && !Array.isArray(params) && (params.body || params.header) ? params : { body: params };
    return [fill(def.header, split.header), fill(def.body, split.body), def.footer].filter(Boolean).join('\n\n');
  } catch {
    return fallback || name || '';
  }
}

// Old rows hold "[Template] name", "[Template: name]" or the bare name.
function placeholderName(content) {
  const text = String(content || '').trim();
  const bracket = text.match(/^\[template:?\s*([a-z0-9_]+)\]?\s*([a-z0-9_]*)$/i);
  if (bracket) return bracket[2] || bracket[1];
  return /^[a-z0-9_]+$/.test(text) && text.includes('_') ? text : null;
}

/** For messages already stored: swaps a placeholder for the template text. */
async function resolvePlaceholders(rows) {
  const cache = new Map();
  for (const row of rows) {
    if ((row.type || row.msg_type) !== 'template') continue;
    const name = placeholderName(row.content);
    if (!name) continue;
    if (!cache.has(name)) cache.set(name, await renderTemplateText(name, null, null, null));
    if (cache.get(name)) row.content = cache.get(name);
  }
  return rows;
}

module.exports = { renderTemplateText, resolvePlaceholders, placeholderName };
