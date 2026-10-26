/**
 * Encrypted file format (.nmf, version 1).
 *
 *   [0..4096)   header slot: "NMF1" + uint32 header length + header JSON, zero padded
 *   [4096..)    chunks: AES-256-GCM(plain chunk) + 16-byte tag, CHUNK bytes of
 *               plaintext each (the last one may be shorter)
 *
 * Keys:
 *   tenant key (KEK) = HKDF-SHA256(master key, info "scope:<scope>"), never stored
 *   file key (DEK)   = 32 random bytes per file, stored wrapped by the KEK
 *
 * Each chunk is sealed with nonce = file nonce prefix (8 bytes) + chunk index
 * (uint32) and AAD "<scope>/<id>/<index>/<last>", so chunks cannot be swapped,
 * reordered, moved to another file or cut off without decryption failing.
 * Chunking lets a range request (video seek) decrypt only the chunks it needs.
 */
const crypto = require('crypto');

const MAGIC = Buffer.from('NMF1');
const HEADER_SLOT = 4096;
const CHUNK = 64 * 1024;
const TAG = 16;
const SEALED_CHUNK = CHUNK + TAG;

function tenantKey(masterKey, scope) {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, Buffer.from('nera-media-v1'), Buffer.from(`scope:${scope}`), 32));
}

// The fields the wrapped key is bound to: editing any of them breaks unwrapping.
const boundFields = (h) => JSON.stringify([h.v, h.scope, h.id, h.mime, h.size, h.chunk, h.nonce]);

function wrapKey(kek, dek, header) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', kek, iv);
  cipher.setAAD(Buffer.from(boundFields(header)));
  const wrapped = Buffer.concat([cipher.update(dek), cipher.final()]);
  return { wrapIv: iv.toString('base64'), wrapTag: cipher.getAuthTag().toString('base64'), wrappedKey: wrapped.toString('base64') };
}

function unwrapKey(kek, header) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', kek, Buffer.from(header.wrapIv, 'base64'));
  decipher.setAAD(Buffer.from(boundFields(header)));
  decipher.setAuthTag(Buffer.from(header.wrapTag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(header.wrappedKey, 'base64')), decipher.final()]);
}

function chunkNonce(prefix, index) {
  const nonce = Buffer.alloc(12);
  prefix.copy(nonce, 0);
  nonce.writeUInt32BE(index, 8);
  return nonce;
}

const chunkAad = (header, index, last) => Buffer.from(`${header.scope}/${header.id}/${index}/${last ? 1 : 0}`);

function sealChunk(dek, prefix, header, index, last, plain) {
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, chunkNonce(prefix, index));
  cipher.setAAD(chunkAad(header, index, last));
  return Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
}

function openChunk(dek, prefix, header, index, last, sealed) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', dek, chunkNonce(prefix, index));
  decipher.setAAD(chunkAad(header, index, last));
  decipher.setAuthTag(sealed.subarray(sealed.length - TAG));
  return Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - TAG)), decipher.final()]);
}

function encodeHeader(header) {
  const json = Buffer.from(JSON.stringify(header));
  if (8 + json.length > HEADER_SLOT) throw new Error('Header too large');
  const slot = Buffer.alloc(HEADER_SLOT);
  MAGIC.copy(slot, 0);
  slot.writeUInt32BE(json.length, 4);
  json.copy(slot, 8);
  return slot;
}

function decodeHeader(slot) {
  if (slot.length < 8 || !slot.subarray(0, 4).equals(MAGIC)) throw new Error('Not a media file');
  const length = slot.readUInt32BE(4);
  if (8 + length > HEADER_SLOT) throw new Error('Corrupt header');
  return JSON.parse(slot.subarray(8, 8 + length).toString('utf8'));
}

const chunkCount = (size) => Math.max(1, Math.ceil(size / CHUNK));

module.exports = {
  CHUNK,
  HEADER_SLOT,
  SEALED_CHUNK,
  TAG,
  tenantKey,
  wrapKey,
  unwrapKey,
  sealChunk,
  openChunk,
  encodeHeader,
  decodeHeader,
  chunkCount,
};
