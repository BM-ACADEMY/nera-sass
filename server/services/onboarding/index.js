/**
 * Guided customer onboarding (N5): the checklist, the Notices box, and Go live.
 * Everything here runs in the signed-in customer's tenant context, so every
 * read is limited to that workspace by the tenant-scope plugin. The only reads
 * that leave it (the platform's Meta template cache and the tenants row) are
 * keyed by values taken from the workspace's own records.
 */
const { Clients, BrainProfiles, Tenants, WhatsappNumberState, MetaWhatsappTemplates, OnboardingStates } = require('../../models');
const { runAsSystem, requireTenantId } = require('../tenantContext');
const billing = require('../billing');
const prompts = require('../brainPrompt');
const audit = require('../audit');
const catalog = require('./catalog');
const steps = require('./steps');
const { buildNotices } = require('./notices');
const whatsapp = require('./whatsapp');
const { embeddedSignupEnabled } = require('../../constants/features');

const NO_ID = { _id: 0 };
const BRAND_FIELDS = { _id: 0, id: 1, name: 1, wa_website: 1, wa_address: 1, phone_number_id: 1, wa_business_id: 1, wa_token_last4: 1, whatsapp_status: 1, whatsapp_number: 1 };

class GoLiveError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    Object.assign(this, extra);
  }
}

/** A workspace is live unless it was created in onboarding and has not gone live yet. */
const isLive = (tenant) => tenant?.campaigns_enabled !== false;

async function loadBrand() {
  const brand = await Clients.findOne({}, BRAND_FIELDS).lean();
  if (!brand) return null;
  // Older rows may hold the token in the legacy plain-text column.
  const legacy = brand.wa_token_last4 ? false : Boolean(await Clients.exists({ $or: [{ wa_access_token_enc: { $nin: [null, ''] } }, { wa_access_token: { $nin: [null, ''] } }] }));
  return { ...brand, token_configured: Boolean(brand.wa_token_last4) || legacy };
}

async function loadTemplates(wabaId) {
  if (!wabaId) return [];
  const rows = await runAsSystem(() => MetaWhatsappTemplates.find(
    { waba_id: wabaId }, { _id: 0, template_id: 1, name: 1, language: 1, category: 1, status: 1, components: 1 },
  ).sort({ name: 1 }).lean(), 'onboarding-templates');
  return rows.map(steps.presentTemplate);
}

async function loadBrain() {
  const brain = await BrainProfiles.findOne({}, NO_ID).lean();
  return {
    row: brain,
    enabled: Boolean(brain?.ai_enabled),
    missing: brain ? (brain.version_type === 'nera' ? [] : prompts.missingRequired(brain.profile)) : Object.values(prompts.REQUIRED_FIELDS),
    configured: Boolean(process.env.N8N_BRAIN_WEBHOOK_URL),
  };
}

/** Reads everything the checklist and the notices need for the current workspace. */
async function loadSnapshot(tenant, now = new Date()) {
  const brand = await loadBrand();
  const [state, services, templates, brain, subRow, aiGate, alerts, numberState] = await Promise.all([
    OnboardingStates.findOne({}, NO_ID).lean(),
    catalog.list(),
    loadTemplates(brand?.wa_business_id),
    loadBrain(),
    billing.subscriptions.current(),
    billing.aiAllowance.check(tenant, now),
    billing.alerts.recent(5),
    brand?.phone_number_id ? WhatsappNumberState.findOne({ phone_number_id: String(brand.phone_number_id) }, NO_ID).lean() : null,
  ]);
  return {
    now, tenant, brand, state, templates, brain, aiGate, alerts, numberState, subscriptionRow: subRow,
    subscription: billing.subscriptions.publicSubscription(subRow, now),
    planRequired: String(process.env.BILLING_REQUIRE_PLAN || '').toLowerCase() === 'true',
    services: services.filter(catalog.isComplete),
    live: isLive(tenant),
    embeddedSignup: embeddedSignupEnabled(),
  };
}

const maskPhone = (phone) => {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits.length >= 4 ? `••••${digits.slice(-4)}` : null;
};

/** The payload behind the Home screen: checklist, notices, live state. */
async function overview({ tenant, user = null, now = new Date() }) {
  const snapshot = await loadSnapshot(tenant, now);
  const checklist = steps.buildChecklist(snapshot);
  const notices = buildNotices({ ...snapshot, brand: snapshot.brand });
  return {
    ...checklist,
    notices,
    live: { is_live: snapshot.live, went_live_at: tenant?.went_live_at || snapshot.state?.went_live_at || null, ai_enabled: snapshot.brain.enabled },
    embedded_signup: whatsapp.embeddedSignupConfig(),
    test_phone: maskPhone(user?.phone),
    brand: snapshot.brand ? { id: snapshot.brand.id, name: snapshot.brand.name || '', website: snapshot.brand.wa_website || '', address: snapshot.brand.wa_address || '' } : null,
  };
}

/**
 * Go live: re-checks steps 1 to 5 on the server (the browser's view is never
 * trusted), then turns campaigns on and, when the AI Brain is ready, AI
 * replies too. Idempotent. Billing is read, never changed.
 */
async function goLive({ tenant, userId, req = null }) {
  const tenantId = requireTenantId();
  if (isLive(tenant)) return { already_live: true, ...(await liveResult(tenant)) };
  const snapshot = await loadSnapshot(tenant);
  const checklist = steps.buildChecklist({ ...snapshot, live: false });
  if (!checklist.ready_to_go_live) {
    const goLiveStep = checklist.steps.find((step) => step.key === 'go_live');
    throw new GoLiveError(409, goLiveStep.detail, 'NOT_READY', { blocked_by: goLiveStep.blocked_by });
  }
  const now = new Date();
  const aiReady = !snapshot.brain.enabled && snapshot.brain.row && !snapshot.brain.missing.length && snapshot.brain.configured;
  const tenantSet = { campaigns_enabled: true, went_live_at: now, updated_at: now };
  if (aiReady) tenantSet.ai_enabled = true;
  if (aiReady) await BrainProfiles.updateOne({}, { $set: { ai_enabled: true, updated_by: userId ?? null, updated_at: now } });
  await runAsSystem(() => Tenants.updateOne({ id: tenantId }, { $set: tenantSet }), 'onboarding-go-live');
  await whatsapp.upsertState({ went_live_at: now, went_live_by: userId ?? null });
  await audit.record(audit.EVENTS.ONBOARDING_WENT_LIVE, { tenantId, req, targetType: 'tenant', targetId: tenantId, meta: { ai_enabled: Boolean(aiReady || snapshot.brain.enabled) } });
  return liveResult({ ...tenant, campaigns_enabled: true, went_live_at: now }, { ai: Boolean(aiReady || snapshot.brain.enabled), ai_missing: aiReady || snapshot.brain.enabled ? [] : snapshot.brain.missing, ai_configured: snapshot.brain.configured });
}

async function liveResult(tenant, ai = null) {
  const brain = ai || await (async () => { const b = await loadBrain(); return { ai: b.enabled, ai_missing: b.missing, ai_configured: b.configured }; })();
  return { live: true, campaigns: true, went_live_at: tenant.went_live_at || null, ai_replies: brain.ai, ai_pending_reason: brain.ai ? null : (brain.ai_missing.length ? 'AI_PROFILE_INCOMPLETE' : (brain.ai_configured ? 'AI_OFF' : 'AI_NOT_CONFIGURED')), ai_missing: brain.ai_missing };
}

module.exports = { GoLiveError, isLive, loadSnapshot, overview, goLive, catalog, whatsapp, steps };
