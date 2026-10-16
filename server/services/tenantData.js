/**
 * Staff-run tenant data procedures (plan U12) and the lifecycle sweep (plan U6).
 *
 * - exportTenant: every tenant-scoped collection for one tenant, secrets removed.
 * - deleteTenantData: deletes one tenant's data on a written request
 *   (Full Scope p12: "Deleted — day 180, or immediately on written request").
 *   It is never automatic, requires a written-request reference and the typed
 *   tenant name, keeps the tenant row (marked deleted) and the audit trail, and
 *   is disabled unless TENANT_DELETION_ENABLED=true (decision D5).
 * - runLifecycleSweep: stores each tenant's current lifecycle state, audits
 *   changes, and writes an archive export when a tenant reaches "archived".
 */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Tenants } = require('../models');
const { TENANT_SCOPED } = require('../db/tenantScope');
const { runAsSystem, runAsTenant } = require('./tenantContext');
const { stripSecrets } = require('./clientSecrets');
const { computeLifecycle, activeSubscription } = require('./lifecycle');
const audit = require('./audit');

const ARCHIVE_DIR = path.join(__dirname, '..', 'data', 'tenant-archives');
// Never deleted with the tenant: the audit trail is the legal record of what happened.
const KEEP_ON_DELETE = new Set(['audit_events']);

const scopedModels = () => [...TENANT_SCOPED.keys()]
  .map((collection) => [collection, mongoose.models[collection]])
  .filter(([, model]) => model);

async function exportTenant(tenantId) {
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0 }).lean(), 'export');
  if (!tenant) return null;
  const collections = {};
  await runAsTenant(tenantId, async () => {
    for (const [collection, model] of scopedModels()) {
      const rows = await model.find({}, { _id: 0 }).lean();
      if (rows.length) collections[collection] = rows.map(stripSecrets);
    }
  });
  return { exported_at: new Date().toISOString(), tenant, collections };
}

async function writeArchive(tenantId) {
  const data = await exportTenant(tenantId);
  if (!data) return null;
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  const file = path.join(ARCHIVE_DIR, `tenant-${tenantId}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(data));
  return path.relative(path.join(__dirname, '..'), file);
}

class DeletionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function deleteTenantData(tenantId, { writtenRequestReference, confirmName, req = null }) {
  if (process.env.TENANT_DELETION_ENABLED !== 'true') {
    throw new DeletionError(403, 'Tenant data deletion is disabled on this server (set TENANT_DELETION_ENABLED=true after approval)');
  }
  const reference = String(writtenRequestReference || '').trim();
  if (!reference) throw new DeletionError(400, 'A written-request reference is required');
  const tenant = await runAsSystem(() => Tenants.findOne({ id: Number(tenantId) }, { _id: 0 }).lean(), 'deletion');
  if (!tenant) throw new DeletionError(404, 'Tenant not found');
  if (tenant.deleted_at) throw new DeletionError(409, 'Tenant data was already deleted');
  if (String(confirmName || '').trim() !== tenant.name) throw new DeletionError(400, 'Type the tenant name exactly to confirm deletion');

  const archive = await writeArchive(tenant.id);
  const counts = {};
  await runAsTenant(tenant.id, async () => {
    for (const [collection, model] of scopedModels()) {
      if (KEEP_ON_DELETE.has(collection)) continue;
      const result = await model.deleteMany({});
      if (result.deletedCount) counts[collection] = result.deletedCount;
    }
  });
  const now = new Date();
  await runAsSystem(() => Tenants.updateOne({ id: tenant.id }, {
    $set: { status: 'deleted', lifecycle_state: 'deleted', deleted_at: now, deletion_request_reference: reference, deletion_requested_at: now, archive_file: archive, updated_at: now },
  }), 'deletion');
  await audit.record(audit.EVENTS.TENANT_DATA_DELETED, { tenantId: tenant.id, req, targetType: 'tenant', targetId: tenant.id, meta: { reference, counts, archive } });
  return { counts, archive };
}

async function runLifecycleSweep(now = new Date()) {
  const tenants = await runAsSystem(() => Tenants.find({ status: { $ne: 'deleted' } }, { _id: 0 }).lean(), 'lifecycle-sweep');
  const changes = [];
  for (const tenant of tenants) {
    const subscription = await activeSubscription(tenant.id);
    const { state } = computeLifecycle(tenant, subscription, now);
    if (state === tenant.lifecycle_state) continue;
    const update = { lifecycle_state: state, lifecycle_changed_at: now, updated_at: now };
    if (state === 'archived' && !tenant.archived_at) {
      update.archived_at = now;
      update.archive_file = await writeArchive(tenant.id);
    }
    await runAsSystem(() => Tenants.updateOne({ id: tenant.id }, { $set: update }), 'lifecycle-sweep');
    await audit.record(audit.EVENTS.TENANT_LIFECYCLE_CHANGED, {
      tenantId: tenant.id,
      actor: { actor_type: 'system', actor_user_id: null },
      targetType: 'tenant',
      targetId: tenant.id,
      meta: { from: tenant.lifecycle_state || null, to: state, archive: update.archive_file || null },
    });
    changes.push({ tenant_id: tenant.id, from: tenant.lifecycle_state, to: state });
  }
  return changes;
}

module.exports = { DeletionError, exportTenant, writeArchive, deleteTenantData, runLifecycleSweep, ARCHIVE_DIR };
