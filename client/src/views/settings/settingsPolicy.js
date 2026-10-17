// What the Settings page shows and allows, from the server's own answers
// (GET /api/tenant permission flags and the signup config). The server checks
// every change again; this only keeps the page honest about what will work.

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent' };

export const roleLabel = (role) => ROLE_LABELS[role] || '';

// Billing details are owner/admin only (billing.view); the server returns
// full plan details only to them.
const canViewBilling = (role) => role === 'owner' || role === 'admin';

export function settingsTabs({ role } = {}) {
  const tabs = [
    { key: 'workspace', label: 'Workspace' },
    { key: 'brand', label: 'Brand Profile' },
    { key: 'whatsapp', label: 'WhatsApp' },
    { key: 'account', label: 'Account' },
  ];
  if (canViewBilling(role)) tabs.push({ key: 'billing', label: 'Billing' });
  return tabs;
}

export const canEditWorkspace = (permissions) => Boolean(permissions?.manage_settings);
export const canEditBrand = (permissions) => Boolean(permissions?.manage_settings);

// The Connect button appears only for people who manage WhatsApp, and is
// usable only once the server reports secure signup as enabled.
export function connectWhatsApp({ permissions, signupConfig } = {}) {
  if (!permissions?.manage_whatsapp) return { visible: false, enabled: false, reason: null };
  if (signupConfig?.enabled !== true) {
    return {
      visible: true,
      enabled: false,
      reason: signupConfig?.message || 'WhatsApp connection is not available yet.',
    };
  }
  return { visible: true, enabled: true, reason: null };
}

// Shows only the last four characters of an identifier.
export function maskId(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return text.length <= 4 ? text : `•••• ${text.slice(-4)}`;
}

const STATUS_LABELS = {
  verified: 'Connected',
  verification_pending: 'Verification pending',
  verification_failed: 'Verification failed',
  not_configured: 'Not connected',
};

export function whatsappSummary(brand) {
  if (!brand) return { status: 'Not connected', number: '', phoneId: '', wabaId: '', credential: 'Not configured' };
  return {
    status: STATUS_LABELS[brand.whatsapp_status] || 'Not connected',
    number: brand.whatsapp_number ? `+${String(brand.whatsapp_number).replace(/^\+/, '')}` : '',
    phoneId: maskId(brand.phone_number_id),
    wabaId: maskId(brand.wa_business_id),
    credential: brand.wa_token_configured
      ? `Configured${brand.wa_token_last4 ? ` (ending ${brand.wa_token_last4})` : ''}`
      : 'Not configured',
  };
}

const PENDING_REASONS = {
  WHATSAPP_NOT_CONNECTED: 'Saved. It will be published to your WhatsApp profile once WhatsApp is connected.',
  WHATSAPP_CREDENTIAL_MISSING: 'Saved. Your WhatsApp profile was not updated because this brand has no WhatsApp credential of its own yet.',
  WHATSAPP_ACCOUNT_ID_MISSING: 'Saved. Your WhatsApp profile was not updated because this brand\'s WhatsApp Business Account ID is missing.',
};

export function profileSaveMessage(result) {
  if (result?.meta_profile_synced) return 'Saved and published to your WhatsApp profile.';
  if (result?.meta_profile_pending) return PENDING_REASONS[result.meta_profile_pending_reason] || 'Saved.';
  return 'Saved.';
}

// Same rule as the server (server/utils/website.js), applied only when the
// website is changed so an existing legacy value never blocks a save.
export function normalizeWebsite(input) {
  const text = String(input ?? '').trim();
  if (!text) return { ok: true, value: '' };
  if (text.length > 256 || /\s/.test(text)) return { ok: false };
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false };
  }
  if (!['http:', 'https:'].includes(url.protocol)) return { ok: false };
  if (!url.hostname.includes('.') || url.username || url.password) return { ok: false };
  return { ok: true, value: candidate };
}

// What the Settings page shows while its data loads. A failed first load is
// an error with Retry, never an empty "no brand profile" page; a failed
// reload keeps the data already shown.
export function settingsLoadState({ loaded, error }) {
  if (loaded) return error ? 'ready-with-error' : 'ready';
  return error ? 'error' : 'loading';
}
