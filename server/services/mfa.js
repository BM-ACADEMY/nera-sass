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

// WhatsApp codes need an approved Meta template (whatsappOtp.js).
const whatsappOtpEnabled = () => String(process.env.WHATSAPP_OTP_TEMPLATE_APPROVED || '').toLowerCase() === 'true';

const METHOD_ORDER = ['totp', 'email', 'whatsapp'];

// Production switch for the newer two-step methods (email code, WhatsApp
// code). Only the exact value 'true' lets people turn them ON; when off, only
// the authenticator app can be set up. People who already have email or
// WhatsApp codes keep signing in with them and can still turn them off.
const extraMethodsEnabled = () => process.env.MFA_EXTRA_METHODS_ENABLED === 'true';
const EXTRA_METHOD_OFF = Object.freeze({
  error: 'This two-step method is not available yet. Use an authenticator app instead.',
  code: 'MFA_METHOD_DISABLED',
});

// whatsappOtp.js registers the full check (flag + platform number configured).
let whatsappUsable = whatsappOtpEnabled;
const setWhatsappAvailability = (fn) => { whatsappUsable = fn; };

// Second-step methods a user can use now: 'email' (one-time code by mail),
// 'totp' (authenticator app; stored as mfa_enabled for older accounts) and
// 'whatsapp' (one-time code by WhatsApp, only while it is available: template
// flag on and the platform number configured).
function methodsOf(user) {
  const methods = [];
  if (user?.mfa_email_enabled) methods.push('email');
  if (user?.mfa_enabled) methods.push('totp');
  if (user?.mfa_whatsapp_enabled && whatsappUsable()) methods.push('whatsapp');
  return methods;
}

// Every method turned on, usable now or not (turning a method off works even
// while WhatsApp codes are switched off).
function enrolledMethodsOf(user) {
  const methods = [];
  if (user?.mfa_email_enabled) methods.push('email');
  if (user?.mfa_enabled) methods.push('totp');
  if (user?.mfa_whatsapp_enabled) methods.push('whatsapp');
  return methods;
}

// Turned on at all (a WhatsApp method still counts while the flag is off: the
// account keeps two-step verification and the recovery codes still work).
const hasMfa = (user) => Boolean(user?.mfa_email_enabled || user?.mfa_enabled || user?.mfa_whatsapp_enabled);

// A customer can add a method with the password alone, so a method added to an
// account that already had two-step verification is "on hold" for a day: it
// signs in, but its codes cannot confirm sensitive changes (stepUp.js). The
// owner has been emailed and can remove it with an older method meanwhile.
const NEW_METHOD_HOLD_HOURS = 24;
const holdField = (method) => `mfa_${method}_hold_until`;
const onHold = (user, method) => {
  const until = user?.[holdField(method)];
  return Boolean(until && new Date(until) > new Date());
};

// The method offered first at sign-in: the user's choice when it is usable,
// else the authenticator app, else the first usable one (methods on hold last).
function defaultMethodOf(user) {
  const methods = methodsOf(user);
  if (methods.includes(user?.mfa_default_method)) return user.mfa_default_method;
  const ordered = METHOD_ORDER.filter((m) => methods.includes(m));
  return ordered.find((m) => !onHold(user, m)) || ordered[0] || null;
}

module.exports = {
  generateSecret, totp, verifyTotp, otpauthUrl, generateRecoveryCodes, hashRecoveryCode, base32Encode, base32Decode,
  methodsOf, enrolledMethodsOf, hasMfa, defaultMethodOf, whatsappOtpEnabled, setWhatsappAvailability, METHOD_ORDER,
  extraMethodsEnabled, EXTRA_METHOD_OFF, NEW_METHOD_HOLD_HOURS, holdField, onHold,
};
