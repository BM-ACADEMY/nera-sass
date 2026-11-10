/**
 * TOKEN_ENCRYPTION_KEY rotation: key versioning in utils/crypto.js and the
 * one-time scripts/rotate-token-key.js. Synthetic keys and tokens only.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { TEST_TOKEN_KEY } = require('./setup');
const cryptoHelper = require('../utils/crypto');
const { rotateAll } = require('../scripts/rotate-token-key');

const OLD_KEY = TEST_TOKEN_KEY;
const NEW_KEY = 'synthetic-new-key-for-rotation-tests-0000000000';

// Writes a value in the pre-versioning format: iv:authTag:ciphertext.
function legacyEncrypt(text, secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = c.update(text, 'utf8', 'hex') + c.final('hex');
  return `${iv.toString('hex')}:${c.getAuthTag().toString('hex')}:${data}`;
}

function withKeys(current, previous, fn) {
  const saved = [process.env.TOKEN_ENCRYPTION_KEY, process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS];
  process.env.TOKEN_ENCRYPTION_KEY = current;
  if (previous) process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = previous; else delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS;
  const restore = () => {
    process.env.TOKEN_ENCRYPTION_KEY = saved[0];
    if (saved[1] === undefined) delete process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS; else process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = saved[1];
  };
  try {
    const out = fn();
    if (out && typeof out.then === 'function') return out.finally(restore);
    restore();
    return out;
  } catch (e) { restore(); throw e; }
}

const quiet = (fn) => async (...a) => {
  const orig = console.error; console.error = () => {};
  try { return await fn(...a); } finally { console.error = orig; }
};

test('crypto: new values carry the key version and round-trip', () => {
  const v = cryptoHelper.encrypt('tok-1');
  assert.match(v, /^v2:[0-9a-f]{8}:[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
  assert.strictEqual(v.split(':')[1], cryptoHelper.currentKeyId());
  assert.ok(!v.includes('tok-1'));
  assert.strictEqual(cryptoHelper.decrypt(v), 'tok-1');
  assert.strictEqual(cryptoHelper.encrypt(''), null);
});

test('crypto: decrypts with current or previous key; legacy values still work', quiet(async () => {
  const legacy = legacyEncrypt('legacy-tok', OLD_KEY);
  const oldVersioned = cryptoHelper.encrypt('old-tok');
  const newValue = withKeys(NEW_KEY, OLD_KEY, () => cryptoHelper.encrypt('new-tok'));

  // Rotated config: new current, old previous.
  withKeys(NEW_KEY, OLD_KEY, () => {
    assert.strictEqual(cryptoHelper.decrypt(legacy), 'legacy-tok');
    assert.strictEqual(cryptoHelper.decrypt(oldVersioned), 'old-tok');
    assert.strictEqual(cryptoHelper.decrypt(newValue), 'new-tok');
    assert.strictEqual(cryptoHelper.inspect(legacy), 'stale');
    assert.strictEqual(cryptoHelper.inspect(oldVersioned), 'stale');
    assert.strictEqual(cryptoHelper.inspect(newValue), 'current');
    assert.strictEqual(cryptoHelper.inspect('plain-token-value'), 'unknown');
  });
  // Previous key removed: old values are locked, new ones still work.
  withKeys(NEW_KEY, null, () => {
    assert.throws(() => cryptoHelper.decrypt(legacy));
    assert.throws(() => cryptoHelper.decrypt(oldVersioned), /No configured key matches/);
    assert.strictEqual(cryptoHelper.inspect(oldVersioned), 'locked');
    assert.strictEqual(cryptoHelper.decrypt(newValue), 'new-tok');
  });
}));

test('crypto: errors and logs never contain the token or key', quiet(async () => {
  const logged = [];
  const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  let message = '';
  try {
    const v = cryptoHelper.encrypt('super-secret-token');
    try { withKeys(NEW_KEY, null, () => cryptoHelper.decrypt(v)); } catch (e) { message = e.message; }
  } finally { console.error = orig; }
  const all = logged.join('\n') + message;
  assert.ok(!all.includes('super-secret-token'));
  assert.ok(!all.includes(OLD_KEY) && !all.includes(NEW_KEY));
}));


// Minimal in-memory stand-in for the slice of the MongoDB driver the script uses
// (find with $type/$ne on one field, async cursor, updateOne with _id + field filter + $set).
function fakeDb() {
  const data = new Map();
  const col = (name) => {
    if (!data.has(name)) data.set(name, []);
    const rows = data.get(name);
    return {
      rows,
      insert(doc) { rows.push({ _id: rows.length + 1, ...doc }); },
      find(filter, { projection }) {
        const [field] = Object.keys(filter);
        const hits = rows.filter((d) => typeof d[field] === 'string' && d[field] !== '');
        return (async function* () { for (const d of hits) yield { _id: d._id, [Object.keys(projection)[0]]: d[field] }; })();
      },
      async updateOne(filter, { $set }) {
        const { _id, ...cond } = filter;
        const doc = rows.find((d) => d._id === _id && Object.entries(cond).every(([k, v]) => d[k] === v));
        if (!doc) return { modifiedCount: 0 };
        Object.assign(doc, $set);
        return { modifiedCount: 1 };
      },
    };
  };
  return { collection: col, rowsOf: (name) => col(name).rows };
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rot-'));
const PLAIN = 'plain-text-token';
const FIELDS = [['brand_social_accounts', ['access_token', 'lead_ads_access_token']], ['clients', ['wa_access_token_enc']], ['users', ['mfa_secret_enc']], ['reply_webhooks', ['secret_enc']]];
const allValues = (db) => FIELDS.flatMap(([c, fs_]) => db.rowsOf(c).flatMap((d) => fs_.filter((f) => d[f]).map((f) => d[f])));
const encryptedValues = (db) => allValues(db).filter((v) => v !== PLAIN);

function seed() {
  const db = fakeDb();
  const legacy = legacyEncrypt('tok-legacy', OLD_KEY);
  const old = cryptoHelper.encrypt('tok-old'); // versioned, written with the old key
  db.collection('brand_social_accounts').insert({ access_token: legacy, lead_ads_access_token: old });
  db.collection('brand_social_accounts').insert({ access_token: old });
  db.collection('brand_social_accounts').insert({ access_token: PLAIN });
  db.collection('clients').insert({ wa_access_token_enc: legacy });
  db.collection('clients').insert({ wa_access_token_enc: null });
  db.collection('users').insert({ mfa_secret_enc: old });
  db.collection('reply_webhooks').insert({ secret_enc: legacy });
  return { db, legacy };
}
const run = (db, opts = {}) => withKeys(NEW_KEY, OLD_KEY, () => rotateAll({ db, backupDir: tmp(), ...opts }));
const PLAINTEXTS = ['tok-legacy', 'tok-legacy', 'tok-legacy', 'tok-old', 'tok-old', 'tok-old'];
const decryptAllWithNewKeyOnly = (db) => withKeys(NEW_KEY, null, () => encryptedValues(db).map((v) => cryptoHelper.decrypt(v)).sort());

test('rotation: dry run counts and writes nothing', quiet(async () => {
  const { db } = seed();
  const dir = tmp();
  const before = JSON.stringify(allValues(db));
  const res = await run(db, { apply: false, backupDir: dir });
  assert.strictEqual(res.totals.pending, 6);
  assert.strictEqual(res.totals.notEncrypted, 1);
  assert.strictEqual(res.totals.rotated, 0);
  assert.strictEqual(JSON.stringify(allValues(db)), before);
  assert.deepStrictEqual(fs.readdirSync(dir), [], 'no backup in a dry run');
}));

test('rotation: apply takes a private backup, moves everything to the new key, leaves plain text alone', quiet(async () => {
  const { db, legacy } = seed();
  const lines = [];
  const res = await run(db, { apply: true, log: (l) => lines.push(l) });
  assert.strictEqual(res.totals.rotated, 6);
  assert.strictEqual(res.totals.pending, 0);
  assert.strictEqual(res.aborted, false);

  const backup = fs.readFileSync(res.backupFile, 'utf8');
  assert.strictEqual(fs.statSync(res.backupFile).mode & 0o077, 0, 'backup readable by owner only');
  assert.ok(backup.includes(legacy), 'backup holds the original ciphertext');
  assert.ok(!/tok-legacy|tok-old/.test(backup), 'backup never holds plaintext');

  assert.deepStrictEqual(decryptAllWithNewKeyOnly(db), PLAINTEXTS.slice().sort(), 'readable without the previous key');
  assert.ok(allValues(db).includes(PLAIN), 'plain text value untouched');

  const output = lines.join('\n') + JSON.stringify(res);
  for (const secret of ['tok-legacy', 'tok-old', PLAIN, OLD_KEY, NEW_KEY, ...allValues(db)]) assert.ok(!output.includes(secret));
}));

test('rotation: re-running changes nothing and takes no new backup', quiet(async () => {
  const { db } = seed();
  await run(db, { apply: true });
  const snapshot = JSON.stringify(allValues(db));
  const res = await run(db, { apply: true });
  assert.strictEqual(res.totals.rotated, 0);
  assert.strictEqual(res.totals.pending, 0);
  assert.strictEqual(res.totals.current, 6);
  assert.strictEqual(res.backupFile, null);
  assert.strictEqual(JSON.stringify(allValues(db)), snapshot);
}));

test('rotation: a run that fails half way stays readable and a re-run finishes it', quiet(async () => {
  const { db } = seed();
  const first = await run(db, { apply: true, failAfter: 3 });
  assert.strictEqual(first.aborted, true);
  assert.strictEqual(first.totals.rotated, 3);
  assert.strictEqual(first.totals.failed, 1);
  assert.strictEqual(first.totals.pending, 3);
  assert.ok(first.backupFile, 'backup taken before the first write');

  // Mixed state: every value still decrypts while both keys are configured.
  const mixed = withKeys(NEW_KEY, OLD_KEY, () => encryptedValues(db).map((v) => cryptoHelper.decrypt(v)).sort());
  assert.deepStrictEqual(mixed, PLAINTEXTS.slice().sort());
  const onNewKey = withKeys(NEW_KEY, OLD_KEY, () => encryptedValues(db).filter((v) => cryptoHelper.inspect(v) === 'current'));
  assert.strictEqual(onNewKey.length, 3);

  const second = await run(db, { apply: true });
  assert.strictEqual(second.aborted, false);
  assert.strictEqual(second.totals.rotated, 3, 'only the remainder is rotated');
  assert.strictEqual(second.totals.current, 3, 'finished values were skipped');
  assert.deepStrictEqual(decryptAllWithNewKeyOnly(db), PLAINTEXTS.slice().sort());
}));

test('rotation: values nothing can read are counted and left untouched', quiet(async () => {
  const { db } = seed();
  const stranger = legacyEncrypt('tok-other', 'some-third-key-nobody-has-0000000');
  db.collection('clients').insert({ wa_access_token_enc: stranger });
  const res = await run(db, { apply: true });
  assert.strictEqual(res.totals.locked, 1);
  assert.strictEqual(res.totals.rotated, 6);
  assert.ok(db.rowsOf('clients').some((d) => d.wa_access_token_enc === stranger));
}));

test('rotation: a value the app rewrote after the scan is not overwritten', quiet(async () => {
  const { db } = seed();
  const real = db.collection('reply_webhooks');
  let touched = false;
  const racing = { collection: (name) => (name !== 'reply_webhooks' ? db.collection(name) : {
    ...real,
    find: (...a) => real.find(...a),
    async updateOne(filter, update) {
      if (!touched) { touched = true; real.rows[0].secret_enc = withKeys(NEW_KEY, OLD_KEY, () => cryptoHelper.encrypt('app-wrote-this')); }
      return real.updateOne(filter, update);
    },
  }) };
  const res = await run(racing, { apply: true });
  assert.strictEqual(res.totals.skippedChanged, 1);
  withKeys(NEW_KEY, OLD_KEY, () => assert.strictEqual(cryptoHelper.decrypt(real.rows[0].secret_enc), 'app-wrote-this'));
}));

test('rotation: refuses to write without a backup directory', quiet(async () => {
  const { db } = seed();
  await assert.rejects(() => run(db, { apply: true, backupDir: undefined }), /backup directory/);
  withKeys(OLD_KEY, null, () => assert.strictEqual(encryptedValues(db).filter((v) => v.startsWith('v2:')).length, 3));
}));

test('erasure: a contact erased under the previous key is still recognised after rotation', () => {
  const { phoneHash } = require('../services/erasure');
  const erasedHash = withKeys(OLD_KEY, null, () => phoneHash(7, '+91 98765 43210'));
  const candidates = withKeys(NEW_KEY, OLD_KEY, () => {
    const mod = require('../services/erasure');
    return { current: mod.phoneHash(7, '+91 98765 43210'), previous: mod.phoneHash(7, '+91 98765 43210', OLD_KEY) };
  });
  assert.notStrictEqual(candidates.current, erasedHash, 'hash changes with the key');
  assert.strictEqual(candidates.previous, erasedHash, 'previous-key hash matches the stored one');
});
