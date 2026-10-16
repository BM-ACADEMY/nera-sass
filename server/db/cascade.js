/**
 * Emulates the Postgres foreign-key rules (ON DELETE CASCADE / SET NULL / NO ACTION
 * and ON UPDATE CASCADE) that the old schema enforced, since MongoDB has none.
 * Always delete parent records through deleteCascade() instead of Model.deleteX().
 */
const models = require('../models');

// [parent collection, parent key, child collection, child column, on delete, on update]
const FOREIGN_KEYS = [
  ['alliance_audiences', 'id', 'alliance_audience_fields', 'audience_id', 'cascade'],
  ['alliance_audiences', 'code', 'alliance_brands', 'audience', 'setNull', 'updateCascade'],
  ['alliance_audiences', 'code', 'alliance_prompt_rules', 'audience', 'cascade', 'updateCascade'],
  ['alliance_brands', 'id', 'alliance_offerings', 'brand_id', 'cascade'],
  ['alliance_campaigns', 'id', 'alliance_campaign_prospects', 'campaign_id', 'cascade'],
  ['alliance_campaigns', 'id', 'alliance_campaign_templates', 'campaign_id', 'cascade'],
  ['alliance_campaigns', 'id', 'alliance_email_events', 'campaign_id', 'cascade'],
  ['alliance_campaigns', 'id', 'alliance_email_inbound', 'campaign_id', 'setNull'],
  ['alliance_campaigns', 'id', 'alliance_prospects', 'campaign_id', 'setNull'],
  ['alliance_campaigns', 'id', 'alliance_touches', 'campaign_id', 'setNull'],
  ['alliance_domains', 'id', 'alliance_campaigns', 'sender_domain_id', 'setNull'],
  ['alliance_domains', 'id', 'alliance_touches', 'domain_id', 'setNull'],
  ['alliance_email_inbound', 'id', 'alliance_email_attachments', 'inbound_id', 'cascade'],
  ['alliance_email_inbound', 'id', 'alliance_replies', 'email_inbound_id', 'setNull'],
  ['alliance_inbox_contacts', 'id', 'alliance_contact_tags', 'contact_id', 'cascade'],
  ['alliance_inbox_contacts', 'id', 'alliance_inbox_conversations', 'contact_id', 'cascade'],
  ['alliance_inbox_contacts', 'id', 'alliance_inbox_messages', 'contact_id', 'cascade'],
  ['alliance_inbox_conversations', 'id', 'alliance_inbox_messages', 'conversation_id', 'cascade'],
  ['alliance_inbox_messages', 'id', 'alliance_inbox_media', 'message_id', 'setNull'],
  ['alliance_inbox_tags', 'id', 'alliance_contact_tags', 'tag_id', 'cascade'],
  ['alliance_inbox_tags', 'id', 'alliance_prospect_tags', 'tag_id', 'cascade'],
  ['alliance_inbox_tags', 'id', 'lead_tags', 'tag_id', 'cascade'],
  ['alliance_numbers', 'id', 'alliance_touches', 'number_id', 'setNull'],
  ['alliance_offerings', 'id', 'alliance_offering_faqs', 'offering_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_campaign_prospects', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_email_events', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_email_inbound', 'prospect_id', 'setNull'],
  ['alliance_prospects', 'id', 'alliance_inbox_contacts', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_prospect_tags', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_replies', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_touches', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_whatsapp_campaign_recipients', 'prospect_id', 'cascade'],
  ['alliance_prospects', 'id', 'alliance_whatsapp_followup_jobs', 'prospect_id', 'cascade'],
  ['alliance_touches', 'id', 'alliance_email_events', 'touch_id', 'cascade'],
  ['alliance_touches', 'id', 'alliance_email_inbound', 'touch_id', 'setNull'],
  ['alliance_whatsapp_campaigns', 'id', 'alliance_whatsapp_campaign_recipients', 'campaign_id', 'cascade'],
  ['alliance_whatsapp_campaigns', 'id', 'alliance_whatsapp_followup_jobs', 'campaign_id', 'cascade'],
  ['brands', 'id', 'ai_brain', 'brand_id', 'restrict'],
  ['brands', 'id', 'conversations', 'brand_id', 'restrict'],
  ['brands', 'id', 'leads', 'brand_id', 'restrict'],
  ['brands', 'id', 'organisations', 'brand_id', 'restrict'],
  ['campaigns', 'id', 'campaign_logs', 'campaign_id', 'cascade'],
  ['chatbot_flows', 'id', 'chatbot_flowsteps', 'flow_id', 'cascade'],
  ['chatbot_flows', 'id', 'chatbot_knowledgebase', 'flow_id', 'cascade'],
  ['chatbot_flows', 'id', 'chatbot_userprogresses', 'flow_id', 'cascade'],
  ['citation_scans', 'id', 'citation_results', 'scanId', 'cascade'],
  ['clients', 'id', 'brain_docs', 'client_id', 'cascade'],
  ['clients', 'name', 'brand_social_accounts', 'brand_name', 'restrict', 'updateCascade'],
  ['clients', 'id', 'campaigns', 'client_id', 'setNull'],
  ['clients', 'id', 'chatbot_flows', 'client_id', 'cascade'],
  ['clients', 'name', 'content_queue', 'brand_name', 'restrict', 'updateCascade'],
  ['clients', 'id', 'gmb_keywords', 'client_id', 'cascade'],
  ['clients', 'id', 'leads', 'client_id', 'setNull'],
  ['clients', 'id', 'meta_whatsapp_phone_numbers', 'client_id', 'setNull'],
  ['clients', 'id', 'templates', 'client_id', 'setNull'],
  ['content_queue', 'id', 'publish_queue', 'content_id', 'cascade'],
  ['conversations', 'id', 'messages', 'conversation_id', 'cascade'],
  ['departments', 'id', 'users', 'department_id', 'restrict'],
  ['gmb_keywords', 'id', 'gmb_keyword_history', 'keyword_id', 'cascade'],
  ['leads', 'id', 'campaign_import_recipients', 'lead_id', 'cascade'],
  ['leads', 'id', 'campaign_logs', 'lead_id', 'cascade'],
  ['leads', 'id', 'chatbot_userprogresses', 'lead_id', 'cascade'],
  ['leads', 'id', 'conversations', 'lead_id', 'cascade'],
  ['leads', 'id', 'demo_call_reminders', 'lead_id', 'cascade'],
  ['leads', 'id', 'lead_notes', 'lead_id', 'cascade'],
  ['leads', 'id', 'lead_tags', 'lead_id', 'cascade'],
  ['leads', 'id', 'payments', 'lead_id', 'cascade'],
  ['leads', 'id', 'sales_lead_notes', 'lead_id', 'cascade'],
  ['leads', 'id', 'sales_tasks', 'lead_id', 'restrict'],
  ['mafiya_gmb_clients', 'id', 'api_usage_logs', 'client_id', 'setNull'],
  ['mafiya_gmb_clients', 'id', 'citation_scans', 'businessId', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'client_directory_cache', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_ai_suggestions_log', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_brain_ai_log', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_citations_scans_log', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_gbp_insights_cache', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_geogrid_scans_log', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_gmb_brain', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_gmb_posts', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_gmb_tokens', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_products', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_review_replies', 'client_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_rivals', 'business_id', 'cascade'],
  ['mafiya_gmb_clients', 'id', 'mafiya_turf_keywords', 'client_id', 'cascade'],
  ['mafiya_plans', 'id', 'mafiya_gmb_clients', 'plan_id', 'setNull'],
  ['mafiya_plans', 'id', 'mafiya_plan_features', 'plan_id', 'cascade'],
  ['mafiya_rivals', 'id', 'mafiya_rival_metrics', 'rival_id', 'cascade'],
  ['meta_whatsapp_accounts', 'waba_id', 'meta_whatsapp_phone_numbers', 'waba_id', 'cascade'],
  ['organisations', 'id', 'ai_analysis', 'org_id', 'cascade'],
  ['organisations', 'id', 'meetings', 'org_id', 'cascade'],
  ['organisations', 'id', 'outreach', 'org_id', 'cascade'],
  ['organisations', 'id', 'pipeline_stages', 'org_id', 'cascade'],
  ['schema_templates', 'id', 'schema_deployments', 'template_id', 'cascade'],
  ['templates', 'id', 'campaigns', 'template_id', 'setNull'],
  ['tenants', 'id', 'alliance_campaigns', 'tenant_id', 'cascade'],
  ['tenants', 'id', 'alliance_domains', 'tenant_id', 'cascade'],
  ['tenants', 'id', 'alliance_numbers', 'tenant_id', 'cascade'],
  ['tenants', 'id', 'alliance_prospects', 'tenant_id', 'cascade'],
  ['tenants', 'id', 'alliance_replies', 'tenant_id', 'cascade'],
  ['thedal_audits', 'id', 'thedal_audit_items', 'audit_id', 'cascade'],
  ['thedal_clients', 'id', 'competitor_spy_history', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'serp_radar_history', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_audits', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_backlinks', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_content', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_gsc_coverage', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_gsc_pages', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_gsc_queries', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_gsc_snapshots', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_gsc_tokens', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_keywords', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_reports', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_rivals', 'client_id', 'cascade'],
  ['thedal_clients', 'id', 'thedal_schema_library', 'client_id', 'cascade'],
  ['thedal_keywords', 'id', 'thedal_rank_history', 'keyword_id', 'cascade'],
  ['thedal_plans', 'id', 'thedal_plan_features', 'plan_id', 'cascade'],
  ['users', 'id', 'ai_brain', 'updated_by', 'restrict'],
  ['users', 'id', 'campaigns', 'created_by', 'restrict'],
  ['users', 'id', 'conversations', 'assigned_to', 'restrict'],
  ['users', 'id', 'lead_notes', 'user_id', 'setNull'],
  ['users', 'id', 'leads', 'admitted_by', 'restrict'],
  ['users', 'id', 'leads', 'assigned_to', 'restrict'],
  ['users', 'id', 'meetings', 'created_by', 'restrict'],
  ['users', 'id', 'messages', 'sent_by', 'restrict'],
  ['users', 'id', 'organisations', 'assigned_to', 'restrict'],
  ['users', 'id', 'pipeline_stages', 'assigned_to', 'restrict'],
  ['users', 'id', 'prompt_templates', 'updated_by', 'restrict'],
  ['users', 'id', 'team_members', 'user_id', 'cascade'],
];

const modelByCollection = new Map(Object.values(models).map((model) => [model.collection.collectionName, model]));
const modelFor = (collection) => {
  const model = modelByCollection.get(collection);
  if (!model) throw new Error(`No model for collection ${collection}`);
  return model;
};

function foreignKeyError(parent, child) {
  const error = new Error(`update or delete on "${parent}" violates foreign key constraint on "${child}"`);
  error.code = '23503';
  return error;
}

// Collects every document that a cascading delete would remove, and fails
// (before anything is deleted) when a NO ACTION/RESTRICT child still exists.
async function planDelete(collection, filter, plan) {
  const docs = await modelFor(collection).find(filter).lean();
  if (!docs.length) return;
  const entry = plan.get(collection) || { ids: new Set(), docs: [] };
  const fresh = docs.filter((doc) => !entry.ids.has(String(doc._id)));
  if (!fresh.length) return;
  fresh.forEach((doc) => { entry.ids.add(String(doc._id)); entry.docs.push(doc); });
  plan.set(collection, entry);

  for (const [parent, parentKey, child, column, onDelete] of FOREIGN_KEYS) {
    if (parent !== collection) continue;
    const values = [...new Set(fresh.map((doc) => doc[parentKey]).filter((v) => v !== null && v !== undefined))];
    if (!values.length) continue;
    const childFilter = { [column]: { $in: values } };
    if (onDelete === 'cascade') await planDelete(child, childFilter, plan);
    else if (onDelete === 'restrict' && await modelFor(child).exists(childFilter)) throw foreignKeyError(parent, child);
  }
}

/**
 * DELETE FROM <collection> WHERE <filter>, applying the original FK actions.
 * Returns the deleted documents of the target collection (like RETURNING *).
 */
async function deleteCascade(collection, filter) {
  const plan = new Map();
  await planDelete(collection, filter, plan);

  for (const [parent, docsEntry] of plan) {
    for (const [fkParent, parentKey, child, column, onDelete] of FOREIGN_KEYS) {
      if (fkParent !== parent || onDelete !== 'setNull') continue;
      const values = [...new Set(docsEntry.docs.map((doc) => doc[parentKey]).filter((v) => v !== null && v !== undefined))];
      if (values.length) await modelFor(child).updateMany({ [column]: { $in: values } }, { $set: { [column]: null } });
    }
  }
  // Delete children before parents (reverse discovery order).
  for (const [name, entry] of [...plan].reverse()) {
    await modelFor(name).deleteMany({ _id: { $in: entry.docs.map((doc) => doc._id) } });
  }
  return (plan.get(collection)?.docs || []).map(({ _id, ...doc }) => doc);
}

// ON UPDATE CASCADE for non-id keys (e.g. alliance_audiences.code, clients.name).
async function updateKeyCascade(collection, key, oldValue, newValue) {
  if (oldValue === newValue || oldValue === null || oldValue === undefined) return;
  for (const [parent, parentKey, child, column, , onUpdate] of FOREIGN_KEYS) {
    if (parent === collection && parentKey === key && onUpdate === 'updateCascade') {
      await modelFor(child).updateMany({ [column]: oldValue }, { $set: { [column]: newValue } });
    }
  }
}

// FK check for inserts/updates: throws a '23503' error when the referenced row is missing.
async function assertReferenceExists(collection, key, value, childCollection = 'child') {
  if (value === null || value === undefined) return;
  if (!(await modelFor(collection).exists({ [key]: value }))) throw foreignKeyError(collection, childCollection);
}

module.exports = { FOREIGN_KEYS, deleteCascade, updateKeyCascade, assertReferenceExists };
