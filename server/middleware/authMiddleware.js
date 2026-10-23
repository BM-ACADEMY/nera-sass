/**
 * Authentication and request context (plans S9, T6, A1, A6, U6).
 *
 * Every protected request:
 *   1. verifies the login token's signature;
 *   2. re-reads the user from the database — existence, active flag, token
 *      version (revocation) and role — and, for customer users, the tenant's
 *      status and lifecycle state;
 *   3. runs the rest of the request inside that user's tenant context, so the
 *      tenant-scope plugin limits every query to that tenant.
 * The tenant always comes from the database, never from the request.
 *
 * Middlewares:
 *   auth          customer workspace routes (tenant users only)
 *   requireAuth   own-account routes (/api/auth/*): tenant users and staff
 *   staffAuth     platform routes (platform staff only, system context)
 *   internalAuth  n8n / internal jobs with the service key + x-tenant-id, or a user token
 *   internalPlatformAuth  service key without tenant, or platform staff
 *   socketAuth    Socket.io handshake; joins tenant:<id> or platform room
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { methodsOf } = require('../services/mfa');

// No fallback secret: a missing JWT_SECRET must stop the server, otherwise
// anyone could sign tokens with a publicly known default.
function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

function bearerToken(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

// Constant-time comparison of the x-internal-key header (used by n8n and the
// server's own cron jobs). Fails closed when INTERNAL_API_KEY is unset.
function hasInternalKey(req) {
  const expected = process.env.INTERNAL_API_KEY;
  const provided = req.headers['x-internal-key'];
  if (!expected || typeof provided !== 'string') return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Lazily required: models depend on db/mongo, which this file must not load
// at require time (authController imports jwtSecret from here).
const deps = () => ({
  ...require('../services/tenantContext'),
  ...require('../services/permissions'),
  ...require('../services/lifecycle'),
  ...require('../models'),
});

class AuthError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function issueAccessToken(user, { mfa = false } = {}) {
  return jwt.sign(
    { id: user.id, tid: user.tenant_id ?? null, tv: Number(user.token_version || 0), mfa: Boolean(mfa), typ: 'access' },
    jwtSecret(),
    { expiresIn: process.env.JWT_EXPIRES_IN || '1d' },
  );
}

// Short-lived token that only allows finishing MFA ('mfa') or enrolling ('mfa_setup').
function issueMfaToken(user, purpose) {
  return jwt.sign({ id: user.id, tv: Number(user.token_version || 0), typ: purpose }, jwtSecret(), { expiresIn: '10m' });
}

/**
 * Resolves a token to a live identity, re-reading everything from the database.
 * Throws AuthError on any problem.
 */
async function resolveIdentity(token, { purpose = 'access' } = {}) {
  const { runAsSystem, describeUser, mfaRequired, tenantLifecycle, Users } = deps();
  if (!token) throw new AuthError(401, 'No token');
  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    throw new AuthError(401, 'Invalid token');
  }
  if ((payload.typ || 'access') !== purpose) throw new AuthError(401, 'Invalid token');
  const user = await runAsSystem(() => Users.findOne({ id: Number(payload.id) }, { _id: 0 }).lean(), 'auth');
  if (!user) throw new AuthError(401, 'Session is no longer valid', 'SESSION_INVALID');
  if (user.is_active === false) throw new AuthError(401, 'This account has been deactivated', 'ACCOUNT_DEACTIVATED');
  if (Number(payload.tv || 0) !== Number(user.token_version || 0)) throw new AuthError(401, 'Session has been revoked; please sign in again', 'SESSION_REVOKED');

  const identity = describeUser(user);
  if (identity.kind === 'none') throw new AuthError(403, 'This account is not assigned to a workspace', 'NO_WORKSPACE');
  if (identity.kind === 'tenant' && payload.tid != null && Number(payload.tid) !== identity.tenantId) {
    throw new AuthError(401, 'Session is no longer valid', 'SESSION_INVALID');
  }
  if (purpose === 'access' && process.env.MFA_ENFORCED !== 'false' && mfaRequired(identity) && !payload.mfa) {
    throw new AuthError(401, 'Two-factor authentication is required; please sign in again', 'MFA_REQUIRED');
  }

  let lifecycle = null;
  if (identity.kind === 'tenant') {
    lifecycle = await tenantLifecycle(identity.tenantId);
    if (!lifecycle.tenant || lifecycle.state === 'deleted') throw new AuthError(401, 'This workspace no longer exists', 'TENANT_DELETED');
  }
  return { user, identity, lifecycle };
}

function publicUser(user, identity, tenant) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || null,
    role: identity.kind === 'tenant' ? identity.role : 'platform_staff',
    tenant_id: identity.kind === 'tenant' ? identity.tenantId : null,
    tenant_name: tenant?.name || null,
    is_platform_staff: identity.kind === 'staff',
    staff_role: identity.staffRole,
    mfa_enabled: methodsOf(user).length > 0,
    mfa_methods: methodsOf(user),
  };
}

function attach(req, resolved) {
  const { user, identity, lifecycle } = resolved;
  req.identity = identity;
  req.tenant = lifecycle?.tenant || null;
  req.lifecycle = lifecycle;
  req.user = publicUser(user, identity, req.tenant);
}

function sendAuthError(res, error) {
  if (error instanceof AuthError) return res.status(error.status).json({ error: error.message, code: error.code });
  console.error('[auth]', error.message);
  return res.status(500).json({ error: 'Authentication failed' });
}

// Methods a restricted tenant may still use, besides reads.
const EXPORT_PATHS = [/^\/api\/leads\/exports(\/|$)/, /^\/api\/sales-tasks\/export$/];
const isExportRequest = (req) => EXPORT_PATHS.some((re) => re.test(req.originalUrl.split('?')[0]));

// Applies the lifecycle rules to a customer request; returns an AuthError or null.
function lifecycleBlock(req, lifecycle, { accountRoute = false } = {}) {
  if (!lifecycle) return null;
  if (lifecycle.access === 'none') {
    return new AuthError(403, lifecycle.manual
      ? 'This workspace has been suspended. Contact support.'
      : 'This workspace is suspended because the subscription has ended. Renew to restore access.', 'TENANT_SUSPENDED');
  }
  const readOnlyMethod = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (lifecycle.access === 'read_export' && !readOnlyMethod && !accountRoute && !isExportRequest(req)) {
    return new AuthError(403, 'This workspace is restricted to reading and exporting data until the subscription is renewed.', 'TENANT_RESTRICTED');
  }
  return null;
}

// Customer workspace routes.
const auth = async (req, res, next) => {
  const { runAsTenant } = deps();
  let resolved;
  try {
    resolved = await resolveIdentity(bearerToken(req));
  } catch (error) {
    return sendAuthError(res, error);
  }
  // Customer workspaces are for customer users only, in every environment.
  // Platform staff work through /api/admin; there is no way to pick a tenant
  // here (impersonation, if ever added, must be explicit and audited — plan A10).
  if (resolved.identity.kind !== 'tenant') {
    return res.status(403).json({ error: 'Platform staff accounts cannot open customer workspaces. Use the admin panel.', code: 'STAFF_NOT_ALLOWED' });
  }
  const blocked = lifecycleBlock(req, resolved.lifecycle);
  if (blocked) return sendAuthError(res, blocked);
  attach(req, resolved);
  return runAsTenant(resolved.identity.tenantId, next, { userId: resolved.user.id });
};

// Own-account routes (profile, password, MFA, logout): tenant users and staff.
const requireAuth = async (req, res, next) => {
  const { runAsTenant, runAsSystem } = deps();
  let resolved;
  try {
    resolved = await resolveIdentity(bearerToken(req));
  } catch (error) {
    return sendAuthError(res, error);
  }
  const blocked = lifecycleBlock(req, resolved.lifecycle, { accountRoute: true });
  if (blocked) return sendAuthError(res, blocked);
  attach(req, resolved);
  if (resolved.identity.kind === 'tenant') return runAsTenant(resolved.identity.tenantId, next, { userId: resolved.user.id });
  return runAsSystem(next, `staff:${resolved.user.id}`);
};

// OAuth redirect routes of staff-only modules: the browser or provider opens
// them without an Authorization header.
const OAUTH_REDIRECT_PATHS = ['/auth/google', '/auth/callback', '/youtube/auth', '/youtube/callback', '/linkedin/auth', '/linkedin/callback'];

// Platform staff routes. Optional permission check.
function staffAuth(permission, { allowOAuthRedirects = false } = {}) {
  return async (req, res, next) => {
    const { runAsSystem, can } = deps();
    if (allowOAuthRedirects && OAUTH_REDIRECT_PATHS.some((p) => req.path.endsWith(p))) {
      return runAsSystem(next, 'oauth-redirect');
    }
    let resolved;
    try {
      resolved = await resolveIdentity(bearerToken(req));
    } catch (error) {
      return sendAuthError(res, error);
    }
    if (resolved.identity.kind !== 'staff') {
      return res.status(403).json({ error: 'Platform staff only', code: 'STAFF_ONLY' });
    }
    attach(req, resolved);
    if (permission && !can(resolved.identity, permission)) {
      return res.status(403).json({ error: 'You do not have permission to do this', permission });
    }
    return runAsSystem(next, `staff:${resolved.user.id}`);
  };
}

// Service calls (n8n, the server's own cron) must name the tenant they act for.
async function serviceTenant(req) {
  const { tenantLifecycle } = deps();
  const raw = req.headers['x-tenant-id'];
  if (!raw) throw new AuthError(400, 'x-tenant-id header is required for service calls', 'TENANT_REQUIRED');
  const tenantId = Number(raw);
  if (!Number.isInteger(tenantId) || tenantId <= 0) throw new AuthError(400, 'Invalid x-tenant-id', 'TENANT_REQUIRED');
  const lifecycle = await tenantLifecycle(tenantId);
  if (!lifecycle.tenant || lifecycle.state === 'deleted') throw new AuthError(404, 'Unknown tenant', 'TENANT_UNKNOWN');
  return lifecycle;
}

const internalAuth = async (req, res, next) => {
  if (!hasInternalKey(req)) return auth(req, res, next);
  const { runAsTenant } = deps();
  let lifecycle;
  try {
    lifecycle = await serviceTenant(req);
  } catch (error) {
    return sendAuthError(res, error);
  }
  const blocked = lifecycleBlock(req, lifecycle);
  if (blocked) return sendAuthError(res, blocked);
  req.identity = { kind: 'service', tenantId: lifecycle.tenant.id };
  req.tenant = lifecycle.tenant;
  req.lifecycle = lifecycle;
  req.user = { id: null, role: 'service', tenant_id: lifecycle.tenant.id, is_platform_staff: false };
  return runAsTenant(lifecycle.tenant.id, next, { service: true });
};

// Platform-level internal routes (cross-tenant reports, maintenance).
const internalPlatformAuth = async (req, res, next) => {
  if (!hasInternalKey(req)) return staffAuth('platform.reports')(req, res, next);
  const { runAsSystem } = deps();
  req.identity = { kind: 'service', tenantId: null };
  req.user = { id: null, role: 'service', tenant_id: null, is_platform_staff: false };
  return runAsSystem(next, 'service');
};

// Socket.io handshake: valid login token required; joins the tenant's room.
const socketAuth = async (socket, next) => {
  try {
    const resolved = await resolveIdentity(socket.handshake.auth?.token);
    const blocked = resolved.lifecycle && resolved.lifecycle.access === 'none';
    if (blocked) return next(new Error('Workspace suspended'));
    socket.data.user = publicUser(resolved.user, resolved.identity, resolved.lifecycle?.tenant);
    socket.join(resolved.identity.kind === 'tenant' ? `tenant:${resolved.identity.tenantId}` : 'platform');
    return next();
  } catch {
    return next(new Error('Unauthorized'));
  }
};

module.exports = {
  AuthError,
  requireAuth,
  auth,
  staffAuth,
  internalAuth,
  internalPlatformAuth,
  socketAuth,
  verifyToken,
  jwtSecret,
  hasInternalKey,
  bearerToken,
  issueAccessToken,
  issueMfaToken,
  resolveIdentity,
  publicUser,
  lifecycleBlock,
};
