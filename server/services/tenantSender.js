/**
 * Resolves the WhatsApp credentials a tenant message must be sent with: the
 * lead's own brand (`clients` row of the current tenant context), decrypted
 * by the model from `wa_access_token_enc`.
 *
 * There is deliberately no fallback to any environment token or phone number.
 * A brand without credentials gets a clear 409 WHATSAPP_NOT_CONNECTED; an
 * unverified brand gets 403, the same answer the manual send gives.
 * Runs inside the caller's tenant context (the tenant-scope plugin filters
 * the lookup).
 */
const { Clients } = require('../models');

class SenderError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const NOT_CONNECTED = () => new SenderError(
  409,
  'WhatsApp is not connected for this workspace. Connect WhatsApp in Settings first.',
  'WHATSAPP_NOT_CONNECTED',
);
const NOT_VERIFIED = () => new SenderError(
  403,
  'WhatsApp is disabled for this brand until verification succeeds',
  'WHATSAPP_NOT_VERIFIED',
);

const CREDENTIAL_FIELDS = { _id: 0, id: 1, name: 1, phone_number_id: 1, wa_access_token: 1, wa_business_id: 1, whatsapp_status: 1 };

/** The brand's sender, or null when the brand has no number or token. */
async function brandSenderForClientId(clientId) {
  if (clientId == null) return null;
  const client = await Clients.findOne({ id: Number(clientId) }, CREDENTIAL_FIELDS).lean();
  if (!client?.phone_number_id || !client?.wa_access_token) return null;
  return {
    clientId: client.id,
    brandName: client.name || null,
    phoneNumberId: String(client.phone_number_id),
    token: client.wa_access_token,
    wabaId: client.wa_business_id || null,
    status: client.whatsapp_status || null,
  };
}

/**
 * The sender for a lead. Throws SenderError(409) when the lead has no brand or
 * the brand has no credentials, and SenderError(403) when `requireVerified`
 * and the brand's WhatsApp is not verified yet.
 */
async function requireBrandSender(lead, { requireVerified = true } = {}) {
  const sender = await brandSenderForClientId(lead?.client_id);
  if (!sender) throw NOT_CONNECTED();
  if (requireVerified && sender.status !== 'verified') throw NOT_VERIFIED();
  return sender;
}

/** The brand's own token, or a 409 SenderError. */
function requireBrandToken(client) {
  if (!client?.wa_access_token) throw NOT_CONNECTED();
  return client.wa_access_token;
}

/** Writes a SenderError (or any error with a status) as the JSON response. */
function sendError(res, err) {
  const status = Number(err?.status) || 500;
  return res.status(status).json({ error: err?.message || 'Server error', ...(err?.code ? { code: err.code } : {}) });
}

module.exports = { SenderError, brandSenderForClientId, requireBrandSender, requireBrandToken, sendError };
