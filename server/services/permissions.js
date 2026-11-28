/**
 * Roles and permissions (plan A1).
 *
 * Customer roles are exactly three: owner, admin and staff.
 *  - owner: everything (billing, WhatsApp number, workspace settings, the team).
 *  - admin: added by an Owner; only the sections the Owner ticked, plus the
 *    Team page where they add and manage Staff (never Owners or other Admins).
 *  - staff: added by an Owner or Admin; only the sections ticked for them.
 * A section is a sidebar page (SECTIONS below). A section that is not granted
 * is hidden in the app and refused here (requireSection, 403).
 *
 * Older accounts carry the retired roles manager and agent (and the original
 * app's user/ops) and no `sections`. They are read as staff with the sections
 * of migration 044 (LEGACY_SECTIONS), so nothing changes before it runs.
 *
 * Platform staff are separate accounts (is_platform_staff, tenant_id = null):
 * founder (shown as "Admin (Owner)", full access) and ops (shown as "Staff",
 * everything except billing grants, staff management and data deletion).
 * A customer role never grants a platform permission.
 */
const TENANT_ROLES = ['owner', 'admin', 'staff'];
const STAFF_ROLES = ['founder', 'ops'];

// Sections an Admin or Staff member can be given (the app's sidebar pages).
// followups: the automatic follow-up engine (due list, rules, AI follow-up
// text, touch counts); separate from ai_brain so it can be given alone.
const SECTIONS = ['dashboard', 'leads', 'sales_tasks', 'inbox', 'templates', 'campaigns', 'ai_brain', 'followups', 'plugins', 'reports'];
const SECTION_LABELS = {
  dashboard: 'Dashboard',
  leads: 'Leads',
  sales_tasks: 'Sales Task',
  inbox: 'WhatsApp Chat',
  templates: 'Templates',
  campaigns: 'Campaigns',
  ai_brain: 'AI Brain',
  followups: 'Follow-ups',
  plugins: 'Plugins & Calendar',
  reports: 'Reports',
};
// Work on one lead (open it, its chat, notes, labels, status) is shared by the
// pages that show leads: Leads, WhatsApp Chat, Sales Task and Dashboard.
const LEAD_WORK = ['leads', 'inbox', 'sales_tasks', 'dashboard'];
// Ticked by default when adding someone.
const DEFAULT_SECTIONS = { admin: [...SECTIONS], staff: ['leads', 'inbox'] };

// Retired role values: read as staff with these sections (migration 044).
const LEGACY_SECTIONS = {
  manager: ['dashboard', 'leads', 'sales_tasks', 'inbox', 'templates', 'campaigns', 'ai_brain', 'followups', 'reports'],
  agent: ['leads', 'sales_tasks', 'inbox'],
  user: ['leads', 'sales_tasks', 'inbox'],
  ops: ['leads', 'sales_tasks', 'inbox'],
};
const LEGACY_TENANT_ROLES = { manager: 'staff', agent: 'staff', user: 'staff', ops: 'staff' };

// roles: who may; section: and (for admin and staff) only with that section.
// Owners always have every section.
const TENANT_PERMISSIONS = {
  'team.view': { roles: ['owner', 'admin'] },
  // Admins manage Staff only (teamMembers.assertCanGrant, userAdmin.assertCanManage).
  'team.manage': { roles: ['owner', 'admin'] },
  'tenant.settings': { roles: ['owner'] },
  'whatsapp.manage': { roles: ['owner'] },
  'calendar.manage': { roles: ['owner'] },
  // Settings > Integrations: connect Facebook Pages for Lead Ads.
  'integrations.manage': { roles: ['owner'] },
  'templates.manage': { roles: ['owner', 'admin', 'staff'], section: 'templates' },
  'campaigns.manage': { roles: ['owner', 'admin', 'staff'], section: 'campaigns' },
  'ai_brain.manage': { roles: ['owner', 'admin', 'staff'], section: 'ai_brain' },
  // Staff with Leads view, edit, assign and add notes; bulk export and delete
  // are for Owners and Admins with Leads.
  'leads.export': { roles: ['owner', 'admin'], section: 'leads' },
  'leads.delete': { roles: ['owner', 'admin'], section: 'leads' },
  // Lead notes: everyone deletes their own; these roles delete anyone's.
  'leads.notes.delete_any': { roles: ['owner', 'admin'] },
  // Create, rename, recolour and delete lead labels. Every member may put
  // labels on leads and take them off.
  'labels.manage': { roles: ['owner', 'admin'] },
  // Plans, wallet and payments (Settings > Billing).
  'billing.view': { roles: ['owner', 'admin'] },
  'billing.manage': { roles: ['owner'] },
  // The whole-workspace data export (every contact and message).
  'workspace.export': { roles: ['owner'] },
  // Settings > Activity: who in the workspace did what, and when.
  'activity.view': { roles: ['owner'] },
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
  // Price list and per-workspace billing: viewing for all staff, changing
  // prices and adjusting wallets for the Admin (Owner) only.
  'platform.billing.view': ['founder', 'ops'],
  'platform.billing.manage': ['founder'],
};

// Customer roles that must set up two-step verification before their first
// session. Empty by default: customers turn it on themselves in Settings.
// Set MFA_REQUIRED_TENANT_ROLES=owner,admin to require it. Platform staff
// always need it (MFA_ENFORCED).
const mfaRequiredTenantRoles = () => String(process.env.MFA_REQUIRED_TENANT_ROLES || '')
  .split(',').map((r) => r.trim()).filter(Boolean);

function normalizeTenantRole(role) {
  const value = String(role || '').toLowerCase();
  if (TENANT_ROLES.includes(value)) return value;
  return LEGACY_TENANT_ROLES[value] || 'staff';
}

// A valid, ordered, de-duplicated list of section keys (unknown keys dropped).
function cleanSections(list) {
  if (!Array.isArray(list)) return [];
  const wanted = new Set(list.map((key) => String(key || '').toLowerCase()));
  return SECTIONS.filter((key) => wanted.has(key));
}

// The sections a user stored with `role` (raw, possibly retired) and
// `sections` (possibly missing) has. Owners have all of them.
function sectionsFor(role, sections) {
  const raw = String(role || '').toLowerCase();
  if (normalizeTenantRole(raw) === 'owner') return [...SECTIONS];
  if (Array.isArray(sections)) return cleanSections(sections);
  if (raw === 'admin') return [...SECTIONS];
  if (LEGACY_SECTIONS[raw]) return [...LEGACY_SECTIONS[raw]];
  return [...DEFAULT_SECTIONS.staff];
}

// Sections for someone added with `role` when none were chosen. A retired
// role name (sent by an older app) keeps the access it used to give.
function defaultSectionsFor(role) {
  const raw = String(role || '').toLowerCase();
  if (LEGACY_SECTIONS[raw]) return [...LEGACY_SECTIONS[raw]];
  return [...(DEFAULT_SECTIONS[normalizeTenantRole(raw)] || SECTIONS)];
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
  return {
    kind: 'tenant',
    role: normalizeTenantRole(user.role),
    tenantId: Number(user.tenant_id),
    staffRole: null,
    sections: sectionsFor(user.role, user.sections),
  };
}

// Whether this identity may use a section. Platform staff and n8n (service)
// act for the whole workspace; Owners have every section.
function hasSection(identity, section) {
  if (!identity) return false;
  if (identity.kind === 'staff' || identity.kind === 'service') return true;
  if (identity.kind !== 'tenant') return false;
  if (identity.role === 'owner') return true;
  return Array.isArray(identity.sections) && identity.sections.includes(section);
}

function can(identity, permission) {
  if (!identity) return false;
  if (permission.startsWith('platform.')) {
    return identity.kind === 'staff' && (STAFF_PERMISSIONS[permission] || []).includes(identity.staffRole);
  }
  if (identity.kind === 'staff') return true;
  if (identity.kind !== 'tenant') return false;
  const rule = TENANT_PERMISSIONS[permission];
  if (!rule || !rule.roles.includes(identity.role)) return false;
  return !rule.section || hasSection(identity, rule.section);
}

// Staff see only their own rows in reports; Owners and Admins see the team.
const ownDataOnly = (identity) => identity?.kind === 'tenant' && identity.role === 'staff';

function mfaRequired(identity) {
  if (!identity) return false;
  if (identity.kind === 'staff') return true;
  return identity.kind === 'tenant' && mfaRequiredTenantRoles().includes(identity.role);
}

// Express middleware: 403 unless req.identity has the permission.
function requirePermission(permission) {
  return (req, res, next) => {
    if (can(req.identity, permission)) return next();
    return res.status(403).json({ error: 'You do not have permission to do this', permission });
  };
}

// Express middleware: 403 unless req.identity may use one of the sections.
function requireSection(...sections) {
  const wanted = sections.flat();
  return (req, res, next) => {
    if (wanted.some((section) => hasSection(req.identity, section))) return next();
    return res.status(403).json({ error: 'You do not have access to this part of the workspace', code: 'SECTION_FORBIDDEN', sections: wanted });
  };
}

// Which roles a customer user may assign: Owners any role; Admins only Staff,
// and only to someone who is Staff. Nobody changes their own role.
function canAssignRole(actorRole, targetCurrentRole, newRole) {
  if (!TENANT_ROLES.includes(newRole)) return false;
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return newRole === 'staff' && normalizeTenantRole(targetCurrentRole) === 'staff';
  return false;
}

// Sections `actor` ({ kind, role, sections }) may give: Owners and platform
// staff any; Admins only the ones they have.
function grantableSections(actor) {
  if (!actor) return [];
  if (actor.kind === 'staff' || actor.role === 'owner') return [...SECTIONS];
  if (actor.role === 'admin') return cleanSections(actor.sections);
  return [];
}

module.exports = {
  TENANT_ROLES,
  STAFF_ROLES,
  SECTIONS,
  SECTION_LABELS,
  LEAD_WORK,
  DEFAULT_SECTIONS,
  LEGACY_SECTIONS,
  TENANT_PERMISSIONS,
  STAFF_PERMISSIONS,
  normalizeTenantRole,
  cleanSections,
  sectionsFor,
  defaultSectionsFor,
  describeUser,
  can,
  hasSection,
  ownDataOnly,
  mfaRequired,
  requirePermission,
  requireSection,
  canAssignRole,
  grantableSections,
};
