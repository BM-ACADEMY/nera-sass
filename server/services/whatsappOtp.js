/**
 * Two-step verification codes by WhatsApp. The code is sent from the
 * platform's own number (the admin "WhatsApp Chat" number, platformInbox.js)
 * with a Meta AUTHENTICATION template, to the number the user verified.
 * Same rules as email codes (otpStore.js): hash only, bound to the user and the
 * destination number, 10-minute expiry, five tries, single use, resend
 * cooldown, purpose separation. Codes are never logged or stored in the inbox.
 *
 * Sign-in codes are also limited to LOGIN_DAILY_LIMIT (3) messages per user per
 * India-time day, counted in the database so parallel requests cannot pass it.
 * Setup and confirmation codes (signed-in use) are not part of that count.
 *
 * The method is offered only when WHATSAPP_OTP_TEMPLATE_APPROVED=true (set it
 * after Meta approved TEMPLATE_DEFINITION below for the platform WABA) and the
 * platform number is configured.
 */
const { Users } = require('../models');
const { runAsSystem } = require('./tenantContext');
const platformInbox = require('./platformInbox');
const mfa = require('./mfa');
const { createOtpStore, MAX_ATTEMPTS } = require('./otpStore');

const sys = (fn) => runAsSystem(fn, 'whatsapp-otp');
// Fixed: the Meta template's footer tells the user the code lasts 10 minutes.
const CODE_MINUTES = 10;
const LOGIN_DAILY_LIMIT = 3;
const DAILY_LIMIT_MESSAGE = `You have used all ${LOGIN_DAILY_LIMIT} WhatsApp sign-in codes for today. Use another method or a recovery code. New WhatsApp codes are available after midnight (India time).`;

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

// mfa.methodsOf offers WhatsApp only while it can really be used.
mfa.setWhatsappAvailability(available);

// Country codes WhatsApp codes may be sent to (WHATSAPP_OTP_COUNTRY_CODES,
// comma-separated, default India only), so the method cannot be used to pump
// paid messages to numbers anywhere.
const allowedCountryCodes = () => String(process.env.WHATSAPP_OTP_COUNTRY_CODES || '91').split(',').map((c) => c.replace(/\D/g, '')).filter(Boolean);
const setupNumbersPerDay = () => Number(process.env.WHATSAPP_SETUP_NUMBERS_PER_DAY || 5);

// A WhatsApp number as Meta wants it: digits with the country code. A plain
// 10-digit Indian mobile number gets 91 in front. Null when invalid or the
// country is not allowed.
function normalizeNumber(value) {
  let d = String(value || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10 && /^[6-9]/.test(d)) d = `91${d}`;
  if (d.length < 11 || d.length > 15) return null;
  return allowedCountryCodes().some((c) => d.startsWith(c) && d.length - c.length >= 8) ? d : null;
}

// Platform-wide cap on WhatsApp code sends per hour (WHATSAPP_OTP_HOURLY_CAP,
// default 200), per server process. A slot is taken before the code is
// stored and given back when nothing was sent.
// Also at most WHATSAPP_OTP_PER_TARGET_HOURLY (6) sends per account and per
// number in an hour, so a few accounts cannot use up the platform cap. Setup
// sends (to a number not verified yet) count in their own per-number bucket,
// so other accounts trying a verified number cannot block its login codes.
let sendTimes = [];
let targetTimes = new Map(); // 'acct:<id>' | 'num:<digits>' | 'num:setup:<digits>' -> [ms]
const HOUR = 60 * 60 * 1000;
const hourlyCap = () => Number(process.env.WHATSAPP_OTP_HOURLY_CAP || 200);
const perTargetCap = () => Number(process.env.WHATSAPP_OTP_PER_TARGET_HOURLY || 6);
const recentFor = (key, now) => (targetTimes.get(key) || []).filter((t) => t > now - HOUR);
function pruneTargets(now) {
  for (const [k, list] of targetTimes) {
    const recent = list.filter((t) => t > now - HOUR);
    if (recent.length) targetTimes.set(k, recent);
    else targetTimes.delete(k);
  }
}
function takeSendSlot(userId, to, purpose) {
  const now = Date.now();
  sendTimes = sendTimes.filter((t) => t > now - HOUR);
  pruneTargets(now);
  if (sendTimes.length >= hourlyCap()) {
    throw new WhatsappOtpError(429, 'WhatsApp codes are busy right now. Use another method or try again later.', 'WHATSAPP_BUSY');
  }
  const keys = [`acct:${userId}`, purpose === 'setup' ? `num:setup:${to}` : `num:${to}`];
  if (keys.some((k) => recentFor(k, now).length >= perTargetCap())) {
    throw new WhatsappOtpError(429, 'Too many WhatsApp codes in the last hour. Try again later or use another method.', 'WHATSAPP_TOO_MANY');
  }
  sendTimes.push(now);
  for (const k of keys) targetTimes.set(k, [...recentFor(k, now), now]);
  return { at: now, keys };
}
function giveBackSlot(slot) {
  const i = sendTimes.indexOf(slot.at);
  if (i >= 0) sendTimes.splice(i, 1);
  for (const k of slot.keys) {
    const list = targetTimes.get(k) || [];
    const j = list.indexOf(slot.at);
    if (j >= 0) list.splice(j, 1);
  }
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

// India time is UTC+05:30 all year.
const indiaDay = (at = new Date()) => new Date(at.getTime() + 330 * 60000).toISOString().slice(0, 10);

/**
 * Takes one of today's sign-in sends. The count moves with one conditional
 * $inc below the limit, so parallel requests cannot take more than the limit.
 * Returns { day, used } or null when today's sends are used up.
 */
async function takeLoginSend(userId, now = new Date()) {
  const day = indiaDay(now);
  // Starts the count again on a new day (only forward, so only once).
  await sys(() => Users.updateOne(
    { id: userId, $or: [{ mfa_wa_login_day: null }, { mfa_wa_login_day: { $lt: day } }] },
    { $set: { mfa_wa_login_day: day, mfa_wa_login_sends: 0 } },
  ));
  const taken = await sys(() => Users.findOneAndUpdate(
    { id: userId, mfa_wa_login_day: day, mfa_wa_login_sends: { $lt: LOGIN_DAILY_LIMIT } },
    { $inc: { mfa_wa_login_sends: 1 } },
    { new: true, projection: { _id: 0, mfa_wa_login_sends: 1 } },
  ).lean());
  return taken ? { day, used: taken.mfa_wa_login_sends } : null;
}

// Gives a taken send back when no message went out.
const giveBackLoginSend = (userId, day) => sys(() => Users.updateOne(
  { id: userId, mfa_wa_login_day: day, mfa_wa_login_sends: { $gt: 0 } },
  { $inc: { mfa_wa_login_sends: -1 } },
));

/**
 * What the sign-in screen shows: today's sends left and how many seconds the
 * last sign-in code is still valid (0 when there is none).
 */
async function loginStatus(userId, now = new Date()) {
  const user = await sys(() => Users.findOne({ id: userId }, { _id: 0 }).lean());
  const used = user?.mfa_wa_login_day === indiaDay(now) ? Number(user.mfa_wa_login_sends || 0) : 0;
  const live = Boolean(user?.mfa_wa_code_hash && user.mfa_wa_code_purpose === 'login' && Number(user.mfa_wa_code_attempts || 0) < MAX_ATTEMPTS);
  const left = live ? Math.ceil((new Date(user.mfa_wa_code_expires_at).getTime() - now.getTime()) / 1000) : 0;
  return { daily_limit: LOGIN_DAILY_LIMIT, sends_left: Math.max(0, LOGIN_DAILY_LIMIT - used), expires_in: Math.max(0, left || 0) };
}

const destination = (user, purpose) => (purpose === 'setup' ? user.mfa_whatsapp_pending_number : user.mfa_whatsapp_number) || null;

const store = createOtpStore({
  prefix: 'mfa_wa_code',
  scope: 'whatsapp-otp',
  ErrorClass: WhatsappOtpError,
  ttlMinutes: CODE_MINUTES,
  describeTarget: (user, to) => maskNumber(to),
  deliver: async ({ code, to }) => {
    try {
      await platformInbox.sendAuthCode({ to, payload: authTemplatePayload(code) });
    } catch (error) {
      // The reason comes from Meta and never contains the code.
      console.error('[whatsapp-otp] Code not sent:', error.message);
      const failed = new WhatsappOtpError(502, 'The WhatsApp code could not be sent. Try again in a minute or use another method.', 'WHATSAPP_SEND_FAILED');
      // true only when Meta answered with a refusal, so no message went out.
      failed.refused = Boolean(error.refused);
      throw failed;
    }
  },
});

async function sendCode(user, purpose) {
  if (!available()) throw new WhatsappOtpError(400, 'WhatsApp codes are not available yet', 'WHATSAPP_NOT_AVAILABLE');
  const to = destination(user, purpose);
  if (!to) throw new WhatsappOtpError(400, 'Add your WhatsApp number first', 'WHATSAPP_NUMBER_MISSING');
  // Every sign-in send (the first one and resends) passes here.
  let daily = null;
  if (purpose === 'login') {
    daily = await takeLoginSend(user.id);
    if (!daily) throw new WhatsappOtpError(429, DAILY_LIMIT_MESSAGE, 'WHATSAPP_DAILY_LIMIT');
  }
  let slot = null;
  try {
    slot = takeSendSlot(user.id, to, purpose);
    const sent = await store.sendCode(user, purpose, { to });
    return daily ? { ...sent, daily_limit: LOGIN_DAILY_LIMIT, sends_left: LOGIN_DAILY_LIMIT - daily.used } : sent;
  } catch (error) {
    // Refused before any send (hourly cap, resend wait, code lock).
    const notAttempted = !slot || error.code === 'OTP_RESEND_WAIT' || error.code === 'MFA_CODE_LOCKED';
    if (slot && notAttempted) giveBackSlot(slot);
    // Today's send is also given back when Meta refused the message. An unclear
    // failure (timeout) may have been delivered, so it stays counted.
    if (daily && (notAttempted || error.refused)) await giveBackLoginSend(user.id, daily.day);
    throw error;
  }
}

async function verifyCode(user, code, purpose) {
  const to = destination(user, purpose);
  if (!to) return false;
  return store.verifyCode(user, code, purpose, { to });
}

module.exports = {
  sendCode, verifyCode, loginStatus, takeLoginSend, indiaDay, LOGIN_DAILY_LIMIT, enabled, available, normalizeNumber, maskNumber, authTemplatePayload, allowedCountryCodes, setupNumbersPerDay,
  resetSendCapForTests: () => { sendTimes = []; targetTimes = new Map(); },
  sendBucketsForTests: () => [...targetTimes.keys()],
  templateName, templateLanguage, TEMPLATE_DEFINITION, WhatsappOtpError, clearFields: store.clearFields,
};
