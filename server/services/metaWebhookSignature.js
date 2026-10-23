/**
 * Meta webhook authentication (X-Hub-Signature-256).
 *
 * Meta signs every webhook POST with HMAC-SHA256 of the exact raw request body,
 * keyed with the app secret of the app the webhook belongs to:
 *   X-Hub-Signature-256: sha256=<64 hex chars>
 *
 * The secret comes from NERA_META_APP_SECRET only. There is deliberately no
 * fallback to META_APP_SECRET, META_CONTENT_OS_APP_SECRET or any hard-coded
 * value: those are shared with other features or previously exposed.
 *
 * Fails closed: with no secret configured, no raw body, or a missing,
 * malformed or wrong signature, the request is refused before anything is
 * logged, stored, forwarded or replied to.
 */
const crypto = require('crypto');

const SECRET_ENV = 'NERA_META_APP_SECRET';
const SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_FORMAT = /^sha256=([0-9a-f]{64})$/i;

const webhookSecret = () => String(process.env[SECRET_ENV] || '').trim() || null;

// True only when `header` is a valid signature of `rawBody` under `secret`.
function isValidMetaSignature(rawBody, header, secret) {
  if (!secret || !Buffer.isBuffer(rawBody)) return false;
  const match = SIGNATURE_FORMAT.exec(String(header || '').trim());
  if (!match) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

let missingSecretLogged = false;

function requireMetaSignature(req, res, next) {
  const secret = webhookSecret();
  if (!secret) {
    if (!missingSecretLogged) {
      console.error(`[Meta Webhook] Refused: ${SECRET_ENV} is not configured, so webhook signatures cannot be verified`);
      missingSecretLogged = true;
    }
    // 503: Meta retries later, so events are not lost once it is configured.
    return res.status(503).json({ error: 'Webhook verification is not configured', code: 'WEBHOOK_SECRET_NOT_CONFIGURED' });
  }
  if (!Buffer.isBuffer(req.rawBody)) {
    return res.status(400).json({ error: 'Webhook body must be JSON', code: 'WEBHOOK_BODY_UNREADABLE' });
  }
  if (!isValidMetaSignature(req.rawBody, req.get(SIGNATURE_HEADER), secret)) {
    return res.status(401).json({ error: 'Invalid webhook signature', code: 'WEBHOOK_SIGNATURE_INVALID' });
  }
  return next();
}

module.exports = { SECRET_ENV, isValidMetaSignature, requireMetaSignature };
