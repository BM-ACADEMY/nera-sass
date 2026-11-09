// Rules for the staff-only "connect WhatsApp" form (N5, Mode B). The server
// checks everything again; this only saves a round trip and builds the label.

export const EMPTY_CONNECTION = Object.freeze({ whatsapp_number: '', phone_number_id: '', wa_business_id: '', wa_access_token: '' });

/** Field errors for the four details. All four are needed on every save. */
export function validateConnection(values = {}) {
  const errors = {};
  const digits = String(values.whatsapp_number || '').replace(/\D/g, '');
  if (digits.length < 8) errors.whatsapp_number = 'Enter the number with its country code, for example +91 98765 43210';
  if (!/^\d{5,25}$/.test(String(values.phone_number_id || '').trim())) errors.phone_number_id = 'Digits only, from Meta';
  if (!/^\d{5,25}$/.test(String(values.wa_business_id || '').trim())) errors.wa_business_id = 'Digits only, from Meta';
  const token = String(values.wa_access_token || '').trim();
  if (token.length < 20 || /\s/.test(token)) errors.wa_access_token = 'Paste the full access token';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** What one queue row says about the customer's connection. */
export function connectionBadge(row) {
  if (!row) return { label: 'Unknown', tone: 'muted' };
  if (row.status === 'verified') return { label: 'Connected', tone: 'ok' };
  if (row.status === 'verification_failed') return { label: 'Verification failed', tone: 'bad' };
  if (row.status === 'verification_pending') return { label: 'Verifying', tone: 'warn' };
  if (row.requested_at) return { label: 'Asked for connection', tone: 'warn' };
  return { label: 'Not requested', tone: 'muted' };
}

/** The toast after a save: the details are saved even when Meta's check fails. */
export function saveOutcome(result) {
  if (result?.verified) return { kind: 'success', text: 'Saved and verified. The customer sees WhatsApp as connected.' };
  return { kind: 'warning', text: `Saved, but Meta did not verify it yet${result?.verify_error ? `: ${result.verify_error}` : ''}. Check the details and save again.` };
}
