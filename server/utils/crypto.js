const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // GCM standard IV length is 12 bytes
const KEY_LENGTH = 32; // 256 bits

function getKey() {
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY;
  if (!encryptionKey) {
    console.error('❌ CRITICAL ERROR: TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY environment variable is not defined.');
    throw new Error('TOKEN_ENCRYPTION_KEY or ENCRYPTION_KEY env variable is required for token encryption');
  }
  // Hash the ENCRYPTION_KEY env variable to ensure we always get a 32-byte key
  return crypto.createHash('sha256').update(encryptionKey).digest();
}

/**
 * Encrypt a text string using AES-256-GCM
 * @param {string} text - The plaintext to encrypt
 * @returns {string|null} The encrypted string in the format iv:authTag:encryptedData, or null
 */
function encrypt(text) {
  if (!text) return null;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  } catch (err) {
    console.error('Encryption failed:', err.message);
    throw err;
  }
}

/**
 * Decrypt an encrypted string (format iv:authTag:encryptedData)
 * @param {string} encryptedText - The encrypted text string
 * @returns {string|null} The decrypted plaintext string, or null
 */
function decrypt(encryptedText) {
  if (!encryptedText) return null;
  try {
    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted text format (must have iv, authTag, and ciphertext)');
    }
    
    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];
    
    const key = getKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    throw err;
  }
}

module.exports = { encrypt, decrypt };
