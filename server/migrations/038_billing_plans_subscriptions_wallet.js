#!/usr/bin/env node
/**
 * Migration 038: plans, subscriptions and the wallet (MongoDB).
 *
 * Creates the billing collections with their indexes and seeds the three
 * launch plans (Desk 799, WhatsApp 1999, Complete 3999 rupees a month) when
 * the catalogue is empty. Idempotent: existing plans and indexes are left
 * alone, so edited prices survive a re-run. Nothing is deleted.
 *
 * Collections:
 *   plans           platform price list (not tenant-scoped)
 *   subscriptions   one row per workspace: plan and paid period
 *   wallet_ledger   append-only money movements; balance = sum(signed_paise)
 *   billing_orders  Razorpay orders created by the server
 *   billing_alerts  owner notices (20 percent left, AI paused)
 *
 * Run by hand against the target database, never automatically:
 *   MONGODB_URI=mongodb://... node migrations/038_billing_plans_subscriptions_wallet.js
 * The server also seeds the plans on startup when the collection is empty.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const models = require('../models');
  const { ensureDefaultPlans } = require('../services/billing/plans');

  await connectMongo();
  const names = ['Plans', 'Subscriptions', 'WalletLedger', 'BillingOrders', 'BillingAlerts'];
  for (const name of names) {
    await models[name].init(); // creates the collection and its indexes
    await models[name].syncIndexes();
    console.log(`[038] ${models[name].collection.name}: indexes in place`);
  }
  const { seeded } = await ensureDefaultPlans();
  console.log(`[038] plans seeded: ${seeded}`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((error) => {
    console.error('[038] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
