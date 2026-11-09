/**
 * Safe access to files that agents upload for manual WhatsApp sends.
 *
 * Uploads live in one folder per workspace:  uploads/media/t_<tenantId>/<file>
 * A `media_url` coming from the browser is only ever read when it names a
 * regular file directly inside the calling workspace's own folder. Everything
 * else is refused with a 4xx before the disk is touched:
 *
 *   - ".." anywhere, encoded dots/slashes/backslashes, NUL, "?" and "#"
 *   - absolute paths, other folders (another tenant's, the legacy flat
 *     /uploads/media/ folder whose owner cannot be proven), nested folders
 *   - symlinks (checked with lstat, realpath, and O_NOFOLLOW on open)
 *   - extensions that WhatsApp does not take, or that do not fit msg_type
 *   - files that are empty or larger than WhatsApp's own limit for the type
 *
 * Errors carry a code and a plain message; the route never shows a path.
 */
const fs = require('fs');
const path = require('path');

const PUBLIC_PREFIX = '/uploads/media/';
const MAX_URL_LENGTH = 300;
const FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/;

const MB = 1024 * 1024;
// WhatsApp Cloud API limits per message type.
const TYPES = {
  image: { exts: ['.jpg', '.jpeg', '.png', '.webp'], max: 5 * MB },
  video: { exts: ['.mp4', '.3gp'], max: 16 * MB },
  audio: { exts: ['.ogg', '.opus', '.mp3', '.m4a', '.aac', '.amr'], max: 16 * MB },
  document: { exts: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'], max: 100 * MB },
  sticker: { exts: ['.webp'], max: 500 * 1024 },
};
const MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.mp4': 'video/mp4', '.3gp': 'video/3gpp',
  '.ogg': 'audio/ogg; codecs=opus', '.opus': 'audio/ogg; codecs=opus', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.amr': 'audio/amr',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.txt': 'text/plain', '.csv': 'text/csv',
};

class TenantUploadError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'TenantUploadError';
    this.status = status;
    this.code = code;
  }
}

const refuse = (code = 'MEDIA_NOT_ALLOWED') => new TenantUploadError(400, code, 'This file cannot be sent. Please upload it again and retry.');

const uploadsRoot = () => path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads'));
const tenantFolderName = (tenantId) => {
  const id = Number(tenantId);
  if (!Number.isInteger(id) || id <= 0) throw new TenantUploadError(403, 'MEDIA_NO_WORKSPACE', 'This file cannot be sent.');
  return `t_${id}`;
};
// Absolute folder where this workspace's uploads are written.
const tenantUploadDir = (tenantId) => path.join(uploadsRoot(), 'media', tenantFolderName(tenantId));
// Browser-facing path of a stored upload.
const publicPathFor = (tenantId, filename) => `${PUBLIC_PREFIX}${tenantFolderName(tenantId)}/${filename}`;

/**
 * Checks `mediaUrl` and returns { path, filename, mime, size, publicPath }.
 * Nothing is read; call readValidated() (or open the returned path yourself
 * with O_NOFOLLOW) afterwards.
 */
async function resolveTenantUpload(mediaUrl, tenantId, msgType) {
  const folder = tenantFolderName(tenantId);
  if (typeof mediaUrl !== 'string' || !mediaUrl || mediaUrl.length > MAX_URL_LENGTH) throw refuse();
  // Plain-text screening first: nothing that could be decoded into a trick.
  if (/[\u0000-\u001f\u007f\\%?#:]/.test(mediaUrl) || mediaUrl.includes('..') || mediaUrl.includes('//')) throw refuse('MEDIA_PATH_INVALID');
  const expectedPrefix = `${PUBLIC_PREFIX}${folder}/`;
  if (!mediaUrl.startsWith(expectedPrefix)) throw refuse('MEDIA_PATH_INVALID');
  const filename = mediaUrl.slice(expectedPrefix.length);
  if (!FILENAME.test(filename) || filename.includes('/')) throw refuse('MEDIA_PATH_INVALID');

  const rule = TYPES[msgType];
  if (!rule) throw refuse('MEDIA_TYPE_INVALID');
  const ext = path.extname(filename).toLowerCase();
  if (!rule.exts.includes(ext)) throw refuse('MEDIA_TYPE_INVALID');

  const root = path.join(uploadsRoot(), 'media');
  const dir = path.join(root, folder);
  const candidate = path.join(dir, filename);
  try {
    // The workspace folder itself must not be a link out of the uploads tree.
    const realDir = await fs.promises.realpath(dir);
    const realRoot = await fs.promises.realpath(root);
    if (realDir !== path.join(realRoot, folder)) throw refuse('MEDIA_PATH_INVALID');
    const link = await fs.promises.lstat(candidate);
    if (link.isSymbolicLink() || !link.isFile()) throw refuse('MEDIA_PATH_INVALID');
    const realFile = await fs.promises.realpath(candidate);
    if (realFile !== path.join(realDir, filename)) throw refuse('MEDIA_PATH_INVALID');
    if (link.size <= 0 || link.size > rule.max) throw refuse('MEDIA_SIZE_INVALID');
    return { path: realFile, filename, mime: MIME[ext] || 'application/octet-stream', size: link.size, publicPath: publicPathFor(tenantId, filename), maxBytes: rule.max };
  } catch (err) {
    if (err instanceof TenantUploadError) throw err;
    throw new TenantUploadError(404, 'MEDIA_NOT_FOUND', 'This file is no longer available. Please upload it again.');
  }
}

// Opens without following a link that appeared after the checks, and re-checks size on the open handle.
async function readValidated(file) {
  let handle;
  try {
    handle = await fs.promises.open(file.path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size <= 0 || stat.size > file.maxBytes) throw refuse('MEDIA_SIZE_INVALID');
    return await handle.readFile();
  } catch (err) {
    if (err instanceof TenantUploadError) throw err;
    throw new TenantUploadError(404, 'MEDIA_NOT_FOUND', 'This file is no longer available. Please upload it again.');
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

module.exports = { TenantUploadError, TYPES, uploadsRoot, tenantUploadDir, publicPathFor, resolveTenantUpload, readValidated };
