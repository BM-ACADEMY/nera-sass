const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createApp, parseRange } = require('../src/app');
const { createLocalStorage } = require('../src/storage/local');
const signing = require('../src/signing');
const { CHUNK } = require('../src/crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-media-'));
const config = {
  root,
  masterKey: crypto.randomBytes(32),
  signingSecret: 'test-signing-secret-at-least-32-characters',
  internalKey: 'test-internal-key-at-least-32-characters!',
  maxBytes: 1024 * 1024,
  allowedOrigins: ['https://app.getnera.in'],
};
let server;
let base;

before(async () => {
  server = createApp(config, createLocalStorage(root)).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const upload = (scope, body, type = 'image/png') => fetch(`${base}/internal/files/${scope}`, {
  method: 'POST',
  headers: { 'x-media-key': config.internalKey, 'content-type': type },
  body,
});

const link = ({ scope, id, name = '', exp = Math.floor(Date.now() / 1000) + 600 }) => {
  const sig = signing.sign(config.signingSecret, { scope, id, name, exp });
  return `${base}/f/${scope}/${id}${name ? `/${encodeURIComponent(name)}` : ''}?exp=${exp}&sig=${sig}`;
};

function storedFiles(dir = root) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === '.tmp') return [];
    return entry.isDirectory() ? storedFiles(full) : [full];
  });
}

test('stores encrypted, in a per-tenant folder, and reads back exactly', async () => {
  const data = crypto.randomBytes(CHUNK * 2 + 123);
  const res = await upload('t_7', data);
  assert.strictEqual(res.status, 201);
  const saved = await res.json();
  assert.match(saved.id, /^\d{6}-[0-9a-f]{32}$/);
  assert.strictEqual(saved.size, data.length);

  const file = storedFiles().find((f) => f.includes(saved.id.split('-')[1]));
  assert.ok(file.includes(`${path.sep}t_7${path.sep}`), 'file must sit in the tenant folder');
  const onDisk = fs.readFileSync(file);
  assert.strictEqual(onDisk.indexOf(data.subarray(0, 64)), -1, 'plaintext must not appear on disk');

  const back = await fetch(link({ scope: 't_7', id: saved.id }));
  assert.strictEqual(back.status, 200);
  assert.strictEqual(back.headers.get('content-type'), 'image/png');
  assert.ok(Buffer.from(await back.arrayBuffer()).equals(data));
});

test('serves byte ranges across chunk borders', async () => {
  const data = crypto.randomBytes(CHUNK * 3);
  const { id } = await (await upload('t_7', data, 'video/mp4')).json();
  const url = link({ scope: 't_7', id });
  for (const [start, end] of [[0, 9], [CHUNK - 5, CHUNK + 5], [CHUNK * 2, CHUNK * 3 - 1]]) {
    const res = await fetch(url, { headers: { range: `bytes=${start}-${end}` } });
    assert.strictEqual(res.status, 206);
    assert.strictEqual(res.headers.get('content-range'), `bytes ${start}-${end}/${data.length}`);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(data.subarray(start, end + 1)));
  }
  assert.strictEqual((await fetch(url, { headers: { range: `bytes=${data.length}-` } })).status, 416);
});

test('rejects expired, tampered and cross-tenant links', async () => {
  const { id } = await (await upload('t_7', Buffer.from('secret invoice'))).json();
  assert.strictEqual((await fetch(link({ scope: 't_7', id, exp: Math.floor(Date.now() / 1000) - 1 }))).status, 403);
  assert.strictEqual((await fetch(link({ scope: 't_7', id }).replace(/sig=./, 'sig=A'))).status, 403);
  assert.strictEqual((await fetch(`${base}/f/t_7/${id}?exp=9999999999`)).status, 403);
  // A valid signature for another tenant's scope finds nothing.
  assert.strictEqual((await fetch(link({ scope: 't_8', id }))).status, 404);
  // The name is part of the signature.
  const named = link({ scope: 't_7', id, name: 'a.pdf' }).replace('/a.pdf', '/b.pdf');
  assert.strictEqual((await fetch(named)).status, 403);
});

test('a file copied into another tenant folder cannot be decrypted', async () => {
  const { id } = await (await upload('t_7', Buffer.from('tenant seven only'))).json();
  const [, yyyymm, hex] = /^(\d{6})-(.+)$/.exec(id);
  const source = path.join(root, 't_7', yyyymm.slice(0, 4), yyyymm.slice(4), `${hex}.nmf`);
  const target = path.join(root, 't_8', yyyymm.slice(0, 4), yyyymm.slice(4), `${hex}.nmf`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  assert.strictEqual((await fetch(link({ scope: 't_8', id }))).status, 404);
});

test('detects tampered ciphertext', async () => {
  const { id } = await (await upload('t_9', crypto.randomBytes(1000))).json();
  const file = storedFiles().find((f) => f.includes(id.split('-')[1]));
  const bytes = fs.readFileSync(file);
  bytes[4096 + 10] ^= 0xff;
  fs.writeFileSync(file, bytes);
  assert.strictEqual((await fetch(link({ scope: 't_9', id }))).status, 500);
});

test('internal routes need the internal key; limits and scopes are enforced', async () => {
  const noKey = await fetch(`${base}/internal/files/t_7`, { method: 'POST', body: 'x' });
  assert.strictEqual(noKey.status, 401);
  assert.strictEqual((await upload('evil_scope', Buffer.from('x'))).status, 400);
  assert.strictEqual((await upload('t_7', crypto.randomBytes(config.maxBytes + 1))).status, 413);

  const { id } = await (await upload('platform', Buffer.from('admin inbox photo'))).json();
  const internal = await fetch(`${base}/internal/files/platform/${id}`, { headers: { 'x-media-key': config.internalKey } });
  assert.strictEqual(await internal.text(), 'admin inbox photo');
  const del = await fetch(`${base}/internal/files/platform/${id}`, { method: 'DELETE', headers: { 'x-media-key': config.internalKey } });
  assert.strictEqual(del.status, 200);
  assert.strictEqual((await fetch(link({ scope: 'platform', id }))).status, 404);
});

test('active content is never rendered inline and empty files work', async () => {
  const { id } = await (await upload('t_7', Buffer.from('<script>alert(1)</script>'), 'text/html')).json();
  const res = await fetch(link({ scope: 't_7', id }));
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.match(res.headers.get('content-security-policy'), /sandbox/);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');

  const empty = await (await upload('t_7', Buffer.alloc(0), 'text/plain')).json();
  const back = await fetch(link({ scope: 't_7', id: empty.id }));
  assert.strictEqual(back.status, 200);
  assert.strictEqual((await back.arrayBuffer()).byteLength, 0);
});

test('CORS only for allowed origins', async () => {
  const { id } = await (await upload('t_7', Buffer.from('x'))).json();
  const ok = await fetch(link({ scope: 't_7', id }), { headers: { origin: 'https://app.getnera.in' } });
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), 'https://app.getnera.in');
  const other = await fetch(link({ scope: 't_7', id }), { headers: { origin: 'https://evil.example' } });
  assert.strictEqual(other.headers.get('access-control-allow-origin'), null);
});

test('parseRange', () => {
  assert.deepStrictEqual(parseRange('bytes=0-4', 10), { start: 0, end: 4 });
  assert.deepStrictEqual(parseRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepStrictEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.strictEqual(parseRange('bytes=8-2', 10), null);
  assert.strictEqual(parseRange('bytes=0-1,3-4', 10), null);
});
