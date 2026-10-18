/**
 * Tenant provisioning (plan O1; Full Scope p3 Phase 7: "Payment creates
 * tenant, owner invite and entitlements in one transaction").
 *
 * provisionTenant() creates, all or nothing:
 *   tenant → brand profile (client) → subscription with copied limits →
 *   owner invitation (email), then writes the audit events.
 *
 * Trigger: a verified payment. For the controlled pilot (Milestone A) the
 * plan allows a staff "manual grant" with the bank/payment reference recorded;
 * the Razorpay subscription webhook (plan B5) will call the same function.
 *
 * Atomicity: the database writes run in a MongoDB transaction when the server
 * supports it (replica set). On a standalone server (decision D8) they run in
 * sequence and are undone if any later step fails.
 */
const mongoose = require('mongoose');
const { Tenants, Clients, Subscriptions, Plans, Users, Invitations } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { describeUser, can } = require('./permissions');
const invitations = require('./invitations');
const audit = require('./audit');
const { sanitizeClient } = require('./clientSecrets');
const bcrypt = require('bcryptjs');
const { normalizeEmail, isEmail, passwordProblem } = require('../utils/passwordPolicy');
const { escapeRegex } = require('../db/mongo');

class ProvisioningError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

let transactionSupport = null;
async function supportsTransactions() {
  if (transactionSupport !== null) return transactionSupport;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionSupport = Boolean(hello.setName || hello.msg === 'isdbgrid');
  } catch {
    transactionSupport = false;
  }
  return transactionSupport;
}

// Adds whole calendar months in India Standard Time, so a 12-month term that
// starts at 10:00 IST on 15 Oct ends at 10:00 IST on 15 Oct next year.
const IST_OFFSET_MS = 330 * 60 * 1000;
function addMonthsIST(date, months) {
  const ist = new Date(new Date(date).getTime() + IST_OFFSET_MS);
  const day = ist.getUTCDate();
  ist.setUTCDate(1);
  ist.setUTCMonth(ist.getUTCMonth() + Number(months));
  const lastDay = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 0)).getUTCDate();
  ist.setUTCDate(Math.min(day, lastDay));
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

// The plan must exist in the server-side catalogue; prices and limits are
// always taken from it, never from the request. An empty catalogue means the
// platform cannot sell plans yet (503), which is different from a wrong code (400).
async function requirePlan(code) {
  const plan = await findPlan(code);
  if (plan) return plan;
  const catalogueLoaded = await runAsSystem(() => Plans.exists({ active: true }), 'provisioning');
  if (!catalogueLoaded) throw new ProvisioningError(503, 'The plan catalogue is not loaded, so workspaces cannot be created or renewed yet.');
  throw new ProvisioningError(400, `Plan ${code} is not in the plan catalogue`);
}

/**
 * Validates how a subscription is paid for.
 *  - manual_grant: staff-authorized grant (Milestone A pilot). Needs a grant
 *    reference, a reason, and the authorizing staff member.
 *  - razorpay: only accepted when the payment was verified server-side
 *    (verified: true, set by the payment webhook, plan B5). Staff cannot record one.
 */
function validatePayment(payment, actorUserId) {
  const method = payment?.method || 'manual_grant';
  const reference = String(payment?.reference || '').trim();
  const reason = String(payment?.reason || '').trim();
  if (!['manual_grant', 'razorpay'].includes(method)) throw new ProvisioningError(400, 'Unknown payment method');
  if (reference.length < 3 || reference.length > 120) {
    throw new ProvisioningError(400, method === 'manual_grant'
      ? 'A manual-grant reference is required (the approval or bank reference, 3-120 characters)'
      : 'A payment reference is required');
  }
  if (method === 'razorpay' && payment.verified !== true) {
    throw new ProvisioningError(400, 'Razorpay payments are recorded only from a verified payment, not entered by staff');
  }
  if (method === 'manual_grant') {
    if (reason.length < 10 || reason.length > 500) throw new ProvisioningError(400, 'A manual grant needs a reason (10-500 characters)');
    if (!actorUserId) throw new ProvisioningError(400, 'A manual grant must be authorized by a signed-in staff member');
  }
  return { method, reference, reason: method === 'manual_grant' ? reason : null };
}

// Second line of defence behind the route permission: a manual grant must be
// authorized by an active founder account, whoever calls this service.
async function assertGrantAuthority(payment, actorUserId) {
  if (payment.method !== 'manual_grant') return;
  const actor = await runAsSystem(() => Users.findOne({ id: Number(actorUserId) }, { _id: 0 }).lean(), 'provisioning');
  if (!actor || actor.is_active === false || !can(describeUser(actor), 'platform.billing.grant')) {
    throw new ProvisioningError(403, 'Only a founder can authorize a manual grant');
  }
}

// Manual grants and verified payments are audited as different events.
function recordPaymentEvent(payment, { tenantId, req, subscriptionId, actorUserId }) {
  if (payment.method === 'manual_grant') {
    return audit.record(audit.EVENTS.MANUAL_GRANT_AUTHORIZED, {
      tenantId, req, targetType: 'subscription', targetId: subscriptionId,
      meta: { reference: payment.reference, reason: payment.reason, authorized_by: actorUserId },
    });
  }
  return audit.record(audit.EVENTS.PAYMENT_VERIFIED, {
    tenantId, req, targetType: 'subscription', targetId: subscriptionId, meta: { method: payment.method, reference: payment.reference },
  });
}

async function findPlan(code) {
  return runAsSystem(() => Plans.findOne({ code: String(code || '').toUpperCase(), active: true }, { _id: 0 }).sort({ version: -1 }).lean(), 'provisioning');
}

// Contract value stored on the subscription; never recomputed later (PDF p10).
function priceTerm(plan, termMonths) {
  const rules = plan.pricing_rules || {};
  const discountPct = Number(rules.term_discount_pct?.[String(termMonths)]);
  if (!Number.isFinite(discountPct)) {
    throw new ProvisioningError(400, `Term must be one of: ${Object.keys(rules.term_discount_pct || {}).join(', ')} months`);
  }
  const onboardingDiscountPct = Number(rules.onboarding_discount_pct?.[String(termMonths)] || 0);
  return {
    discount_pct: discountPct,
    contract_value: Math.round(plan.monthly_price * termMonths * (1 - discountPct / 100)),
    onboarding_fee: Math.round(plan.onboarding_fee * (1 - onboardingDiscountPct / 100)),
  };
}

function subscriptionDoc({ plan, termMonths, start, payment, grantedBy }) {
  const price = priceTerm(plan, termMonths);
  return {
    plan_code: plan.code,
    plan_name: plan.name,
    plan_version: plan.version,
    product_line: plan.product_line,
    term_months: termMonths,
    monthly_price: plan.monthly_price,
    discount_pct: price.discount_pct,
    contract_value: price.contract_value,
    onboarding_fee: price.onboarding_fee,
    currency: plan.currency || 'INR',
    limits: plan.limits || {},
    features: plan.features || {},
    status: 'active',
    current_period_start: start,
    current_period_end: addMonthsIST(start, termMonths),
    payment_method: payment.method,
    payment_reference: payment.reference,
    grant_reason: payment.reason || null,
    granted_by: grantedBy ?? null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

const TENANT_SETTING_FIELDS = ['language', 'currency', 'tax_treatment', 'timezone'];
const BRAND_FIELDS = ['industry', 'city', 'phone', 'contact_person', 'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website'];
const pick = (source, fields) => Object.fromEntries(fields.filter((f) => source?.[f] !== undefined && source[f] !== '').map((f) => [f, source[f]]));

/**
 * input: { business_name, owner_email, owner_name, plan_code, term_months,
 *          payment: { method: 'manual_grant', reference, reason }
 *                   | { method: 'razorpay', reference, verified: true },
 *          settings: { language, currency, tax_treatment, timezone },
 *          brand: { industry, city, ... }, is_founding_client }
 */
async function provisionTenant(input, { req = null, actorUserId = null, actorName = null } = {}) {
  const businessName = String(input.business_name || '').trim();
  const ownerEmail = normalizeEmail(input.owner_email);
  const termMonths = Number(input.term_months);
  if (!businessName) throw new ProvisioningError(400, 'Business name is required');
  if (!isEmail(ownerEmail)) throw new ProvisioningError(400, 'A valid owner email is required');
  const payment = validatePayment(input.payment, actorUserId);
  await assertGrantAuthority(payment, actorUserId);
  const plan = await requirePlan(input.plan_code);
  priceTerm(plan, termMonths); // validates the term before anything is written

  // With owner_password the owner account is created directly (staff hand the
  // credentials over themselves; no email is sent). Without it the owner joins
  // through an invitation email and chooses their own password.
  const ownerPassword = input.owner_password;
  const ownerName = String(input.owner_name || '').trim();
  if (ownerPassword !== undefined) {
    const passwordError = passwordProblem(ownerPassword, ownerEmail);
    if (passwordError) throw new ProvisioningError(400, passwordError);
    if (!ownerName) throw new ProvisioningError(400, 'Owner name is required');
  }
  const existingTenant = await runAsSystem(() => Tenants.findOne({
    name: { $regex: new RegExp(`^${escapeRegex(businessName)}$`, 'i') },
    status: { $ne: 'deleted' },
  }), 'provisioning');
  if (existingTenant) {
    throw new ProvisioningError(409, `A workspace named "${businessName}" already exists`);
  }

  if (await runAsSystem(() => Users.exists({ email: ownerEmail }), 'provisioning')) {
    throw new ProvisioningError(409, 'A user with the owner email already exists');
  }

  const existingInvite = await runAsSystem(() => Invitations.findOne({
    email: ownerEmail,
    accepted_at: null,
    revoked_at: null,
    expires_at: { $gt: new Date() },
  }), 'provisioning');
  if (existingInvite) {
    throw new ProvisioningError(409, `An active invitation has already been sent to ${ownerEmail}`);
  }

  const now = new Date();
  const created = { tenant: null, client: null, subscription: null };
  const useTransaction = await supportsTransactions();
  const session = useTransaction ? await mongoose.startSession() : null;

  const writeAll = async () => {
    const opts = session ? { session } : {};
    const [tenant] = await runAsSystem(() => Tenants.create([{
      name: businessName,
      status: 'active',
      lifecycle_state: 'active',
      ...pick(input.settings, TENANT_SETTING_FIELDS),
      is_founding_client: Boolean(input.is_founding_client),
      created_by: actorUserId,
      created_at: now,
      updated_at: now,
    }], opts), 'provisioning');
    created.tenant = tenant;
    await runAsTenant(tenant.id, async () => {
      const [client] = await Clients.create([{ name: businessName, status: 'active', whatsapp_status: 'not_configured', ...pick(input.brand, BRAND_FIELDS), created_at: now }], opts);
      created.client = client;
      const [subscription] = await Subscriptions.create([subscriptionDoc({ plan, termMonths, start: now, payment, grantedBy: actorUserId })], opts);
      created.subscription = subscription;
    });
  };

  const undo = async () => {
    await runAsSystem(async () => {
      if (created.subscription) await Subscriptions.deleteOne({ id: created.subscription.id, tenant_id: created.tenant.id });
      if (created.client) await Clients.deleteOne({ id: created.client.id, tenant_id: created.tenant.id });
      if (created.tenant) await Tenants.deleteOne({ id: created.tenant.id });
    }, 'provisioning-undo').catch((error) => console.error('[provisioning] Undo failed:', error.message));
  };

  try {
    if (session) await session.withTransaction(writeAll);
    else await writeAll();
  } catch (error) {
    if (!session) await undo();
    throw error;
  } finally {
    if (session) await session.endSession();
  }

  // The owner (account or invitation) is created after the commit so it only
  // exists for a tenant that exists. If it fails, the whole tenant is removed again.
  let invite = { invitation: null, delivery: null };
  let owner = null;
  try {
    if (ownerPassword !== undefined) {
      const passwordHash = await bcrypt.hash(ownerPassword, 12);
      const user = await runAsTenant(created.tenant.id, () => Users.create({
        name: ownerName,
        email: ownerEmail,
        phone: null,
        password_hash: passwordHash,
        role: 'owner',
        is_platform_staff: false,
        staff_role: null,
        is_active: true,
        active: true,
        token_version: 0,
        invited_by: actorUserId ?? null,
        password_changed_at: new Date(),
        created_at: new Date(),
      }));
      created.owner = user;
      await runAsSystem(() => Tenants.updateOne({ id: created.tenant.id }, { $set: { owner_user_id: user.id, updated_at: new Date() } }), 'provisioning');
      owner = { id: user.id, name: user.name, email: user.email };
    } else {
      invite = await invitations.createInvitation({
        tenantId: created.tenant.id,
        email: ownerEmail,
        name: ownerName || null,
        role: 'owner',
        invitedBy: { id: actorUserId, name: actorName },
        req,
      });
    }
  } catch (error) {
    if (created.owner) await runAsSystem(() => Users.deleteOne({ id: created.owner.id }), 'provisioning-undo').catch(() => {});
    await undo();
    if (error.code === 11000) throw new ProvisioningError(409, 'A user with the owner email already exists');
    throw error;
  }

  const tenantId = created.tenant.id;
  if (owner) {
    await audit.record(audit.EVENTS.USER_JOINED, {
      tenantId, req, targetType: 'user', targetId: owner.id,
      meta: { email: ownerEmail, role: 'owner', created_by_staff: actorUserId ?? null },
    });
  }
  const subscription = created.subscription.toObject();
  await audit.record(audit.EVENTS.TENANT_CREATED, { tenantId, req, targetType: 'tenant', targetId: tenantId, meta: { name: businessName, owner_email: ownerEmail, transactional: useTransaction } });
  await recordPaymentEvent(payment, { tenantId, req, subscriptionId: subscription.id, actorUserId });
  await audit.record(audit.EVENTS.SUBSCRIPTION_ACTIVATED, { tenantId, req, targetType: 'subscription', targetId: subscription.id, meta: { plan_code: plan.code, term_months: termMonths, contract_value: subscription.contract_value, period_end: subscription.current_period_end } });
  await audit.record(audit.EVENTS.ENTITLEMENT_CHANGED, { tenantId, req, targetType: 'subscription', targetId: subscription.id, meta: { limits: subscription.limits, features: subscription.features } });

  return {
    tenant: created.tenant.toObject(),
    client: sanitizeClient(created.client.toObject()),
    subscription,
    owner,
    invitation: invite.invitation,
    // If the email could not be sent, the workspace and the pending invitation
    // remain; staff resend it with POST /api/admin/tenants/:id/invitations/:invitationId/resend.
    delivery: invite.delivery,
    transactional: useTransaction,
  };
}

/**
 * Renews or changes a tenant's plan after a verified payment or an authorized
 * manual grant (input.payment, validated like provisionTenant). The same plan
 * continues from the end of the current period; a different plan starts now.
 */
async function grantSubscription(tenantId, input, { req = null, actorUserId = null } = {}) {
  const payment = validatePayment(input.payment, actorUserId);
  await assertGrantAuthority(payment, actorUserId);
  const plan = await requirePlan(input.plan_code);
  const termMonths = Number(input.term_months);
  priceTerm(plan, termMonths);
  return runAsTenant(tenantId, async () => {
    const current = await Subscriptions.findOne({ status: 'active' }, { _id: 0 }).sort({ current_period_end: -1 }).lean();
    const now = new Date();
    const samePlan = current && current.plan_code === plan.code;
    const start = samePlan && new Date(current.current_period_end) > now ? new Date(current.current_period_end) : now;
    const subscription = (await Subscriptions.create(subscriptionDoc({ plan, termMonths, start, payment, grantedBy: actorUserId }))).toObject();
    if (current && !samePlan) await Subscriptions.updateOne({ id: current.id }, { $set: { status: 'replaced', updated_at: now } });
    await recordPaymentEvent(payment, { tenantId, req, subscriptionId: subscription.id, actorUserId });
    await audit.record(audit.EVENTS.SUBSCRIPTION_ACTIVATED, { tenantId, req, targetType: 'subscription', targetId: subscription.id, meta: { plan_code: plan.code, term_months: termMonths, renewal: samePlan, period_end: subscription.current_period_end } });
    if (!samePlan) {
      await audit.record(audit.EVENTS.ENTITLEMENT_CHANGED, { tenantId, req, targetType: 'subscription', targetId: subscription.id, meta: { from: current?.plan_code || null, to: plan.code, limits: subscription.limits } });
    }
    return subscription;
  });
}

module.exports = { ProvisioningError, provisionTenant, grantSubscription, priceTerm, addMonthsIST, supportsTransactions, findPlan, requirePlan, validatePayment };
