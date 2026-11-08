/**
 * Internal WhatsApp notifications to the Getnera owner (founder reports, staff
 * alerts). These are platform messages, never tenant messages, so they use an
 * explicit, named configuration of their own:
 *
 *   NERA_FOUNDER_NOTIFY_PHONE_NUMBER_ID  the Cloud API phone number that sends
 *   NERA_FOUNDER_NOTIFY_ACCESS_TOKEN     a token allowed to send from that number
 *   NERA_FOUNDER_NOTIFY_TO               the owner's WhatsApp number (digits)
 *
 * No fallback: when any of these is missing nothing is sent and the caller
 * gets { delivered: false, reason: 'NOT_CONFIGURED', missing: [...] } plus a
 * clear log line. A tenant's token or the platform inbox is never used here.
 */
const axios = require('axios');

const ENV = Object.freeze({
  phoneNumberId: 'NERA_FOUNDER_NOTIFY_PHONE_NUMBER_ID',
  token: 'NERA_FOUNDER_NOTIFY_ACCESS_TOKEN',
  to: 'NERA_FOUNDER_NOTIFY_TO',
});
const GRAPH_VERSION = 'v21.0';

const read = (name) => String(process.env[name] || '').trim() || null;

function config() {
  return { phoneNumberId: read(ENV.phoneNumberId), token: read(ENV.token), to: read(ENV.to) };
}

/** Names of the variables still missing; `to` is only needed without an explicit recipient. */
function missing({ to } = {}) {
  const c = config();
  const out = [];
  if (!c.phoneNumberId) out.push(ENV.phoneNumberId);
  if (!c.token) out.push(ENV.token);
  if (!to && !c.to) out.push(ENV.to);
  return out;
}

const isConfigured = (options) => missing(options).length === 0;

/**
 * Sends one text to the owner (or an explicit `to`). Never throws.
 * Returns { delivered, reason?, missing?, wa_msg_id?, error? }.
 */
async function sendText({ content, to = null, label = 'internal notification' } = {}) {
  const text = String(content || '').trim();
  if (!text) return { delivered: false, reason: 'EMPTY_CONTENT' };
  const gap = missing({ to });
  if (gap.length) {
    console.warn(`[founderNotify] "${label}" not sent: ${gap.join(', ')} not configured`);
    return { delivered: false, reason: 'NOT_CONFIGURED', missing: gap };
  }
  const c = config();
  const digits = String(to || c.to).replace(/\D/g, '');
  if (digits.length < 10) return { delivered: false, reason: 'INVALID_RECIPIENT' };
  try {
    const response = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${c.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: text.slice(0, 4096) } },
      { headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
    );
    return { delivered: true, wa_msg_id: response.data?.messages?.[0]?.id || null };
  } catch (err) {
    const detail = err.response?.data?.error?.message || err.message;
    console.error(`[founderNotify] "${label}" failed: ${detail}`);
    return { delivered: false, reason: 'SEND_FAILED', error: detail };
  }
}

module.exports = { ENV, config, missing, isConfigured, sendText };
