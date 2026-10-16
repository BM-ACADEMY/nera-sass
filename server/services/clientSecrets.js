/**
 * WhatsApp credential handling for brand profiles (`clients`), plan S8.
 *
 * - At rest, the access token lives only in `wa_access_token_enc`
 *   (AES-256-GCM, utils/crypto.js) plus `wa_token_last4` for display.
 * - The clients model decrypts it into `wa_access_token` in memory when a query
 *   asks for it, so server code can use it to call Meta.
 * - API responses must go through sanitizeClient(), which removes every
 *   secret and exposes only "configured" and the last four characters.
 */
const { encrypt, decrypt } = require('../utils/crypto');

const SECRET_FIELDS = ['wa_access_token', 'wa_access_token_enc', 'access_token', 'refresh_token', 'mfa_secret_enc'];

function encryptToken(token) {
  const value = String(token || '').trim();
  if (!value) return null;
  return { wa_access_token_enc: encrypt(value), wa_token_last4: value.slice(-4) };
}

function decryptToken(ciphertext) {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    console.error('[clientSecrets] Stored WhatsApp token could not be decrypted (wrong TOKEN_ENCRYPTION_KEY?)');
    return null;
  }
}

function sanitizeClient(client) {
  if (!client) return client;
  const source = typeof client.toObject === 'function' ? client.toObject() : client;
  const out = { ...source };
  const configured = Boolean(source.wa_access_token_enc || source.wa_access_token);
  for (const field of SECRET_FIELDS) delete out[field];
  out.wa_token_configured = configured;
  out.wa_token_last4 = configured ? (source.wa_token_last4 || null) : null;
  return out;
}

// Removes secret fields from any object (used for exports and audit metadata).
function stripSecrets(record) {
  if (!record || typeof record !== 'object') return record;
  const out = { ...record };
  for (const field of [...SECRET_FIELDS, 'password_hash', 'reset_token_hash', 'token_hash', 'mfa_pending_secret_enc', 'mfa_recovery_hashes', 'client_wa_token', 'wa_token']) {
    delete out[field];
  }
  return out;
}

module.exports = { SECRET_FIELDS, encryptToken, decryptToken, sanitizeClient, stripSecrets };
