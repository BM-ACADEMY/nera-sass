/**
 * Authenticator-app MFA (plan A5, decision 14: TOTP with recovery codes).
 * RFC 6238 TOTP, 30-second steps, 6 digits, SHA-1 (what authenticator apps use).
 */
const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    value = (value << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function generateSecret() {
  return base32Encode(crypto.randomBytes(20));
}

function totp(secret, timeMs = Date.now(), step = 30, digits = 6) {
  const counter = Math.floor(timeMs / 1000 / step);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(buffer).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits).toString();
  return code.padStart(digits, '0');
}

// Accepts the current code and one step either side (clock drift).
function verifyTotp(secret, code, timeMs = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean) || !secret) return false;
  for (const drift of [-1, 0, 1]) {
    const expected = totp(secret, timeMs + drift * 30000);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

function otpauthUrl(secret, accountName, issuer) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

const hashRecoveryCode = (code) => crypto.createHash('sha256').update(String(code).replace(/[\s-]/g, '').toUpperCase()).digest('hex');

// Ten single-use recovery codes, shown once; only hashes are stored.
function generateRecoveryCodes(count = 10) {
  const codes = Array.from({ length: count }, () => {
    const raw = base32Encode(crypto.randomBytes(6)).slice(0, 10);
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// Second-step methods a user has turned on: 'email' (one-time code by mail)
// and 'totp' (authenticator app; stored as mfa_enabled for older accounts).
function methodsOf(user) {
  const methods = [];
  if (user?.mfa_email_enabled) methods.push('email');
  if (user?.mfa_enabled) methods.push('totp');
  return methods;
}

const hasMfa = (user) => methodsOf(user).length > 0;

module.exports = { generateSecret, totp, verifyTotp, otpauthUrl, generateRecoveryCodes, hashRecoveryCode, base32Encode, base32Decode, methodsOf, hasMfa };
