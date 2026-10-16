/**
 * User administration shared by the customer Team screen (/api/team) and the
 * platform admin panel (/api/admin): role changes, deactivation and
 * reactivation, session revocation, MFA reset. Plans A1, A6, B10.
 *
 * Rules:
 *  - a user never changes their own role and never deactivates themselves;
 *  - customer Admins cannot change or deactivate Owners, or grant Owner;
 *  - a workspace always keeps at least one active Owner;
 *  - deactivation revokes every session immediately (token_version + 1);
 *  - reactivation counts against the plan's user limit.
 */
const { Users } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { TENANT_ROLES, STAFF_ROLES, canAssignRole, normalizeTenantRole, describeUser } = require('./permissions');
const { assertSeatAvailable } = require('./entitlements');
const audit = require('./audit');

class UserAdminError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const PUBLIC_FIELDS = { _id: 0, id: 1, name: 1, email: 1, phone: 1, role: 1, is_active: 1, last_login: 1, created_at: 1, mfa_enabled: 1, tenant_id: 1, is_platform_staff: 1, staff_role: 1, deactivated_at: 1 };

function presentUser(user) {
  if (!user) return user;
  const identity = describeUser(user);
  return {
    id: user.id,
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || null,
    role: identity?.kind === 'tenant' ? identity.role : null,
    staff_role: identity?.kind === 'staff' ? identity.staffRole : null,
    is_platform_staff: identity?.kind === 'staff',
    tenant_id: user.tenant_id ?? null,
    is_active: user.is_active !== false,
    mfa_enabled: Boolean(user.mfa_enabled),
    last_login: user.last_login || null,
    deactivated_at: user.deactivated_at || null,
    created_at: user.created_at || null,
  };
}

async function listTenantUsers(tenantId) {
  const users = await runAsTenant(tenantId, () => Users.find({}, PUBLIC_FIELDS).sort({ created_at: 1 }).lean());
  return users.map(presentUser);
}

async function activeOwnerCount(tenantId) {
  return runAsTenant(tenantId, () => Users.countDocuments({ role: 'owner', is_active: { $ne: false } }));
}

async function loadTarget(tenantId, userId) {
  const target = await runAsTenant(tenantId, () => Users.findOne({ id: Number(userId) }, { _id: 0 }).lean());
  if (!target) throw new UserAdminError(404, 'User not found in this workspace');
  return target;
}

// actor: { id, kind: 'tenant' | 'staff', role }
function assertCanManage(actor, target) {
  if (Number(actor.id) === Number(target.id)) throw new UserAdminError(400, 'You cannot change your own account this way');
  if (actor.kind === 'staff') return;
  const targetRole = normalizeTenantRole(target.role);
  if (actor.role === 'admin' && targetRole === 'owner') throw new UserAdminError(403, 'Only an Owner can change another Owner');
  if (!['owner', 'admin'].includes(actor.role)) throw new UserAdminError(403, 'You do not have permission to manage users');
}

async function changeRole({ tenantId, userId, newRole, actor, req }) {
  const role = String(newRole || '').toLowerCase();
  if (!TENANT_ROLES.includes(role)) throw new UserAdminError(400, `Role must be one of: ${TENANT_ROLES.join(', ')}`);
  const target = await loadTarget(tenantId, userId);
  assertCanManage(actor, target);
  const currentRole = normalizeTenantRole(target.role);
  if (actor.kind !== 'staff' && !canAssignRole(actor.role, currentRole, role)) {
    throw new UserAdminError(403, 'You cannot assign this role');
  }
  if (currentRole === role) return presentUser(target);
  if (currentRole === 'owner' && target.is_active !== false && (await activeOwnerCount(tenantId)) <= 1) {
    throw new UserAdminError(409, 'A workspace must keep at least one active Owner');
  }
  const updated = await runAsTenant(tenantId, () => Users.findOneAndUpdate(
    { id: target.id },
    { $set: { role, updated_at: new Date() } },
    { new: true, projection: { _id: 0 } },
  ).lean());
  await audit.record(audit.EVENTS.USER_ROLE_CHANGED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email, from: currentRole, to: role } });
  return presentUser(updated);
}

async function setActive({ tenantId, userId, active, actor, req }) {
  const target = await loadTarget(tenantId, userId);
  assertCanManage(actor, target);
  const isActive = target.is_active !== false;
  if (isActive === Boolean(active)) return presentUser(target);
  if (!active && normalizeTenantRole(target.role) === 'owner' && (await activeOwnerCount(tenantId)) <= 1) {
    throw new UserAdminError(409, 'A workspace must keep at least one active Owner');
  }
  if (active) await assertSeatAvailable(tenantId, 1);
  const update = active
    ? { $set: { is_active: true, active: true, updated_at: new Date() }, $unset: { deactivated_at: '', deactivated_by: '' } }
    : { $set: { is_active: false, active: false, deactivated_at: new Date(), deactivated_by: actor.id ?? null, updated_at: new Date() }, $inc: { token_version: 1 } };
  const updated = await runAsTenant(tenantId, () => Users.findOneAndUpdate({ id: target.id }, update, { new: true, projection: { _id: 0 } }).lean());
  await audit.record(active ? audit.EVENTS.USER_REACTIVATED : audit.EVENTS.USER_DEACTIVATED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email } });
  return presentUser(updated);
}

async function revokeSessions({ tenantId, userId, actor, req }) {
  const target = await loadTarget(tenantId, userId);
  if (actor.kind !== 'staff') assertCanManage(actor, target);
  await runAsTenant(tenantId, () => Users.updateOne({ id: target.id }, { $inc: { token_version: 1 } }));
  await audit.record(audit.EVENTS.SESSIONS_REVOKED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email } });
  return { success: true };
}

// Staff only: clears MFA so the user enrols again at next login (lost device).
async function resetMfa({ userId, req }) {
  const target = await runAsSystem(() => Users.findOne({ id: Number(userId) }, { _id: 0 }).lean(), 'user-admin');
  if (!target) throw new UserAdminError(404, 'User not found');
  await runAsSystem(() => Users.updateOne({ id: target.id }, {
    $set: { mfa_enabled: false },
    $unset: { mfa_secret_enc: '', mfa_pending_secret_enc: '', mfa_recovery_hashes: '', mfa_enrolled_at: '' },
    $inc: { token_version: 1 },
  }), 'user-admin');
  await audit.record(audit.EVENTS.MFA_RESET, { tenantId: target.tenant_id ?? null, req, targetType: 'user', targetId: target.id, meta: { email: target.email } });
  return { success: true };
}

// Platform staff accounts (founder only manages them).
async function setStaffRole({ userId, staffRole, actor, req }) {
  if (!STAFF_ROLES.includes(staffRole)) throw new UserAdminError(400, `Staff role must be one of: ${STAFF_ROLES.join(', ')}`);
  if (Number(actor.id) === Number(userId)) throw new UserAdminError(400, 'You cannot change your own role');
  const target = await runAsSystem(() => Users.findOne({ id: Number(userId) }, { _id: 0 }).lean(), 'user-admin');
  if (!target || describeUser(target)?.kind !== 'staff') throw new UserAdminError(404, 'Staff member not found');
  const updated = await runAsSystem(() => Users.findOneAndUpdate(
    { id: target.id },
    { $set: { staff_role: staffRole, is_platform_staff: true, updated_at: new Date() } },
    { new: true, projection: { _id: 0 } },
  ).lean(), 'user-admin');
  await audit.record(audit.EVENTS.USER_ROLE_CHANGED, { req, targetType: 'staff', targetId: target.id, meta: { email: target.email, to: staffRole } });
  return presentUser(updated);
}

async function setStaffActive({ userId, active, actor, req }) {
  if (Number(actor.id) === Number(userId)) throw new UserAdminError(400, 'You cannot deactivate yourself');
  const target = await runAsSystem(() => Users.findOne({ id: Number(userId) }, { _id: 0 }).lean(), 'user-admin');
  if (!target || describeUser(target)?.kind !== 'staff') throw new UserAdminError(404, 'Staff member not found');
  const update = active
    ? { $set: { is_active: true, active: true }, $unset: { deactivated_at: '' } }
    : { $set: { is_active: false, active: false, deactivated_at: new Date(), deactivated_by: actor.id }, $inc: { token_version: 1 } };
  const updated = await runAsSystem(() => Users.findOneAndUpdate({ id: target.id }, update, { new: true, projection: { _id: 0 } }).lean(), 'user-admin');
  await audit.record(active ? audit.EVENTS.USER_REACTIVATED : audit.EVENTS.USER_DEACTIVATED, { req, targetType: 'staff', targetId: target.id, meta: { email: target.email } });
  return presentUser(updated);
}

module.exports = {
  UserAdminError,
  PUBLIC_FIELDS,
  presentUser,
  listTenantUsers,
  changeRole,
  setActive,
  revokeSessions,
  resetMfa,
  setStaffRole,
  setStaffActive,
};
