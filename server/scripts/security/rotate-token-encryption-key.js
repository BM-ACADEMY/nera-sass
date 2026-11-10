#!/usr/bin/env node
/**
 * One-time re-encryption after TOKEN_ENCRYPTION_KEY is replaced.
 *
 * Every stored value encrypted by utils/crypto.js is decrypted with the key
 * that encrypted it (TOKEN_ENCRYPTION_KEY_PREVIOUS, or the current key for a
 * value that only lacks a version) and written back encrypted with
 * TOKEN_ENCRYPTION_KEY. Full procedure: docs/runbook-rotate-token-encryption-key.md
 *
 * Usage (from server/, with both keys already in server/.env):
 *   node scripts/security/rotate-token-encryption-key.js
 *       Dry run (the default). Reads and counts; writes nothing.
 *   node scripts/security/rotate-token-encryption-key.js --apply --backup <path>
 *       Re-encrypts. <path> is the mongodump taken for this rotation: a dump
 *       file or folder that exists, is not empty and is newer than
 *       --backup-max-age-hours (default 24).
 *
 * Safety:
 *   - No key, token, plaintext or ciphertext is ever printed: counts only.
 *   - --apply refuses to run without the backup check and without
 *     TOKEN_ENCRYPTION_KEY_PREVIOUS.
 *   - Each value is one atomic update that only applies if the stored value is
 *     still the one that was read, so a value the app changed meanwhile is
 *     never overwritten, and the new ciphertext is decrypted and compared
 *     before it is written.
 *   - Safe to re-run: values already under the current key are skipped, so a
 *     run that stopped half way is resumed by running the same command again.
 *     While both keys are set the app reads old and new values alike.
 *   - A value that no configured key can read is counted and left untouched.
 *
 * Exit code: 0 = nothing left under an old key; 1 = something still needs
 * attention (see the report); 2 = could not run.
 */
const fs = require('fs');
const path = require('path');

/** Every database field encrypted with TOKEN_ENCRYPTION_KEY (utils/crypto.js). */
const ENCRYPTED_FIELDS = [
  { collection: 'clients', field: 'wa_access_token_enc', what: 'customer WhatsApp access token' },
  { collection: 'brand_social_accounts', field: 'access_token', what: 'Meta / LinkedIn / YouTube publishing token' },
  { collection: 'brand_social_accounts', field: 'lead_ads_access_token', what: 'Meta Lead Ads token' },
  { collection: 'google_calendar_credentials', field: 'refresh_token_encrypted', what: 'Google Calendar refresh token' },
  { collection: 'reply_webhooks', field: 'secret_enc', what: 'reply webhook signing secret' },
  { collection: 'users', field: 'mfa_secret_enc', what: 'two-step verification secret' },
  { collection: 'users', field: 'mfa_pending_secret_enc', what: 'two-step secret awaiting confirmation' },
  { collection: 'invitations', field: 'password_enc', what: 'preset password on an invitation' },
  // Encrypted through db/encryptedFields.js. Rows from before that may still be
  // plain text until scripts/security/encrypt-plaintext-tokens.js has run:
  // those are counted as "plain text" and left alone here.
  { collection: 'mafiya_gmb_tokens', field: 'access_token', what: 'Google Business Profile access token', mayBePlain: true },
  { collection: 'mafiya_gmb_tokens', field: 'refresh_token', what: 'Google Business Profile refresh token', mayBePlain: true },
  { collection: 'thedal_gsc_tokens', field: 'access_token', what: 'Google Search Console access token', mayBePlain: true },
  { collection: 'thedal_gsc_tokens', field: 'refresh_token', what: 'Google Search Console refresh token', mayBePlain: true },
  { collection: 'clients', field: 'access_token', what: 'Google access token on the brand', mayBePlain: true },
  { collection: 'clients', field: 'refresh_token', what: 'Google refresh token on the brand', mayBePlain: true },
];

const DEFAULT_BACKUP_MAX_AGE_HOURS = 24;

class RotationError extends Error {}

function parseArgs(argv) {
  const args = { apply: false, backup: null, backupMaxAgeHours: DEFAULT_BACKUP_MAX_AGE_HOURS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--backup') args.backup = argv[++i] || '';
    else if (arg === '--backup-max-age-hours') args.backupMaxAgeHours = Number(argv[++i]);
    else throw new RotationError(`Unknown option: ${arg}`);
  }
  if (args.apply && args.dryRun) throw new RotationError('Use either --apply or --dry-run, not both.');
  if (!(args.backupMaxAgeHours > 0)) throw new RotationError('--backup-max-age-hours must be a number above 0.');
  return args;
}

// Total size and newest modification time of a dump file, or of every file in a dump folder.
function measure(target) {
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return { files: 1, bytes: stat.size, newest: stat.mtimeMs };
  const total = { files: 0, bytes: 0, newest: 0 };
  for (const entry of fs.readdirSync(target)) {
    const inner = measure(path.join(target, entry));
    total.files += inner.files;
    total.bytes += inner.bytes;
    total.newest = Math.max(total.newest, inner.newest);
  }
  return total;
}

/**
 * The backup check that must pass before anything is written. Proves that a
 * recent, non-empty dump exists at the given path; it cannot prove the dump
 * restores (the runbook has a restore check for that).
 */
function checkBackup(backupPath, { maxAgeHours = DEFAULT_BACKUP_MAX_AGE_HOURS, now = Date.now() } = {}) {
  if (!backupPath) throw new RotationError('--apply needs --backup <path to the mongodump taken for this rotation>.');
  const resolved = path.resolve(backupPath);
  if (!fs.existsSync(resolved)) throw new RotationError('Backup check failed: the --backup path does not exist.');
  const { files, bytes, newest } = measure(resolved);
  if (!files || !bytes) throw new RotationError('Backup check failed: the backup is empty.');
  const ageHours = (now - newest) / 3600000;
  if (ageHours > maxAgeHours) {
    throw new RotationError(`Backup check failed: the backup is ${Math.floor(ageHours)} hours old (limit ${maxAgeHours}). Take a fresh one.`);
  }
  return { files, bytes, ageMinutes: Math.max(0, Math.round(ageHours * 60)) };
}

/**
 * Re-encrypts every encrypted field (apply) or only counts (dry run).
 * `db` is the MongoDB driver database: Mongoose hooks and tenant scoping are
 * deliberately bypassed, and no other field of any document is touched.
 * Returns the report; never logs.
 */
async function rotate({ db, apply = false }) {
  const tokenCrypto = require('../../utils/crypto');
  const current = tokenCrypto.currentKeyVersion();
  const previous = tokenCrypto.previousKeyVersion();
  if (apply && !previous) {
    throw new RotationError('TOKEN_ENCRYPTION_KEY_PREVIOUS is not set (or equals TOKEN_ENCRYPTION_KEY): there is no old key to rotate from.');
  }

  const report = { apply, currentKeyVersion: current, previousKeyVersion: previous, fields: [], erasures: null };
  for (const { collection, field, what, mayBePlain } of ENCRYPTED_FIELDS) {
    const row = { collection, field, what, found: 0, alreadyCurrent: 0, reencrypted: 0, toReencrypt: 0, changedMeanwhile: 0, unreadable: 0, plainText: 0 };
    report.fields.push(row);
    const coll = db.collection(collection);
    const cursor = coll.find({ [field]: { $type: 'string', $ne: '' } }, { projection: { _id: 1, [field]: 1 } });
    for await (const doc of cursor) {
      const stored = doc[field];
      row.found += 1;
      if (mayBePlain && !tokenCrypto.looksEncrypted(stored)) { row.plainText += 1; continue; }
      if (tokenCrypto.keyVersionOf(stored) === current) { row.alreadyCurrent += 1; continue; }
      const opened = tokenCrypto.tryDecrypt(stored);
      if (!opened.ok || !opened.value) { row.unreadable += 1; continue; }
      if (!apply) { row.toReencrypt += 1; continue; }

      const replacement = tokenCrypto.encrypt(opened.value);
      const check = tokenCrypto.tryDecrypt(replacement);
      if (tokenCrypto.keyVersionOf(replacement) !== current || !check.ok || check.value !== opened.value) {
        throw new RotationError(`Self-check failed for ${collection}.${field}; nothing was written for this value. Stopping.`);
      }
      // Compare-and-set: only replace the exact value that was read.
      const result = await coll.updateOne({ _id: doc._id, [field]: stored }, { $set: { [field]: replacement } });
      if (result.matchedCount === 1) row.reencrypted += 1;
      else row.changedMeanwhile += 1;
    }
  }

  // Contact-erasure phone hashes are keyed with the same key but are one-way:
  // they cannot be converted, only counted.
  const erasures = db.collection('contact_erasures');
  const hashed = { phone_hash: { $type: 'string' } };
  report.erasures = {
    total: await erasures.countDocuments(hashed),
    underOtherKey: await erasures.countDocuments({ ...hashed, phone_hash_key: { $ne: current } }),
  };

  const sum = (key) => report.fields.reduce((n, row) => n + row[key], 0);
  report.totals = {
    found: sum('found'), alreadyCurrent: sum('alreadyCurrent'), reencrypted: sum('reencrypted'),
    toReencrypt: sum('toReencrypt'), changedMeanwhile: sum('changedMeanwhile'), unreadable: sum('unreadable'),
    plainText: sum('plainText'),
  };
  report.remaining = report.totals.toReencrypt + report.totals.changedMeanwhile + report.totals.unreadable;
  return report;
}

function formatReport(report) {
  const lines = [];
  const done = report.apply ? 're-encrypted' : 'to re-encrypt';
  const doneKey = report.apply ? 'reencrypted' : 'toReencrypt';
  lines.push('');
  lines.push(`TOKEN_ENCRYPTION_KEY rotation report (${report.apply ? 'APPLY' : 'DRY RUN: nothing was written'})`);
  lines.push(`Current key version: ${report.currentKeyVersion}   Previous key version: ${report.previousKeyVersion || 'not set'}`);
  lines.push('');
  const header = ['collection.field', 'found', 'already current', done, 'changed meanwhile', 'unreadable', 'plain text'];
  const rows = report.fields.map((row) => [`${row.collection}.${row.field}`, row.found, row.alreadyCurrent, row[doneKey], row.changedMeanwhile, row.unreadable, row.plainText]);
  rows.push(['TOTAL', report.totals.found, report.totals.alreadyCurrent, report.totals[doneKey], report.totals.changedMeanwhile, report.totals.unreadable, report.totals.plainText]);
  const table = [header, ...rows].map((cells) => cells.map(String));
  const widths = header.map((_, i) => Math.max(...table.map((cells) => cells[i].length)));
  for (const cells of table) lines.push(cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  '));
  lines.push('');
  lines.push(`Contact-erasure records with a phone hash: ${report.erasures.total}; hashed with a key other than the current one: ${report.erasures.underOtherKey}.`);
  if (report.erasures.underOtherKey) {
    lines.push('  These hashes cannot be converted (the phone numbers were deleted). They keep blocking sends');
    lines.push('  only while TOKEN_ENCRYPTION_KEY_PREVIOUS stays set. Do not remove it without a decision on them.');
  }
  lines.push('');
  if (report.totals.unreadable) {
    lines.push(`ATTENTION: ${report.totals.unreadable} value(s) could not be read with any configured key and were left untouched.`);
  }
  if (report.totals.plainText) {
    lines.push(`${report.totals.plainText} value(s) are still plain text (not encrypted with any key). Run scripts/security/encrypt-plaintext-tokens.js for those.`);
  }
  if (report.totals.changedMeanwhile) {
    lines.push(`${report.totals.changedMeanwhile} value(s) were changed by the app during the run and were not overwritten. Run the same command again.`);
  }
  if (!report.apply) {
    lines.push(report.previousKeyVersion
      ? `Dry run: ${report.totals.toReencrypt} value(s) would be re-encrypted. Run again with --apply --backup <path> to do it.`
      : `Dry run without TOKEN_ENCRYPTION_KEY_PREVIOUS: ${report.totals.toReencrypt} value(s) are readable with the current key but carry no current key version.`);
  } else if (report.remaining === 0) {
    lines.push('RESULT: every encrypted value is now under the current key.');
  } else {
    lines.push(`RESULT: ${report.remaining} value(s) are NOT under the current key yet. Keep TOKEN_ENCRYPTION_KEY_PREVIOUS set.`);
  }
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    // The backup is checked before the database is even opened.
    if (args.apply) {
      const backup = checkBackup(args.backup, { maxAgeHours: args.backupMaxAgeHours });
      console.log(`Backup check passed: ${backup.files} file(s), ${backup.bytes} bytes, ${backup.ageMinutes} minute(s) old.`);
    }
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const { connectMongo, mongoose } = require('../../db/mongo'); // loads server/.env
  let exitCode = 2;
  try {
    await connectMongo();
    const report = await rotate({ db: mongoose.connection.db, apply: args.apply });
    console.log(formatReport(report));
    if (args.apply) exitCode = report.remaining === 0 ? 0 : 1;
    else exitCode = report.totals.unreadable ? 1 : 0;
  } catch (error) {
    // A database error message can quote document contents, so only its name and code are printed.
    console.error(error instanceof RotationError ? error.message : `Stopped by an error: ${error.name}${error.code ? ` (code ${error.code})` : ''}`);
    console.error('Nothing is lost: values already re-encrypted stay readable. Fix the cause and run the same command again.');
    exitCode = error instanceof RotationError ? 2 : 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  return exitCode;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { ENCRYPTED_FIELDS, RotationError, parseArgs, checkBackup, rotate, formatReport };
