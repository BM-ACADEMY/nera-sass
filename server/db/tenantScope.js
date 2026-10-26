/**
 * Tenant isolation for Mongoose models (plan T4/T6/T9).
 *
 * Every collection listed in TENANT_SCOPED gets a `tenant_id` field and these
 * guarantees, enforced for every query, update, delete, count, aggregate and
 * insert:
 *   - in a tenant context, reads/writes are limited to that tenant and new
 *     documents are stamped with it; a document can never be moved to another
 *     tenant;
 *   - in a system context (platform staff, platform jobs) no filter is added,
 *     but inserts into a required-tenant collection must name their tenant;
 *   - with no context, the call throws (fail closed).
 *
 * `optional` collections may hold platform-level rows with tenant_id = null
 * (for example platform staff users or the platform Meta inventory). Tenant
 * contexts still only ever see their own rows.
 */
const { getContext, TenantContextError } = require('../services/tenantContext');

const TENANT_SCOPED = new Map([
  // identity
  ['users', { optional: true }],
  ['invitations', { optional: true }],
  ['audit_events', { optional: true }],
  // brand profile and WhatsApp
  ['clients', {}],
  ['brand_social_accounts', {}],
  ['meta_whatsapp_accounts', { optional: true }],
  ['meta_whatsapp_phone_numbers', { optional: true }],
  ['meta_whatsapp_templates', { optional: true }],
  ['meta_whatsapp_sync_runs', { optional: true }],
  ['failed_webhooks', { optional: true }],
  // LeadOS data
  ['leads', {}],
  ['conversations', {}],
  ['messages', {}],
  ['media_files', { optional: true }],
  ['templates', {}],
  ['campaigns', {}],
  ['campaign_message_queue', {}],
  ['campaign_logs', {}],
  ['campaign_rate_stats', {}],
  ['campaign_import_recipients', {}],
  ['payments', {}],
  ['brain_docs', {}],
  ['brands', {}],
  ['sales_tasks', {}],
  ['sales_lead_notes', {}],
  ['lead_notes', {}],
  ['lead_tags', {}],
  ['followup_rules', {}],
  ['lead_export_jobs', {}],
  ['demo_call_reminders', {}],
  ['booking_notification_log', {}],
  ['ai_decisions', {}],
  ['reports', {}],
  ['google_calendar_credentials', {}],
  ['workflow_logs', { optional: true }],
]);

const QUERY_OPS = [
  'find', 'findOne', 'countDocuments', 'distinct',
  'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
];
const UPDATE_OPS = new Set(['findOneAndUpdate', 'updateOne', 'updateMany']);
const REPLACE_OPS = new Set(['findOneAndReplace', 'replaceOne']);

function requireContext(collection, action) {
  const context = getContext();
  if (!context) throw new TenantContextError(`No tenant context for ${action} on ${collection}`);
  return context;
}

// Removes any attempt to write tenant_id through an update document, then
// pins it for upserts so a new document lands in the caller's tenant.
function guardUpdate(update, tenantId) {
  if (!update || Array.isArray(update)) {
    if (Array.isArray(update) && JSON.stringify(update).includes('tenant_id')) {
      throw new TenantContextError('Updates may not change tenant_id');
    }
    return update;
  }
  for (const key of Object.keys(update)) {
    if (key === 'tenant_id') throw new TenantContextError('Updates may not change tenant_id');
    if (key.startsWith('$') && update[key] && typeof update[key] === 'object' && 'tenant_id' in update[key] && key !== '$setOnInsert') {
      throw new TenantContextError('Updates may not change tenant_id');
    }
  }
  update.$setOnInsert = { ...(update.$setOnInsert || {}), tenant_id: tenantId };
  return update;
}

function tenantScopePlugin(schema, { collection, optional }) {
  schema.add({ tenant_id: { type: Number, default: null } });
  const alreadyIndexed = schema.indexes().some(([keys]) => Object.keys(keys)[0] === 'tenant_id');
  if (!alreadyIndexed) schema.index({ tenant_id: 1 });

  schema.pre(QUERY_OPS, function scopeQuery() {
    const op = this.op;
    const context = requireContext(collection, op);
    if (context.system) return;
    this.where({ tenant_id: context.tenantId });
    if (UPDATE_OPS.has(op)) guardUpdate(this.getUpdate(), context.tenantId);
    if (REPLACE_OPS.has(op)) {
      const replacement = this.getUpdate();
      if (replacement && replacement.tenant_id != null && replacement.tenant_id !== context.tenantId) {
        throw new TenantContextError('Replacement may not change tenant_id');
      }
      if (replacement) replacement.tenant_id = context.tenantId;
    }
  });

  schema.pre('estimatedDocumentCount', function scopeEstimate() {
    const context = requireContext(collection, 'estimatedDocumentCount');
    if (!context.system) throw new TenantContextError(`estimatedDocumentCount on ${collection} is platform-only; use countDocuments`);
  });

  schema.pre('aggregate', function scopeAggregate() {
    const context = requireContext(collection, 'aggregate');
    if (context.system) return;
    const pipeline = this.pipeline();
    if (pipeline.some((stage) => stage.$lookup || stage.$unionWith || stage.$graphLookup)) {
      throw new TenantContextError(`Cross-collection aggregate stages are not allowed on ${collection}`);
    }
    pipeline.unshift({ $match: { tenant_id: context.tenantId } });
  });

  schema.pre('insertMany', function scopeInsertMany(next, docs) {
    try {
      const context = requireContext(collection, 'insertMany');
      for (const doc of Array.isArray(docs) ? docs : [docs]) stampDocument(doc, context, collection, optional);
      next();
    } catch (error) {
      next(error);
    }
  });

  schema.pre('save', function scopeSave() {
    const context = requireContext(collection, 'save');
    if (this.isNew) {
      stampDocument(this, context, collection, optional);
    } else if (this.isModified('tenant_id') && !context.system) {
      throw new TenantContextError('Documents cannot be moved to another tenant');
    } else if (!context.system && this.tenant_id !== context.tenantId) {
      throw new TenantContextError('Document belongs to another tenant');
    }
  });

  // Deleting a loaded document goes through deleteOne on the document.
  schema.pre('deleteOne', { document: true, query: false }, function scopeDocDelete() {
    const context = requireContext(collection, 'deleteOne');
    if (!context.system && this.tenant_id !== context.tenantId) {
      throw new TenantContextError('Document belongs to another tenant');
    }
  });
}

function stampDocument(doc, context, collection, optional) {
  if (context.system) {
    if (doc.tenant_id == null && !optional) {
      throw new TenantContextError(`Platform jobs must set tenant_id when inserting into ${collection}`);
    }
    return;
  }
  if (doc.tenant_id != null && Number(doc.tenant_id) !== context.tenantId) {
    throw new TenantContextError(`Cannot insert into another tenant's ${collection}`);
  }
  doc.tenant_id = context.tenantId;
}

function applyTenantScope(schema, collection) {
  const config = TENANT_SCOPED.get(collection);
  if (!config) return false;
  tenantScopePlugin(schema, { collection, optional: Boolean(config.optional) });
  return true;
}

module.exports = { TENANT_SCOPED, applyTenantScope, tenantScopePlugin };
