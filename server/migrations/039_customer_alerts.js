#!/usr/bin/env node
/**
 * Migration 039 — customer notices and campaign audience by tag (plan N4).
 *
 * MongoDB migration, written as a file only: the server never runs it.
 *
 *   MONGODB_URI=... node migrations/039_customer_alerts.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/039_customer_alerts.js --apply
 *
 * What it does (idempotent):
 *   1. Creates the indexes of customer_alerts (unique tenant_id + dedupe_key).
 *   2. Reports workspaces with no WhatsApp-alert opt-in. Nothing is backfilled:
 *      opt-in is taken at signup, so existing workspaces get email notices only
 *      until the platform records a consent for them.
 *   3. Gives existing campaigns target_tag_id = null (they target by status).
 *   4. Gives rejected LeadOS templates rejection_reason = 'UNSPECIFIED' so the
 *      library shows a generic sentence until the next sync fetches Meta's code.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run to report or --apply to write.');
  process.exit(2);
}

async function main() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const { CustomerAlerts, Tenants, Campaigns, Templates } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  await connectMongo();
  await runAsSystem(async () => {
    if (apply) await CustomerAlerts.createIndexes();
    console.log(`[039] customer_alerts indexes ${apply ? 'created' : 'would be created'}`);
    const noOptIn = await Tenants.countDocuments({ status: { $ne: 'deleted' }, 'alerts_whatsapp.opted_in': { $ne: true } });
    console.log(`[039] ${noOptIn} workspace(s) have no WhatsApp-alert opt-in (email notices only)`);
    const campaigns = await Campaigns.countDocuments({ target_tag_id: { $exists: false } });
    if (apply && campaigns) await Campaigns.updateMany({ target_tag_id: { $exists: false } }, { $set: { target_tag_id: null } });
    console.log(`[039] ${campaigns} campaign(s) ${apply ? 'updated' : 'would be updated'} with target_tag_id`);
    const rejected = await Templates.countDocuments({ status: 'rejected', rejection_reason: { $exists: false } });
    if (apply && rejected) await Templates.updateMany({ status: 'rejected', rejection_reason: { $exists: false } }, { $set: { rejection_reason: 'UNSPECIFIED' } });
    console.log(`[039] ${rejected} rejected template(s) ${apply ? 'updated' : 'would be updated'}`);
  }, 'migration-039');
  await mongoose.disconnect();
}

main().catch((error) => { console.error('[039] failed:', error.message); process.exit(1); });
