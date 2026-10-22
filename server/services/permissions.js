/**
 * Roles and permissions (plan A1).
 *
 * Customer roles come from the Full Scope document (p2): owner, admin,
 * manager, agent. Each workspace now has a single login (its owner, full
 * access; see invitations.assertSingleLogin), so in practice only "owner" is
 * issued; the other roles stay for older accounts.
 * Platform staff are separate accounts (is_platform_staff, tenant_id = null):
 * founder (shown as "Admin (Owner)", full access) and ops (shown as "Staff",
 * everything except billing grants, staff management and data deletion).
 * A customer role never grants a platform permission.
 */
const TENANT_ROLES = ['owner', 'admin', 'manager', 'agent'];
const STAFF_ROLES = ['founder', 'ops'];

// Legacy role values from the original single-company app.
const LEGACY_TENANT_ROLES = { user: 'agent', ops: 'agent' };

const TENANT_PERMISSIONS = {
  'team.view': ['owner', 'admin', 'manager'],
  'team.manage': ['owner', 'admin'],
  'tenant.settings': ['owner', 'admin'],
  'whatsapp.manage': ['owner', 'admin'],
  'templates.manage': ['owner', 'admin', 'manager'],
  'campaigns.manage': ['owner', 'admin', 'manager'],
  'ai_brain.manage': ['owner', 'admin', 'manager'],
  'leads.export': ['owner', 'admin', 'manager'],
  'leads.delete': ['owner', 'admin', 'manager'],
};

const STAFF_PERMISSIONS = {
  'platform.tenants.view': ['founder', 'ops'],
  'platform.tenants.manage': ['founder', 'ops'],
  'platform.tenants.export': ['founder', 'ops'],
  'platform.tenants.delete': ['founder'],
  // Creating a workspace is Admin (Owner) only.
  'platform.tenants.create': ['founder'],
  'platform.users.manage': ['founder', 'ops'],
  'platform.staff.manage': ['founder'],
  // Meta WhatsApp inventory: view, sync and link/unlink reconciliation.
  'platform.meta': ['founder', 'ops'],
  // Inventory phone registration and cache clearing.
  'platform.meta.admin': ['founder'],
  // The platform's own WhatsApp inbox (admin panel WhatsApp Chat).
  'platform.inbox': ['founder', 'ops'],
  'platform.reports': ['founder', 'ops'],
  'platform.audit.view': ['founder', 'ops'],
  'platform.modules': ['founder', 'ops'],
};

// Roles that must use MFA (plan A5; Manager is decision D7).
const MFA_REQUIRED_TENANT_ROLES = ['owner', 'admin'];

function normalizeTenantRole(role) {
  const value = String(role || '').toLowerCase();
  if (TENANT_ROLES.includes(value)) return value;
  return LEGACY_TENANT_ROLES[value] || 'agent';
}

/**
 * The single place that decides whether a user record is platform staff.
 * A user with no tenant and the legacy role "admin" is the original platform
 * administrator (seeded before roles existed) and is treated as founder.
 */
function describeUser(user) {
  if (!user) return null;
  const legacyPlatformAdmin = !user.is_platform_staff && user.tenant_id == null && user.role === 'admin';
  if (user.is_platform_staff || legacyPlatformAdmin) {
    // A staff account with no known role (for example the retired "support")
    // keeps its login but gets no platform permission.
    const staffRole = STAFF_ROLES.includes(user.staff_role) ? user.staff_role : (legacyPlatformAdmin ? 'founder' : null);
    return { kind: 'staff', staffRole, role: null, tenantId: null };
  }
  if (user.tenant_id == null) return { kind: 'none' };
  return { kind: 'tenant', role: normalizeTenantRole(user.role), tenantId: Number(user.tenant_id), staffRole: null };
}

function can(identity, permission) {
  if (!identity) return false;
  if (permission.startsWith('platform.')) {
    return identity.kind === 'staff' && (STAFF_PERMISSIONS[permission] || []).includes(identity.staffRole);
  }
  if (identity.kind === 'staff') return true;
  return identity.kind === 'tenant' && (TENANT_PERMISSIONS[permission] || []).includes(identity.role);
}

function mfaRequired(identity) {
  if (!identity) return false;
  if (identity.kind === 'staff') return true;
  return identity.kind === 'tenant' && MFA_REQUIRED_TENANT_ROLES.includes(identity.role);
}

// Express middleware: 403 unless req.identity has the permission.
function requirePermission(permission) {
  return (req, res, next) => {
    if (can(req.identity, permission)) return next();
    return res.status(403).json({ error: 'You do not have permission to do this', permission });
  };
}

// Which roles a customer user may assign: Owners assign any role; Admins any
// role except Owner. Nobody changes their own role.
function canAssignRole(actorRole, targetCurrentRole, newRole) {
  if (!TENANT_ROLES.includes(newRole)) return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return newRole !== 'owner' && targetCurrentRole !== 'owner';
  return false;
}

module.exports = {
  TENANT_ROLES,
  STAFF_ROLES,
  TENANT_PERMISSIONS,
  STAFF_PERMISSIONS,
  normalizeTenantRole,
  describeUser,
  can,
  mfaRequired,
  requirePermission,
  canAssignRole,
};
