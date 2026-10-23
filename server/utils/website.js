/**
 * Brand website rule (the customer app applies the same rule before saving).
 * Empty clears the website. A value without a scheme gets https://. Only
 * http(s) URLs with a real host name are accepted, so nothing like
 * "javascript:" can be stored and later rendered as a link.
 */
const MAX_LENGTH = 256;

function normalizeWebsite(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: true, value: null };
  if (text.length > MAX_LENGTH || /\s/.test(text)) return { ok: false };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false };
  if (!url.hostname.includes('.') || url.username || url.password) return { ok: false };
  return { ok: true, value: candidate };
}

module.exports = { normalizeWebsite };
