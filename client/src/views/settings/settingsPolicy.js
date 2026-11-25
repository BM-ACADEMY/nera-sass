// What the Settings page shows and allows, from the server's own answers
// (GET /api/tenant permission flags and the signup config). The server checks
// every change again; this only keeps the page honest about what will work.

export const ROLE_LABELS = { owner: 'Owner', admin: 'Admin', manager: 'Manager', agent: 'Agent' };

export const roleLabel = (role) => ROLE_LABELS[role] || '';

// Settings sections, in the admin panel's style: a hub of cards, each opening
// /settings/<key>. Billing has its own page (/billing, from the profile menu)
// and WhatsApp lives on the WhatsApp Number page.
export const SETTINGS_SECTIONS = [
  { key: 'profile', title: 'Profile & workspace', text: 'Your sign-in details, your workspace and its language.' },
  { key: 'brand', title: 'Brand profile', text: 'Business name, category and automated replies.' },
  { key: 'two-step', title: 'Two-step verification', text: 'Ask for a code from your phone when you sign in.' },
  { key: 'password', title: 'Password & sessions', text: 'Change your password or sign out of every device.' },
  { key: 'integrations', title: 'Integrations', text: 'Connect your Facebook Page to receive Lead Form ad leads.' },
];

export function settingsSections() {
  return SETTINGS_SECTIONS;
}

export const findSection = (key) => SETTINGS_SECTIONS.find((s) => s.key === key) || null;

// Languages for automatic WhatsApp follow-ups (tenant.language; a template
// language code). An unknown stored value is kept as an extra option.
export const LANGUAGES = [
  ['en', 'English'], ['ta', 'Tamil'], ['hi', 'Hindi'], ['te', 'Telugu'], ['kn', 'Kannada'], ['ml', 'Malayalam'],
];
export function languageOptions(current) {
  const list = LANGUAGES.map(([value, label]) => ({ value, label }));
  if (current && !LANGUAGES.some(([value]) => value === current)) list.push({ value: current, label: current });
  return list;
}

const LIFECYCLE_LABELS = { active: 'Active', trial: 'Trial', grace: 'Payment overdue', restricted: 'Restricted', suspended: 'Suspended' };
const TAX_LABELS = { gst: 'GST (India)', none: 'No tax' };

// The read-only workspace facts shown on the Profile page. Customers cannot
// change these; the Getnera team does from the admin panel.
export function workspaceInfo(tenantInfo) {
  const tenant = tenantInfo?.tenant || {};
  const state = tenantInfo?.lifecycle?.state || tenant.status || '';
  return [
    { key: 'name', label: 'Workspace name', value: tenant.name || '' },
    { key: 'id', label: 'Workspace ID', value: tenant.id != null ? String(tenant.id) : '' },
    { key: 'status', label: 'Status', value: LIFECYCLE_LABELS[state] || (state ? state[0].toUpperCase() + state.slice(1) : '') },
    { key: 'currency', label: 'Currency', value: tenant.currency || 'INR' },
    { key: 'timezone', label: 'Timezone', value: tenant.timezone || 'Asia/Kolkata' },
    { key: 'tax_treatment', label: 'Tax treatment', value: TAX_LABELS[tenant.tax_treatment] || tenant.tax_treatment || '' },
  ];
}

// WhatsApp business profile: Meta's limits, checked before saving (the server
// checks again). Returns { ok, changes } or { ok: false, error }.
export const PROFILE_LIMITS = { about: 139, description: 512, address: 256, email: 128 };
const PROFILE_LABELS = { about: 'About', description: 'Description', address: 'Address', email: 'Email' };
export function profileChanges(values, current = {}) {
  const changes = {};
  for (const key of Object.keys(PROFILE_LIMITS)) {
    const value = String(values?.[key] ?? '').trim();
    if (value.length > PROFILE_LIMITS[key]) {
      return { ok: false, error: `${PROFILE_LABELS[key]} can be at most ${PROFILE_LIMITS[key]} characters (now ${value.length}).` };
    }
    if (value !== String(current?.[key] ?? '').trim()) changes[key] = value;
  }
  if (changes.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) {
    return { ok: false, error: 'Enter a valid email address, for example hello@yourbusiness.com.' };
  }
  if (changes.about === '') return { ok: false, error: 'About cannot be empty on WhatsApp. Write a short line about your business.' };
  if (!Object.keys(changes).length) return { ok: false, error: 'Nothing has changed yet.' };
  return { ok: true, changes };
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
