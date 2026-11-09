#!/usr/bin/env node
/**
 * Migration 039: guided customer onboarding (plan N5).
 *
 * MongoDB migration, written as a file only: the server never runs it. Run it
 * once by hand against the target database:
 *
 *   MONGODB_URI=... node migrations/039_onboarding.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/039_onboarding.js --apply
 *
 * What it does (idempotent, nothing is deleted):
 *   1. Creates the `onboarding_states` collection and its indexes (unique per
 *      tenant).
 *   2. Marks every workspace that exists today as already live
 *      (`campaigns_enabled: true`, `went_live_at` = now) when it has no value,
 *      so the new "campaigns start when you go live" rule only applies to
 *      workspaces created after this release. Workspaces already having
 *      `campaigns_enabled` (true or false) are left alone.
 *
 * Step 2 is optional safety: a workspace with no `campaigns_enabled` value is
 * already treated as live by the code, so skipping it changes nothing. Run it
 * to make the state explicit in the data.
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
  const { OnboardingStates, Tenants } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  await connectMongo();
  await runAsSystem(async () => {
    const existing = await mongoose.connection.db.listCollections({ name: 'onboarding_states' }).toArray();
    console.log(`[039] onboarding_states ${existing.length ? 'exists' : 'will be created'}`);
    if (apply) await OnboardingStates.createIndexes();
    console.log(`[039] indexes ${apply ? 'created' : 'would be created'}`);

    const filter = { status: { $ne: 'deleted' }, campaigns_enabled: { $exists: false } };
    const pending = await Tenants.countDocuments(filter);
    console.log(`[039] workspaces with no live flag: ${pending}`);
    if (apply && pending) {
      const now = new Date();
      const result = await Tenants.updateMany(filter, { $set: { campaigns_enabled: true, went_live_at: now } });
      console.log(`[039] marked live: ${result.modifiedCount}`);
    }
  }, 'migration-039');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[039] failed:', err.message);
  process.exit(1);
});
