/**
 * Loads config/plan-catalogue.json into the `plans` collection (plan B1).
 * Inserts plans that do not exist yet; never changes an existing plan version
 * (a price change must become a new version — Full Scope p14).
 *
 *   node scripts/seed-plan-catalogue.js            (dry run: shows what would change)
 *   node scripts/seed-plan-catalogue.js --apply    (writes)
 *
 * Requires approval before running against a shared database.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const { connectMongo, mongoose } = require('../db/connection');
const { Plans } = require('../models');
const { runAsSystem } = require('../services/tenantContext');
const catalogue = require('../config/plan-catalogue.json');

async function seedPlanCatalogue({ apply = false, log = console.log } = {}) {
  return runAsSystem(async () => {
    const results = [];
    for (const plan of catalogue.plans) {
      const exists = await Plans.exists({ code: plan.code, version: 1 });
      if (exists) {
        results.push({ code: plan.code, action: 'exists' });
        continue;
      }
      if (apply) {
        await Plans.create({ ...plan, version: 1, active: true, pricing_rules: catalogue.pricing_rules, currency: 'INR', created_at: new Date() });
      }
      results.push({ code: plan.code, action: apply ? 'created' : 'would create' });
    }
    results.forEach((r) => log(`${r.code.padEnd(12)} ${r.action}`));
    return results;
  }, 'seed-plans');
}

if (require.main === module) {
  const apply = process.argv.includes('--apply');
  (async () => {
    await connectMongo();
    console.log(`Database: ${mongoose.connection.name}${apply ? '' : ' (dry run; add --apply to write)'}`);
    await seedPlanCatalogue({ apply });
  })()
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => mongoose.disconnect());
}

module.exports = { seedPlanCatalogue };
