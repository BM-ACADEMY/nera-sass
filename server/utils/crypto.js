const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV length is 12 bytes
const FORMAT_TAG = 'v2';

/**
 * Key versioning
 * --------------
 * New values are written as   v2:<keyId>:<iv>:<authTag>:<ciphertext>   (hex parts).
 * <keyId> is a short public fingerprint of the key that encrypted the value; it
 * cannot be used to recover the key. Values written before versioning have the
 * legacy shape <iv>:<authTag>:<ciphertext> and are tried against every key.
 *
 *   TOKEN_ENCRYPTION_KEY           current key: encrypts, and decrypts
 *   TOKEN_ENCRYPTION_KEY_PREVIOUS  optional: decrypts only (kept during rotation)
 *   ENCRYPTION_KEY                 legacy name for the current key
 */
function currentSecret() {
  return process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || '';
}

function deriveKey(secret) {
  // Hash the secret so we always get a 32-byte key.
  return crypto.createHash('sha256').update(secret).digest();
}

function keyIdOf(key) {
  return crypto.createHash('sha256').update('token-key-id:').update(key).digest('hex').slice(0, 8);
}

function getKeyring() {
  const secret = currentSecret();
  if (!secret) {
    console.error('❌ CRITICAL ERROR: TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY environment variable is not defined.');
    throw new Error('TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY env variable is required for token encryption');
  }
  const current = deriveKey(secret);
  const keys = [{ id: keyIdOf(current), key: current, current: true }];
  const previousSecret = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  if (previousSecret && previousSecret !== secret) {
    const previous = deriveKey(previousSecret);
    keys.push({ id: keyIdOf(previous), key: previous, current: false });
  }
  return keys;
}

/** Version id of the current key (safe to log). */
function currentKeyId() {
  return getKeyring()[0].id;
}

/**
 * Encrypt a text string using AES-256-GCM with the current key.
 * @returns {string|null} v2:<keyId>:<iv>:<authTag>:<ciphertext>, or null for empty input
 */
function encrypt(text) {
  if (!text) return null;
  try {
    const { id, key } = getKeyring()[0];
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${FORMAT_TAG}:${id}:${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (err) {
    console.error('Encryption failed:', err.message);
    throw err;
  }
}

/** Splits a stored value into its parts without decrypting. Null when malformed. */
function parse(encryptedText) {
  if (typeof encryptedText !== 'string') return null;
  const parts = encryptedText.split(':');
  if (parts.length === 5 && parts[0] === FORMAT_TAG) {
    return { keyId: parts[1], iv: parts[2], authTag: parts[3], data: parts[4] };
  }
  if (parts.length === 3) return { keyId: null, iv: parts[0], authTag: parts[1], data: parts[2] };
  return null;
}

function open(key, parsed) {
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(parsed.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(parsed.authTag, 'hex'));
  let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Decrypt with whichever configured key encrypted the value.
 * @returns {string|null}
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parsed = parse(encryptedText);
    if (!parsed) throw new Error('Invalid encrypted text format');
    const keyring = getKeyring();

    // Versioned value: use the key it names. Legacy value: try every key.
    const candidates = parsed.keyId ? keyring.filter((k) => k.id === parsed.keyId) : keyring;
    if (candidates.length === 0) {
      throw new Error(`No configured key matches key version ${parsed.keyId}`);
    }
    for (const candidate of candidates) {
      try {
        return open(candidate.key, parsed);
      } catch {
        // wrong key (GCM auth failed): try the next one
      }
    }
    throw new Error('Unsupported state or unable to authenticate data');
  } catch (err) {
    console.error('Decryption failed:', err.message);
    throw err;
  }
}

/**
 * Where a stored value stands relative to the keys now configured.
 *   'empty'   no value
 *   'current' encrypted with the current key, in the versioned format
 *   'stale'   readable, but legacy-format or written with the previous key
 *   'unknown' not in an encrypted format at all (possibly plain text)
 *   'locked'  encrypted, but no configured key can read it
 */
function inspect(encryptedText) {
  if (!encryptedText) return 'empty';
  const parsed = parse(encryptedText);
  if (!parsed || !/^[0-9a-f]+$/i.test(parsed.iv + parsed.authTag + parsed.data) || parsed.iv.length !== IV_LENGTH * 2) {
    return 'unknown';
  }
  const keyring = getKeyring();
  if (parsed.keyId) {
    const match = keyring.find((k) => k.id === parsed.keyId);
    if (!match) return 'locked';
    try { open(match.key, parsed); } catch { return 'locked'; }
    return match.current ? 'current' : 'stale';
  }
  for (const candidate of keyring) {
    try { open(candidate.key, parsed); return 'stale'; } catch { /* next key */ }
  }
  return 'locked';
}

/**
 * Re-encrypts a stored value with the current key.
 * @returns {{ status: string, value: string }} value is unchanged unless status is 'rotated'
 */
function rotate(encryptedText) {
  const status = inspect(encryptedText);
  if (status !== 'stale') return { status, value: encryptedText };
  const plain = decrypt(encryptedText);
  const value = encrypt(plain);
  if (decrypt(value) !== plain) throw new Error('Re-encrypted value failed verification');
  return { status: 'rotated', value };
}

module.exports = { encrypt, decrypt, inspect, rotate, currentKeyId };
