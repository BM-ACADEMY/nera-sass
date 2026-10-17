/**
 * Credentials for the platform's Meta WhatsApp inventory (staff-only sync,
 * phone registration and cache maintenance).
 *
 * The inventory uses META_INVENTORY_ACCESS_TOKEN and nothing else. It never
 * falls back to META_PAGE_ACCESS_TOKEN or META_SYSTEM_USER_ACCESS_TOKEN: those
 * are previously exposed credentials and must not be used for new live calls.
 * Phone registration is also off unless META_PHONE_REGISTRATION_ENABLED=true.
 */
class MetaCredentialError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const inventoryAccessToken = () => String(process.env.META_INVENTORY_ACCESS_TOKEN || '').trim() || null;

const phoneRegistrationEnabled = () => process.env.META_PHONE_REGISTRATION_ENABLED === 'true';

function requireInventoryAccessToken() {
  const token = inventoryAccessToken();
  if (!token) {
    throw new MetaCredentialError(503, 'The Meta inventory credential (META_INVENTORY_ACCESS_TOKEN) is not configured', 'META_CREDENTIAL_NOT_CONFIGURED');
  }
  return token;
}

module.exports = { MetaCredentialError, inventoryAccessToken, phoneRegistrationEnabled, requireInventoryAccessToken };
