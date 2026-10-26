/**
 * Encrypts files on the way in and decrypts them on the way out, on top of a
 * storage driver that only ever sees ciphertext.
 *
 * Layout: <scope>/<yyyy>/<mm>/<random>.nmf where scope is t_<tenant id> for a
 * customer workspace or "platform" for the admin inbox. The file id
 * (yyyymm-<32 hex>) is random, so names say nothing about the content.
 */
const fs = require('fs');
const crypto = require('crypto');
const c = require('./crypto');

const SCOPE = /^(t_[1-9]\d{0,11}|platform)$/;
const ID = /^(\d{4})(\d{2})-([0-9a-f]{32})$/;

class MediaError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const validScope = (scope) => SCOPE.test(String(scope || ''));
const validId = (id) => ID.test(String(id || ''));

function keyFor(scope, id) {
  const match = ID.exec(id);
  if (!validScope(scope) || !match) throw new MediaError(400, 'Invalid file reference');
  return `${scope}/${match[1]}/${match[2]}/${match[3]}.nmf`;
}

function newId(now = new Date()) {
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${now.getUTCFullYear()}${month}-${crypto.randomBytes(16).toString('hex')}`;
}

function createStore({ storage, masterKey, maxBytes }) {
  // Reads `source` (any async iterable of Buffers), encrypts it chunk by chunk
  // into a temp file and moves it into place only once it is complete.
  async function save(scope, source, mime) {
    if (!validScope(scope)) throw new MediaError(400, 'Invalid scope');
    const id = newId();
    const dek = crypto.randomBytes(32);
    const prefix = crypto.randomBytes(8);
    const sealing = { scope, id };
    const tempPath = storage.tempPath();
    const handle = await fs.promises.open(tempPath, 'w');
    let size = 0;
    let index = 0;
    let position = c.HEADER_SLOT;
    let pending = Buffer.alloc(0);

    const writeChunk = async (plain, last) => {
      const sealed = c.sealChunk(dek, prefix, sealing, index++, last, plain);
      await handle.write(sealed, 0, sealed.length, position);
      position += sealed.length;
    };

    try {
      for await (const piece of source) {
        size += piece.length;
        if (size > maxBytes) throw new MediaError(413, 'File is too large');
        pending = pending.length ? Buffer.concat([pending, piece]) : Buffer.from(piece);
        // Keep the final chunk back until the stream ends: it is sealed as "last".
        while (pending.length > c.CHUNK) {
          await writeChunk(pending.subarray(0, c.CHUNK), false);
          pending = pending.subarray(c.CHUNK);
        }
      }
      await writeChunk(pending, true);

      const header = { v: 1, scope, id, mime: String(mime || 'application/octet-stream').slice(0, 200), size, chunk: c.CHUNK, nonce: prefix.toString('base64'), created: new Date().toISOString() };
      Object.assign(header, c.wrapKey(c.tenantKey(masterKey, scope), dek, header));
      await handle.write(c.encodeHeader(header), 0, c.HEADER_SLOT, 0);
      await handle.close();
      await storage.putFile(keyFor(scope, id), tempPath);
      return { id, scope, size, mime: header.mime };
    } catch (err) {
      await handle.close().catch(() => {});
      await fs.promises.unlink(tempPath).catch(() => {});
      throw err;
    }
  }

  async function open(scope, id) {
    const key = keyFor(scope, id);
    let slot;
    try {
      slot = await storage.readRange(key, 0, c.HEADER_SLOT);
    } catch (err) {
      if (err.code === 'ENOENT') throw new MediaError(404, 'Not found');
      throw err;
    }
    const header = c.decodeHeader(slot);
    if (header.v !== 1 || header.scope !== scope || header.id !== id) throw new MediaError(404, 'Not found');
    let dek;
    try {
      dek = c.unwrapKey(c.tenantKey(masterKey, scope), header);
    } catch {
      throw new MediaError(500, 'File failed its integrity check');
    }
    return { header, dek, key };
  }

  // Yields the plaintext bytes start..end (inclusive), decrypting only the
  // chunks that overlap the range.
  async function* read(file, start = 0, end = file.header.size - 1) {
    const { header, dek, key } = file;
    if (header.size === 0 || end < start) return;
    const prefix = Buffer.from(header.nonce, 'base64');
    const total = c.chunkCount(header.size);
    for (let i = Math.floor(start / c.CHUNK); i <= Math.floor(end / c.CHUNK); i++) {
      const last = i === total - 1;
      const plainLength = last ? header.size - i * c.CHUNK : c.CHUNK;
      const sealed = await storage.readRange(key, c.HEADER_SLOT + i * c.SEALED_CHUNK, plainLength + c.TAG);
      if (sealed.length !== plainLength + c.TAG) throw new MediaError(500, 'File is truncated');
      let plain;
      try {
        plain = c.openChunk(dek, prefix, header, i, last, sealed);
      } catch {
        throw new MediaError(500, 'File failed its integrity check');
      }
      const from = i * c.CHUNK;
      yield plain.subarray(Math.max(0, start - from), Math.min(plain.length, end - from + 1));
    }
  }

  const remove = (scope, id) => storage.remove(keyFor(scope, id));

  return { save, open, read, remove };
}

module.exports = { createStore, MediaError, validScope, validId };
