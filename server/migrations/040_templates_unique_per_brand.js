#!/usr/bin/env node
/**
 * Migration 040 — LeadOS templates unique per workspace, brand, name and language.
 *
 * MongoDB migration, written as a file only: the server never runs it.
 *
 *   MONGODB_URI=... node migrations/040_templates_unique_per_brand.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/040_templates_unique_per_brand.js --apply
 *
 * Why: `templates` had a unique index on `name` alone, across every workspace.
 * Meta gives every WhatsApp account templates with the same names (for example
 * hello_world), so "Sync from Meta" failed for every workspace after the first
 * one that synced such a name.
 *
 * What it does (idempotent):
 *   1. Drops the old `name_1` unique index if it exists.
 *   2. Creates the model's indexes, including the new unique
 *      (tenant_id, client_id, name, language). Rows are not changed.
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
  const { Templates } = require('../models');
  await connectMongo();
  const indexes = await Templates.collection.indexes().catch(() => []);
  const old = indexes.find((index) => index.name === 'name_1');
  if (old) {
    if (apply) await Templates.collection.dropIndex('name_1');
    console.log(`[040] templates.name_1 ${apply ? 'dropped' : 'would be dropped'}`);
  } else {
    console.log('[040] templates.name_1 not present');
  }
  if (apply) await Templates.createIndexes();
  console.log(`[040] templates unique (tenant_id, client_id, name, language) ${apply ? 'in place' : 'would be created'}`);
  await mongoose.disconnect();
}

main().then(() => process.exit(0)).catch((error) => {
  console.error('[040] failed:', error.message);
  process.exit(1);
});
