#!/usr/bin/env node
/**
 * Migration 039 (N7): prepaid 3 and 6 month plans, the 7-day free trial and GST.
 *
 * MongoDB migration, written as a file only: the server never runs it. Run it
 * once by hand against the target database:
 *
 *   MONGODB_URI=... node migrations/039_billing_periods_trial_gst.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/039_billing_periods_trial_gst.js --apply
 *
 * What it does (idempotent, nothing deleted):
 *   1. plans: fills period_prices_inr on rows that have none. A launch plan
 *      still at its launch monthly price gets the launch table
 *      (Desk 799 / 2149 / 3799, WhatsApp 1999 / 5399 / 9599,
 *      Complete 3999 / 10799 / 19199); any other row is sold monthly only
 *      until staff fill in the longer periods. An edited table is never touched.
 *   2. billing_orders: older orders (before GST) get price_paise = amount_paise,
 *      gst_paise = 0, total_paise = amount_paise, period_months = 1 for plan
 *      orders, so reports and invoices read one shape.
 *   3. subscriptions: period_months = 1 and is_trial = false where missing.
 *   4. Creates the indexes of billing_invoices, billing_trials and
 *      billing_trial_attempts (the one-trial rules are unique indexes).
 *
 * Invoices are not created for payments made before this migration.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const apply = process.argv.includes('--apply');
if (!apply && !process.argv.includes('--dry-run')) {
  console.error('Pass --dry-run to report or --apply to write.');
  process.exit(2);
}

async function run() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const models = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  const plans = require('../services/billing/plans');
  await connectMongo();

  await runAsSystem(async () => {
    // 1. plan periods
    const missing = await models.Plans.countDocuments({ $or: [{ period_prices_inr: { $exists: false } }, { period_prices_inr: null }, { period_prices_inr: {} }] });
    if (apply) {
      const backfilled = await plans.ensurePeriodPrices();
      console.log(`[039] plans: period prices filled on ${backfilled} row(s)`);
    } else {
      console.log(`[039] plans: ${missing} row(s) would get period prices`);
    }

    // 2. orders
    const orderFilter = { $or: [{ total_paise: { $exists: false } }, { total_paise: null }] };
    const orders = await models.BillingOrders.countDocuments(orderFilter);
    if (apply && orders) {
      await models.BillingOrders.updateMany(orderFilter, [{ $set: {
        price_paise: '$amount_paise', gst_rate_percent: 0, gst_paise: 0, total_paise: '$amount_paise',
        period_months: { $cond: [{ $eq: ['$purpose', 'subscription'] }, 1, null] },
      } }]);
    }
    console.log(`[039] billing_orders: ${orders} row(s) ${apply ? 'updated' : 'to update'} with price / GST / total`);

    // 3. subscriptions
    const subFilter = { $or: [{ period_months: { $exists: false } }, { is_trial: { $exists: false } }] };
    const subs = await models.Subscriptions.countDocuments(subFilter);
    if (apply && subs) await models.Subscriptions.updateMany(subFilter, { $set: { period_months: 1, is_trial: false } });
    console.log(`[039] subscriptions: ${subs} row(s) ${apply ? 'updated' : 'to update'}`);

    // 4. indexes
    for (const name of ['BillingInvoices', 'BillingTrials', 'BillingTrialAttempts', 'BillingOrders', 'Subscriptions', 'Plans']) {
      if (apply) { await models[name].init(); await models[name].syncIndexes(); }
      console.log(`[039] ${models[name].collection.name}: indexes ${apply ? 'in place' : 'would be created'}`);
    }
  }, 'migration-039');

  await mongoose.disconnect();
  console.log(`[039] ${apply ? 'applied' : 'dry run complete'}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error('[039] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
