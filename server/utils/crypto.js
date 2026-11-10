/**
 * AES-256-GCM encryption for secrets stored in the database, with key versions
 * so TOKEN_ENCRYPTION_KEY can be rotated without losing stored values.
 *
 * Keys (read from the environment on every call):
 *   TOKEN_ENCRYPTION_KEY            current key: encrypts everything new.
 *                                   (ENCRYPTION_KEY is still accepted as a fallback name.)
 *   TOKEN_ENCRYPTION_KEY_PREVIOUS   optional: the key used before the last
 *                                   rotation. Only ever used to decrypt.
 *
 * Stored format:
 *   k<version>:<iv>:<authTag>:<ciphertext>     written by this code
 *   <iv>:<authTag>:<ciphertext>                written before key versions existed
 *
 * <version> identifies the key that encrypted the value. It is the first 8 hex
 * characters of a SHA-256 over the key (with a fixed label), so it is derived
 * from the key itself and can never drift from it: there is no separate
 * version number to keep in step when a key is replaced. It does not reveal the key.
 *
 * Decryption picks the key by version. A value without a version is tried
 * against every configured key; GCM authentication makes a wrong key fail
 * cleanly instead of returning garbage.
 *
 * Nothing here logs a key, a plaintext or a ciphertext.
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV length is 12 bytes
const VERSION_PATTERN = /^k([0-9a-f]{8})$/;

function keyVersion(secret) {
  return crypto.createHash('sha256').update(`nera-token-key-version:${secret}`).digest('hex').slice(0, 8);
}

function makeKey(secret) {
  // Hash the secret so any string gives a 32-byte key.
  return { version: keyVersion(secret), key: crypto.createHash('sha256').update(secret).digest() };
}

function currentSecret() {
  return process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || null;
}

/** The previous key's secret, or null when none is set (or it equals the current one). */
function previousSecret() {
  const previous = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS || null;
  return previous && previous !== currentSecret() ? previous : null;
}

function currentKey() {
  const secret = currentSecret();
  if (!secret) {
    console.error('❌ CRITICAL ERROR: TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY environment variable is not defined.');
    throw new Error('TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY env variable is required for token encryption');
  }
  return makeKey(secret);
}

/** Every key that may decrypt, current first. */
function decryptionKeys() {
  const keys = [currentKey()];
  const previous = previousSecret();
  if (previous) keys.push(makeKey(previous));
  return keys;
}

function currentKeyVersion() {
  return currentKey().version;
}

function previousKeyVersion() {
  const previous = previousSecret();
  return previous ? keyVersion(previous) : null;
}

/** The key version recorded in a stored value, or null for a value written before versions existed. */
function keyVersionOf(storedValue) {
  const match = VERSION_PATTERN.exec(String(storedValue || '').split(':')[0]);
  return match ? match[1] : null;
}

function decryptWith(key, ivHex, authTagHex, ciphertextHex) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  return decipher.update(ciphertextHex, 'hex', 'utf8') + decipher.final('utf8');
}

function decryptQuietly(storedValue) {
  const parts = String(storedValue).split(':');
  const version = keyVersionOf(storedValue);
  if (version) {
    if (parts.length !== 4) throw new Error('Invalid encrypted text format');
    const match = decryptionKeys().find((candidate) => candidate.version === version);
    if (!match) throw new Error('Value was encrypted with a key version that is not configured (is TOKEN_ENCRYPTION_KEY_PREVIOUS missing?)');
    return decryptWith(match.key, parts[1], parts[2], parts[3]);
  }
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format (must have iv, authTag, and ciphertext)');
  }
  let lastError;
  for (const candidate of decryptionKeys()) {
    try {
      return decryptWith(candidate.key, parts[0], parts[1], parts[2]);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/**
 * Encrypt a text string with the current key.
 * @param {string} text - The plaintext to encrypt
 * @returns {string|null} k<version>:iv:authTag:ciphertext, or null for empty input
 */
function encrypt(text) {
  if (!text) return null;
  try {
    const { version, key } = currentKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const encrypted = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    return `k${version}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('Encryption failed:', err.message);
    throw err;
  }
}

/**
 * Decrypt a stored value with whichever configured key encrypted it.
 * @param {string} encryptedText - The stored value
 * @returns {string|null} The plaintext, or null for empty input
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    return decryptQuietly(encryptedText);
  } catch (err) {
    console.error('Decryption failed:', err.message);
    throw err;
  }
}

/** Like decrypt(), but returns { ok, value } and logs nothing (used by the rotation script). */
function tryDecrypt(encryptedText) {
  try {
    return { ok: true, value: decryptQuietly(encryptedText) };
  } catch {
    return { ok: false, value: null };
  }
}

module.exports = {
  encrypt,
  decrypt,
  tryDecrypt,
  keyVersionOf,
  currentKeyVersion,
  previousKeyVersion,
  currentSecret,
  previousSecret,
};
