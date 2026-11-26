// Plain-language error messages for customers.
//
// Every failed request becomes one short sentence that says what happened and
// what to do. Customers never see developer text: stack traces, "Request
// failed with status code 500", database or Meta messages, JSON, codes.
//
// Order of choice for a failed API call:
//   1. a Meta (WhatsApp) error number we know          -> META
//   2. a server `code` we know (unless CONTEXTUAL)      -> CODES
//   3. the server's own sentence, if it is not technical
//   4. a sentence for the HTTP status                   -> STATUS
//
// Translations: add a language next to `en` (for example `ta`) with any subset
// of the keys; missing keys fall back to English. Call setErrorLanguage('ta').
// This file has no browser or Vite dependencies so it can be unit tested with
// `node --test`.

const en = {
  generic: 'Something went wrong. Please try again.',
  server: 'Something went wrong on our side. Please try again in a minute.',
  network: 'We could not reach Getnera. Please check your internet connection and try again.',
  offline: 'You are offline. Please check your internet connection and try again.',
  timeout: 'This is taking longer than usual. Please try again in a minute.',
  cancelled: 'The request was cancelled.',
  invalidResponse: 'We received an unexpected reply. Please refresh the page and try again.',
  reference: 'Reference',

  status: {
    400: 'Please check the details you entered and try again.',
    401: 'Please sign in again.',
    402: 'This needs an active plan or wallet balance. Please check Billing.',
    403: "You don't have permission to do this.",
    404: 'We could not find what you were looking for. It may have been removed.',
    405: 'This action is not available.',
    408: 'This is taking longer than usual. Please try again in a minute.',
    409: 'This clashes with something that already exists. Please refresh and try again.',
    410: 'This is no longer available.',
    413: 'This file is too large. Please choose a smaller file.',
    415: 'This file type is not supported.',
    422: 'Please check the details you entered and try again.',
    423: 'This is locked for now. Please try again later.',
    429: 'Too many tries. Please wait a moment and try again.',
  },

  // Codes the Getnera server sends in `{ error, code }`.
  codes: {
    // Sign-in and access
    ACCOUNT_LOCKED: 'Too many failed attempts. Please try again later or reset your password.',
    ACCOUNT_DEACTIVATED: 'This account has been turned off. Please contact your workspace admin.',
    SESSION_INVALID: 'Your session has ended. Please sign in again.',
    SESSION_REVOKED: 'Your session has ended. Please sign in again.',
    MFA_REQUIRED: 'Please sign in again and enter your two-step code.',
    INVALID_MFA_CODE: 'That code is not correct. Please check it and try again.',
    MFA_LAST_METHOD: 'Admins must keep one two-step method. Turn on another method first.',
    OTP_RESEND_WAIT: 'Please wait a few seconds before asking for a new code.',
    PASSWORD_REQUIRED: 'Your password is not correct. Please try again.',
    PERMISSION_DENIED: "You don't have permission to do this.",
    SCOPE_DENIED: 'Access was not fully granted. Please connect again and allow all permissions.',
    NO_WORKSPACE: 'Your account is not part of a workspace yet. Please contact your admin.',
    TENANT_REQUIRED: 'Please choose a workspace and try again.',
    TENANT_SUSPENDED: 'This workspace is suspended. Please contact Getnera support.',
    TENANT_RESTRICTED: 'Your plan has ended, so this workspace is read-only. Renew your plan in Billing to continue.',
    STAFF_ONLY: "You don't have permission to do this.",
    STAFF_NOT_ALLOWED: 'Platform staff accounts cannot open customer workspaces. Please use the admin panel.',
    SERVICE_ONLY: "You don't have permission to do this.",
    CROSS_TENANT_ACCESS_DENIED: "You don't have permission to do this.",
    INVITATION_REVOKED: 'This invitation is no longer valid. Please ask your admin for a new one.',
    TOKEN_EXPIRED: 'Your connection has expired. Please reconnect and try again.',
    NOT_CONNECTED: 'This account is not connected yet. Please connect it first.',
    IDENTITY_MISMATCH: 'This does not match your account. Please check and try again.',

    // Plan, wallet and billing
    NO_ACTIVE_PLAN: 'Your workspace does not have an active plan. Choose a plan in Billing to continue.',
    WALLET_EMPTY: 'Your wallet balance is too low. Please top up your wallet in Billing.',
    INSUFFICIENT_FUNDS: 'Your wallet balance is too low. Please top up your wallet in Billing.',
    AI_ALLOWANCE_USED: 'You have used all AI replies in your plan. Top up your wallet or upgrade your plan to continue.',
    QUOTA_EXCEEDED: 'You have reached the limit of your plan. Please upgrade your plan to continue.',
    EXTRAS_FAILED: 'We could not add the extras to your plan. You were not charged. Please try again.',
    PAYMENTS_NOT_CONFIGURED: 'Online payments are not available right now. Please try again later.',
    GATEWAY_ERROR: 'The payment provider did not accept the request. Please try again.',
    INVALID_AMOUNT: 'Please enter an amount of at least ₹1.',

    // WhatsApp connection and number
    WHATSAPP_NOT_CONNECTED: 'WhatsApp is not connected yet. Please connect WhatsApp in Settings first.',
    WHATSAPP_NOT_VERIFIED: 'Your WhatsApp number is not verified yet. Please finish verifying it in Settings.',
    WHATSAPP_CREDENTIAL_MISSING: 'WhatsApp is not fully connected. Please reconnect WhatsApp in Settings.',
    WHATSAPP_ACCOUNT_ID_MISSING: 'WhatsApp is not fully connected. Please reconnect WhatsApp in Settings.',
    META_CREDENTIAL_NOT_CONFIGURED: 'WhatsApp setup is not finished on our side yet. Please contact Getnera support.',
    META_APP_ID_MISSING: 'WhatsApp setup is not finished on our side yet. Please contact Getnera support.',
    SECURE_SIGNUP_PENDING: 'WhatsApp sign-up is not available yet. Please contact Getnera support to connect your number.',
    REGISTRATION_DISABLED: 'Number registration is turned off. Please contact Getnera support.',
    PHONE_ASSIGNED: 'This number is already used by another workspace. Remove it there first.',
    PHONE_NUMBER_IN_USE: 'This number is already used by another workspace.',
    PLATFORM_NUMBER: 'This number belongs to Getnera and cannot be used here.',
    BRAND_HAS_NUMBER: 'This workspace already uses another WhatsApp number. Remove that number first.',
    BRAND_MANAGED_BY_PLATFORM: 'This is managed by Getnera. Please contact support to change it.',
    WABA_HAS_LINKED_PHONE: 'A number in this WhatsApp account is still linked. Unlink it first.',
    PROFILE_NOT_EDITABLE: 'This WhatsApp profile cannot be changed right now.',
    QUALITY_STILL_LOW: 'Your number quality is still low. Please wait for it to improve before sending more marketing messages.',
    NUMBER_PAUSED: 'Marketing messages are paused on this number because quality dropped. Please try again later.',

    // Sending messages
    CONSENT_REQUIRED: 'This contact has not agreed to get marketing messages, so we did not send it.',
    CONTACT_OPTED_OUT: 'This contact asked not to get marketing messages, so we did not send it.',
    CONTACT_ERASED: 'This contact asked for their data to be deleted, so messages cannot be sent to them.',
    WINDOW_CLOSED: 'More than 24 hours have passed since this customer last wrote. Send an approved template message instead.',
    SEND_BLOCKED: 'Sending is paused for this workspace. Please check Billing or contact Getnera support.',
    TENANT_SENDING_PAUSED: 'Sending is paused for this workspace. Please contact Getnera support.',
    RATE_LIMITED: 'You are sending too fast. Please wait a moment and try again.',
    DAILY_CAP_REACHED: 'You have reached today’s sending limit for this number. Sending continues tomorrow.',
    WHATSAPP_SEND_FAILED: 'WhatsApp could not send this message. Please try again in a few minutes.',
    SEND_FAILED: 'This message could not be sent. Please try again.',
    INVALID_PHONE: 'This phone number does not look right. Please check it, including the country code.',
    INVALID_RECIPIENT: 'This phone number does not look right. Please check it, including the country code.',
    EMPTY_CONTENT: 'Please type a message first.',
    MEDIA_REQUIRED: 'Please attach a file to send.',
    PREVIEW_REQUIRED: 'Please check the preview before sending.',
    CAMPAIGN_NOT_READY: 'This campaign is not ready to send yet. Please check its settings.',
    CONFIRMATION_REQUIRED: 'Please confirm before continuing.',

    // Templates and files
    META_TEMPLATE_NOT_FOUND: 'We could not find this template on WhatsApp. Please refresh your templates.',
    META_TEMPLATE_AND_WABA_MISSING: 'We could not find this template on WhatsApp. Please refresh your templates.',
    TEMPLATE_NOT_FOUND: 'We could not find this template. Please refresh your templates.',
    TEMPLATE_EXISTS: 'A template with this name already exists in this language. Please choose another name.',
    TEMPLATE_VALUE_MISSING: 'Please fill in every value in the template.',
    TEMPLATE_VALUE_TOO_LONG: 'One of the template values is too long. Please shorten it.',
    TEMPLATE_SYNC_FAILED: 'We could not refresh your templates from WhatsApp. Please try again in a few minutes.',
    TEMPLATE_UPDATE_FAILED: 'We could not update this template. Please try again in a few minutes.',
    META_ERROR: 'WhatsApp did not accept this request. Please check the details and try again.',
    FILE_TOO_LARGE: 'This file is too large. Please choose a smaller file.',
    LIMIT_FILE_SIZE: 'This file is too large. Please choose a smaller file.',
    BAD_FILE: 'This file type is not supported here.',
    MEDIA_TYPE_INVALID: 'This file type cannot be sent on WhatsApp.',
    MEDIA_NOT_ALLOWED: 'This file type cannot be sent on WhatsApp.',
    MEDIA_SIZE_INVALID: 'This file is too large to send on WhatsApp.',
    MEDIA_REJECTED: 'WhatsApp did not accept this file. Please try a different file.',
    MEDIA_EXPIRED: 'This file has expired. Please upload it again.',
    MEDIA_NOT_FOUND: 'We could not find this file. Please upload it again.',

    // Integrations and setup
    CALENDAR_NOT_CONNECTED: 'Connect your Google Calendar first.',
    AI_BRAIN_NOT_CONFIGURED: 'AI replies are not switched on for your workspace yet. Please contact Getnera support.',
    INVALID_WEBSITE: 'Please enter a valid website, for example https://example.com',
    INVALID_WEBHOOK_URL: 'Please enter a valid web address that starts with https://',
    BLOCKED_ADDRESS: 'This web address cannot be used. Please use a public https:// address.',
    OPT_IN_AT_SIGNUP: 'WhatsApp alerts can only be turned on when the workspace is created.',
    ERASURE_INCOMPLETE: 'Some files could not be removed yet. Sending is already stopped. Please try again in a few minutes.',
    N8N_NOT_CONFIGURED: 'Automations are not available right now. Please try again later.',
    N8N_UNAVAILABLE: 'Automations are not available right now. Please try again in a few minutes.',
    PLATFORM_MAINTENANCE: 'Getnera is being updated. Please try again in a few minutes.',
  },

  // Meta (WhatsApp Cloud API) error numbers.
  meta: {
    4: 'WhatsApp is receiving too many requests right now. Please try again in a few minutes.',
    10: 'WhatsApp permission is missing. Please reconnect WhatsApp in Settings.',
    100: 'WhatsApp did not accept some of the details. Please check the message and try again.',
    190: 'Your WhatsApp connection has expired. Please reconnect WhatsApp in Settings.',
    200: 'WhatsApp permission is missing. Please reconnect WhatsApp in Settings.',
    368: 'WhatsApp has temporarily blocked this number for a policy issue. Please check WhatsApp Manager.',
    470: 'More than 24 hours have passed since this customer last wrote. Send an approved template message instead.',
    80007: 'WhatsApp is receiving too many requests right now. Please try again in a few minutes.',
    130429: 'You are sending too fast for WhatsApp. Please wait a minute and try again.',
    131000: 'WhatsApp could not send this message right now. Please try again in a few minutes.',
    131005: 'WhatsApp permission is missing. Please reconnect WhatsApp in Settings.',
    131008: 'Some required details are missing from this message. Please check it and try again.',
    131009: 'One of the values in this message is not valid. Please check it and try again.',
    131016: 'WhatsApp is having a problem right now. Please try again in a few minutes.',
    131021: 'You cannot send a message to your own business number.',
    131026: 'This message could not be delivered. The number may not be on WhatsApp, or the person needs to update WhatsApp.',
    131031: 'Your WhatsApp account is locked or restricted. Please check WhatsApp Manager.',
    131042: 'There is a payment problem on your WhatsApp account. Please check the payment method in WhatsApp Manager.',
    131045: 'This WhatsApp number is not fully registered yet. Please finish connecting your number in Settings.',
    131047: 'More than 24 hours have passed since this customer last wrote. Send an approved template message instead.',
    131048: 'WhatsApp limited sending from this number because of spam reports. Please wait and send fewer messages.',
    131049: 'WhatsApp held back this marketing message to protect the customer experience. Please try again later or with a different template.',
    131051: 'This type of message is not supported on WhatsApp.',
    131052: 'The file in this message could not be downloaded. Please try a different file.',
    131053: 'The file could not be uploaded to WhatsApp. Please try a different file.',
    131056: 'Too many messages to this same number in a short time. Please wait a moment and try again.',
    132000: 'The number of values does not match the template. Please fill in every value in the template.',
    132001: 'This template does not exist in this language or is not approved yet.',
    132005: 'The template text is too long after filling in the values. Please shorten them.',
    132007: 'This template breaks a WhatsApp policy. Please edit the template.',
    132012: 'One of the template values is in the wrong format. Please check the values.',
    132015: 'This template is paused by WhatsApp because of low quality. Please use another template.',
    132016: 'This template has been turned off by WhatsApp. Please use another template.',
    133010: 'This WhatsApp number is not registered yet. Please finish connecting your number in Settings.',
  },
};

const MESSAGES = { en };
let language = 'en';

export function setErrorLanguage(lang) {
  language = MESSAGES[lang] ? lang : 'en';
}

export function addErrorLanguage(lang, messages) {
  MESSAGES[lang] = messages;
}

function text(path) {
  const pick = (table) => path.reduce((node, key) => (node == null ? undefined : node[key]), table);
  return pick(MESSAGES[language]) ?? pick(en);
}

// Codes whose server sentence carries useful detail ("Fill in Name", "the file
// is too large (max 5 MB)"): the server sentence is shown when it is plain
// language, and the sentence in CODES only when it is not.
const CONTEXTUAL_CODES = new Set([
  'TEMPLATE_VALUE_MISSING', 'TEMPLATE_VALUE_TOO_LONG', 'TEMPLATE_EXISTS', 'BAD_FILE', 'FILE_TOO_LARGE',
  'CAMPAIGN_NOT_READY', 'INSUFFICIENT_FUNDS', 'AI_ALLOWANCE_USED', 'OTP_RESEND_WAIT', 'RATE_LIMITED',
  'DAILY_CAP_REACHED', 'PHONE_ASSIGNED', 'SEND_FAILED', 'WHATSAPP_SEND_FAILED', 'META_ERROR',
  'NUMBER_PAUSED', 'MEDIA_TYPE_INVALID', 'ERASURE_INCOMPLETE', 'GATEWAY_ERROR', 'MFA_LAST_METHOD',
]);

// Text only a developer could read.
const TECHNICAL_PATTERNS = [
  /E11000|duplicate key/i,
  /Cast to \w+ failed|CastError|ValidationError|validation failed/i,
  /MongoServerError|MongoNetworkError|MongooseError|BSON|ObjectId/i,
  /Cannot (read|set) propert(y|ies) of/i,
  /is not (a function|defined|iterable)/i,
  /\bundefined\b|\bnull\b|NaN/,
  /TypeError|ReferenceError|SyntaxError|RangeError/,
  /Unexpected token|JSON\.parse|in JSON at position|is not valid JSON/i,
  /ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up/i,
  /Request failed with status code|timeout of \d+ms|Network Error|Failed to fetch|NetworkError|Load failed/i,
  /HTTP error|status:? ?\d{3}\b|\b[45]\d\d\b (error|Internal|Bad|Not Found)/i,
  /\(#\d+\)|OAuthException|GraphMethodException|fbtrace_id|Meta error \d+/i,
  /\bat \S+ \(.*:\d+:\d+\)|\n\s+at /,
  /^\s*[[{<]/,
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/,
  /jwt|jsonwebtoken|invalid signature/i,
  /\/(srv|home|var|usr|tmp)\/|[A-Z]:\\|node_modules/,
  /\[object Object\]/,
  /^(API Error|Server error|Internal Server Error|Bad Request|Not Found|Forbidden|Unauthorized)$/i,
];

export function looksTechnical(value) {
  if (value == null) return false;
  if (typeof value !== 'string') return true;
  const s = value.trim();
  if (!s) return false;
  if (s.length > 300) return true;
  return TECHNICAL_PATTERNS.some((re) => re.test(s));
}

// The Meta error number inside a body or raw text, if any.
export function metaCodeOf(data, raw) {
  const numeric = (v) => (v != null && /^\d{1,6}$/.test(String(v)) ? Number(v) : null);
  const fromData = data && typeof data === 'object'
    ? numeric(data.meta_code) ?? numeric(data.error_code) ?? numeric(data.error?.code) ?? numeric(data.meta_error?.code)
    : null;
  if (fromData) return fromData;
  const s = typeof raw === 'string' ? raw : '';
  const m = s.match(/\(#(\d{1,6})\)|Meta error (\d{1,6})|"code"\s*:\s*(\d{1,6})/i);
  return m ? Number(m[1] || m[2] || m[3]) : null;
}

// One of the general sentences: 'network', 'offline', 'timeout', 'server', 'generic'...
export const errorText = (key) => text([key]);

const withRef = (message, ref) => (ref ? `${message} (${text(['reference'])}: ${ref})` : message);

/**
 * The customer sentence for a failed request.
 * @param {{ status?: number, code?: string, data?: object, message?: string }} info
 *   status: HTTP status; data: the parsed JSON body; message: raw text if no body.
 */
export function friendlyMessage({ status, code, data, message } = {}) {
  const body = data && typeof data === 'object' ? data : {};
  const errCode = typeof (code ?? body.code) === 'string' ? (code ?? body.code) : null;
  const serverText = typeof body.error === 'string' ? body.error
    : typeof body.message === 'string' ? body.message
      : typeof message === 'string' ? message : null;
  const ref = typeof body.ref === 'string' ? body.ref : null;

  const metaCode = metaCodeOf(body, serverText);
  const metaText = metaCode != null ? text(['meta', metaCode]) : undefined;
  if (metaText) return metaText;

  const codeText = errCode ? text(['codes', errCode]) : undefined;
  const plainServer = serverText && !looksTechnical(serverText) ? serverText.trim() : null;
  if (codeText && !(CONTEXTUAL_CODES.has(errCode) && plainServer)) return codeText;

  if (status >= 500) {
    // The server already sends a plain sentence (with a reference) for 5xx.
    return withRef(plainServer || text(['server']), ref);
  }
  if (plainServer) return plainServer;
  if (status && text(['status', status])) return text(['status', status]);
  if (status >= 400) return text(['status', 400]);
  return text(['generic']);
}

/**
 * Builds the Error thrown by the API layer.
 * err.message / err.userMessage: the customer sentence.
 * err.detail: the raw server text (for the console and staff tools only).
 */
export function toApiError({ status, data, raw, kind } = {}) {
  let userMessage;
  if (kind === 'offline') userMessage = text(['offline']);
  else if (kind === 'network') userMessage = text(['network']);
  else if (kind === 'timeout') userMessage = text(['timeout']);
  else if (kind === 'cancelled') userMessage = text(['cancelled']);
  else if (kind === 'invalid') userMessage = status >= 400 ? friendlyMessage({ status }) : text(['invalidResponse']);
  else userMessage = friendlyMessage({ status, data });

  const err = new Error(userMessage);
  err.userMessage = userMessage;
  err.status = status;
  const body = data && typeof data === 'object' ? data : null;
  err.code = body && typeof body.code === 'string' ? body.code : (kind ? kind.toUpperCase() : undefined);
  err.ref = body?.ref;
  err.detail = body?.detail ?? body?.error ?? body?.message ?? raw;
  if (kind === 'cancelled') err.name = 'AbortError';
  // Callers that read err.response.data.error also get the plain sentence.
  err.response = { status, data: { ...(body || {}), error: userMessage } };
  return err;
}

/**
 * The customer sentence for anything a page caught: an API error, an axios
 * error, a browser network error or a plain Error. Use it where a page builds
 * its own error text: toast.error(friendlyError(err)).
 */
export function friendlyError(err, fallback) {
  if (!err) return fallback || text(['generic']);
  if (typeof err === 'string') return looksTechnical(err) ? (fallback || text(['generic'])) : err;
  if (err.userMessage) return err.userMessage;
  if (err.name === 'AbortError') return text(['cancelled']);
  if (err.name === 'TimeoutError' || err.code === 'ECONNABORTED') return text(['timeout']);
  const res = err.response;
  if (res && (res.status || res.data)) {
    return friendlyMessage({ status: res.status, data: res.data, message: typeof res.data === 'string' ? res.data : undefined });
  }
  if (err.code === 'ERR_NETWORK' || /Failed to fetch|NetworkError|Network Error|Load failed/i.test(err.message || '')) {
    return typeof navigator !== 'undefined' && navigator.onLine === false ? text(['offline']) : text(['network']);
  }
  const msg = err.message;
  if (msg && !looksTechnical(msg)) return msg;
  return fallback || text(['generic']);
}

export const ERROR_MESSAGES = MESSAGES;
