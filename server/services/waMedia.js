/**
 * Meta WhatsApp Cloud API media rules, shared by the admin inbox
 * (platformInbox) and the customer inbox (/api/messages/upload and
 * /api/whatsapp/send), so both send a file the same way.
 *
 * Which files go as image / video / audio and the size limit of each.
 * Anything else (gif, webp, heic, xlsx, ...) is sent as a document, which
 * keeps its name and accepts up to 100 MB.
 */
const MB = 1024 * 1024;
const MEDIA_KINDS = [
  { kind: 'image', types: ['image/jpeg', 'image/png'], max: 5 * MB },
  { kind: 'video', types: ['video/mp4', 'video/3gpp'], max: 16 * MB },
  { kind: 'audio', types: ['audio/aac', 'audio/amr', 'audio/mpeg', 'audio/mp4', 'audio/ogg'], max: 16 * MB },
];
const DOCUMENT_MAX = 100 * MB;

const baseType = (mimeType) => String(mimeType || '').split(';')[0].trim().toLowerCase();

/** How Meta will take a file of this type and size: image, video, audio or document. */
function mediaKind(mimeType, size) {
  const base = baseType(mimeType);
  const match = MEDIA_KINDS.find((k) => k.types.includes(base) && size <= k.max);
  return match ? match.kind : 'document';
}

/**
 * Whether a stored file may be sent as `type`: a document takes any file up to
 * 100 MB; image / video / audio need one of Meta's types and its size limit.
 */
function fitsKind(type, mimeType, size) {
  if (!Number.isFinite(size) || size <= 0) return false;
  if (type === 'document') return size <= DOCUMENT_MAX;
  const rule = MEDIA_KINDS.find((k) => k.kind === type);
  if (!rule) return false;
  return rule.types.includes(baseType(mimeType)) && size <= rule.max;
}

module.exports = { MB, MEDIA_KINDS, DOCUMENT_MAX, mediaKind, fitsKind };
