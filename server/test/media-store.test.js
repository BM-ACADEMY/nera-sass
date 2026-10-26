const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startTestDb, stopTestDb, clearCollections } = require('./setup');

const SIGNING = 'media-test-signing-secret-32-chars-long!';
const INTERNAL = 'media-test-internal-key-32-chars-long!!';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-media-api-'));
let mediaServer;

test.before(async () => {
  await startTestDb();
  // The real media server, in-process, on a temp folder.
  const { createApp } = require('../../mediaserver/src/app');
  const { createLocalStorage } = require('../../mediaserver/src/storage/local');
  const app = createApp({ root, masterKey: crypto.randomBytes(32), signingSecret: SIGNING, internalKey: INTERNAL, maxBytes: 5 * 1024 * 1024, allowedOrigins: [] }, createLocalStorage(root));
  mediaServer = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => mediaServer.once('listening', resolve));
  const base = `http://127.0.0.1:${mediaServer.address().port}`;
  Object.assign(process.env, { MEDIA_SERVER_URL: base, MEDIA_PUBLIC_URL: base, MEDIA_SIGNING_SECRET: SIGNING, MEDIA_INTERNAL_KEY: INTERNAL });
});

test.after(async () => {
  for (const key of ['MEDIA_SERVER_URL', 'MEDIA_PUBLIC_URL', 'MEDIA_SIGNING_SECRET', 'MEDIA_INTERNAL_KEY']) delete process.env[key];
  mediaServer?.close();
  fs.rmSync(root, { recursive: true, force: true });
  await stopTestDb();
});

test.beforeEach(clearCollections);

test('media store: tenant files, signed links and ownership', async (t) => {
  const mediaStore = require('../services/mediaStore');
  const { runAsTenant } = require('../services/tenantContext');

  await t.test('stores in the tenant scope and signs links the media server accepts', async () => {
    const data = Buffer.from('tenant 1 photo bytes');
    const saved = await runAsTenant(1, () => mediaStore.save({ data, mime: 'image/jpeg', name: 'shop front.jpg' }));
    assert.match(saved.ref, /^media:\/\/t_1\/\d{6}-[0-9a-f]{32}\/shop%20front\.jpg$/);

    const url = mediaStore.presentUrl(saved.ref);
    assert.ok(url.startsWith(`${process.env.MEDIA_PUBLIC_URL}/f/t_1/`));
    const res = await fetch(url);
    assert.strictEqual(res.status, 200);
    assert.ok(Buffer.from(await res.arrayBuffer()).equals(data));

    const back = await runAsTenant(1, () => mediaStore.read(saved.ref));
    assert.ok(back.equals(data));
  });

  await t.test('a link or reference from another workspace is refused', async () => {
    const saved = await runAsTenant(1, () => mediaStore.save({ data: Buffer.from('private'), mime: 'application/pdf', name: 'a.pdf' }));
    const link = mediaStore.signedUrl(saved.ref);

    const own = await runAsTenant(1, () => mediaStore.resolveOwned(link));
    assert.strictEqual(own.ref, saved.ref);
    assert.strictEqual(own.mime, 'application/pdf');

    await assert.rejects(runAsTenant(2, () => mediaStore.resolveOwned(link)), (err) => err.status === 403);
    await assert.rejects(runAsTenant(2, () => mediaStore.resolveOwned(saved.ref)), (err) => err.status === 403);
    // Pretending tenant 2 owns tenant 1's file id under its own scope fails too.
    const forged = saved.ref.replace('t_1', 't_2');
    await assert.rejects(runAsTenant(2, () => mediaStore.resolveOwned(forged)), (err) => err.status === 403);
  });

  await t.test('non-media values pass through untouched', async () => {
    assert.strictEqual(mediaStore.presentUrl('/uploads/media/file-1.jpg'), '/uploads/media/file-1.jpg');
    assert.strictEqual(mediaStore.presentUrl('https://graph.facebook.com/v18.0/123'), 'https://graph.facebook.com/v18.0/123');
    assert.strictEqual(mediaStore.presentUrl(null), null);
    assert.strictEqual(await runAsTenant(1, () => mediaStore.resolveOwned('/uploads/media/file-1.jpg')), null);
  });

  await t.test('remove deletes the encrypted file and its row', async () => {
    const { MediaFiles } = require('../models');
    const saved = await runAsTenant(1, () => mediaStore.save({ data: Buffer.from('to delete'), mime: 'text/plain', name: 'x.txt' }));
    const link = mediaStore.signedUrl(saved.ref);
    assert.strictEqual((await fetch(link)).status, 200);
    assert.strictEqual(await runAsTenant(1, () => mediaStore.remove(saved.ref)), true);
    assert.strictEqual((await fetch(link)).status, 404);
    assert.strictEqual(await runAsTenant(1, () => MediaFiles.countDocuments({ file_id: saved.id })), 0);
  });

  await t.test('expiry is rounded so repeated links are identical', () => {
    const ref = `media://t_1/202610-${'a'.repeat(32)}`;
    assert.strictEqual(mediaStore.signedUrl(ref), mediaStore.signedUrl(ref));
  });
});
