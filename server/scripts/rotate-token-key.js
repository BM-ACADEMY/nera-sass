#!/usr/bin/env node
/**
 * One-time re-encryption of every stored value from the previous TOKEN_ENCRYPTION_KEY
 * to the current one.
 *
 *   1. Set TOKEN_ENCRYPTION_KEY=<new key> and TOKEN_ENCRYPTION_KEY_PREVIOUS=<old key>.
 *   2. node scripts/rotate-token-key.js              dry run: counts only, writes nothing
 *   3. node scripts/rotate-token-key.js --apply      backup, then re-encrypt
 *   4. Re-run step 3 until it reports 0 pending, then remove TOKEN_ENCRYPTION_KEY_PREVIOUS.
 *
 * Options: --apply, --dry-run (default), --backup-dir <dir>
 *
 * Safety:
 *  - Dry run is the default; nothing is written without --apply.
 *  - Before the first write a backup of the affected ciphertext (never plaintext) is
 *    saved with file mode 0600. Treat it like the database: it holds encrypted tokens.
 *  - Re-runnable: values already on the current key are skipped, and each update only
 *    applies if the stored value is still the one that was read, so a half-finished
 *    run, a repeat run or a live app write can never be overwritten or corrupted.
 *  - Every new value is decrypted again and compared before it is written.
 *  - Output is counts only. No token, key, ciphertext or document id is ever printed.
 *  - Values nothing can decrypt are left untouched and counted as "locked".
 */
const fs = require('fs');
const path = require('path');
const cryptoHelper = require('../utils/crypto');

// Every collection/field written with utils/crypto.js encrypt().
const TARGETS = [
  { collection: 'brand_social_accounts', fields: ['access_token', 'lead_ads_access_token'] },
  { collection: 'clients', fields: ['wa_access_token_enc'] },
  { collection: 'reply_webhooks', fields: ['secret_enc'] },
  { collection: 'users', fields: ['mfa_secret_enc', 'mfa_pending_secret_enc'] },
  { collection: 'invitations', fields: ['password_enc'] },
  { collection: 'google_calendar_credentials', fields: ['refresh_token_encrypted'] },
];

const emptyCounts = () => ({ scanned: 0, current: 0, pending: 0, rotated: 0, locked: 0, notEncrypted: 0, skippedChanged: 0, failed: 0 });

/**
 * @param {object} opts
 * @param {import('mongodb').Db} opts.db        native driver database
 * @param {boolean} [opts.apply]                write changes (default: dry run)
 * @param {string}  [opts.backupDir]            required with apply
 * @param {Function} [opts.log]                 receives counts-only lines
 * @param {number}  [opts.failAfter]            test hook: throw after N successful writes
 * @returns {Promise<{ apply: boolean, backupFile: string|null, totals: object, perField: object, aborted: boolean }>}
 */
async function rotateAll({ db, apply = false, backupDir, log = () => {}, failAfter = null, targets = TARGETS, now = () => new Date() } = {}) {
  if (!db) throw new Error('db is required');
  cryptoHelper.currentKeyId(); // throws if TOKEN_ENCRYPTION_KEY is missing

  // Pass 1: read-only classification.
  const plan = [];
  const perField = {};
  for (const { collection, fields } of targets) {
    const coll = db.collection(collection);
    for (const field of fields) {
      const counts = emptyCounts();
      perField[`${collection}.${field}`] = counts;
      const cursor = coll.find({ [field]: { $type: 'string', $ne: '' } }, { projection: { [field]: 1 } });
      for await (const doc of cursor) {
        counts.scanned += 1;
        const status = cryptoHelper.inspect(doc[field]);
        if (status === 'current') counts.current += 1;
        else if (status === 'stale') { counts.pending += 1; plan.push({ collection, field, _id: doc._id, before: doc[field] }); }
        else if (status === 'locked') counts.locked += 1;
        else counts.notEncrypted += 1;
      }
    }
  }

  const result = { apply, backupFile: null, perField, totals: null, aborted: false };

  if (apply && plan.length > 0) {
    if (!backupDir) throw new Error('A backup directory is required with --apply');
    fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const file = path.join(backupDir, `token-rotation-backup-${stamp}.json`);
    const body = JSON.stringify({
      note: 'Ciphertext only. Restore a value by writing it back to the same collection/field/_id.',
      createdAt: now().toISOString(),
      entries: plan.map((p) => ({ collection: p.collection, field: p.field, _id: p._id, value: p.before })),
    });
    // 'wx': never overwrite an earlier backup.
    fs.writeFileSync(file, body, { mode: 0o600, flag: 'wx' });
    result.backupFile = file;
    log(`backup written (${plan.length} values)`);
  }

  // Pass 2: write, one value at a time, each guarded by compare-and-set.
  if (apply) {
    let written = 0;
    for (const item of plan) {
      const counts = perField[`${item.collection}.${item.field}`];
      try {
        if (failAfter !== null && written >= failAfter) throw new Error('simulated failure');
        const { status, value } = cryptoHelper.rotate(item.before);
        if (status !== 'rotated') { counts.skippedChanged += 1; continue; }
        const res = await db.collection(item.collection).updateOne(
          { _id: item._id, [item.field]: item.before },
          { $set: { [item.field]: value } },
        );
        if (res.modifiedCount === 1) { counts.rotated += 1; counts.pending -= 1; written += 1; }
        else counts.skippedChanged += 1; // changed by the app since we read it: next run decides
      } catch (err) {
        counts.failed += 1;
        log(`stopped: ${err && err.name ? err.name : 'Error'} on ${item.collection}.${item.field}`);
        result.aborted = true;
        break; // stop early: everything written so far is valid, a re-run finishes the rest
      }
    }
  }

  const totals = emptyCounts();
  for (const c of Object.values(perField)) for (const k of Object.keys(totals)) totals[k] += c[k];
  result.totals = totals;
  return result;
}

function parseArgs(argv) {
  const out = { apply: false, backupDir: path.join(__dirname, '..', 'backups', 'token-rotation') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') out.apply = true;
    else if (argv[i] === '--dry-run') out.apply = false;
    else if (argv[i] === '--backup-dir') out.backupDir = path.resolve(argv[++i] || '');
    else throw new Error(`Unknown option ${argv[i]}`);
  }
  return out;
}

function printReport(res) {
  console.log(res.apply ? 'Mode: APPLY' : 'Mode: DRY RUN (nothing written)');
  console.log(`Current key version: ${cryptoHelper.currentKeyId()}`);
  for (const [name, c] of Object.entries(res.perField)) {
    if (c.scanned === 0) continue;
    console.log(`${name}: scanned=${c.scanned} current=${c.current} pending=${c.pending} rotated=${c.rotated} locked=${c.locked} not_encrypted=${c.notEncrypted} skipped_changed=${c.skippedChanged} failed=${c.failed}`);
  }
  const t = res.totals;
  console.log(`TOTAL: scanned=${t.scanned} current=${t.current} pending=${t.pending} rotated=${t.rotated} locked=${t.locked} not_encrypted=${t.notEncrypted} skipped_changed=${t.skippedChanged} failed=${t.failed}`);
  if (res.backupFile) console.log(`Backup: ${res.backupFile}`);
  if (res.aborted) console.log('Run stopped early. Re-run with --apply to finish; already-rotated values are skipped.');
  else if (res.apply && t.pending === 0 && t.locked === 0) console.log('All readable values are on the current key. TOKEN_ENCRYPTION_KEY_PREVIOUS can be removed.');
  else if (!res.apply && t.pending > 0) console.log('Dry run only. Re-run with --apply to rotate.');
  if (t.locked > 0) console.log('Some values cannot be read by the configured keys. Set TOKEN_ENCRYPTION_KEY_PREVIOUS to the key that wrote them. They were not changed.');
}

async function main() {
  const mongoose = require('mongoose');
  const { connectMongo } = require('../db/mongo');
  const args = parseArgs(process.argv.slice(2));
  await connectMongo();
  try {
    const res = await rotateAll({ db: mongoose.connection.db, apply: args.apply, backupDir: args.backupDir, log: (m) => console.log(m) });
    printReport(res);
    process.exitCode = res.aborted || res.totals.failed > 0 || res.totals.locked > 0 ? 1 : 0;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`rotate-token-key failed: ${err && err.name ? err.name : 'Error'}`);
    process.exit(1);
  });
}

module.exports = { rotateAll, TARGETS, parseArgs };
