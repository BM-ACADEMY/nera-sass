/**
 * Tenant provisioning.
 *
 * provisionTenant() creates, all or nothing:
 *   tenant → brand profile (client) → the Owner (an account with a staff-set
 *   password, or an invitation email when no password is given), then writes
 *   the audit events.
 *
 * There are no plans or subscriptions: a workspace has full access from the
 * moment it is created, with no expiry and no limits. Only an active founder
 * (Admin (Owner)) may create one.
 *
 * Atomicity: the tenant and brand are written in a MongoDB transaction when
 * the server supports it (replica set). On a standalone server they run in
 * sequence and are undone if any later step fails.
 */
const mongoose = require('mongoose');
const { Tenants, Clients, Users, Invitations } = require('../models');
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

// Second line of defence behind the route permission: whoever calls this
// service, the workspace must be created by an active founder account.
async function assertCreateAuthority(actorUserId) {
  const actor = actorUserId
    ? await runAsSystem(() => Users.findOne({ id: Number(actorUserId) }, { _id: 0 }).lean(), 'provisioning')
    : null;
  if (!actor || actor.is_active === false || !can(describeUser(actor), 'platform.tenants.create')) {
    throw new ProvisioningError(403, 'Only an Admin (Owner) can create a workspace');
  }
}

const TENANT_SETTING_FIELDS = ['language', 'currency', 'tax_treatment', 'timezone'];
const BRAND_FIELDS = ['industry', 'city', 'phone', 'contact_person', 'wa_category', 'wa_description', 'wa_address', 'wa_email', 'wa_website'];
const pick = (source, fields) => Object.fromEntries(fields.filter((f) => source?.[f] !== undefined && source[f] !== '').map((f) => [f, source[f]]));

/**
 * input: { business_name, owner_email, owner_name, owner_password?,
 *          settings: { language, currency, tax_treatment, timezone },
 *          brand: { industry, city, ... }, is_founding_client }
 */
async function provisionTenant(input, { req = null, actorUserId = null, actorName = null } = {}) {
  const businessName = String(input.business_name || '').trim();
  const ownerEmail = normalizeEmail(input.owner_email);
  if (!businessName) throw new ProvisioningError(400, 'Business name is required');
  if (!isEmail(ownerEmail)) throw new ProvisioningError(400, 'A valid owner email is required');
  await assertCreateAuthority(actorUserId);

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
  const created = { tenant: null, client: null, owner: null };
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
    });
  };

  const undo = async () => {
    await runAsSystem(async () => {
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
  await audit.record(audit.EVENTS.TENANT_CREATED, { tenantId, req, targetType: 'tenant', targetId: tenantId, meta: { name: businessName, owner_email: ownerEmail, transactional: useTransaction } });

  return {
    tenant: created.tenant.toObject(),
    client: sanitizeClient(created.client.toObject()),
    owner,
    invitation: invite.invitation,
    // If the email could not be sent, the workspace and the pending invitation
    // remain; staff resend it with POST /api/admin/tenants/:id/invitations/:invitationId/resend.
    delivery: invite.delivery,
    transactional: useTransaction,
  };
}

module.exports = { ProvisioningError, provisionTenant, supportsTransactions };
