#!/usr/bin/env node
/**
 * Migration 038 — appointments and AI reply cost (plan N2).
 *
 * MongoDB migration, written as a file only: it is never run by the server.
 * Run it once by hand against the target database:
 *
 *   MONGODB_URI=... node migrations/038_appointments.js --dry-run   # report only
 *   MONGODB_URI=... node migrations/038_appointments.js --apply
 *
 * What it does (idempotent):
 *   1. Creates the indexes of `appointments`, including the unique
 *      (tenant_id, slot_key) index that stops two customers taking the same
 *      seat of the same time.
 *   2. Creates the indexes of `ai_reply_logs` (unchanged keys; the new cost
 *      fields need no backfill: older rows simply have null tokens and cost).
 * Nothing is deleted or rewritten.
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
  const { Appointments, AiReplyLogs } = require('../models');
  const { runAsSystem } = require('../services/tenantContext');
  await connectMongo();
  await runAsSystem(async () => {
    const existing = await mongoose.connection.db.listCollections({ name: 'appointments' }).toArray();
    console.log(`[038] appointments collection ${existing.length ? 'exists' : 'will be created'}`);
    if (apply) await Promise.all([Appointments.createIndexes(), AiReplyLogs.createIndexes()]);
    console.log(`[038] indexes ${apply ? 'created' : 'would be created'}`);
  }, 'migration-038');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('[038] failed:', err.message);
  process.exit(1);
});
