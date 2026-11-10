/**
 * TOKEN_ENCRYPTION_KEY rotation: key versions in utils/crypto.js and the
 * one-time re-encryption script. In-memory MongoDB, dummy keys and tokens only.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const mongoose = require('mongoose');
const { startTestDb, stopTestDb, clearCollections, TEST_TOKEN_KEY } = require('./setup');

const OLD_KEY = TEST_TOKEN_KEY;
const NEW_KEY = 'test-dummy-new-encryption-key-used-only-in-tests-0001';
const SCRIPT = path.join(__dirname, '..', 'scripts', 'security', 'rotate-token-encryption-key.js');

const tokenCrypto = require('../utils/crypto');
const rotation = require('../scripts/security/rotate-token-encryption-key');

// Exactly what utils/crypto.js wrote before key versions existed.
function legacyEncrypt(text, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${body}`;
}

function useKeys(current, previous) {
  process.env.TOKEN_ENCRYPTION_KEY = current;
  if (previous) process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = previous;
  else delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
}

// Runs fn while capturing everything written to the console.
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
// Raw inserts skip the models, so each document gets its own id and workspace
// (both are unique in several collections).
let nextSeed = 1000;
const ids = () => { nextSeed += 1; return { id: nextSeed, tenant_id: nextSeed }; };
const plainOf = (collection, field, n) => `test-dummy-${collection}-${field}-${n}`;

// Three values per encrypted field, all written by the old key: two without a
// version (as production has today) and one with the old key's version.
async function seedOldKeyData() {
  useKeys(OLD_KEY);
  const expected = [];
  for (const { collection, field } of rotation.ENCRYPTED_FIELDS) {
    for (let n = 1; n <= 3; n += 1) {
      const plain = plainOf(collection, field, n);
      const stored = n === 3 ? tokenCrypto.encrypt(plain) : legacyEncrypt(plain, OLD_KEY);
      const { insertedId } = await db().collection(collection).insertOne({ ...ids(), seed: `${field}-${n}`, [field]: stored, untouched: 'keep-me' });
      expected.push({ collection, field, _id: insertedId, plain });
    }
  }
  return expected;
}

async function snapshot() {
  const out = {};
  for (const name of new Set(rotation.ENCRYPTED_FIELDS.map((f) => f.collection))) {
    out[name] = await db().collection(name).find({}).sort({ _id: 1 }).toArray();
  }
  return JSON.stringify(out);
}

// How many seeded values each key state can read, and how many carry the current version.
async function readState(expected) {
  let readable = 0;
  let current = 0;
  for (const item of expected) {
    const doc = await db().collection(item.collection).findOne({ _id: item._id });
    if (tokenCrypto.keyVersionOf(doc[item.field]) === tokenCrypto.currentKeyVersion()) current += 1;
    const opened = tokenCrypto.tryDecrypt(doc[item.field]);
    if (opened.ok && opened.value === item.plain) readable += 1;
  }
  return { readable, current };
}

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

test('key versions in utils/crypto.js', async (t) => {
  await t.test('a new value records the version of the key that encrypted it', () => {
    const stored = tokenCrypto.encrypt('test-dummy-token');
    assert.match(stored, /^k[0-9a-f]{8}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    assert.strictEqual(tokenCrypto.keyVersionOf(stored), tokenCrypto.currentKeyVersion());
    assert.strictEqual(tokenCrypto.decrypt(stored), 'test-dummy-token');
    assert.ok(!stored.includes(OLD_KEY), 'the version does not contain the key');
  });

  await t.test('a value written before key versions still decrypts', () => {
    const legacy = legacyEncrypt('test-dummy-legacy', OLD_KEY);
    assert.strictEqual(tokenCrypto.keyVersionOf(legacy), null);
    assert.strictEqual(tokenCrypto.decrypt(legacy), 'test-dummy-legacy');
  });

  await t.test('after the key is replaced, old values decrypt through TOKEN_ENCRYPTION_KEY_PREVIOUS', async () => {
    const legacy = legacyEncrypt('test-dummy-legacy', OLD_KEY);
    const versioned = tokenCrypto.encrypt('test-dummy-versioned');
    const oldVersion = tokenCrypto.currentKeyVersion();

    useKeys(NEW_KEY, OLD_KEY);
    assert.notStrictEqual(tokenCrypto.currentKeyVersion(), oldVersion);
    assert.strictEqual(tokenCrypto.previousKeyVersion(), oldVersion);
    assert.strictEqual(tokenCrypto.decrypt(legacy), 'test-dummy-legacy');
    assert.strictEqual(tokenCrypto.decrypt(versioned), 'test-dummy-versioned');
    const fresh = tokenCrypto.encrypt('test-dummy-fresh');
    assert.strictEqual(tokenCrypto.keyVersionOf(fresh), tokenCrypto.currentKeyVersion(), 'new values always use the current key');

    // Without the previous key the old values are refused, and nothing secret is logged.
    useKeys(NEW_KEY);
    const { output } = await captureConsole(() => {
      assert.throws(() => tokenCrypto.decrypt(legacy));
      assert.throws(() => tokenCrypto.decrypt(versioned), /key version that is not configured/);
    });
    assert.ok(!output.includes(OLD_KEY) && !output.includes(NEW_KEY) && !output.includes('test-dummy-'));
    assert.strictEqual(tokenCrypto.decrypt(fresh), 'test-dummy-fresh');
  });

  await t.test('a tampered value is rejected', async () => {
    const stored = tokenCrypto.encrypt('test-dummy-token');
    const flipped = stored.slice(0, -1) + (stored.endsWith('0') ? '1' : '0');
    await captureConsole(() => assert.throws(() => tokenCrypto.decrypt(flipped)));
    assert.deepStrictEqual(tokenCrypto.tryDecrypt(flipped), { ok: false, value: null });
  });

  await t.test('a previous key equal to the current key is ignored', () => {
    useKeys(OLD_KEY, OLD_KEY);
    assert.strictEqual(tokenCrypto.previousKeyVersion(), null);
  });
});

test('the backup check', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-rotation-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const good = path.join(dir, 'dump.archive.gz');
  fs.writeFileSync(good, 'dummy dump bytes');

  assert.throws(() => rotation.checkBackup(null), /needs --backup/);
  assert.throws(() => rotation.checkBackup(path.join(dir, 'missing')), /does not exist/);

  const empty = path.join(dir, 'empty.gz');
  fs.writeFileSync(empty, '');
  assert.throws(() => rotation.checkBackup(empty), /empty/);
  const emptyDir = path.join(dir, 'empty-dump');
  fs.mkdirSync(emptyDir);
  assert.throws(() => rotation.checkBackup(emptyDir), /empty/);

  assert.throws(() => rotation.checkBackup(good, { now: Date.now() + 25 * 3600000 }), /hours old/);
  assert.strictEqual(rotation.checkBackup(good).files, 1);

  const dumpDir = path.join(dir, 'dump', 'nera');
  fs.mkdirSync(dumpDir, { recursive: true });
  fs.writeFileSync(path.join(dumpDir, 'clients.bson'), 'dummy');
  fs.writeFileSync(path.join(dumpDir, 'users.bson'), 'dummy');
  assert.strictEqual(rotation.checkBackup(path.join(dir, 'dump')).files, 2);

  // The command line refuses --apply before it opens the database.
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/never_connected' } });
  const noBackup = run(['--apply']);
  assert.strictEqual(noBackup.status, 2);
  assert.match(noBackup.stderr, /needs --backup/);
  const missing = run(['--apply', '--backup', path.join(dir, 'missing')]);
  assert.strictEqual(missing.status, 2);
  assert.match(missing.stderr, /does not exist/);
  assert.strictEqual(run(['--nonsense']).status, 2);
});

test('re-encryption script', async (t) => {
  await t.test('dry run counts and writes nothing', async () => {
    const expected = await seedOldKeyData();
    useKeys(NEW_KEY, OLD_KEY);
    const before = await snapshot();
    const report = await rotation.rotate({ db: db(), apply: false });
    assert.strictEqual(await snapshot(), before, 'nothing changed');
    assert.strictEqual(report.totals.found, expected.length);
    assert.strictEqual(report.totals.toReencrypt, expected.length);
    assert.strictEqual(report.totals.reencrypted, 0);
    assert.match(rotation.formatReport(report), /DRY RUN/);
  });

  await t.test('apply refuses to run without the previous key', async () => {
    await seedOldKeyData();
    const before = await snapshot();
    await assert.rejects(rotation.rotate({ db: db(), apply: true }), /TOKEN_ENCRYPTION_KEY_PREVIOUS is not set/);
    assert.strictEqual(await snapshot(), before);
  });

  await t.test('a run that fails half way loses nothing and is finished by running again', async () => {
    const expected = await seedOldKeyData();
    const total = expected.length;
    const half = Math.floor(total / 2);
    useKeys(NEW_KEY, OLD_KEY);

    // First run crashes after half the values are written.
    const { output } = await captureConsole(async () => {
      await assert.rejects(rotation.rotate({ db: failingDb(half), apply: true }), /simulated crash/);
    });
    const afterCrash = await readState(expected);
    assert.strictEqual(afterCrash.current, half, 'exactly the values written before the crash are under the new key');
    assert.strictEqual(afterCrash.readable, total, 'with both keys set the app still reads every value');

    // Second run picks up where the first stopped.
    const second = await rotation.rotate({ db: db(), apply: true });
    assert.strictEqual(second.totals.alreadyCurrent, half, 'values done by the first run are skipped');
    assert.strictEqual(second.totals.reencrypted, total - half);
    assert.strictEqual(second.remaining, 0);
    assert.match(rotation.formatReport(second), /every encrypted value is now under the current key/);

    // The old key can now be removed: everything decrypts with the new key alone.
    useKeys(NEW_KEY);
    assert.deepStrictEqual(await readState(expected), { readable: total, current: total });

    // A third run finds nothing to do and changes nothing.
    useKeys(NEW_KEY, OLD_KEY);
    const settled = await snapshot();
    const third = await rotation.rotate({ db: db(), apply: true });
    assert.strictEqual(third.totals.reencrypted, 0);
    assert.strictEqual(third.totals.alreadyCurrent, total);
    assert.strictEqual(await snapshot(), settled);

    // Only the encrypted field changed on each document.
    const sample = await db().collection('clients').findOne({ seed: 'wa_access_token_enc-1' });
    assert.strictEqual(sample.untouched, 'keep-me');

    // Nothing printed along the way, and no report, contains a key, a token or a ciphertext.
    const printed = [output, rotation.formatReport(second), rotation.formatReport(third), JSON.stringify(second)].join('\n');
    assert.ok(!printed.includes(OLD_KEY) && !printed.includes(NEW_KEY), 'no key');
    assert.ok(!printed.includes('test-dummy-'), 'no plaintext');
    for (const item of expected) {
      const doc = await db().collection(item.collection).findOne({ _id: item._id });
      assert.ok(!printed.includes(doc[item.field]), 'no ciphertext');
    }
  });

  await t.test('unreadable values and plain-text columns are counted or ignored, never changed', async () => {
    useKeys(OLD_KEY);
    const clients = db().collection('clients');
    await clients.insertOne({ id: 1, tenant_id: 1, wa_access_token_enc: legacyEncrypt('test-dummy-good', OLD_KEY) });
    await clients.insertOne({ id: 2, tenant_id: 2, wa_access_token_enc: legacyEncrypt('test-dummy-lost', 'test-dummy-some-third-key-nobody-has') });
    await clients.insertOne({ id: 3, tenant_id: 3, wa_access_token_enc: 'not-a-ciphertext' });
    await clients.insertOne({ id: 4, tenant_id: 4, wa_access_token: 'test-dummy-plain-legacy', access_token: 'test-dummy-plain-google' });

    useKeys(NEW_KEY, OLD_KEY);
    const report = await rotation.rotate({ db: db(), apply: true });
    const row = report.fields.find((f) => f.collection === 'clients' && f.field === 'wa_access_token_enc');
    assert.deepStrictEqual([row.found, row.reencrypted, row.unreadable], [3, 1, 2]);
    assert.strictEqual(report.remaining, 2);
    assert.match(rotation.formatReport(report), /could not be read with any configured key/);

    assert.strictEqual((await clients.findOne({ tenant_id: 3 })).wa_access_token_enc, 'not-a-ciphertext');
    const plain = await clients.findOne({ tenant_id: 4 });
    assert.strictEqual(plain.wa_access_token, 'test-dummy-plain-legacy');
    assert.strictEqual(plain.access_token, 'test-dummy-plain-google');
    assert.strictEqual(plain.wa_access_token_enc, undefined);
  });

  await t.test('a value the app changes during the run is not overwritten', async () => {
    useKeys(OLD_KEY);
    const clients = db().collection('clients');
    const { insertedId } = await clients.insertOne({ id: 1, tenant_id: 1, wa_access_token_enc: legacyEncrypt('test-dummy-before', OLD_KEY) });
    useKeys(NEW_KEY, OLD_KEY);
    const appWrite = tokenCrypto.encrypt('test-dummy-saved-by-the-app');
    const racingDb = {
      collection(name) {
        const real = db().collection(name);
        return {
          find: (...args) => real.find(...args),
          countDocuments: (...args) => real.countDocuments(...args),
          updateOne: async (...args) => {
            if (name === 'clients') await real.updateOne({ _id: insertedId }, { $set: { wa_access_token_enc: appWrite } });
            return real.updateOne(...args);
          },
        };
      },
    };
    const report = await rotation.rotate({ db: racingDb, apply: true });
    assert.strictEqual(report.totals.changedMeanwhile, 1);
    assert.strictEqual((await clients.findOne({ _id: insertedId })).wa_access_token_enc, appWrite);
  });

  await t.test('the app keeps working through the models before, during and after', async () => {
    const { Clients, Users } = require('../models');
    const { runAsTenant, runAsSystem } = require('../services/tenantContext');
    useKeys(OLD_KEY);
    await db().collection('clients').insertOne({ id: 1, tenant_id: 7, name: 'Brand', wa_access_token_enc: legacyEncrypt('test-dummy-wa-token-WXYZ', OLD_KEY), wa_token_last4: 'WXYZ' });
    await db().collection('users').insertOne({ id: 1, tenant_id: 7, email: 'owner@example.com', mfa_secret_enc: legacyEncrypt('test-dummy-mfa-secret', OLD_KEY) });
    const token = async () => (await runAsTenant(7, () => Clients.findOne({ id: 1 }).lean())).wa_access_token;

    assert.strictEqual(await token(), 'test-dummy-wa-token-WXYZ', 'before: old key only');
    useKeys(NEW_KEY, OLD_KEY);
    assert.strictEqual(await token(), 'test-dummy-wa-token-WXYZ', 'new key deployed, value not yet re-encrypted');
    await rotation.rotate({ db: db(), apply: true });
    useKeys(NEW_KEY);
    assert.strictEqual(await token(), 'test-dummy-wa-token-WXYZ', 'after: new key only');
    const raw = await db().collection('clients').findOne({ id: 1 });
    assert.strictEqual(raw.wa_token_last4, 'WXYZ');
    const user = await runAsSystem(() => Users.findOne({ id: 1 }).lean(), 'test');
    assert.strictEqual(tokenCrypto.decrypt(user.mfa_secret_enc), 'test-dummy-mfa-secret');
  });
});

test('contact-erasure phone hashes across a key change', async () => {
  const erasure = require('../services/erasure');
  const { ContactErasures } = require('../models');
  const { runAsTenant } = require('../services/tenantContext');
  const PHONE = '+91 90000 12345';

  useKeys(OLD_KEY);
  const oldHash = erasure.phoneHash(5, PHONE);
  await db().collection('contact_erasures').insertOne({ id: 1, tenant_id: 5, lead_id: 1, phone_hash: oldHash, status: 'completed' });
  assert.strictEqual(await runAsTenant(5, () => erasure.isErased(PHONE)), true);

  useKeys(NEW_KEY, OLD_KEY);
  assert.notStrictEqual(erasure.phoneHash(5, PHONE), oldHash);
  assert.strictEqual(await runAsTenant(5, () => erasure.isErased(PHONE)), true, 'an erasure made under the old key still blocks sends');
  assert.strictEqual(await runAsTenant(6, () => erasure.isErased(PHONE)), false, 'still per workspace');

  await runAsTenant(5, () => ContactErasures.create({ id: 2, lead_id: 2, phone_hash: erasure.phoneHash(5, '+91 90000 99999'), phone_hash_key: tokenCrypto.currentKeyVersion(), status: 'completed' }));
  const report = await rotation.rotate({ db: db(), apply: false });
  assert.deepStrictEqual(report.erasures, { total: 2, underOtherKey: 1 });
  assert.match(rotation.formatReport(report), /cannot be converted/);
});
