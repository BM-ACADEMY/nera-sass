/**
 * Two-step verification codes by WhatsApp. The code is sent from the
 * platform's own number (the admin "WhatsApp Chat" number, platformInbox.js)
 * with a Meta AUTHENTICATION template, to the number the user verified.
 * Same rules as email codes (otpStore.js): hash only, bound to the user and the
 * destination number, 10-minute expiry, five tries, single use, resend
 * cooldown, purpose separation. Codes are never logged or stored in the inbox.
 *
 * The method is offered only when WHATSAPP_OTP_TEMPLATE_APPROVED=true (set it
 * after Meta approved TEMPLATE_DEFINITION below for the platform WABA) and the
 * platform number is configured.
 */
const platformInbox = require('./platformInbox');
const { createOtpStore } = require('./otpStore');

class WhatsappOtpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const templateName = () => String(process.env.WHATSAPP_OTP_TEMPLATE_NAME || 'getnera_login_code').trim();
const templateLanguage = () => String(process.env.WHATSAPP_OTP_TEMPLATE_LANGUAGE || 'en').trim();

/**
 * The template to submit to Meta (WhatsApp Manager → Message templates, on the
 * platform number's WABA, or POST /{waba-id}/message_templates). AUTHENTICATION
 * templates have fixed text: "{{1}} is your verification code." plus the
 * security recommendation and the expiry line; only these switches are chosen.
 */
const TEMPLATE_DEFINITION = Object.freeze({
  name: 'getnera_login_code',
  language: 'en',
  category: 'AUTHENTICATION',
  components: [
    { type: 'BODY', add_security_recommendation: true },
    { type: 'FOOTER', code_expiration_minutes: 10 },
    { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
  ],
});

// Set by staff once Meta approved the template.
const enabled = () => String(process.env.WHATSAPP_OTP_TEMPLATE_APPROVED || '').toLowerCase() === 'true';
const available = () => enabled() && Boolean(platformInbox.platformPhoneId() && platformInbox.platformToken());

// A WhatsApp number as Meta wants it: digits with the country code. A plain
// 10-digit Indian mobile number gets 91 in front.
function normalizeNumber(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : null;
}

const maskNumber = (number) => {
  const d = String(number || '');
  return d ? `+${d.slice(0, d.length - 10)} ******${d.slice(-4)}` : '';
};

// The Meta payload for the AUTHENTICATION template: the code fills the body
// and the copy-code button (Meta's required shape for OTP buttons).
function authTemplatePayload(code) {
  return {
    type: 'template',
    template: {
      name: templateName(),
      language: { code: templateLanguage() },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  };
}

const destination = (user, purpose) => (purpose === 'setup' ? user.mfa_whatsapp_pending_number : user.mfa_whatsapp_number) || null;

const store = createOtpStore({
  prefix: 'mfa_wa_code',
  scope: 'whatsapp-otp',
  ErrorClass: WhatsappOtpError,
  describeTarget: (user, to) => maskNumber(to),
  deliver: async ({ code, to }) => {
    try {
      await platformInbox.sendAuthCode({ to, payload: authTemplatePayload(code) });
    } catch (error) {
      // The reason comes from Meta and never contains the code.
      console.error('[whatsapp-otp] Code not sent:', error.message);
      throw new WhatsappOtpError(502, 'The WhatsApp code could not be sent. Try again in a minute or use another method.', 'WHATSAPP_SEND_FAILED');
    }
  },
});

async function sendCode(user, purpose) {
  if (!available()) throw new WhatsappOtpError(400, 'WhatsApp codes are not available yet', 'WHATSAPP_NOT_AVAILABLE');
  const to = destination(user, purpose);
  if (!to) throw new WhatsappOtpError(400, 'Add your WhatsApp number first', 'WHATSAPP_NUMBER_MISSING');
  return store.sendCode(user, purpose, { to });
}

async function verifyCode(user, code, purpose) {
  const to = destination(user, purpose);
  if (!to) return false;
  return store.verifyCode(user, code, purpose, { to });
}

module.exports = {
  sendCode, verifyCode, enabled, available, normalizeNumber, maskNumber, authTemplatePayload,
  templateName, templateLanguage, TEMPLATE_DEFINITION, WhatsappOtpError, clearFields: store.clearFields,
};
