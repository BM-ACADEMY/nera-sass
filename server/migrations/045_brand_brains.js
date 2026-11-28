#!/usr/bin/env node
/**
 * Migration 045 — one AI brain per brand (brand brains).
 *
 * MongoDB migration, written as a file only: the server never runs it.
 *
 *   MONGODB_URI=... node migrations/045_brand_brains.js            # dry run (report only, the default)
 *   MONGODB_URI=... node migrations/045_brand_brains.js --apply    # write
 *
 * Why: a WhatsApp number can be shared by brands (tenant 12: BM TechX and
 * BM Academy). Each brand gets its own brain (brain_profiles.client_id) and
 * services/brandRouter.js picks the brand before the AI runs, so one brand's
 * brain never sees another brand's prices or documents.
 *
 * What it does (idempotent; running it again changes nothing):
 *   1. brain_profiles: drops the old one-brain-per-workspace unique index
 *      (tenant_id_1) and builds the new one (tenant_id + client_id), so a
 *      workspace can hold a brain per brand.
 *   2. For each workspace with exactly one brain, no client_id on it yet, and
 *      all of its brain documents on one client_id: sets the brain's
 *      client_id to that brand, and, when the brain has keep-words for the
 *      keyword rule and no routing words yet, copies them to
 *      profile.route_keywords. Nothing else is changed (the keyword rule
 *      fields stay as they are) and no new brain is created.
 *   The app already treats a brain without client_id as the workspace's
 *   brain, so before or after this runs, a single-brain workspace answers the
 *   same way.
 */
const path = require('path');

const TAG = '[045]';
const OLD_INDEX = 'tenant_id_1';

async function migrate({ apply = false, log = console.log } = {}) {
  const { BrainProfiles, BrainDocs } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');

  return runAsSystem(async () => {
    const report = { apply, old_index_dropped: false, brains_assigned: 0, skipped: 0, already_done: 0, details: [] };

    // 1. Indexes.
    let indexes = [];
    try {
      indexes = await BrainProfiles.collection.indexes();
    } catch (err) {
      if (err.codeName !== 'NamespaceNotFound') throw err;
    }
    const old = indexes.find((ix) => ix.name === OLD_INDEX && ix.unique);
    if (old) {
      report.old_index_dropped = true;
      log(`${TAG} brain_profiles index ${OLD_INDEX} (one brain per workspace) ${apply ? 'dropped' : 'would be dropped'}`);
      if (apply) await BrainProfiles.collection.dropIndex(OLD_INDEX);
    }
    if (apply) await BrainProfiles.createIndexes();

    // 2. Brains.
    const brains = await BrainProfiles.find({}, { _id: 0, id: 1, tenant_id: 1, client_id: 1, profile: 1 }).sort({ id: 1 }).lean();
    const byTenant = new Map();
    for (const brain of brains) {
      if (!byTenant.has(brain.tenant_id)) byTenant.set(brain.tenant_id, []);
      byTenant.get(brain.tenant_id).push(brain);
    }
    for (const [tenantId, list] of byTenant) {
      if (list.length !== 1) {
        report.skipped += 1;
        log(`${TAG} workspace ${tenantId}: ${list.length} brains, left as they are`);
        continue;
      }
      const [brain] = list;
      if (brain.client_id != null) { report.already_done += 1; continue; }
      const clientIds = (await BrainDocs.distinct('client_id', { tenant_id: tenantId })).filter((id) => id != null);
      if (clientIds.length !== 1) {
        report.skipped += 1;
        log(`${TAG} workspace ${tenantId}: brain #${brain.id} has documents on ${clientIds.length} brands, left as it is`);
        continue;
      }
      const clientId = clientIds[0];
      const keep = brain.profile?.brand_keep_keywords || [];
      const route = brain.profile?.route_keywords || [];
      const set = { client_id: clientId };
      if (keep.length && !route.length) set['profile.route_keywords'] = keep;
      report.brains_assigned += 1;
      report.details.push({ tenant_id: tenantId, brain_id: brain.id, client_id: clientId, route_keywords: set['profile.route_keywords'] || route });
      log(`${TAG} workspace ${tenantId}: brain #${brain.id} -> brand ${clientId}${set['profile.route_keywords'] ? ` (route keywords: ${keep.join(', ')})` : ''} ${apply ? 'updated' : 'would be updated'}`);
      if (apply) await BrainProfiles.updateOne({ id: brain.id, tenant_id: tenantId, client_id: null }, { $set: set });
    }

    log(`${TAG} ${apply ? 'applied' : 'dry run'}: ${JSON.stringify({ ...report, details: undefined })}`);
    return report;
  }, 'migration-045');
}

module.exports = { migrate };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
  const apply = process.argv.includes('--apply');
  (async () => {
    const { connectMongo, mongoose } = require('../db/mongo');
    await connectMongo();
    await migrate({ apply });
    await mongoose.disconnect();
  })().then(() => process.exit(0)).catch((error) => {
    console.error(`${TAG} failed:`, error.message);
    process.exit(1);
  });
}
