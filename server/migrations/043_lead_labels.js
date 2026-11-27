#!/usr/bin/env node
/**
 * Migration 043 — old lead tags become per-workspace lead labels.
 *
 * MongoDB migration, written as a file only: the server never runs it.
 *
 *   MONGODB_URI=... node migrations/043_lead_labels.js            # dry run (report only, the default)
 *   MONGODB_URI=... node migrations/043_lead_labels.js --apply    # write
 *
 * Why: lead tags (lead_tags.tag_id) pointed at alliance_inbox_tags, one table
 * shared by every workspace, so tag names and ids leaked across workspaces and
 * a campaign could target another workspace's tag id. Leads now carry labels
 * (lead_labels + lead_label_links), both tenant-scoped.
 *
 * What it does (idempotent; running it again changes nothing):
 *   1. For every lead_tags link whose lead still exists, the workspace is taken
 *      from the LEAD (not from the link). The tag's name and colour are copied
 *      into a label of that workspace: an existing label with the same name
 *      (case-insensitive) is reused, else one is created with
 *      migrated_from_tag_id = the old tag id. Hex colours map to the nearest of
 *      the 8 palette colours.
 *   2. A lead_label_links row is added for the link (skipped when present).
 *   3. Campaigns with target_tag_id get target_label_id = the label of their
 *      own workspace for that tag (created when no lead carried it), and
 *      target_tag_id is cleared (the old id is kept in migrated_from_tag_id).
 *   Links to a deleted lead or a deleted tag are reported and left alone.
 *   Nothing is deleted: lead_tags and alliance_inbox_tags stay as they are
 *   (the app no longer reads lead_tags, except for campaigns not yet migrated).
 */
const path = require('path');

const TAG = '[043]';

async function migrate({ apply = false, log = console.log } = {}) {
  const models = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const { nearestColor, cleanName, NAME_MAX } = require('../services/leadLabels');
  const { Leads, LeadTags, AllianceInboxTags, Labels, LeadLabelLinks, Campaigns } = models;

  return runAsSystem(async () => {
    const report = { apply, labels_created: 0, labels_reused: 0, links_added: 0, links_present: 0, links_orphaned: 0, campaigns_moved: 0, campaigns_unresolved: 0 };
    // (tenant, tag id) -> label id (a placeholder in a dry run).
    const labelFor = new Map();
    const key = (tenantId, tagId) => `${tenantId}:${tagId}`;
    const tagCache = new Map();
    const tagOf = async (tagId) => {
      if (!tagCache.has(tagId)) tagCache.set(tagId, await AllianceInboxTags.findOne({ id: tagId }, { _id: 0, id: 1, name: 1, color: 1 }).lean());
      return tagCache.get(tagId);
    };

    async function ensureLabel(tenantId, tagId) {
      const k = key(tenantId, tagId);
      if (labelFor.has(k)) return labelFor.get(k);
      const tag = await tagOf(tagId);
      if (!tag || !String(tag.name || '').trim()) { labelFor.set(k, null); return null; }
      let name;
      try { name = cleanName(String(tag.name)); } catch { name = `Tag ${tagId}`; }
      name = name.slice(0, NAME_MAX);
      const existing = await Labels.findOne({ tenant_id: tenantId, migrated_from_tag_id: tagId }, { _id: 0, id: 1 }).lean()
        || await Labels.findOne({ tenant_id: tenantId, name_key: name.toLowerCase() }, { _id: 0, id: 1 }).lean();
      if (existing) {
        report.labels_reused += 1;
        labelFor.set(k, existing.id);
        return existing.id;
      }
      report.labels_created += 1;
      log(`${TAG} workspace ${tenantId}: label "${name}" from tag #${tagId} ${apply ? 'created' : 'would be created'}`);
      if (!apply) { labelFor.set(k, `new:${k}`); return labelFor.get(k); }
      const label = await Labels.create({
        tenant_id: tenantId, name, name_key: name.toLowerCase(), color: nearestColor(tag.color),
        created_by: null, created_at: new Date(), updated_at: new Date(), migrated_from_tag_id: tagId,
      });
      labelFor.set(k, label.id);
      return label.id;
    }

    // 1 + 2. Links.
    const links = await LeadTags.find({}, { _id: 0, lead_id: 1, tag_id: 1, assigned_at: 1 }).lean();
    const leadTenant = new Map((await Leads.find({ id: { $in: [...new Set(links.map((l) => l.lead_id))] } }, { _id: 0, id: 1, tenant_id: 1 }).lean())
      .map((lead) => [lead.id, lead.tenant_id]));
    for (const link of links) {
      const tenantId = leadTenant.get(link.lead_id);
      if (tenantId == null) { report.links_orphaned += 1; continue; }
      const labelId = await ensureLabel(tenantId, link.tag_id);
      if (labelId == null) { report.links_orphaned += 1; continue; }
      const present = typeof labelId === 'number'
        && await LeadLabelLinks.exists({ tenant_id: tenantId, lead_id: link.lead_id, label_id: labelId });
      if (present) { report.links_present += 1; continue; }
      report.links_added += 1;
      if (apply) {
        try {
          await LeadLabelLinks.create({ tenant_id: tenantId, lead_id: link.lead_id, label_id: labelId, added_by: null, added_at: link.assigned_at || new Date() });
        } catch (error) {
          if (error.code !== 11000) throw error;
        }
      }
    }

    // 3. Campaigns.
    const campaigns = await Campaigns.find({ target_tag_id: { $ne: null } }, { _id: 0, id: 1, tenant_id: 1, target_tag_id: 1 }).lean();
    for (const campaign of campaigns) {
      const labelId = campaign.tenant_id != null ? await ensureLabel(campaign.tenant_id, campaign.target_tag_id) : null;
      if (labelId == null) {
        report.campaigns_unresolved += 1;
        log(`${TAG} campaign #${campaign.id}: tag #${campaign.target_tag_id} not found; left unchanged`);
        continue;
      }
      report.campaigns_moved += 1;
      if (apply) {
        await Campaigns.updateOne({ id: campaign.id, tenant_id: campaign.tenant_id }, {
          $set: { target_label_id: labelId, target_tag_id: null, migrated_from_tag_id: campaign.target_tag_id },
        });
      }
    }

    log(`${TAG} ${apply ? 'applied' : 'dry run'}: ${JSON.stringify(report)}`);
    return report;
  }, 'migration-043');
}

module.exports = { migrate };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const apply = process.argv.includes('--apply');
  (async () => {
    const { connectMongo, mongoose } = require('../db/mongo');
    await connectMongo();
    if (apply) {
      const { Labels, LeadLabelLinks } = require('../models');
      await Labels.createIndexes();
      await LeadLabelLinks.createIndexes();
    }
    await migrate({ apply });
    await mongoose.disconnect();
  })().then(() => process.exit(0)).catch((error) => {
    console.error(`${TAG} failed:`, error.message);
    process.exit(1);
  });
}
