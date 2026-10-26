/**
 * Client for the media server (mediaserver/, media.getnera.in).
 *
 * Files are stored encrypted, one folder per workspace (scope t_<tenant id>,
 * or "platform" for the admin inbox). The database keeps only a reference:
 *
 *   media://t_7/202610-<32 hex>/invoice.pdf
 *
 * API responses turn a reference into a short-lived signed link
 * (presentUrl). A reference or link coming back from the browser is accepted
 * only when the current workspace owns that file (resolveOwned).
 *
 * With MEDIA_SERVER_URL unset the feature is off and the old /uploads/media
 * behaviour stays, so development and tests need no media server.
 *
 * Env: MEDIA_SERVER_URL (internal, e.g. http://127.0.0.1:3700), MEDIA_PUBLIC_URL
 * (https://media.getnera.in), MEDIA_SIGNING_SECRET, MEDIA_INTERNAL_KEY,
 * MEDIA_URL_TTL_SECONDS (default 900).
 */
const crypto = require('crypto');
const fs = require('fs');
const { currentTenantId } = require('./tenantContext');

const REF = /^media:\/\/(t_[1-9]\d*|platform)\/(\d{6}-[0-9a-f]{32})(?:\/([^/?#]*))?$/;
const PLATFORM_SCOPE = 'platform';

class MediaStoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const env = () => ({
  serverUrl: (process.env.MEDIA_SERVER_URL || '').replace(/\/+$/, ''),
  publicUrl: (process.env.MEDIA_PUBLIC_URL || '').replace(/\/+$/, ''),
  signingSecret: process.env.MEDIA_SIGNING_SECRET || '',
  internalKey: process.env.MEDIA_INTERNAL_KEY || '',
  ttl: Number(process.env.MEDIA_URL_TTL_SECONDS) || 900,
});

function enabled() {
  const e = env();
  return Boolean(e.serverUrl && e.publicUrl && e.signingSecret && e.internalKey);
}

const scopeForTenant = (tenantId) => `t_${Number(tenantId)}`;

// Keeps a readable, path-safe file name for links and downloads.
const cleanName = (name) => String(name || '').replace(/[\\/?#%\u0000-\u001f]/g, '_').trim().slice(0, 120);

function refOf({ scope, id, name }) {
  const safe = cleanName(name);
  return `media://${scope}/${id}${safe ? `/${encodeURIComponent(safe)}` : ''}`;
}

// Accepts a media:// reference or one of our own signed links.
function parse(value) {
  if (typeof value !== 'string' || !value) return null;
  let candidate = value;
  const { publicUrl } = env();
  if (publicUrl && value.startsWith(`${publicUrl}/f/`)) {
    candidate = `media://${value.slice(publicUrl.length + 3).split(/[?#]/)[0]}`;
  }
  const match = REF.exec(candidate);
  if (!match) return null;
  let name = '';
  try {
    name = match[3] ? decodeURIComponent(match[3]) : '';
  } catch {
    return null;
  }
  return { scope: match[1], id: match[2], name, ref: refOf({ scope: match[1], id: match[2], name }) };
}

const isRef = (value) => typeof value === 'string' && value.startsWith('media://');

// Same string as mediaserver/src/signing.js.
const signature = (secret, { scope, id, name, exp }) => crypto
  .createHmac('sha256', secret)
  .update(`v1\n${scope}\n${id}\n${name || ''}\n${exp}`)
  .digest('base64url');

/**
 * Signed link for a reference. Expiry is rounded up to the next 5 minutes so
 * the same file gets the same link for a while and the browser can cache it.
 * Anything that is not a media reference is returned unchanged.
 */
function signedUrl(value, { ttl, download = false } = {}) {
  const parsed = parse(value);
  if (!parsed || !enabled()) return value;
  const e = env();
  const exp = Math.ceil((Date.now() / 1000 + (ttl || e.ttl)) / 300) * 300;
  const sig = signature(e.signingSecret, { ...parsed, exp });
  const namePart = parsed.name ? `/${encodeURIComponent(parsed.name)}` : '';
  return `${e.publicUrl}/f/${parsed.scope}/${parsed.id}${namePart}?exp=${exp}&sig=${sig}${download ? '&dl=1' : ''}`;
}

const presentUrl = (value) => (isRef(value) ? signedUrl(value) : value);

async function internalFetch(path, options = {}) {
  const e = env();
  const res = await fetch(`${e.serverUrl}${path}`, {
    ...options,
    headers: { ...(options.headers || {}), 'x-media-key': e.internalKey },
    signal: AbortSignal.timeout(options.timeoutMs || 120000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new MediaStoreError(res.status === 413 ? 413 : 502, `Media server answered ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res;
}

/**
 * Stores a file and records who owns it. `data` is a Buffer, or pass
 * `filePath` to stream a file from disk. `scope` defaults to the current
 * workspace. Returns { ref, id, scope, size, mime }.
 */
async function save({ data, filePath, mime, name, source, scope, waMediaId } = {}) {
  if (!enabled()) throw new MediaStoreError(503, 'Media server is not configured');
  const target = scope || (currentTenantId() ? scopeForTenant(currentTenantId()) : null);
  if (!target) throw new MediaStoreError(400, 'No workspace for this file');
  const body = filePath ? fs.createReadStream(filePath) : data;
  const res = await internalFetch(`/internal/files/${target}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-media-type': mime || 'application/octet-stream' },
    body,
    duplex: 'half',
  });
  const saved = await res.json();
  const { MediaFiles } = require('../models');
  await MediaFiles.create({
    file_id: saved.id, scope: saved.scope, mime_type: saved.mime, file_size: saved.size,
    filename: cleanName(name) || null, source: source || 'upload', wa_media_id: waMediaId || null,
  });
  return { ref: refOf({ scope: saved.scope, id: saved.id, name }), id: saved.id, scope: saved.scope, size: saved.size, mime: saved.mime };
}

/**
 * For a reference or signed link sent by the browser: returns the file when
 * the current workspace owns it, null when the value is not a media file at
 * all (legacy /uploads path, outside URL), and throws 403 otherwise.
 */
async function resolveOwned(value) {
  const parsed = parse(value);
  if (!parsed) return null;
  const tenantId = currentTenantId();
  const { MediaFiles } = require('../models');
  const row = tenantId && parsed.scope === scopeForTenant(tenantId)
    ? await MediaFiles.findOne({ file_id: parsed.id, scope: parsed.scope }, { mime_type: 1, filename: 1, file_size: 1 }).lean()
    : null;
  if (!row) throw new MediaStoreError(403, 'This file does not belong to your workspace');
  return { ...parsed, mime: row.mime_type, filename: row.filename || parsed.name, size: row.file_size };
}

// Deletes a stored file for good: the encrypted bytes and its ownership row.
async function remove(value) {
  const parsed = parse(value);
  if (!parsed || !enabled()) return false;
  await internalFetch(`/internal/files/${parsed.scope}/${parsed.id}`, { method: 'DELETE' });
  const { MediaFiles } = require('../models');
  await MediaFiles.deleteOne({ file_id: parsed.id, scope: parsed.scope });
  return true;
}

// Reads a stored file back as a Buffer (to upload it to Meta).
async function read(value) {
  const parsed = parse(value);
  if (!parsed) throw new MediaStoreError(400, 'Not a media reference');
  const res = await internalFetch(`/internal/files/${parsed.scope}/${parsed.id}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Downloads a WhatsApp media id from Meta and stores it. Meta deletes inbound
 * media after about 30 days, so inbound files are copied as soon as they arrive.
 */
async function saveFromWhatsApp({ mediaId, token, name, scope }) {
  const auth = { Authorization: `Bearer ${token}` };
  const meta = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`, { headers: auth, signal: AbortSignal.timeout(20000) });
  const info = await meta.json().catch(() => ({}));
  if (!meta.ok || !info.url) throw new MediaStoreError(502, `Meta media lookup failed: ${info.error?.message || meta.status}`);
  const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(120000) });
  if (!file.ok) throw new MediaStoreError(502, `Meta media download failed: ${file.status}`);
  const data = Buffer.from(await file.arrayBuffer());
  return save({ data, mime: info.mime_type, name, source: 'inbound', scope, waMediaId: mediaId });
}

module.exports = {
  PLATFORM_SCOPE,
  MediaStoreError,
  enabled,
  scopeForTenant,
  parse,
  isRef,
  refOf,
  signedUrl,
  presentUrl,
  save,
  resolveOwned,
  read,
  remove,
  saveFromWhatsApp,
};
