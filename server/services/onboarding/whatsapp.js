/**
 * Step 2 and step 5 of the setup checklist.
 *
 * Connecting WhatsApp has two modes:
 *   A  Meta Embedded Signup, behind WA_EMBEDDED_SIGNUP_ENABLED (off until Meta
 *      approves Getnera as a Tech Provider). The customer authorises in Meta's
 *      popup; the server exchanges the one-time code for the customer's own
 *      token. No platform token is ever used for a customer's account.
 *   B  Staff-assisted: the customer asks, our team enters the WhatsApp Business
 *      account details on a staff-only screen. The token is written through
 *      the clients model, which encrypts it (services/clientSecrets.js, the
 *      same code the tenant sender reads back), and no response ever returns
 *      it, not even its last characters.
 *
 * The test message goes through the N1 send policy and number limits like any
 * other business-initiated message, from the customer's own number.
 */
const axios = require('axios');
const { parsePhoneNumberFromString } = require('libphonenumber-js');
const { Clients, OnboardingStates, MetaWhatsappTemplates, Users } = require('../../models');
const { runAsSystem, requireTenantId } = require('../tenantContext');
const { upsertOne } = require('../../db/mongo');
const { assertPhoneNumberAvailable } = require('../whatsappIdentity');
const { brandSenderForClientId, SenderError } = require('../tenantSender');
const sendPolicy = require('../sendPolicy');
const numberHealth = require('../numberHealth');
const consent = require('../consent');
const audit = require('../audit');
const { notifyStaff } = require('../realtime');
const { embeddedSignupEnabled } = require('../../constants/features');
const steps = require('./steps');

const NO_ID = { _id: 0 };
const DAY_MS = 24 * 60 * 60 * 1000;
const graphVersion = () => process.env.META_GRAPH_VERSION || 'v21.0';
const testLimitPerDay = () => {
  const n = Number(process.env.ONBOARDING_TEST_MAX_PER_DAY);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
};

class OnboardingError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Created through the model (not a raw upsert) so the row gets its numeric id.
async function upsertState(set, { push = null } = {}) {
  const now = new Date();
  const update = { $set: { ...set, updated_at: now } };
  const insert = { ...set, created_at: now, updated_at: now };
  if (push) {
    update.$push = Object.fromEntries(Object.entries(push).map(([key, value]) => [key, { $each: [value], $slice: -20 }]));
    for (const [key, value] of Object.entries(push)) insert[key] = [value];
  }
  return upsertOne(OnboardingStates, {}, update, insert);
}

const getState = () => OnboardingStates.findOne({}, NO_ID).lean();

// ── Customer asks our team to connect (Mode B, step 1 of 2) ──
async function requestStaffConnect({ userId, req = null }) {
  const tenantId = requireTenantId();
  const brand = await Clients.findOne({}, { _id: 0, id: 1, name: 1, whatsapp_status: 1 }).lean();
  if (!brand) throw new OnboardingError(409, 'This workspace has no brand profile yet', 'NO_BRAND');
  if (brand.whatsapp_status === 'verified') throw new OnboardingError(409, 'WhatsApp is already connected', 'ALREADY_CONNECTED');
  const existing = await getState();
  if (existing?.wa_connect_requested_at) return { requested_at: existing.wa_connect_requested_at, already: true };
  const state = await upsertState({ wa_connect_requested_at: new Date(), wa_connect_requested_by: userId ?? null });
  await audit.record(audit.EVENTS.ONBOARDING_WHATSAPP_REQUESTED, { tenantId, req, targetType: 'tenant', targetId: tenantId });
  notifyStaff('onboarding_whatsapp_requested', { tenant_id: tenantId, tenant_name: brand.name || null });
  return { requested_at: state.wa_connect_requested_at, already: false };
}

// ── Staff enter the customer's account details (Mode B, step 2 of 2) ──
const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

function cleanConnection(input = {}) {
  const phone = String(input.whatsapp_number ?? '').trim();
  const parsed = parsePhoneNumberFromString(phone.startsWith('+') ? phone : `+${phone}`);
  if (!parsed?.isValid()) throw new OnboardingError(400, 'Enter the WhatsApp number with its country code, for example +91 98765 43210', 'INVALID_NUMBER');
  const phoneNumberId = String(input.phone_number_id ?? '').trim();
  if (!/^\d{5,25}$/.test(phoneNumberId)) throw new OnboardingError(400, 'The Meta Phone Number ID is digits only', 'INVALID_PHONE_NUMBER_ID');
  const wabaId = String(input.wa_business_id ?? '').trim();
  if (!/^\d{5,25}$/.test(wabaId)) throw new OnboardingError(400, 'The WhatsApp Business Account ID is digits only', 'INVALID_WABA_ID');
  const token = String(input.wa_access_token ?? '').trim();
  if (token.length < 20 || /\s/.test(token)) throw new OnboardingError(400, 'Paste the full access token', 'INVALID_TOKEN');
  return { whatsapp_number: parsed.number.slice(1), phone_number_id: phoneNumberId, wa_business_id: wabaId, wa_access_token: token };
}

/** What staff may see about a saved connection. Never any part of the token. */
function presentConnection(brand, state) {
  const hasToken = Boolean(brand?.wa_token_last4 || brand?.token_configured);
  return {
    configured: Boolean(brand?.phone_number_id && hasToken),
    status: brand?.whatsapp_status || 'not_configured',
    whatsapp_number: brand?.whatsapp_number || null,
    phone_number_id: brand?.phone_number_id || null,
    wa_business_id: brand?.wa_business_id || null,
    token_saved: hasToken,
    requested_at: state?.wa_connect_requested_at || null,
    connected_at: state?.wa_connected_at || null,
    verified_at: brand?.whatsapp_verified_at || null,
  };
}

const CONNECTION_FIELDS = { _id: 0, id: 1, name: 1, whatsapp_status: 1, whatsapp_number: 1, phone_number_id: 1, wa_business_id: 1, wa_token_last4: 1, whatsapp_verified_at: 1 };

/** Staff view of one workspace's WhatsApp connection (runs in that tenant's context). */
async function staffConnection() {
  const [brand, state] = await Promise.all([Clients.findOne({}, CONNECTION_FIELDS).lean(), getState()]);
  if (!brand) throw new OnboardingError(404, 'Brand profile not found', 'NO_BRAND');
  return { workspace: brand.name || null, ...presentConnection(brand, state) };
}

/**
 * Saves the details (token encrypted by the clients model) and then asks Meta
 * to verify them. Runs in the customer's tenant context. Returns what staff
 * may see; a verification failure is reported to staff, not thrown, because
 * the details are saved either way.
 */
async function staffSaveConnection(input, { staffId, verifyClientWhatsApp, req = null }) {
  const tenantId = requireTenantId();
  const values = cleanConnection(input);
  const current = await Clients.findOne({}, { _id: 0, id: 1 }).lean();
  if (!current) throw new OnboardingError(404, 'Brand profile not found', 'NO_BRAND');
  await assertPhoneNumberAvailable(values.phone_number_id, { exceptClientId: current.id });
  await Clients.updateOne({}, { $set: {
    ...values, whatsapp_status: 'verification_pending', whatsapp_verified_at: null, whatsapp_verification_error: null, updated_at: new Date(),
  } });
  await upsertState({ wa_connected_at: new Date(), wa_connected_by: staffId ?? null });
  await audit.record(audit.EVENTS.ONBOARDING_WHATSAPP_CONNECTED, {
    tenantId, req, targetType: 'client', targetId: current.id,
    meta: { fields: ['whatsapp_number', 'phone_number_id', 'wa_business_id'], token_updated: true, mode: 'staff_assisted' },
  });

  let verified = false;
  let verifyError = null;
  if (verifyClientWhatsApp) {
    try {
      const client = await Clients.findOne({}, { _id: 0 }).lean();
      await verifyClientWhatsApp(client);
      verified = true;
    } catch (error) {
      verifyError = error?.response?.data?.error?.message || error?.message || 'Verification failed';
    }
  }
  const [brand, state] = await Promise.all([Clients.findOne({}, CONNECTION_FIELDS).lean(), getState()]);
  return { ...presentConnection(brand, state), verified, verify_error: verifyError };
}

// ── Mode A: Meta Embedded Signup (flagged) ──────────────────
const gateway = {
  async exchangeCode(code) {
    const response = await axios.get(`https://graph.facebook.com/${graphVersion()}/oauth/access_token`, {
      params: { client_id: process.env.META_APP_ID, client_secret: process.env.NERA_META_APP_SECRET, code },
      timeout: 15000,
    });
    return response.data?.access_token || null;
  },
  async phoneNumber(phoneNumberId, token) {
    const response = await axios.get(`https://graph.facebook.com/${graphVersion()}/${phoneNumberId}`, {
      params: { fields: 'display_phone_number' }, headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
    });
    return response.data?.display_phone_number || null;
  },
};

const NOT_AVAILABLE = () => new OnboardingError(404, 'Connecting WhatsApp yourself is not available yet. Ask our team to connect it for you.', 'FEATURE_OFF');

function embeddedSignupConfig() {
  if (!embeddedSignupEnabled()) return { enabled: false };
  const appId = process.env.META_APP_ID;
  const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
  if (!appId || !configId || !process.env.NERA_META_APP_SECRET) return { enabled: false, reason: 'NOT_CONFIGURED' };
  return { enabled: true, app_id: appId, config_id: configId };
}

async function completeEmbeddedSignup({ code, phone_number_id: phoneNumberId, waba_id: wabaId }, { userId, verifyClientWhatsApp, req = null }) {
  if (!embeddedSignupEnabled()) throw NOT_AVAILABLE();
  if (!embeddedSignupConfig().enabled) throw new OnboardingError(503, 'Connecting WhatsApp yourself is not set up yet. Ask our team to connect it for you.', 'NOT_CONFIGURED');
  const tenantId = requireTenantId();
  const phoneId = String(phoneNumberId ?? '').trim();
  const waba = String(wabaId ?? '').trim();
  if (!String(code || '').trim() || !/^\d{5,25}$/.test(phoneId) || !/^\d{5,25}$/.test(waba)) {
    throw new OnboardingError(400, 'Meta did not return the WhatsApp account details. Please try again.', 'SIGNUP_INCOMPLETE');
  }
  const current = await Clients.findOne({}, { _id: 0, id: 1 }).lean();
  if (!current) throw new OnboardingError(404, 'Brand profile not found', 'NO_BRAND');
  await assertPhoneNumberAvailable(phoneId, { exceptClientId: current.id });
  let token;
  let display;
  try {
    token = await gateway.exchangeCode(String(code).trim());
    display = token ? await gateway.phoneNumber(phoneId, token) : null;
  } catch (error) {
    console.error('[onboarding] Embedded Signup exchange failed:', error?.response?.data?.error?.message || error?.message);
    throw new OnboardingError(502, 'We could not finish connecting your WhatsApp account. Please try again or ask our team.', 'SIGNUP_FAILED');
  }
  const number = digitsOnly(display);
  if (!token || number.length < 10) throw new OnboardingError(502, 'We could not finish connecting your WhatsApp account. Please try again or ask our team.', 'SIGNUP_FAILED');
  await Clients.updateOne({}, { $set: {
    whatsapp_number: number, phone_number_id: phoneId, wa_business_id: waba, wa_access_token: token,
    whatsapp_status: 'verification_pending', whatsapp_verified_at: null, whatsapp_verification_error: null, updated_at: new Date(),
  } });
  await upsertState({ wa_connected_at: new Date(), wa_connected_by: userId ?? null });
  await audit.record(audit.EVENTS.ONBOARDING_WHATSAPP_CONNECTED, {
    tenantId, req, targetType: 'client', targetId: current.id, meta: { fields: ['whatsapp_number', 'phone_number_id', 'wa_business_id'], token_updated: true, mode: 'embedded_signup' },
  });
  let verified = false;
  try {
    await verifyClientWhatsApp(await Clients.findOne({}, { _id: 0 }).lean());
    verified = true;
  } catch (error) {
    console.error('[onboarding] Embedded Signup verification failed:', error?.message);
  }
  return { verified };
}

// ── Step 5: test message to the customer's own phone ────────
function normalisePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = raw.startsWith('+') ? parsePhoneNumberFromString(raw) : (parsePhoneNumberFromString(raw, 'IN') || parsePhoneNumberFromString(`+${raw}`));
  return parsed?.isValid() ? parsed.number.slice(1) : null;
}

/** The approved templates of this workspace's own WABA that can be sent as they are. */
async function sendableTemplates(wabaId) {
  if (!wabaId) return [];
  const rows = await runAsSystem(() => MetaWhatsappTemplates.find(
    { waba_id: wabaId, status: 'APPROVED' }, { _id: 0, template_id: 1, name: 1, language: 1, category: 1, status: 1, components: 1 },
  ).sort({ name: 1 }).lean(), 'onboarding-templates');
  return rows.filter(steps.isSendableAsIs);
}

const blocked = (error) => Object.assign(new OnboardingError(error.status || 409, error.message, error.code), { retryAt: error.retryAt });

async function sendTestMessage({ userId, templateId = null, phone = null, confirmOwnPhone = false, req = null }) {
  const tenantId = requireTenantId();
  const brand = await Clients.findOne({}, { _id: 0, id: 1, whatsapp_status: 1, wa_business_id: 1 }).lean();
  if (!brand) throw new OnboardingError(409, 'This workspace has no brand profile yet', 'NO_BRAND');
  const sender = await brandSenderForClientId(brand.id);
  if (!sender) throw new SenderError(409, 'WhatsApp is not connected for this workspace yet.', 'WHATSAPP_NOT_CONNECTED');
  if (sender.status !== 'verified') throw new SenderError(403, 'WhatsApp is not verified yet. We will tell you when it is ready.', 'WHATSAPP_NOT_VERIFIED');

  // The customer's own phone: the one on their profile, or the one they give
  // now (which is then saved on their profile as their own).
  const user = userId == null ? null : await Users.findOne({ id: Number(userId) }, { _id: 0, id: 1, phone: 1 }).lean();
  let to = normalisePhone(user?.phone);
  if (!to) {
    to = normalisePhone(phone);
    if (!to) throw new OnboardingError(400, 'Enter your own mobile number with its country code, for example +91 98765 43210', 'PHONE_REQUIRED');
  }

  const templates = await sendableTemplates(brand.wa_business_id);
  const template = templateId ? templates.find((item) => String(item.template_id) === String(templateId)) : templates[0];
  if (!template) throw new OnboardingError(409, 'You need an approved template without variables to send a test. Create a simple one first.', 'NO_TEST_TEMPLATE');

  const state = await getState();
  const since = new Date(Date.now() - DAY_MS);
  const recent = (state?.test_attempts || []).filter((at) => new Date(at) > since);
  if (recent.length >= testLimitPerDay()) throw new OnboardingError(429, 'You have sent enough test messages for today. Try again tomorrow.', 'TEST_LIMIT');

  // N1: the same policy every business-initiated message passes.
  const lead = { id: null, phone: to };
  // The category comes from the template row of this workspace's own WABA, not from a lookup by name.
  const kind = sendPolicy.kindForCategory(template.category) || 'marketing';
  if (kind === 'marketing') {
    const existing = await consent.getConsent({ phone: to });
    if (existing?.status !== 'opted_in' && existing?.status !== 'opted_out') {
      if (confirmOwnPhone !== true) {
        throw new OnboardingError(400, 'This template is a marketing template. Confirm the number is your own and that you want to receive this test.', 'CONFIRMATION_REQUIRED');
      }
      await consent.recordOptIn({ phone: to, source: 'onboarding_test', text: 'The workspace owner asked for a test message to their own phone', by: userId ?? null });
    }
  }
  const check = await sendPolicy.checkSend({ lead, kind, messageType: 'template', phoneNumberId: sender.phoneNumberId, onboardingTest: true });
  if (!check.ok) throw blocked(check);
  const slot = await numberHealth.reserveSlot(sender.phoneNumberId, { countsTowardDailyCap: true });
  if (!slot.ok) throw new OnboardingError(429, 'Your WhatsApp number has reached its sending limit for now. Try again later.', slot.reason === 'daily_cap' ? 'DAILY_CAP_REACHED' : 'RATE_LIMITED');

  await upsertState({}, { push: { test_attempts: new Date() } });
  try {
    await axios.post(
      `https://graph.facebook.com/${graphVersion()}/${sender.phoneNumberId}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'template', template: { name: template.name, language: { code: template.language || 'en' } } },
      { headers: { Authorization: `Bearer ${sender.token}`, 'Content-Type': 'application/json' }, timeout: 15000 },
    );
  } catch (error) {
    const meta = error?.response?.data?.error;
    console.error('[onboarding] Test message refused by Meta:', meta?.code || error?.code || '', meta?.message || error?.message);
    if (meta?.code) await numberHealth.recordSendError(sender.phoneNumberId, { code: meta.code, message: meta.message }).catch(() => {});
    throw new OnboardingError(502, 'WhatsApp did not accept the test message. Check that the number is right and has WhatsApp, then try again. If it keeps failing, contact support.', 'TEST_SEND_FAILED');
  }
  if (userId != null && !user?.phone) await Users.updateOne({ id: Number(userId) }, { $set: { phone: `+${to}` } });
  await upsertState({ test_message_sent_at: new Date(), test_message_template: template.name });
  await audit.record(audit.EVENTS.ONBOARDING_TEST_SENT, { tenantId, req, targetType: 'tenant', targetId: tenantId, meta: { template: template.name, to_last4: to.slice(-4) } });
  return { sent: true, to_last4: to.slice(-4), template: template.name };
}

module.exports = {
  OnboardingError, gateway, cleanConnection, presentConnection, getState, upsertState,
  requestStaffConnect, staffConnection, staffSaveConnection,
  embeddedSignupConfig, completeEmbeddedSignup,
  normalisePhone, sendableTemplates, sendTestMessage,
};
