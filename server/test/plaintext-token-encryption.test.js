/**
 * Encrypting the token columns that used to be plain text: the model-level
 * encryption (db/encryptedFields.js) and the one-time migration script.
 * In-memory MongoDB, dummy keys and tokens only.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, TEST_TOKEN_KEY } = require('./setup');

const OLD_KEY = TEST_TOKEN_KEY;
const NEW_KEY = 'test-dummy-new-encryption-key-used-only-in-tests-0002';
const SCRIPT = path.join(__dirname, '..', 'scripts', 'security', 'encrypt-plaintext-tokens.js');

const tokenCrypto = require('../utils/crypto');
const migration = require('../scripts/security/encrypt-plaintext-tokens');
const rotation = require('../scripts/security/rotate-token-encryption-key');

function useKeys(current, previous) {
  process.env.TOKEN_ENCRYPTION_KEY = current;
  if (previous) process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
}

async function captureConsole(fn) {
  const lines = [];
  const original = { log: console.log, error: console.error, warn: console.warn };
  for (const name of Object.keys(original)) console[name] = (...args) => lines.push(args.map(String).join(' '));
  try {
    return { result: await fn(), output: lines.join('\n') };
  } finally {
    Object.assign(console, original);
  }
}

const db = () => mongoose.connection.db;
const raw = (collection, filter) => db().collection(collection).findOne(filter);
const isCurrent = (value) => tokenCrypto.keyVersionOf(value) === tokenCrypto.currentKeyVersion();

// A database handle whose updateOne starts failing after `allowed` writes.
function failingDb(allowed) {
  let writes = 0;
  return {
    collection(name) {
      const real = db().collection(name);
      return {
        find: (...args) => real.find(...args),
        countDocuments: (...args) => real.countDocuments(...args),
        updateOne: async (...args) => {
          if (writes >= allowed) throw new Error('simulated crash in the middle of the run');
          writes += 1;
          return real.updateOne(...args);
        },
      };
    },
  };
}

// Plain-text rows exactly as older code left them.
async function seedPlainRows() {
  const expected = [];
  const add = async (collection, doc, fields) => {
    const { insertedId } = await db().collection(collection).insertOne({ ...doc, untouched: 'keep-me' });
    for (const field of fields) expected.push({ collection, _id: insertedId, field, plain: doc[field] });
  };
  for (let n = 1; n <= 3; n += 1) {
    await add('mafiya_gmb_tokens', { id: n, client_id: n, access_token: `test-dummy-gmb-access-${n}`, refresh_token: `test-dummy-gmb-refresh-${n}` }, ['access_token', 'refresh_token']);
    await add('thedal_gsc_tokens', { id: n, client_id: n, access_token: `test-dummy-gsc-access-${n}`, refresh_token: `test-dummy-gsc-refresh-${n}` }, ['access_token', 'refresh_token']);
    await add('clients', { id: n, tenant_id: n, name: `Brand ${n}`, access_token: `test-dummy-brand-access-${n}`, refresh_token: `test-dummy-brand-refresh-${n}` }, ['access_token', 'refresh_token']);
  }
  return expected;
}

async function snapshot() {
  const out = {};
  for (const name of ['mafiya_gmb_tokens', 'thedal_gsc_tokens', 'clients']) {
    out[name] = await db().collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(out);
}

async function state(expected) {
  let encrypted = 0;
  let readable = 0;
  for (const item of expected) {
    const stored = (await raw(item.collection, { _id: item._id }))[item.field];
    if (tokenCrypto.looksEncrypted(stored)) encrypted += 1;
    const value = tokenCrypto.looksEncrypted(stored) ? tokenCrypto.tryDecrypt(stored).value : stored;
    if (value === item.plain) readable += 1;
  }
  return { encrypted, readable };
}

test.before(async () => {
  await startTestDb();
});

test.after(async () => {
  useKeys(OLD_KEY);
  await stopTestDb();
});

test.beforeEach(async () => {
  useKeys(OLD_KEY);
  await clearCollections();
});

test('token columns are encrypted at rest and plain to server code', async (t) => {
  const { MafiyaGmbTokens, ThedalGscTokens, Clients } = require('../models');
  const { runAsTenant } = require('../services/tenantContext');

  await t.test('create, read, update and upsert on mafiya_gmb_tokens (the Google connect and refresh flows)', async () => {
    const created = await MafiyaGmbTokens.create({ client_id: 7, access_token: 'test-dummy-access-1', refresh_token: 'test-dummy-refresh-1' });
    assert.strictEqual(created.access_token, 'test-dummy-access-1', 'the saved document is readable to the caller');

    let stored = await raw('mafiya_gmb_tokens', { client_id: 7 });
    assert.ok(isCurrent(stored.access_token) && isCurrent(stored.refresh_token), 'stored with the current key version');
    assert.ok(!JSON.stringify(stored).includes('test-dummy-'), 'no plain token in the database');

    const lean = await MafiyaGmbTokens.findOne({ client_id: 7 }, { access_token: 1, refresh_token: 1, expires_at: 1 }).lean();
    assert.deepStrictEqual([lean.access_token, lean.refresh_token], ['test-dummy-access-1', 'test-dummy-refresh-1']);
    const doc = await MafiyaGmbTokens.findOne({ client_id: 7 });
    assert.strictEqual(doc.refresh_token, 'test-dummy-refresh-1');
    const [listed] = await MafiyaGmbTokens.find({ client_id: 7 }).lean();
    assert.strictEqual(listed.access_token, 'test-dummy-access-1');

    // The token refresh in routes/mafiya-reviews.js and mafiya-insights.js.
    await MafiyaGmbTokens.updateMany({ client_id: 7 }, { $set: { access_token: 'test-dummy-access-2', expires_at: new Date() } });
    stored = await raw('mafiya_gmb_tokens', { client_id: 7 });
    assert.ok(isCurrent(stored.access_token));
    assert.strictEqual((await MafiyaGmbTokens.findOne({ client_id: 7 }).lean()).access_token, 'test-dummy-access-2');
    assert.strictEqual((await MafiyaGmbTokens.findOne({ client_id: 7 }).lean()).refresh_token, 'test-dummy-refresh-1', 'other fields are untouched');

    // Changing a loaded document and saving it.
    doc.access_token = 'test-dummy-access-3';
    await doc.save();
    assert.strictEqual(doc.access_token, 'test-dummy-access-3');
    stored = await raw('mafiya_gmb_tokens', { client_id: 7 });
    assert.strictEqual(tokenCrypto.decrypt(stored.access_token), 'test-dummy-access-3');
    assert.strictEqual(tokenCrypto.decrypt(stored.refresh_token), 'test-dummy-refresh-1', 'an unchanged field is not double-encrypted');

    const upserted = await MafiyaGmbTokens.findOneAndUpdate({ client_id: 8 }, { $set: { access_token: 'test-dummy-access-8' } }, { upsert: true, new: true }).lean();
    assert.strictEqual(upserted.access_token, 'test-dummy-access-8');
    assert.ok(isCurrent((await raw('mafiya_gmb_tokens', { client_id: 8 })).access_token));

    await MafiyaGmbTokens.insertMany([{ client_id: 9, access_token: 'test-dummy-access-9' }]);
    assert.ok(isCurrent((await raw('mafiya_gmb_tokens', { client_id: 9 })).access_token));
    assert.strictEqual((await MafiyaGmbTokens.findOne({ client_id: 9 }).lean()).access_token, 'test-dummy-access-9');

    const status = await MafiyaGmbTokens.findOne({ client_id: 7 }, { refresh_token: 1 }).lean();
    assert.ok(status.refresh_token, 'the connection status check still sees a refresh token');
    await MafiyaGmbTokens.create({ client_id: 10, access_token: 'test-dummy-access-10', refresh_token: null });
    assert.strictEqual((await MafiyaGmbTokens.findOne({ client_id: 10 }).lean()).refresh_token, null, 'a missing refresh token stays empty');
  });

  await t.test('a row that is still plain text keeps working until it is migrated', async () => {
    await db().collection('thedal_gsc_tokens').insertOne({ id: 1, client_id: 1, access_token: 'test-dummy-plain-access', refresh_token: 'test-dummy-plain-refresh' });
    const row = await ThedalGscTokens.findOne({ client_id: 1 }).lean();
    assert.deepStrictEqual([row.access_token, row.refresh_token], ['test-dummy-plain-access', 'test-dummy-plain-refresh']);
    await ThedalGscTokens.updateOne({ client_id: 1 }, { $set: { access_token: 'test-dummy-new-access' } });
    const stored = await raw('thedal_gsc_tokens', { client_id: 1 });
    assert.ok(isCurrent(stored.access_token), 'the next write encrypts');
    assert.strictEqual(stored.refresh_token, 'test-dummy-plain-refresh');
  });

  await t.test('clients.access_token and refresh_token, alongside the WhatsApp token', async () => {
    const { sanitizeClient } = require('../services/clientSecrets');
    await runAsTenant(3, () => Clients.create({ name: 'Brand', access_token: 'test-dummy-brand-access', refresh_token: 'test-dummy-brand-refresh', wa_access_token: 'test-dummy-wa-token-ABCD' }));
    const stored = await raw('clients', { tenant_id: 3 });
    assert.ok(isCurrent(stored.access_token) && isCurrent(stored.refresh_token) && isCurrent(stored.wa_access_token_enc));
    assert.strictEqual(stored.wa_access_token, undefined);
    assert.ok(!JSON.stringify(stored).includes('test-dummy-'));

    const brand = await runAsTenant(3, () => Clients.findOne({}).lean());
    assert.deepStrictEqual([brand.access_token, brand.refresh_token, brand.wa_access_token], ['test-dummy-brand-access', 'test-dummy-brand-refresh', 'test-dummy-wa-token-ABCD']);
    const safe = sanitizeClient(brand);
    assert.strictEqual(safe.access_token, undefined);
    assert.strictEqual(safe.refresh_token, undefined);

    await runAsTenant(3, () => Clients.updateOne({}, { $set: { refresh_token: 'test-dummy-brand-refresh-2', wa_access_token: 'test-dummy-wa-token-WXYZ' } }));
    const after = await runAsTenant(3, () => Clients.findOne({}).lean());
    assert.deepStrictEqual([after.refresh_token, after.wa_access_token], ['test-dummy-brand-refresh-2', 'test-dummy-wa-token-WXYZ']);
    assert.ok(isCurrent((await raw('clients', { tenant_id: 3 })).refresh_token));
  });

  await t.test('a value that cannot be decrypted reads as empty and nothing secret is logged', async () => {
    await MafiyaGmbTokens.create({ client_id: 11, access_token: 'test-dummy-access-11' });
    useKeys(NEW_KEY);
    const { result, output } = await captureConsole(() => MafiyaGmbTokens.findOne({ client_id: 11 }).lean());
    assert.strictEqual(result.access_token, null);
    assert.match(output, /could not be decrypted/);
    assert.ok(!output.includes('test-dummy-') && !output.includes(OLD_KEY) && !output.includes(NEW_KEY));
  });
});

test('migration of existing plain-text rows', async (t) => {
  await t.test('dry run counts and writes nothing', async () => {
    const expected = await seedPlainRows();
    const before = await snapshot();
    const report = await migration.migrate({ db: db(), apply: false });
    assert.strictEqual(await snapshot(), before, 'nothing changed');
    assert.strictEqual(report.totals.found, expected.length);
    assert.strictEqual(report.totals.toEncrypt, expected.length);
    assert.strictEqual(report.totals.encrypted, 0);
    assert.match(migration.formatReport(report), /DRY RUN/);
  });

  await t.test('a run that fails half way loses nothing and is finished by running again', async () => {
    const { MafiyaGmbTokens } = require('../models');
    const expected = await seedPlainRows();
    const total = expected.length;
    const half = Math.floor(total / 2);

    const { output } = await captureConsole(async () => {
      await assert.rejects(migration.migrate({ db: failingDb(half), apply: true }), /simulated crash/);
    });
    assert.deepStrictEqual(await state(expected), { encrypted: half, readable: total }, 'half encrypted, everything still readable');
    for (let n = 1; n <= 3; n += 1) {
      const row = await MafiyaGmbTokens.findOne({ client_id: n }).lean();
      assert.deepStrictEqual([row.access_token, row.refresh_token], [`test-dummy-gmb-access-${n}`, `test-dummy-gmb-refresh-${n}`], 'the app reads the half-migrated data');
    }

    const second = await migration.migrate({ db: db(), apply: true });
    assert.strictEqual(second.totals.alreadyEncrypted, half, 'values done by the first run are skipped');
    assert.strictEqual(second.totals.encrypted, total - half);
    assert.strictEqual(second.remaining, 0);
    assert.match(migration.formatReport(second), /no plain-text token is left/);
    assert.deepStrictEqual(await state(expected), { encrypted: total, readable: total });

    const settled = await snapshot();
    const third = await migration.migrate({ db: db(), apply: true });
    assert.strictEqual(third.totals.encrypted, 0);
    assert.strictEqual(await snapshot(), settled, 'a re-run changes nothing');
    assert.ok(!settled.includes('test-dummy-'), 'no plain token is left in the database');
    assert.strictEqual((await raw('clients', { id: 1 })).untouched, 'keep-me');

    const printed = [output, migration.formatReport(second), migration.formatReport(third), JSON.stringify(second)].join('\n');
    assert.ok(!printed.includes(OLD_KEY), 'no key');
    assert.ok(!printed.includes('test-dummy-'), 'no plaintext');
    for (const item of expected) assert.ok(!printed.includes((await raw(item.collection, { _id: item._id }))[item.field]), 'no ciphertext');
  });

  await t.test('clients.wa_access_token moves to the encrypted column; conflicts are left alone', async () => {
    const { Clients } = require('../models');
    const { runAsTenant } = require('../services/tenantContext');
    const clients = db().collection('clients');
    await clients.insertOne({ id: 1, tenant_id: 1, name: 'Plain only', wa_access_token: 'test-dummy-wa-plain-AAAA' });
    await clients.insertOne({ id: 2, tenant_id: 2, name: 'Same in both', wa_access_token: 'test-dummy-wa-same-BBBB', wa_access_token_enc: tokenCrypto.encrypt('test-dummy-wa-same-BBBB'), wa_token_last4: 'BBBB' });
    await clients.insertOne({ id: 3, tenant_id: 3, name: 'Different', wa_access_token: 'test-dummy-wa-older-CCCC', wa_access_token_enc: tokenCrypto.encrypt('test-dummy-wa-newer-DDDD'), wa_token_last4: 'DDDD' });
    await clients.insertOne({ id: 4, tenant_id: 4, name: 'Unreadable', wa_access_token: 'test-dummy-wa-plain-EEEE', wa_access_token_enc: 'not-a-ciphertext' });
    await clients.insertOne({ id: 5, tenant_id: 5, name: 'Encrypted only', wa_access_token_enc: tokenCrypto.encrypt('test-dummy-wa-fine-FFFF'), wa_token_last4: 'FFFF' });

    const dry = await migration.migrate({ db: db(), apply: false });
    const dryRow = dry.fields.find((f) => f.field === 'wa_access_token');
    assert.deepStrictEqual([dryRow.found, dryRow.toEncrypt, dryRow.conflicts], [4, 2, 2]);

    const report = await migration.migrate({ db: db(), apply: true });
    const row = report.fields.find((f) => f.field === 'wa_access_token');
    assert.deepStrictEqual([row.found, row.encrypted, row.duplicatesRemoved, row.conflicts], [4, 2, 1, 2]);
    assert.strictEqual(report.remaining, 2);
    assert.match(migration.formatReport(report), /someone must decide which is right/);

    const moved = await clients.findOne({ id: 1 });
    assert.strictEqual(moved.wa_access_token, undefined);
    assert.strictEqual(tokenCrypto.decrypt(moved.wa_access_token_enc), 'test-dummy-wa-plain-AAAA');
    assert.strictEqual(moved.wa_token_last4, 'AAAA');
    assert.strictEqual((await runAsTenant(1, () => Clients.findOne({}).lean())).wa_access_token, 'test-dummy-wa-plain-AAAA', 'the app still gets the token');

    const same = await clients.findOne({ id: 2 });
    assert.strictEqual(same.wa_access_token, undefined);
    assert.strictEqual(tokenCrypto.decrypt(same.wa_access_token_enc), 'test-dummy-wa-same-BBBB');

    const different = await clients.findOne({ id: 3 });
    assert.strictEqual(different.wa_access_token, 'test-dummy-wa-older-CCCC', 'left as it was');
    assert.strictEqual(tokenCrypto.decrypt(different.wa_access_token_enc), 'test-dummy-wa-newer-DDDD');
    const unreadable = await clients.findOne({ id: 4 });
    assert.strictEqual(unreadable.wa_access_token, 'test-dummy-wa-plain-EEEE');
    assert.strictEqual(unreadable.wa_access_token_enc, 'not-a-ciphertext');

    assert.ok(!migration.formatReport(report).includes('test-dummy-'));
  });

  await t.test('the command line refuses --apply without a valid backup', async (t2) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-plaintext-'));
    t2.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/never_connected' } });
    const noBackup = run(['--apply']);
    assert.strictEqual(noBackup.status, 2);
    assert.match(noBackup.stderr, /needs --backup/);
    const missing = run(['--apply', '--backup', path.join(dir, 'missing')]);
    assert.strictEqual(missing.status, 2);
    assert.match(missing.stderr, /does not exist/);
  });
});

test('key rotation covers the newly encrypted columns', async () => {
  const { MafiyaGmbTokens } = require('../models');
  const expected = await seedPlainRows();

  // Before the migration, a rotation counts plain rows and leaves them alone.
  useKeys(NEW_KEY, OLD_KEY);
  const early = await rotation.rotate({ db: db(), apply: true });
  assert.strictEqual(early.totals.plainText, expected.length);
  assert.strictEqual(early.totals.unreadable, 0);
  assert.deepStrictEqual(await state(expected), { encrypted: 0, readable: expected.length });
  assert.match(rotation.formatReport(early), /still plain text/);

  // Migrate under the old key, then rotate to the new one.
  useKeys(OLD_KEY);
  await migration.migrate({ db: db(), apply: true });
  useKeys(NEW_KEY, OLD_KEY);
  const report = await rotation.rotate({ db: db(), apply: true });
  assert.strictEqual(report.totals.reencrypted, expected.length);
  assert.strictEqual(report.totals.plainText, 0);
  assert.strictEqual(report.remaining, 0);

  useKeys(NEW_KEY);
  assert.deepStrictEqual(await state(expected), { encrypted: expected.length, readable: expected.length }, 'readable with the new key alone');
  assert.strictEqual((await MafiyaGmbTokens.findOne({ client_id: 2 }).lean()).refresh_token, 'test-dummy-gmb-refresh-2');
});
