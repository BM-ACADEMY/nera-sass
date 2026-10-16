/**
 * Request / job context that decides which tenant's data a database call may
 * touch. Set once per request (authMiddleware), per webhook delivery, or per
 * background row; read by the tenant-scope plugin (db/tenantScope.js).
 *
 *   { tenantId: 7 }                  — a customer user or a job for tenant 7
 *   { system: true, reason: '...' }  — platform staff / platform jobs; no filter
 *
 * With no context at all, tenant-scoped queries throw (fail closed).
 */
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

class TenantContextError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TenantContextError';
    this.status = 403;
  }
}

function getContext() {
  return storage.getStore() || null;
}

function runWithContext(context, fn) {
  return storage.run(Object.freeze({ ...context }), () => {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return (async () => await res)();
    }
    return res;
  });
}

function toTenantId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new TenantContextError(`Invalid tenant id: ${value}`);
  return id;
}

function runAsTenant(tenantId, fn, extra = {}) {
  return runWithContext({ ...extra, tenantId: toTenantId(tenantId), system: false }, fn);
}

function runAsSystem(fn, reason = 'system') {
  return runWithContext({ system: true, reason }, fn);
}

function currentTenantId() {
  const context = getContext();
  return context && !context.system && context.tenantId ? context.tenantId : null;
}

function requireTenantId() {
  const tenantId = currentTenantId();
  if (!tenantId) throw new TenantContextError('This operation needs a tenant context');
  return tenantId;
}

module.exports = {
  TenantContextError,
  getContext,
  runWithContext,
  runAsTenant,
  runAsSystem,
  currentTenantId,
  requireTenantId,
  toTenantId,
};
