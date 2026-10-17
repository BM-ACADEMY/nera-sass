/**
 * Safety net: a customer user's API response never carries a WhatsApp
 * credential, whichever route builds it.
 *
 * Brand routes already sanitise their output (sanitizeClient); this catches
 * anything else that joins a brand's token into a record (for example a lead
 * enriched with `client_wa_token`). It applies only to customer sessions
 * (identity kind "tenant"): service calls and staff routes are unchanged.
 */
const WHATSAPP_SECRET_KEYS = new Set(['wa_access_token', 'wa_access_token_enc', 'client_wa_token', 'wa_token']);
const MAX_DEPTH = 12;

const isPlainObject = (value) => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function stripWhatsAppSecrets(value, depth = 0) {
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) return value.map((item) => stripWhatsAppSecrets(item, depth + 1));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (WHATSAPP_SECRET_KEYS.has(key)) continue;
    out[key] = stripWhatsAppSecrets(item, depth + 1);
  }
  return out;
}

function customerResponseGuard(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(req.identity?.kind === 'tenant' ? stripWhatsAppSecrets(body) : body);
  next();
}

module.exports = { WHATSAPP_SECRET_KEYS, stripWhatsAppSecrets, customerResponseGuard };
