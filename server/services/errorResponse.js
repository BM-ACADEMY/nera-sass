/**
 * Plain-language error responses.
 *
 * Customers must never see a developer error (a stack trace, a database or
 * Meta message, "Cannot read properties of undefined"). Many route handlers
 * answer a failure with `res.status(500).json({ error: error.message })`;
 * this guard rewrites those answers in one place instead of in every route:
 *
 * - Every 500 answer, and any other 5xx whose text looks technical, gets a
 *   generic sentence plus a short reference id (`ref`). The real message is
 *   logged with the same id so support can find it.
 * - A 4xx answer whose text is a raw developer error (duplicate key, cast
 *   error, undefined property...) gets a plain sentence for its status.
 * - Status codes and `code` fields are never changed: clients rely on them.
 * - Platform staff and service calls (n8n) keep the original text; staff also
 *   get `detail` so the admin panel can show it.
 */
const crypto = require('crypto');

const GENERIC_SERVER_ERROR = 'Something went wrong on our side. Please try again in a minute.';

const STATUS_TEXT = {
  400: 'Please check the details you entered and try again.',
  401: 'Please sign in again.',
  403: "You don't have permission to do this.",
  404: 'We could not find what you were looking for.',
  409: 'This clashes with something that already exists.',
  413: 'This file is too large.',
  422: 'Please check the details you entered and try again.',
  429: 'Too many tries. Please wait a moment and try again.',
};

// Text that only a developer could read: runtime, database, network and
// third-party API errors, stack traces, JSON, environment variable names.
const TECHNICAL_PATTERNS = [
  /E11000|duplicate key/i,
  /Cast to \w+ failed|CastError|ValidationError|validation failed/i,
  /MongoServerError|MongoNetworkError|MongooseError|BSON|ObjectId/i,
  /Cannot (read|set) propert(y|ies) of/i,
  /is not (a function|defined|iterable)/i,
  /\bundefined\b|\bnull\b|NaN/,
  /TypeError|ReferenceError|SyntaxError|RangeError/,
  /Unexpected token|JSON\.parse|in JSON at position/i,
  /ECONN(RESET|REFUSED|ABORTED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|socket hang up/i,
  /Request failed with status code|timeout of \d+ms|Network Error/i,
  /\(#\d+\)|OAuthException|GraphMethodException|fbtrace_id/i,
  /\bat \S+ \(.*:\d+:\d+\)|\n\s+at /, // stack frame
  /^\s*[[{]/, // JSON blob
  /\b[A-Z][A-Z0-9]*_[A-Z0-9_]{2,}\b/, // ENV_VAR_NAME / INTERNAL_CODE
  /jwt|jsonwebtoken|invalid signature/i,
  /\/(srv|home|var|usr|tmp)\/|[A-Z]:\\|node_modules/,
  /\[object Object\]/,
];

function looksTechnical(text) {
  if (typeof text !== 'string') return text != null;
  if (!text.trim()) return false;
  if (text.length > 300) return true;
  return TECHNICAL_PATTERNS.some((re) => re.test(text));
}

// A Meta (WhatsApp) error number inside raw text, e.g. "(#131047) Re-engagement
// message" or "... (Meta error 131026)". Kept as `meta_code` so the app can
// explain it even after the raw text is replaced.
function metaCodeOf(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\(#(\d{1,6})\)|Meta error (\d{1,6})/i);
  return m ? Number(m[1] || m[2]) : null;
}

const newRef = () => crypto.randomBytes(4).toString('hex');

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

// Staff and service callers (n8n) keep the real text; everyone else is a customer.
const isInternalCaller = (req) => ['staff', 'service'].includes(req.identity?.kind);

function logServerError(req, status, ref, detail) {
  const text = detail instanceof Error ? (detail.stack || detail.message) : (typeof detail === 'string' ? detail : JSON.stringify(detail));
  console.error(`[Error ref ${ref}] ${req.method} ${req.originalUrl} ${status}: ${text}`);
}

/**
 * Returns the body to send for this status (a new object when it changes).
 * Exported for tests.
 */
function friendlyBody(req, res, status, body) {
  if (!isPlainObject(body) || status < 400) return body;
  const textKey = body.error !== undefined ? 'error' : (status >= 500 && typeof body.message === 'string' ? 'message' : null);
  if (!textKey) return body;
  const original = body[textKey];

  if (status >= 500) {
    if (status !== 500 && !looksTechnical(original)) return body;
    const ref = res.locals?.errorRef || newRef();
    if (!res.locals?.errorRef) logServerError(req, status, ref, original);
    const out = { ...body, ref };
    delete out.stack;
    if (isInternalCaller(req)) {
      if (req.identity?.kind === 'staff') out.detail = original;
      return out;
    }
    out[textKey] = GENERIC_SERVER_ERROR;
    const metaCode = metaCodeOf(original);
    if (metaCode && out.meta_code == null) out.meta_code = metaCode;
    if (textKey === 'error' && typeof body.message === 'string' && looksTechnical(body.message)) delete out.message;
    if (typeof out.details === 'string') delete out.details;
    return out;
  }

  // 4xx: only replace text that is clearly a raw developer error.
  if (isInternalCaller(req) || !looksTechnical(original)) return body;
  console.warn(`[Client error] ${req.method} ${req.originalUrl} ${status}: ${typeof original === 'string' ? original : JSON.stringify(original)}`);
  const out = { ...body, [textKey]: STATUS_TEXT[status] || STATUS_TEXT[400] };
  const metaCode = metaCodeOf(original);
  if (metaCode && out.meta_code == null) out.meta_code = metaCode;
  return out;
}

function friendlyErrorGuard(req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => {
    try {
      return json(friendlyBody(req, res, res.statusCode, body));
    } catch (error) {
      console.error('[friendlyErrorGuard]', error.message);
      return json(body);
    }
  };
  next();
}

/**
 * The last Express error handler: anything a route did not catch itself.
 */
function finalErrorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);
  if (err?.name === 'TenantContextError') {
    console.warn('[Tenant isolation]', req.method, req.originalUrl, err.message);
    return res.status(403).json({ error: 'Access denied' });
  }
  if (err?.name === 'MulterError') {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'This file is too large.' : 'This file could not be uploaded.' });
  }
  // body-parser: a broken or oversized request body.
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'The request could not be read. Please try again.' });
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: STATUS_TEXT[413] });

  const status = Number(err?.status || err?.statusCode) || 500;
  if (status < 500) {
    return res.status(status).json({ error: err.message, ...(err.code && typeof err.code === 'string' ? { code: err.code } : {}) });
  }
  const ref = newRef();
  res.locals.errorRef = ref;
  logServerError(req, status, ref, err);
  return res.status(status).json({ error: isInternalCaller(req) ? (err?.message || GENERIC_SERVER_ERROR) : GENERIC_SERVER_ERROR });
}

module.exports = {
  GENERIC_SERVER_ERROR,
  STATUS_TEXT,
  looksTechnical,
  metaCodeOf,
  friendlyBody,
  friendlyErrorGuard,
  finalErrorHandler,
};
