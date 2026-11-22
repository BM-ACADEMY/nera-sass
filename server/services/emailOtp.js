/**
 * One-time sign-in codes by email (second-step method next to the
 * authenticator app and WhatsApp). The rules (hash only, 10-minute expiry,
 * five tries, single use, resend cooldown, purpose separation) live in
 * otpStore.js and are the same for every channel.
 */
const notify = require('./notify');
const { createOtpStore, MAX_ATTEMPTS } = require('./otpStore');

class EmailOtpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const maskEmail = (email) => String(email || '').replace(/^(.)(.*)(.@.*)$/, (m, a, mid, b) => `${a}${'*'.repeat(Math.min(mid.length, 6))}${b}`);

const store = createOtpStore({
  prefix: 'mfa_email_code',
  scope: 'email-otp',
  ErrorClass: EmailOtpError,
  describeTarget: (user) => maskEmail(user.email),
  deliver: ({ user, code, purpose, minutes }) => notify.signInCodeEmail({ to: user.email, name: user.name, code, minutes, purpose }),
});

const sendCode = (user, purpose) => store.sendCode(user, purpose);
const verifyCode = (user, code, purpose) => store.verifyCode(user, code, purpose);

module.exports = { sendCode, verifyCode, maskEmail, EmailOtpError, MAX_ATTEMPTS };
