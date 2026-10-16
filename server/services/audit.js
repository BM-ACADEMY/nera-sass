/**
 * Append-only audit log writer (plan T10; Full Scope p13 step 7).
 * Events always carry the tenant they concern (or null for platform events),
 * the actor and a time. Secrets are stripped from metadata.
 */
const { AuditEvents } = require('../models');
const { runAsSystem } = require('./tenantContext');
const { stripSecrets } = require('./clientSecrets');

const EVENTS = Object.freeze({
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_UPDATED: 'TENANT_UPDATED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_REINSTATED: 'TENANT_REINSTATED',
  TENANT_LIFECYCLE_CHANGED: 'TENANT_LIFECYCLE_CHANGED',
  TENANT_EXPORTED: 'TENANT_EXPORTED',
  TENANT_DATA_DELETED: 'TENANT_DATA_DELETED',
  BRAND_UPDATED: 'BRAND_UPDATED',
  TOKEN_UPDATED: 'TOKEN_UPDATED',
  USER_INVITED: 'USER_INVITED',
  INVITATION_REVOKED: 'INVITATION_REVOKED',
  USER_JOINED: 'USER_JOINED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
  USER_DEACTIVATED: 'USER_DEACTIVATED',
  USER_REACTIVATED: 'USER_REACTIVATED',
  SESSIONS_REVOKED: 'SESSIONS_REVOKED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  MFA_ENROLLED: 'MFA_ENROLLED',
  MFA_RESET: 'MFA_RESET',
  LOGIN_FAILED_LOCKOUT: 'LOGIN_FAILED_LOCKOUT',
  PAYMENT_VERIFIED: 'PAYMENT_VERIFIED',
  MANUAL_GRANT_AUTHORIZED: 'MANUAL_GRANT_AUTHORIZED',
  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  ENTITLEMENT_CHANGED: 'ENTITLEMENT_CHANGED',
  CROSS_TENANT_ACCESS_DENIED: 'CROSS_TENANT_ACCESS_DENIED',
  PLATFORM_MAINTENANCE: 'PLATFORM_MAINTENANCE',
});

function actorFrom(req) {
  if (!req) return { actor_type: 'system', actor_user_id: null, ip: null };
  const identity = req.identity;
  let actorType = 'system';
  if (identity?.kind === 'staff') actorType = 'staff';
  else if (identity?.kind === 'tenant') actorType = 'user';
  else if (identity?.kind === 'service') actorType = 'service';
  return { actor_type: actorType, actor_user_id: req.user?.id ?? null, ip: req.ip || null };
}

/**
 * record(event, { tenantId, req, targetType, targetId, meta })
 * Never throws: a failed audit write is logged, the caller continues.
 */
async function record(event, { tenantId = null, req = null, actor = null, targetType = null, targetId = null, meta = {} } = {}) {
  const who = actor || actorFrom(req);
  try {
    await runAsSystem(() => AuditEvents.create({
      tenant_id: tenantId == null ? null : Number(tenantId),
      event,
      actor_type: who.actor_type,
      actor_user_id: who.actor_user_id ?? null,
      target_type: targetType,
      target_id: targetId == null ? null : String(targetId),
      ip: who.ip ?? null,
      meta: stripSecrets(meta),
      created_at: new Date(),
    }), 'audit');
  } catch (error) {
    console.error(`[audit] Failed to record ${event}:`, error.message);
  }
}

module.exports = { EVENTS, record, actorFrom };
