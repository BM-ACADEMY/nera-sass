/**
 * Outbound reply webhook: when a customer's new message arrives, the business's
 * own URL receives a signed JSON event.
 *
 *   POST <business URL>
 *   Content-Type: application/json
 *   X-Nera-Event-Id:   <uuid, the same on every retry>
 *   X-Nera-Timestamp:  <unix seconds, set again on every attempt>
 *   X-Nera-Signature:  v1=<hex HMAC-SHA256(secret, `${timestamp}.${raw body}`)>
 *   X-Nera-Attempt:    <1 for the first try>
 *
 * The secret is per workspace, generated here, stored encrypted and shown once.
 * Receivers should reject timestamps older than a few minutes and compare the
 * signature in constant time.
 *
 * Delivery: a row in webhook_deliveries is written when the message arrives and
 * a worker (every 15 s) sends the due rows. A non-2xx answer, timeout or network
 * error is retried with growing delays (1 min, 5 min, 30 min, 2 h, 6 h); after 6
 * attempts the row is "failed". The log keeps ids, status codes and error codes
 * only. The payload is rebuilt from the stored message at each attempt, so no
 * message text is ever copied into the log, and a message deleted in the
 * meantime (contact erasure) is "dropped", not sent.
 *
 * The URL is business-supplied, so it must be https, must not point at private,
 * loopback, link-local or metadata addresses (checked when saved and again when
 * connecting, so DNS tricks do not help), and redirects are not followed.
 */
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const https = require('https');
const axios = require('axios');
const models = require('../models');
const { encrypt, decrypt } = require('../utils/crypto');
const { runAsSystem, runAsTenant, requireTenantId } = require('./tenantContext');

const MAX_ATTEMPTS = 6;
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600]; // after attempt 1..5
const TIMEOUT_MS = 10000;
const WORKER_INTERVAL_MS = 15000;
const STUCK_AFTER_MS = 5 * 60 * 1000;
const EVENT_TYPE = 'message.received';

class WebhookConfigError extends Error {
  constructor(message, code = 'INVALID_WEBHOOK_URL') {
    super(message);
    this.status = 400;
    this.code = code;
  }
}

// ── signing ──────────────────────────────────────────────────────────────────
const generateSecret = () => `whsec_${crypto.randomBytes(32).toString('hex')}`;

function sign(secret, timestamp, rawBody) {
  return `v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex')}`;
}

function verifySignature(secret, timestamp, rawBody, header) {
  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const received = Buffer.from(String(header || ''));
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// ── address policy ──────────────────────────────────────────────────────────
function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19));
}

function isPrivateAddress(address) {
  const ip = String(address || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  if (net.isIPv6(ip)) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return isPrivateIPv4(mapped[1]);
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || ip.startsWith('::ffff:');
  }
  return true; // not an address at all: refuse
}

/** Returns the parsed URL, or throws WebhookConfigError. No network access. */
function validateUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new WebhookConfigError('Enter a full https:// address.');
  }
  if (url.protocol !== 'https:') throw new WebhookConfigError('The webhook address must start with https://');
  if (url.username || url.password) throw new WebhookConfigError('Do not put a username or password in the address.');
  if (String(value).length > 2000) throw new WebhookConfigError('The webhook address is too long.');
  const host = url.hostname.toLowerCase();
  const literal = host.replace(/^\[|\]$/g, '');
  if (net.isIP(literal) ? isPrivateAddress(literal) : (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.'))) {
    throw new WebhookConfigError('The webhook address must be a public internet address.');
  }
  return url;
}

// DNS lookup used when connecting: refuses private answers even if the name
// looked public when it was saved.
function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'function' ? {} : options || {};
  const cb = typeof options === 'function' ? options : callback;
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return cb(error);
    if (!addresses.length || addresses.some((entry) => isPrivateAddress(entry.address))) {
      const blocked = new Error('Address not allowed');
      blocked.code = 'BLOCKED_ADDRESS';
      return cb(blocked);
    }
    if (opts.all) return cb(null, addresses);
    return cb(null, addresses[0].address, addresses[0].family);
  });
}

// Replaceable in tests. Returns { status } or throws an error with a short .code.
const transport = {
  async post(url, body, headers) {
    try {
      const response = await axios.post(url, body, {
        headers,
        timeout: TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: 64 * 1024,
        responseType: 'text',
        transformResponse: [(data) => data],
        validateStatus: () => true,
        httpsAgent: new https.Agent({ lookup: guardedLookup }),
      });
      return { status: response.status };
    } catch (error) {
      const code = error.code === 'BLOCKED_ADDRESS' ? 'blocked_address'
        : error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' ? 'timeout' : 'network';
      const failure = new Error(code);
      failure.code = code;
      throw failure;
    }
  },
};

// ── settings ────────────────────────────────────────────────────────────────
const publicConfig = (row) => (row ? {
  url: row.url, enabled: Boolean(row.enabled), secret_last4: row.secret_last4 || null,
  secret_rotated_at: row.secret_rotated_at || null, updated_at: row.updated_at || null,
} : null);

async function getConfig() {
  return publicConfig(await models.ReplyWebhooks.findOne({}, { _id: 0 }).lean());
}

/**
 * Saves the URL. The first save also creates the secret, returned once here.
 * Returns { config, secret } where secret is null unless just created.
 */
async function saveConfig({ url, enabled = true }) {
  const valid = validateUrl(url);
  const existing = await models.ReplyWebhooks.findOne({}, { _id: 0, id: 1 }).lean();
  const now = new Date();
  if (existing) {
    await models.ReplyWebhooks.updateOne({}, { $set: { url: valid.toString(), enabled: Boolean(enabled), updated_at: now } });
    return { config: await getConfig(), secret: null, created: false };
  }
  const secret = generateSecret();
  await models.ReplyWebhooks.create({
    url: valid.toString(), enabled: Boolean(enabled), secret_enc: encrypt(secret), secret_last4: secret.slice(-4), secret_rotated_at: now,
  });
  return { config: await getConfig(), secret, created: true };
}

async function rotateSecret() {
  const secret = generateSecret();
  const result = await models.ReplyWebhooks.updateOne({}, { $set: { secret_enc: encrypt(secret), secret_last4: secret.slice(-4), secret_rotated_at: new Date(), updated_at: new Date() } });
  if (!result.matchedCount) throw new WebhookConfigError('Set a webhook address first.', 'WEBHOOK_NOT_CONFIGURED');
  return { config: await getConfig(), secret };
}

async function listDeliveries(limit = 50) {
  const rows = await models.WebhookDeliveries.find({}, {
    _id: 0, id: 1, event_id: 1, event_type: 1, message_id: 1, url_host: 1, status: 1, attempts: 1,
    last_status_code: 1, last_error_code: 1, last_attempt_at: 1, next_attempt_at: 1, delivered_at: 1, created_at: 1,
  }).sort({ id: -1 }).limit(Math.min(Math.max(Number(limit) || 50, 1), 200)).lean();
  return rows;
}

// ── delivery ────────────────────────────────────────────────────────────────
/** Called when a customer message has been stored. Never throws. */
async function enqueueReply({ leadId, messageId }) {
  try {
    const config = await models.ReplyWebhooks.findOne({}, { _id: 0, url: 1, enabled: 1 }).lean();
    if (!config?.enabled) return null;
    const row = await models.WebhookDeliveries.create({
      event_id: crypto.randomUUID(), event_type: EVENT_TYPE, lead_id: leadId, message_id: messageId,
      url_host: new URL(config.url).host, status: 'pending', next_attempt_at: new Date(),
    });
    return row.toObject();
  } catch (error) {
    if (error?.code !== 11000) console.error('[reply-webhook] Could not queue an event:', error.message);
    return null;
  }
}

async function buildEvent(delivery, tenantId) {
  const message = await models.Messages.findOne({ id: delivery.message_id }, { _id: 0 }).lean();
  if (!message) return null;
  const lead = delivery.lead_id != null ? await models.Leads.findOne({ id: delivery.lead_id }, { _id: 0, id: 1, name: 1, phone: 1 }).lean() : null;
  if (!lead) return null;
  return {
    id: delivery.event_id,
    type: delivery.event_type,
    created_at: new Date(delivery.created_at).toISOString(),
    workspace_id: tenantId,
    data: {
      contact: { id: lead.id, name: lead.name || null, phone: lead.phone || null },
      message: {
        id: message.id, direction: message.direction, type: message.msg_type || 'text', text: message.content || '',
        has_attachment: Boolean(message.media_url), received_at: new Date(message.sent_at).toISOString(),
      },
    },
  };
}

const retryDelayMs = (attemptsMade) => (BACKOFF_SECONDS[attemptsMade - 1] || BACKOFF_SECONDS[BACKOFF_SECONDS.length - 1]) * 1000;

/** One delivery attempt, inside the tenant context. Returns the new status. */
async function attemptDelivery(deliveryId, { now = new Date() } = {}) {
  const tenantId = requireTenantId();
  const { WebhookDeliveries, ReplyWebhooks } = models;
  const delivery = await WebhookDeliveries.findOneAndUpdate(
    { id: deliveryId, status: 'pending', next_attempt_at: { $lte: now } },
    { $set: { status: 'sending', last_attempt_at: now } },
    { new: true, projection: { _id: 0 } },
  ).lean();
  if (!delivery) return null; // already taken by another worker, or not due yet

  const finish = (set) => WebhookDeliveries.updateOne({ id: delivery.id }, { $set: set });
  const config = await ReplyWebhooks.findOne({}, { _id: 0, url: 1, enabled: 1, secret_enc: 1 }).lean();
  if (!config?.enabled) { await finish({ status: 'skipped', last_error_code: 'webhook_disabled' }); return 'skipped'; }
  const event = await buildEvent(delivery, tenantId);
  if (!event) { await finish({ status: 'dropped', last_error_code: 'message_deleted' }); return 'dropped'; }

  const attempt = delivery.attempts + 1;
  let statusCode = null;
  let errorCode = null;
  try {
    const secret = decrypt(config.secret_enc);
    validateUrl(config.url);
    const body = JSON.stringify(event);
    const timestamp = Math.floor(now.getTime() / 1000);
    const result = await transport.post(config.url, body, {
      'Content-Type': 'application/json',
      'User-Agent': 'Getnera-Webhooks/1',
      'X-Nera-Event-Id': event.id,
      'X-Nera-Timestamp': String(timestamp),
      'X-Nera-Signature': sign(secret, timestamp, body),
      'X-Nera-Attempt': String(attempt),
    });
    statusCode = result.status;
    if (statusCode < 200 || statusCode >= 300) errorCode = `http_${statusCode}`;
  } catch (error) {
    errorCode = error instanceof WebhookConfigError ? 'invalid_url' : (error.code && /^[a-z_]+$/.test(error.code) ? error.code : 'network');
  }

  if (!errorCode) {
    await finish({ status: 'delivered', attempts: attempt, last_status_code: statusCode, last_error_code: null, delivered_at: now });
    return 'delivered';
  }
  const permanent = errorCode === 'invalid_url' || errorCode === 'blocked_address';
  if (permanent || attempt >= MAX_ATTEMPTS) {
    await finish({ status: 'failed', attempts: attempt, last_status_code: statusCode, last_error_code: errorCode });
    return 'failed';
  }
  await finish({
    status: 'pending', attempts: attempt, last_status_code: statusCode, last_error_code: errorCode,
    next_attempt_at: new Date(now.getTime() + retryDelayMs(attempt)),
  });
  return 'pending';
}

/** Sends every due delivery of every workspace. Returns how many were tried. */
async function processDue({ now = new Date(), limit = 50 } = {}) {
  const stuckBefore = new Date(now.getTime() - STUCK_AFTER_MS);
  const due = await runAsSystem(async () => {
    // A crash between "sending" and the result must not lose the event.
    await models.WebhookDeliveries.updateMany({ status: 'sending', last_attempt_at: { $lt: stuckBefore } }, { $set: { status: 'pending' } });
    return models.WebhookDeliveries.find(
      { status: 'pending', next_attempt_at: { $lte: now } },
      { _id: 0, id: 1, tenant_id: 1 },
    ).sort({ next_attempt_at: 1 }).limit(limit).lean();
  }, 'reply-webhook-worker');
  let tried = 0;
  for (const row of due) {
    if (!row.tenant_id) continue;
    try {
      const outcome = await runAsTenant(row.tenant_id, () => attemptDelivery(row.id, { now }));
      if (outcome) tried += 1;
    } catch (error) {
      console.error(`[reply-webhook] Delivery ${row.id} could not be processed:`, error.message);
    }
  }
  return tried;
}

let timer = null;
function startWorker() {
  if (timer) return;
  timer = setInterval(() => { processDue().catch((error) => console.error('[reply-webhook] Worker error:', error.message)); }, WORKER_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
}
function stopWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** Queue the event and try the first delivery right away (outside tests). */
async function notifyReply({ leadId, messageId }) {
  const row = await enqueueReply({ leadId, messageId });
  if (row && process.env.NODE_ENV !== 'test') {
    const tenantId = requireTenantId();
    setImmediate(() => runAsTenant(tenantId, () => attemptDelivery(row.id)).catch((error) => console.error('[reply-webhook] First attempt failed:', error.message)));
  }
  return row;
}

module.exports = {
  EVENT_TYPE, MAX_ATTEMPTS, BACKOFF_SECONDS, WebhookConfigError, transport,
  generateSecret, sign, verifySignature, isPrivateAddress, validateUrl, guardedLookup,
  getConfig, saveConfig, rotateSecret, listDeliveries,
  enqueueReply, notifyReply, attemptDelivery, processDue, retryDelayMs, startWorker, stopWorker,
};
