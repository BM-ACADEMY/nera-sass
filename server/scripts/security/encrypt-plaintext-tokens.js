#!/usr/bin/env node
/**
 * One-time migration: encrypts tokens that older code stored in plain text.
 *
 *   mafiya_gmb_tokens.access_token / refresh_token    encrypted in place
 *   thedal_gsc_tokens.access_token / refresh_token    encrypted in place
 *   clients.access_token / refresh_token              encrypted in place
 *   clients.wa_access_token                           moved to wa_access_token_enc
 *                                                     (+ wa_token_last4), plain column removed
 *
 * Values are encrypted with TOKEN_ENCRYPTION_KEY and carry its key version
 * (utils/crypto.js), so later key rotations cover them. Deploy the code that
 * reads both forms (db/encryptedFields.js) BEFORE running this.
 *
 * Usage (from server/):
 *   node scripts/security/encrypt-plaintext-tokens.js
 *       Dry run (the default). Reads and counts; writes nothing.
 *   node scripts/security/encrypt-plaintext-tokens.js --apply --backup <path>
 *       Encrypts. <path> is a mongodump taken for this migration: it must
 *       exist, not be empty and be newer than --backup-max-age-hours (default 24).
 *
 * Safety:
 *   - No token, key or ciphertext is ever printed: counts only.
 *   - Each value is one atomic update that only applies if the stored value is
 *     still the one that was read; the ciphertext is decrypted and compared
 *     before it is written.
 *   - Safe to re-run: values already encrypted are skipped, so a run that
 *     stopped half way is finished by running the same command again.
 *   - clients.wa_access_token is only removed once the same token is safely in
 *     wa_access_token_enc. If a row holds a plain token AND a different or
 *     unreadable encrypted one, nothing is changed and it is counted as a
 *     conflict: the script cannot know which token is the right one.
 *
 * Exit code: 0 = no plain-text token left; 1 = something still needs attention
 * (see the report); 2 = could not run.
 */
const { RotationError, parseArgs, checkBackup } = require('./rotate-token-encryption-key');

/** Plain-text token columns that are encrypted in the same column. */
const IN_PLACE_FIELDS = [
  { collection: 'mafiya_gmb_tokens', field: 'access_token' },
  { collection: 'mafiya_gmb_tokens', field: 'refresh_token' },
  { collection: 'thedal_gsc_tokens', field: 'access_token' },
  { collection: 'thedal_gsc_tokens', field: 'refresh_token' },
  { collection: 'clients', field: 'access_token' },
  { collection: 'clients', field: 'refresh_token' },
];

const emptyRow = (collection, field) => ({ collection, field, found: 0, alreadyEncrypted: 0, encrypted: 0, toEncrypt: 0, changedMeanwhile: 0, conflicts: 0 });

// Encrypts a value and proves it reads back before anything is written.
function sealChecked(tokenCrypto, plain, label) {
  const sealed = tokenCrypto.encrypt(plain);
  const check = tokenCrypto.tryDecrypt(sealed);
  if (!tokenCrypto.looksEncrypted(sealed) || !check.ok || check.value !== plain) {
    throw new RotationError(`Self-check failed for ${label}; nothing was written for this value. Stopping.`);
  }
  return sealed;
}

/**
 * Encrypts every plain-text token (apply) or only counts (dry run). `db` is
 * the MongoDB driver database: Mongoose hooks and tenant scoping are bypassed
 * and no other field is touched. Returns the report; never logs.
 */
async function migrate({ db, apply = false }) {
  const tokenCrypto = require('../../utils/crypto');
  tokenCrypto.currentKeyVersion(); // fails early when TOKEN_ENCRYPTION_KEY is missing
  const report = { apply, fields: [] };

  for (const { collection, field } of IN_PLACE_FIELDS) {
    const row = emptyRow(collection, field);
    report.fields.push(row);
    const coll = db.collection(collection);
    const cursor = coll.find({ [field]: { $type: 'string', $ne: '' } }, { projection: { _id: 1, [field]: 1 } });
    for await (const doc of cursor) {
      const stored = doc[field];
      row.found += 1;
      if (tokenCrypto.looksEncrypted(stored)) { row.alreadyEncrypted += 1; continue; }
      if (!apply) { row.toEncrypt += 1; continue; }
      const sealed = sealChecked(tokenCrypto, stored, `${collection}.${field}`);
      const result = await coll.updateOne({ _id: doc._id, [field]: stored }, { $set: { [field]: sealed } });
      if (result.matchedCount === 1) row.encrypted += 1;
      else row.changedMeanwhile += 1;
    }
  }

  // clients.wa_access_token: the encrypted column is wa_access_token_enc.
  const row = emptyRow('clients', 'wa_access_token');
  row.duplicatesRemoved = 0;
  report.fields.push(row);
  const clients = db.collection('clients');
  const cursor = clients.find({ wa_access_token: { $type: 'string', $ne: '' } }, { projection: { _id: 1, wa_access_token: 1, wa_access_token_enc: 1 } });
  for await (const doc of cursor) {
    const stored = doc.wa_access_token;
    const token = stored.trim();
    if (!token) continue;
    row.found += 1;
    const existing = typeof doc.wa_access_token_enc === 'string' && doc.wa_access_token_enc ? doc.wa_access_token_enc : null;
    if (existing) {
      const opened = tokenCrypto.tryDecrypt(existing);
      if (!opened.ok || opened.value !== token) { row.conflicts += 1; continue; }
      // The same token is already encrypted: only the plain copy has to go.
      if (!apply) { row.toEncrypt += 1; continue; }
      const result = await clients.updateOne({ _id: doc._id, wa_access_token: stored, wa_access_token_enc: existing }, { $unset: { wa_access_token: '' } });
      if (result.matchedCount === 1) { row.encrypted += 1; row.duplicatesRemoved += 1; } else row.changedMeanwhile += 1;
      continue;
    }
    if (!apply) { row.toEncrypt += 1; continue; }
    const sealed = sealChecked(tokenCrypto, token, 'clients.wa_access_token');
    const result = await clients.updateOne(
      { _id: doc._id, wa_access_token: stored, wa_access_token_enc: { $in: [null, ''] } },
      { $set: { wa_access_token_enc: sealed, wa_token_last4: token.slice(-4) }, $unset: { wa_access_token: '' } }
    );
    if (result.matchedCount === 1) row.encrypted += 1;
    else row.changedMeanwhile += 1;
  }

  const sum = (key) => report.fields.reduce((n, r) => n + r[key], 0);
  report.totals = {
    found: sum('found'), alreadyEncrypted: sum('alreadyEncrypted'), encrypted: sum('encrypted'),
    toEncrypt: sum('toEncrypt'), changedMeanwhile: sum('changedMeanwhile'), conflicts: sum('conflicts'),
  };
  report.remaining = report.totals.toEncrypt + report.totals.changedMeanwhile + report.totals.conflicts;
  return report;
}

function formatReport(report) {
  const lines = [];
  const done = report.apply ? 'encrypted' : 'to encrypt';
  const doneKey = report.apply ? 'encrypted' : 'toEncrypt';
  lines.push('');
  lines.push(`Plain-text token encryption report (${report.apply ? 'APPLY' : 'DRY RUN: nothing was written'})`);
  lines.push('');
  const header = ['collection.field', 'found', 'already encrypted', done, 'changed meanwhile', 'conflicts'];
  const rows = report.fields.map((r) => [`${r.collection}.${r.field}`, r.found, r.alreadyEncrypted, r[doneKey], r.changedMeanwhile, r.conflicts]);
  rows.push(['TOTAL', report.totals.found, report.totals.alreadyEncrypted, report.totals[doneKey], report.totals.changedMeanwhile, report.totals.conflicts]);
  const table = [header, ...rows].map((cells) => cells.map(String));
  const widths = header.map((_, i) => Math.max(...table.map((cells) => cells[i].length)));
  for (const cells of table) lines.push(cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join('  '));
  lines.push('');
  if (report.totals.conflicts) {
    lines.push(`ATTENTION: ${report.totals.conflicts} brand(s) hold a plain-text WhatsApp token AND a different or unreadable encrypted one.`);
    lines.push('  Nothing was changed for them. The app uses the encrypted one; someone must decide which is right.');
  }
  if (report.totals.changedMeanwhile) {
    lines.push(`${report.totals.changedMeanwhile} value(s) were changed by the app during the run and were not overwritten. Run the same command again.`);
  }
  if (!report.apply) {
    lines.push(`Dry run: ${report.totals.toEncrypt} value(s) would be encrypted. Run again with --apply --backup <path> to do it.`);
  } else if (report.remaining === 0) {
    lines.push('RESULT: no plain-text token is left in these columns.');
  } else {
    lines.push(`RESULT: ${report.remaining} value(s) are still plain text.`);
  }
  return lines.join('\n');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
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
    const report = await migrate({ db: mongoose.connection.db, apply: args.apply });
    console.log(formatReport(report));
    if (args.apply) exitCode = report.remaining === 0 ? 0 : 1;
    else exitCode = report.totals.conflicts ? 1 : 0;
  } catch (error) {
    // A database error message can quote document contents, so only its name and code are printed.
    console.error(error instanceof RotationError ? error.message : `Stopped by an error: ${error.name}${error.code ? ` (code ${error.code})` : ''}`);
    console.error('Nothing is lost: values already encrypted stay readable. Fix the cause and run the same command again.');
    exitCode = error instanceof RotationError ? 2 : 1;
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
  return exitCode;
}

if (require.main === module) {
  main().then((code) => process.exit(code));
}

module.exports = { IN_PLACE_FIELDS, migrate, formatReport };
