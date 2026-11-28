/**
 * People in a customer workspace (Settings > Team, and the admin panel's
 * workspace page): add with a temporary password or by invitation, edit name,
 * phone and role, reset the password, remove. Disable/enable and "sign out
 * everywhere" are in userAdmin.js and shared with the older routes.
 *
 * Rules (on top of userAdmin's: nobody manages themselves, Admins never touch
 * Owners, a workspace keeps one active Owner):
 *  - only an Owner (or platform staff) adds or promotes someone to Owner or
 *    Admin; Admins add and edit Staff only;
 *  - Admins and Staff have the sections ticked for them (permissions.SECTIONS);
 *    an Admin gives only sections they have themselves;
 *  - every new login takes a seat (invitations.assertSingleLogin);
 *  - a temporary password follows the normal password rules, is stored only
 *    as a bcrypt hash, is never logged or returned, and must be replaced at the
 *    next sign-in (must_change_password; authMiddleware refuses everything
 *    else until then);
 *  - a password reset or removal signs the person out everywhere.
 * actor: { id, kind: 'tenant' | 'staff', role, sections, name }
 */
const bcrypt = require('bcryptjs');
const { Users, Invitations, Tenants } = require('../models');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const {
  TENANT_ROLES, SECTIONS, LEGACY_SECTIONS, normalizeTenantRole, sectionsFor, defaultSectionsFor, grantableSections,
} = require('./permissions');
const { passwordProblem, normalizeEmail, isEmail } = require('../utils/passwordPolicy');
const userAdmin = require('./userAdmin');
const invitations = require('./invitations');
const sessions = require('./sessions');
const audit = require('./audit');
const notify = require('./notify');

const { UserAdminError } = userAdmin;
const PHONE_RE = /^\+?[0-9 ()-]{7,20}$/;
const BCRYPT_ROUNDS = 12; // same as sign-up, password change and reset
const MAIL_WAIT_MS = 15000;

// Tells a new person about their login. The account already exists, so a slow
// or failing mail server never fails the request: the answer says delivered: false.
async function sendAddedEmail(details) {
  let timer;
  try {
    const result = await Promise.race([
      notify.memberAddedEmail(details),
      new Promise((resolve) => { timer = setTimeout(resolve, MAIL_WAIT_MS, { delivered: false, mode: 'timeout' }); }),
    ]);
    return { delivered: Boolean(result.delivered), mode: result.mode };
  } catch (error) {
    console.error('[team] Welcome email not sent:', error.message);
    return { delivered: false, mode: 'error' };
  } finally {
    clearTimeout(timer);
  }
}

function cleanName(name) {
  const value = typeof name === 'string' ? name.trim() : '';
  if (value.length < 2 || value.length > 80) throw new UserAdminError(400, 'Name must be 2 to 80 characters');
  return value;
}

function cleanPhone(phone) {
  if (phone == null) return null;
  const value = String(phone).trim();
  if (!value) return null;
  if (!PHONE_RE.test(value)) throw new UserAdminError(400, 'Enter a valid phone number');
  return value;
}

// A role from the request. The retired names (manager, agent) sent by an
// older app are read as Staff.
function cleanRole(role) {
  const value = String(role || '').toLowerCase();
  if (TENANT_ROLES.includes(value)) return value;
  if (LEGACY_SECTIONS[value]) return normalizeTenantRole(value);
  throw new UserAdminError(400, `Role must be one of: ${TENANT_ROLES.join(', ')}`);
}

// Section keys from the request: a list of known keys, or a 400.
function parseSections(sections) {
  if (!Array.isArray(sections)) throw new UserAdminError(400, 'Sections must be a list');
  const keys = sections.map((key) => String(key || '').toLowerCase());
  const unknown = keys.filter((key) => !SECTIONS.includes(key));
  if (unknown.length) throw new UserAdminError(400, `Unknown section: ${unknown.join(', ')}. Sections are: ${SECTIONS.join(', ')}`);
  return SECTIONS.filter((key) => keys.includes(key));
}

// Owners give any role; Admins give Staff only; platform staff give any role.
function assertCanGrant(actor, role) {
  if (actor.kind === 'staff' || actor.role === 'owner') return;
  if (actor.role === 'admin' && role === 'staff') return;
  if (actor.role === 'admin') throw new UserAdminError(403, 'Only an Owner can make someone an Owner or Admin');
  throw new UserAdminError(403, 'You do not have permission to manage users');
}

/**
 * The sections to store for someone getting `role`. Owners have every section
 * (nothing is stored: null). `requested` undefined means "not chosen": the
 * person keeps `current` (an edit) or gets the defaults for the role (a new
 * person; `rawRole` keeps a retired role's old access). An Admin gives only
 * sections they have; sections the person already has outside the Admin's
 * own stay as they are.
 */
function resolveSections(actor, { role, rawRole = role, requested, current = null }) {
  if (role === 'owner') return null;
  const grantable = grantableSections(actor);
  let wanted;
  if (requested === undefined || requested === null) {
    wanted = current ? [...current] : defaultSectionsFor(rawRole).filter((key) => grantable.includes(key));
  } else {
    wanted = parseSections(requested);
  }
  const before = current || [];
  const refused = wanted.filter((key) => !grantable.includes(key) && !before.includes(key));
  if (refused.length) throw new UserAdminError(403, 'You can only give sections that you have yourself');
  // Sections outside the actor's own cannot be taken away by them either.
  const kept = before.filter((key) => !grantable.includes(key));
  return SECTIONS.filter((key) => wanted.includes(key) || kept.includes(key));
}

function checkPassword(password, email) {
  const problem = passwordProblem(password, email);
  if (problem) throw new UserAdminError(400, problem);
}

/**
 * Adds a person. method 'password': the account is created now with the
 * temporary password and they are emailed how to sign in (never the
 * password); 'invite': an invitation email (they set their own).
 * Returns { user, delivery } or { invitation, delivery }.
 */
async function createMember({ tenantId, actor, name, email, phone, role, sections, method, password, req = null }) {
  const cleanEmail = normalizeEmail(email);
  if (!isEmail(cleanEmail)) throw new UserAdminError(400, 'Enter a valid email address');
  const displayName = cleanName(name);
  const cleanPhoneValue = cleanPhone(phone);
  const newRole = cleanRole(role || 'staff');
  assertCanGrant(actor, newRole);
  const newSections = resolveSections(actor, { role: newRole, rawRole: role || 'staff', requested: sections });
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0, id: 1, name: 1, status: 1 }).lean(), 'team');
  if (!tenant || tenant.status === 'deleted') throw new UserAdminError(404, 'Workspace not found');

  if (method === 'invite') {
    if (password !== undefined && password !== null && password !== '') {
      throw new UserAdminError(400, 'An invited person sets their own password. Choose "Set a temporary password" to set one now.');
    }
    const result = await invitations.createInvitation({
      tenantId: tenant.id, email: cleanEmail, name: displayName, phone: cleanPhoneValue, role: newRole, sections: newSections,
      invitedBy: { id: actor.id, name: actor.name }, req,
    });
    return { invitation: result.invitation, delivery: result.delivery };
  }
  if (method !== 'password') throw new UserAdminError(400, 'Choose how they get their password: a temporary password or an invitation email');

  checkPassword(password, cleanEmail);
  const existing = await runAsSystem(() => Users.findOne({ email: cleanEmail }, { _id: 0, id: 1, tenant_id: 1, removed_at: 1 }).lean(), 'team');
  if (existing) {
    if (existing.removed_at && Number(existing.tenant_id) === Number(tenant.id)) {
      throw new UserAdminError(409, 'This email belongs to someone removed from this workspace. Contact support to bring them back.');
    }
    throw new UserAdminError(409, 'A user with this email already exists');
  }
  // A pending invitation for the same address is replaced by the account.
  await runAsTenant(tenant.id, () => Invitations.updateMany(
    { email: cleanEmail, accepted_at: null, revoked_at: null },
    { $set: { revoked_at: new Date(), revoked_by: actor.id ?? null } },
  ));
  await invitations.assertSingleLogin(tenant.id, cleanEmail);

  const now = new Date();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  let user;
  try {
    user = await runAsTenant(tenant.id, () => Users.create({
      name: displayName,
      email: cleanEmail,
      phone: cleanPhoneValue,
      password_hash: passwordHash,
      role: newRole,
      ...(newSections ? { sections: newSections } : {}),
      is_platform_staff: false,
      staff_role: null,
      is_active: true,
      active: true,
      token_version: 0,
      invited_by: actor.id ?? null,
      must_change_password: true,
      password_changed_at: now,
      password_claimed_at: null,
      created_at: now,
    }));
  } catch (error) {
    if (error.code === 11000) throw new UserAdminError(409, 'A user with this email already exists');
    throw error;
  }
  await audit.record(audit.EVENTS.TEAM_MEMBER_ADDED, {
    tenantId: tenant.id, req, targetType: 'user', targetId: user.id,
    meta: { email: cleanEmail, role: newRole, sections: newSections, method: 'temporary_password', by_staff: actor.kind === 'staff' },
  });
  const delivery = await sendAddedEmail({ to: cleanEmail, name: displayName, workspaceName: tenant.name, inviterName: actor.name, role: newRole });
  return { user: userAdmin.presentUser(user.toObject()), delivery };
}

/** Name, phone, role and sections. Only the fields given are changed. */
async function updateMember({ tenantId, userId, actor, changes = {}, req = null }) {
  const target = await userAdmin.loadTarget(tenantId, userId);
  userAdmin.assertCanManage(actor, target);
  const set = {};
  if (changes.name !== undefined) set.name = cleanName(changes.name);
  if (changes.phone !== undefined) set.phone = cleanPhone(changes.phone);
  const currentRole = normalizeTenantRole(target.role);
  const currentSections = currentRole === 'owner' ? null : sectionsFor(target.role, target.sections);
  const role = changes.role !== undefined ? cleanRole(changes.role) : null;
  const roleChanges = Boolean(role && role !== currentRole);
  if (roleChanges) assertCanGrant(actor, role);
  const finalRole = roleChanges ? role : currentRole;
  // Sections: as given, or kept (an Owner made Admin or Staff gets the defaults).
  const sectionsGiven = changes.sections !== undefined && changes.sections !== null;
  const newSections = (sectionsGiven || roleChanges)
    ? resolveSections(actor, { role: finalRole, requested: changes.sections, current: currentSections })
    : currentSections;
  if (roleChanges) {
    await userAdmin.changeRole({ tenantId, userId: target.id, newRole: role, sections: newSections, actor, req, event: audit.EVENTS.TEAM_MEMBER_ROLE_CHANGED });
  } else if (sectionsGiven && finalRole !== 'owner' && newSections.join() !== (currentSections || []).join()) {
    await runAsTenant(tenantId, () => Users.updateOne({ id: target.id }, { $set: { sections: newSections, updated_at: new Date() } }));
    await audit.record(audit.EVENTS.TEAM_MEMBER_UPDATED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email, fields: ['sections'], from: currentSections, to: newSections } });
  }
  const fields = Object.keys(set).filter((key) => (set[key] ?? null) !== (target[key] ?? null));
  if (fields.length) {
    await runAsTenant(tenantId, () => Users.updateOne({ id: target.id }, { $set: { ...set, updated_at: new Date() } }));
    await audit.record(audit.EVENTS.TEAM_MEMBER_UPDATED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email, fields } });
  }
  const fresh = await runAsTenant(tenantId, () => Users.findOne({ id: target.id }, { _id: 0 }).lean());
  return userAdmin.presentUser(fresh);
}

/**
 * Sets a new temporary password: they must choose their own at the next
 * sign-in, and every session they have ends now.
 */
async function resetPassword({ tenantId, userId, actor, password, req = null }) {
  const target = await userAdmin.loadTarget(tenantId, userId);
  userAdmin.assertCanManage(actor, target);
  checkPassword(password, target.email);
  const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  await runAsTenant(tenantId, () => Users.updateOne({ id: target.id }, {
    $set: { password_hash: hash, must_change_password: true, password_changed_at: new Date(), failed_login_count: 0, updated_at: new Date() },
    $unset: { reset_token_hash: '', reset_token_expires_at: '', locked_until: '' },
    $inc: { token_version: 1 },
  }));
  await sessions.revokeOthers(target.id, null, 'password_reset_by_admin');
  await audit.record(audit.EVENTS.TEAM_MEMBER_PASSWORD_RESET, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email } });
  const fresh = await runAsTenant(tenantId, () => Users.findOne({ id: target.id }, { _id: 0 }).lean());
  return userAdmin.presentUser(fresh);
}

/**
 * Removes a person: their login stops working at once and they leave the
 * team list. The row is kept (audit trail, their past work).
 */
async function removeMember({ tenantId, userId, actor, req = null }) {
  const target = await userAdmin.loadTarget(tenantId, userId);
  userAdmin.assertCanManage(actor, target);
  const isOwner = normalizeTenantRole(target.role) === 'owner';
  if (isOwner && target.is_active !== false && (await userAdmin.activeOwnerCount(tenantId)) <= 1) {
    throw new UserAdminError(409, 'A workspace must keep at least one active Owner');
  }
  const now = new Date();
  await runAsTenant(tenantId, () => Users.updateOne({ id: target.id }, {
    $set: {
      removed_at: now, removed_by: actor.id ?? null, is_active: false, active: false,
      deactivated_at: target.deactivated_at || now, deactivated_by: target.deactivated_by ?? actor.id ?? null, updated_at: now,
    },
    $inc: { token_version: 1 },
  }));
  await sessions.revokeOthers(target.id, null, 'removed');
  // The workspace's recorded owner moves to another active Owner.
  if (isOwner) await userAdmin.moveRecordedOwner(tenantId, target.id);
  await audit.record(audit.EVENTS.TEAM_MEMBER_REMOVED, { tenantId, req, targetType: 'user', targetId: target.id, meta: { email: target.email, role: normalizeTenantRole(target.role) } });
  return { success: true };
}

const setActive = (args) => userAdmin.setActive({
  ...args,
  events: { on: audit.EVENTS.TEAM_MEMBER_ENABLED, off: audit.EVENTS.TEAM_MEMBER_DISABLED },
});

module.exports = { assertCanGrant, resolveSections, cleanRole, createMember, updateMember, resetPassword, removeMember, setActive };
