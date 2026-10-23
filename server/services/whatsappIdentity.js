/**
 * A WhatsApp phone number (Meta Phone Number ID) belongs to one brand only.
 *
 * Inbound messages are routed to a tenant by the brand's phone_number_id, so
 * two brands sharing a number would send one customer's conversations to
 * another workspace. The check runs in the system context so it sees every
 * tenant's brands, not just the caller's, and the error never names the
 * other brand or workspace.
 */
const { Clients } = require('../models');
const { runAsSystem } = require('./tenantContext');

class PhoneNumberInUseError extends Error {
  constructor() {
    super('This WhatsApp number is already connected to another brand or workspace');
    this.status = 409;
    this.code = 'PHONE_NUMBER_IN_USE';
  }
}

async function assertPhoneNumberAvailable(phoneNumberId, { exceptClientId = null } = {}) {
  const value = String(phoneNumberId ?? '').trim();
  if (!value) return;
  const filter = { phone_number_id: value };
  if (exceptClientId != null) filter.id = { $ne: Number(exceptClientId) };
  const taken = await runAsSystem(() => Clients.exists(filter), 'phone-number-uniqueness');
  if (taken) throw new PhoneNumberInUseError();
}

module.exports = { PhoneNumberInUseError, assertPhoneNumberAvailable };
