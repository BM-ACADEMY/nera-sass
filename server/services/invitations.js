/**
 * Invitations (plan A3; Full Scope p2: "Invited user finishes signup with no
 * database edit; expired or reused link is rejected").
 *
 * - The token is 32 random bytes, sent only in the email link; the database
 *   stores its SHA-256 hash.
 * - Customer invitations count against the plan's user limit (plan B10).
 * - Accepting is atomic: the invitation is claimed with a single conditional
 *   update, so a link works exactly once even under concurrent requests.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Users, Invitations, Tenants } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { TENANT_ROLES, STAFF_ROLES } = require('./permissions');
const { assertSeatAvailable } = require('./entitlements');
const { passwordProblem, normalizeEmail, isEmail } = require('../utils/passwordPolicy');
const notify = require('./notify');
const { encrypt, decrypt } = require('../utils/crypto');
const audit = require('./audit');

const ttlHours = () => Number(process.env.INVITATION_TTL_HOURS || 72);
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

class InvitationError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const publicInvitation = (inv) => inv && ({
  id: inv.id,
  email: inv.email,
  name: inv.name || null,
  role: inv.is_platform_staff ? inv.staff_role : inv.role,
  is_platform_staff: Boolean(inv.is_platform_staff),
  expires_at: inv.expires_at,
  accepted_at: inv.accepted_at || null,
  revoked_at: inv.revoked_at || null,
  status: inv.accepted_at ? 'accepted' : inv.revoked_at ? 'revoked' : new Date(inv.expires_at) <= new Date() ? 'expired' : 'pending',
  invited_by: inv.invited_by ?? null,
  created_at: inv.created_at,
});

async function emailTaken(email) {
  return runAsSystem(() => Users.exists({ email }), 'invitations');
}

/**
 * Creates an invitation and emails it.
 * { tenantId | null (staff), email, name, role | staffRole, invitedBy: { id, name }, req }
 * Returns { invitation, delivery } — the raw token is never returned.
 */
// Each workspace has exactly one login (its owner). A workspace that already
// has an account, or a pending invitation for someone else, takes no more.
async function assertSingleLogin(tenantId, email) {
  const [users, pending] = await runAsTenant(tenantId, () => Promise.all([
    Users.countDocuments({}),
    Invitations.countDocuments({ email: { $ne: email }, accepted_at: null, revoked_at: null, expires_at: { $gt: new Date() } }),
  ]));
  if (users > 0 || pending > 0) {
    throw new InvitationError(409, 'This workspace already has its login. Each workspace has one login.');
  }
}

async function createInvitation({ tenantId = null, email, name = null, role = null, staffRole = null, password = undefined, invitedBy = {}, req = null, skipSeatCheck = false }) {
  const normalized = normalizeEmail(email);
  if (!isEmail(normalized)) throw new InvitationError(400, 'A valid email address is required');
  const staff = tenantId == null;
  // An Admin may choose a staff member's password up front. It is stored
  // encrypted only until the invitation is accepted, then mailed and erased.
  if (password !== undefined) {
    if (!staff) throw new InvitationError(400, 'A password can only be set when inviting a team member');
    const passwordError = passwordProblem(password, normalized);
    if (passwordError) throw new InvitationError(400, passwordError);
  }
  if (staff && !STAFF_ROLES.includes(staffRole)) throw new InvitationError(400, `Staff role must be one of: ${STAFF_ROLES.join(', ')}`);
  if (!staff && !TENANT_ROLES.includes(role)) throw new InvitationError(400, `Role must be one of: ${TENANT_ROLES.join(', ')}`);
  if (await emailTaken(normalized)) throw new InvitationError(409, 'A user with this email already exists');

  const run = (fn) => (staff ? runAsSystem(fn, 'invitations') : runAsTenant(tenantId, fn));
  const tenant = staff ? null : await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0, id: 1, name: 1 }).lean(), 'invitations');
  if (!staff && !tenant) throw new InvitationError(404, 'Workspace not found');

  // A newer invitation replaces any still-pending one for the same address.
  await run(() => Invitations.updateMany(
    { email: normalized, tenant_id: staff ? null : Number(tenantId), accepted_at: null, revoked_at: null },
    { $set: { revoked_at: new Date(), revoked_by: invitedBy.id ?? null } },
  ));
  if (!staff) await assertSingleLogin(tenantId, normalized);
  if (!staff && !skipSeatCheck) await assertSeatAvailable(tenantId, 1);

  const token = crypto.randomBytes(32).toString('base64url');
  const invitation = await run(() => Invitations.create({
    tenant_id: staff ? null : Number(tenantId),
    email: normalized,
    name: name ? String(name).trim() : null,
    role: staff ? null : role,
    is_platform_staff: staff,
    staff_role: staff ? staffRole : null,
    password_enc: password !== undefined ? encrypt(password) : null,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + ttlHours() * 3600 * 1000),
    invited_by: invitedBy.id ?? null,
    created_at: new Date(),
  }));

  const delivery = await sendInvitationEmail(invitation.toObject(), token, { tenant, inviterName: invitedBy.name });
  await audit.record(audit.EVENTS.USER_INVITED, {
    tenantId: staff ? null : tenantId,
    req,
    actor: req ? null : { actor_type: 'system', actor_user_id: invitedBy.id ?? null },
    targetType: 'invitation',
    targetId: invitation.id,
    meta: { email: normalized, role: staff ? staffRole : role, staff, delivered: delivery.delivered },
  });
  return {
    invitation: publicInvitation(invitation.toObject()),
    delivery,
    // Automated tests only (NODE_ENV=test): lets service-level tests accept an
    // invitation without reading email. Routes never pass this through.
    token: process.env.NODE_ENV === 'test' ? token : undefined,
  };
}

async function sendInvitationEmail(invitation, token, { tenant, inviterName }) {
  const base = invitation.is_platform_staff ? notify.adminUrl() : notify.appUrl();
  try {
    return await notify.invitationEmail({
      to: invitation.email,
      inviteeName: invitation.name,
      workspaceName: tenant?.name,
      inviterName,
      role: invitation.is_platform_staff ? invitation.staff_role : invitation.role,
      url: `${base}/invite/${token}`,
      expiresAt: invitation.expires_at,
      staff: invitation.is_platform_staff,
      passwordPreset: Boolean(invitation.password_enc),
    });
  } catch (error) {
    console.error('[invitations] Email not sent:', error.message);
    return { delivered: false, mode: 'error', error: error.message };
  }
}

// Issues a fresh token and expiry for a pending invitation (the old link stops working).
async function resendInvitation({ invitationId, tenantId = null, invitedBy = {}, req = null }) {
  const staff = tenantId == null;
  const run = (fn) => (staff ? runAsSystem(fn, 'invitations') : runAsTenant(tenantId, fn));
  const token = crypto.randomBytes(32).toString('base64url');
  const filter = { id: Number(invitationId), accepted_at: null, revoked_at: null };
  if (staff) filter.tenant_id = null;
  const invitation = await run(() => Invitations.findOneAndUpdate(
    filter,
    { $set: { token_hash: hashToken(token), expires_at: new Date(Date.now() + ttlHours() * 3600 * 1000) } },
    { new: true, projection: { _id: 0 } },
  ).lean());
  if (!invitation) throw new InvitationError(404, 'Pending invitation not found');
  const tenant = staff ? null : await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0, name: 1 }).lean(), 'invitations');
  const delivery = await sendInvitationEmail(invitation, token, { tenant, inviterName: invitedBy.name });
  await audit.record(audit.EVENTS.USER_INVITED, { tenantId, req, targetType: 'invitation', targetId: invitation.id, meta: { email: invitation.email, resent: true } });
  return { invitation: publicInvitation(invitation), delivery };
}

async function revokeInvitation({ invitationId, tenantId = null, revokedBy = null, req = null }) {
  const staff = tenantId == null;
  const run = (fn) => (staff ? runAsSystem(fn, 'invitations') : runAsTenant(tenantId, fn));
  const filter = { id: Number(invitationId), accepted_at: null, revoked_at: null };
  if (staff) filter.tenant_id = null;
  const invitation = await run(() => Invitations.findOneAndUpdate(filter, { $set: { revoked_at: new Date(), revoked_by: revokedBy } }, { new: true, projection: { _id: 0 } }).lean());
  if (!invitation) throw new InvitationError(404, 'Pending invitation not found');
  await audit.record(audit.EVENTS.INVITATION_REVOKED, { tenantId, req, targetType: 'invitation', targetId: invitation.id, meta: { email: invitation.email } });
  return publicInvitation(invitation);
}

async function findUsableInvitation(token) {
  if (!token || typeof token !== 'string') return null;
  return runAsSystem(() => Invitations.findOne({ token_hash: hashToken(token) }, { _id: 0 }).lean(), 'invitations');
}

function invitationProblem(invitation) {
  if (!invitation) return 'This invitation link is not valid';
  if (invitation.accepted_at) return 'This invitation has already been used';
  if (invitation.revoked_at) return 'This invitation has been cancelled';
  if (new Date(invitation.expires_at) <= new Date()) return 'This invitation has expired; ask for a new one';
  return null;
}

// Public preview for the accept page.
async function previewInvitation(token) {
  const invitation = await findUsableInvitation(token);
  const problem = invitationProblem(invitation);
  if (problem) throw new InvitationError(410, problem);
  const tenant = invitation.tenant_id
    ? await runAsSystem(() => Tenants.findOne({ id: invitation.tenant_id }, { _id: 0, name: 1 }).lean(), 'invitations')
    : null;
  return {
    email: invitation.email,
    name: invitation.name,
    role: invitation.is_platform_staff ? invitation.staff_role : invitation.role,
    workspace_name: tenant?.name || null,
    is_platform_staff: Boolean(invitation.is_platform_staff),
    password_preset: Boolean(invitation.password_enc),
    expires_at: invitation.expires_at,
  };
}

/**
 * Accepts an invitation: the invited person sets their own name and password.
 * Returns the created user (plain object).
 */
async function acceptInvitation({ token, name, password, phone = null }) {
  const invitation = await findUsableInvitation(token);
  const problem = invitationProblem(invitation);
  if (problem) throw new InvitationError(410, problem);
  const presetPassword = invitation.password_enc ? decrypt(invitation.password_enc) : null;
  if (invitation.password_enc && !presetPassword) throw new InvitationError(500, 'This invitation could not be read; ask for a new one');
  if (presetPassword) password = presetPassword;
  const passwordError = passwordProblem(password, invitation.email);
  if (passwordError) throw new InvitationError(400, passwordError);
  const displayName = String(name || invitation.name || '').trim();
  if (!displayName) throw new InvitationError(400, 'Your name is required');
  if (await emailTaken(invitation.email)) throw new InvitationError(409, 'A user with this email already exists');

  // Claim the invitation atomically: only one request can flip accepted_at.
  const claimed = await runAsSystem(() => Invitations.findOneAndUpdate(
    { id: invitation.id, token_hash: invitation.token_hash, accepted_at: null, revoked_at: null, expires_at: { $gt: new Date() } },
    { $set: { accepted_at: new Date() } },
    { new: true, projection: { _id: 0 } },
  ).lean(), 'invitations');
  if (!claimed) throw new InvitationError(410, 'This invitation has already been used');

  const staff = Boolean(claimed.is_platform_staff);
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const doc = {
      name: displayName,
      email: claimed.email,
      phone: phone ? String(phone).trim() : null,
      password_hash: passwordHash,
      role: staff ? null : claimed.role,
      is_platform_staff: staff,
      staff_role: staff ? claimed.staff_role : null,
      is_active: true,
      active: true,
      token_version: 0,
      invited_by: claimed.invited_by ?? null,
      password_changed_at: new Date(),
      created_at: new Date(),
    };
    const user = staff
      ? await runAsSystem(() => Users.create({ ...doc, tenant_id: null }), 'invitations')
      : await runAsTenant(claimed.tenant_id, () => Users.create(doc));
    await runAsSystem(() => Invitations.updateOne({ id: claimed.id }, { $set: { accepted_user_id: user.id }, $unset: { password_enc: '' } }), 'invitations');
    if (!staff && claimed.role === 'owner') {
      await runAsSystem(() => Tenants.updateOne({ id: claimed.tenant_id, owner_user_id: null }, { $set: { owner_user_id: user.id, updated_at: new Date() } }), 'invitations');
    }
    await audit.record(audit.EVENTS.USER_JOINED, {
      tenantId: staff ? null : claimed.tenant_id,
      actor: { actor_type: staff ? 'staff' : 'user', actor_user_id: user.id },
      targetType: 'user',
      targetId: user.id,
      meta: { email: claimed.email, role: staff ? claimed.staff_role : claimed.role, invitation_id: claimed.id },
    });
    const created = user.toObject();
    if (presetPassword) {
      // Sends the overview and login details; a failed email does not undo the account.
      created.welcome_delivery = await notify.staffWelcomeEmail({ to: claimed.email, name: displayName, role: claimed.staff_role, password: presetPassword })
        .catch((error) => ({ delivered: false, mode: 'error', error: error.message }));
    }
    return created;
  } catch (error) {
    // Release the claim so the person can try again with the same link.
    await runAsSystem(() => Invitations.updateOne({ id: claimed.id, accepted_user_id: null }, { $set: { accepted_at: null } }), 'invitations');
    if (error.code === 11000) throw new InvitationError(409, 'A user with this email already exists');
    throw error;
  }
}

module.exports = {
  InvitationError,
  hashToken,
  publicInvitation,
  createInvitation,
  resendInvitation,
  revokeInvitation,
  previewInvitation,
  acceptInvitation,
};
