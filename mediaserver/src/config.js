/**
 * Media server settings, read once from the environment.
 *
 *   MEDIA_MASTER_KEY      64 hex chars. Every tenant key is derived from it.
 *                         Losing it makes every stored file unreadable: back it
 *                         up outside this server.
 *   MEDIA_SIGNING_SECRET  shared with the API; signs the public /f/ links.
 *   MEDIA_INTERNAL_KEY    shared with the API; guards /internal/*.
 *   MEDIA_ROOT            where encrypted files live (default ./storage).
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const HEX64 = /^[0-9a-f]{64}$/i;

function required(name, check, hint) {
  const value = process.env[name];
  if (!value || (check && !check(value))) throw new Error(`${name} is missing or invalid (${hint})`);
  return value;
}

function load() {
  return {
    port: Number(process.env.PORT) || 3700,
    host: process.env.HOST || '127.0.0.1',
    root: path.resolve(process.env.MEDIA_ROOT || path.join(__dirname, '..', 'storage')),
    masterKey: Buffer.from(required('MEDIA_MASTER_KEY', (v) => HEX64.test(v), '64 hex chars, run npm run keygen'), 'hex'),
    signingSecret: required('MEDIA_SIGNING_SECRET', (v) => v.length >= 32, 'at least 32 chars'),
    internalKey: required('MEDIA_INTERNAL_KEY', (v) => v.length >= 32, 'at least 32 chars'),
    maxBytes: Number(process.env.MEDIA_MAX_BYTES) || 100 * 1024 * 1024,
    allowedOrigins: (process.env.MEDIA_ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
  };
}

module.exports = { load };
