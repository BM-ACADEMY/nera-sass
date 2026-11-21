/**
 * Customer WhatsApp Chat files: POST /api/messages/upload stores the file on
 * the media server in the workspace's own scope with the same Meta rules as
 * the admin inbox, and POST /api/whatsapp/send only sends a workspace's own
 * file, within Meta's type and size limits. The media server runs in-process
 * on a temp folder; Meta is stubbed (no real call).
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startTestDb, stopTestDb, clearCollections, makeToken } = require('./setup');

const SIGNING = 'chat-media-signing-secret-32-chars-long!';
const INTERNAL = 'chat-media-internal-key-32-chars-long!!';
const MB = 1024 * 1024;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-chat-media-'));
let app;
let mediaServer;
const metaCalls = [];
const metaUploads = [];
const realPost = axios.post;
const realFetch = global.fetch;

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  await startTestDb();
  const { createApp } = require('../../mediaserver/src/app');
  const { createLocalStorage } = require('../../mediaserver/src/storage/local');
  const media = createApp({ root, masterKey: crypto.randomBytes(32), signingSecret: SIGNING, internalKey: INTERNAL, maxBytes: 20 * MB, allowedOrigins: [] }, createLocalStorage(root));
  mediaServer = media.listen(0, '127.0.0.1');
  await new Promise((resolve) => mediaServer.once('listening', resolve));
  const base = `http://127.0.0.1:${mediaServer.address().port}`;
  Object.assign(process.env, { MEDIA_SERVER_URL: base, MEDIA_PUBLIC_URL: base, MEDIA_SIGNING_SECRET: SIGNING, MEDIA_INTERNAL_KEY: INTERNAL });
  ({ app } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: `wamid.${metaCalls.length}` }] } };
  };
  // Meta's media upload goes through fetch; everything else (the media server) is real.
  global.fetch = async (url, options) => {
    if (/^https:\/\/graph\.facebook\.com\//.test(String(url))) {
      const file = options?.body?.get?.('file');
      metaUploads.push({ url: String(url), type: file?.type, size: file?.size });
      return new Response(JSON.stringify({ id: `META_MEDIA_${metaUploads.length}` }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return realFetch(url, options);
  };
});

test.after(async () => {
  axios.post = realPost;
  global.fetch = realFetch;
  for (const key of ['MEDIA_SERVER_URL', 'MEDIA_PUBLIC_URL', 'MEDIA_SIGNING_SECRET', 'MEDIA_INTERNAL_KEY']) delete process.env[key];
  mediaServer?.close();
  fs.rmSync(root, { recursive: true, force: true });
  await stopTestDb();
});

test.beforeEach(async () => {
  metaCalls.length = 0;
  metaUploads.length = 0;
  await clearCollections();
});

test('Customer chat files: upload and send', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages, MediaFiles } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');

  // One workspace with a brand and a customer who wrote a minute ago (window open).
  async function workspace(tenantId) {
    await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${tenantId}`, status: 'active' }), 'test');
    const owner = (await runAsSystem(() => Users.create({
      tenant_id: tenantId, role: 'owner', email: `owner${tenantId}@shop.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }), 'test')).toObject();
    return runAsTenant(tenantId, async () => {
      const brand = await Clients.create({ name: `Brand ${tenantId}`, phone_number_id: `PN${tenantId}`, whatsapp_status: 'verified', ...encryptToken('test-dummy-token') });
      const lead = await Leads.create({ name: 'Ravi', phone: `91987654321${tenantId}`, client_id: brand.id, status: 'new' });
      const conversation = await Conversations.create({ lead_id: lead.id, phone: `987654321${tenantId}`, status: 'open' });
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: new Date(Date.now() - 60000) });
      return { lead, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
    });
  }
  const upload = (headers, data, name) => request(app).post('/api/messages/upload').set(headers).attach('file', data, name);

  await t.test('C1. A photo is stored on the media server in the workspace scope and goes as an image', async () => {
    const a = await workspace(1);
    const res = await upload(a.headers, Buffer.from('fake png bytes'), 'shop.png');
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.match(res.body.mediaRef, /^media:\/\/t_1\/\d{6}-[0-9a-f]{32}\/shop\.png$/);
    assert.strictEqual(res.body.kind, 'image');
    assert.strictEqual(res.body.mimeType, 'image/png');
    assert.ok(res.body.fileUrl.startsWith(`${process.env.MEDIA_PUBLIC_URL}/f/t_1/`), 'a signed media-server link, not /uploads');
    assert.strictEqual(await runAsSystem(() => MediaFiles.countDocuments({ scope: 't_1' }), 'test'), 1);
    assert.strictEqual(await runAsSystem(() => MediaFiles.countDocuments({ scope: { $ne: 't_1' } }), 'test'), 0);
  });

  await t.test('C2. Meta limits as in the admin inbox: a photo over 5 MB or a .webp goes as a document', async () => {
    const a = await workspace(1);
    const big = await upload(a.headers, Buffer.alloc(5 * MB + 10, 1), 'big.jpg');
    assert.strictEqual(big.status, 200, JSON.stringify(big.body));
    assert.strictEqual(big.body.kind, 'document');
    const webp = await upload(a.headers, Buffer.from('webp'), 'sticker.webp');
    assert.strictEqual(webp.body.kind, 'document');
    const voice = await upload(a.headers, Buffer.from('OggS voice'), 'voice-1.ogg');
    assert.strictEqual(voice.body.kind, 'audio');
    assert.match(voice.body.mimeType, /^audio\/ogg; codecs=opus$/);
    const pdf = await upload(a.headers, Buffer.from('%PDF-1.4'), 'price list.pdf');
    assert.strictEqual(pdf.body.kind, 'document');
  });

  await t.test('C3. File types WhatsApp does not take are refused, with no stack trace', async () => {
    const a = await workspace(1);
    for (const name of ['run.exe', 'x.php', 'page.html', 'noext']) {
      const res = await upload(a.headers, Buffer.from('data'), name);
      assert.strictEqual(res.status, 400, `${name}: ${res.status}`);
      assert.ok(!/\bat \w+ \(/.test(JSON.stringify(res.body)), 'no stack trace');
    }
    assert.strictEqual(await runAsSystem(() => MediaFiles.countDocuments({}), 'test'), 0);
    const anonymous = await request(app).post('/api/messages/upload').attach('file', Buffer.from('x'), 'x.png');
    assert.strictEqual(anonymous.status, 401);
  });

  await t.test('C4. Another workspace cannot send this workspace\'s file (reference or signed link)', async () => {
    const a = await workspace(1);
    const b = await workspace(2);
    const res = await upload(a.headers, Buffer.from('private photo'), 'private.png');
    for (const mediaUrl of [res.body.mediaRef, res.body.fileUrl, res.body.mediaRef.replace('t_1', 't_2')]) {
      const send = await request(app).post('/api/whatsapp/send').set(b.headers).send({ lead_id: b.lead.id, message: '', media_url: mediaUrl, msg_type: 'image' });
      assert.strictEqual(send.status, 403, JSON.stringify(send.body));
    }
    assert.strictEqual(metaCalls.length + metaUploads.length, 0, 'nothing reached Meta');
  });

  await t.test('C5. The owner sends it: uploaded to Meta by id, stored with the media reference', async () => {
    const a = await workspace(1);
    const res = await upload(a.headers, Buffer.from('my photo'), 'photo.png');
    const send = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: a.lead.id, message: 'New stock', media_url: res.body.fileUrl, msg_type: res.body.kind });
    assert.strictEqual(send.status, 200, JSON.stringify(send.body));
    assert.strictEqual(metaUploads.length, 1);
    assert.strictEqual(metaUploads[0].type, 'image/png');
    assert.deepStrictEqual(metaCalls[0].body.image, { id: 'META_MEDIA_1', caption: 'New stock' });
    const saved = await runAsTenant(1, () => Messages.findOne({ direction: 'outbound' }).lean());
    assert.strictEqual(saved.media_url, res.body.mediaRef);
    assert.strictEqual(saved.msg_type, 'image');
  });

  await t.test('C6. A file is never sent as a kind Meta would refuse (too big or wrong type for an image)', async () => {
    const a = await workspace(1);
    const big = await upload(a.headers, Buffer.alloc(5 * MB + 10, 1), 'big.jpg');
    const asImage = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: a.lead.id, message: '', media_url: big.body.mediaRef, msg_type: 'image' });
    assert.strictEqual(asImage.status, 400, JSON.stringify(asImage.body));
    assert.strictEqual(asImage.body.code, 'MEDIA_TYPE_INVALID');
    const pdf = await upload(a.headers, Buffer.from('%PDF-1.4'), 'list.pdf');
    const pdfAsAudio = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: a.lead.id, message: '', media_url: pdf.body.mediaRef, msg_type: 'audio' });
    assert.strictEqual(pdfAsAudio.status, 400);
    assert.strictEqual(metaCalls.length + metaUploads.length, 0);

    const asDocument = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: a.lead.id, message: '', media_url: big.body.mediaRef, msg_type: big.body.kind });
    assert.strictEqual(asDocument.status, 200, JSON.stringify(asDocument.body));
    assert.strictEqual(metaCalls[0].body.type, 'document');
  });

  await t.test('C7. A recorded voice note (ogg/opus) is sent as audio with the codec Meta needs', async () => {
    const a = await workspace(1);
    const voice = await upload(a.headers, Buffer.from('OggS voice note'), 'voice-123.ogg');
    const send = await request(app).post('/api/whatsapp/send').set(a.headers).send({ lead_id: a.lead.id, message: '', media_url: voice.body.mediaRef, msg_type: voice.body.kind });
    assert.strictEqual(send.status, 200, JSON.stringify(send.body));
    assert.strictEqual(metaUploads[0].type, 'audio/ogg; codecs=opus');
    assert.deepStrictEqual(metaCalls[0].body.audio, { id: 'META_MEDIA_1' });
  });
});

test('Shared Meta media rules (admin and customer inbox)', () => {
  const { mediaKind, fitsKind } = require('../services/waMedia');
  assert.strictEqual(require('../services/platformInbox').mediaKind, mediaKind, 'the admin inbox uses the same rules');
  assert.strictEqual(mediaKind('image/png', 1000), 'image');
  assert.strictEqual(mediaKind('image/webp', 1000), 'document');
  assert.strictEqual(fitsKind('image', 'image/jpeg', 5 * MB), true);
  assert.strictEqual(fitsKind('image', 'image/jpeg', 5 * MB + 1), false);
  assert.strictEqual(fitsKind('video', 'video/mp4', 16 * MB + 1), false);
  assert.strictEqual(fitsKind('audio', 'audio/ogg; codecs=opus', 1000), true);
  assert.strictEqual(fitsKind('document', 'application/zip', 100 * MB), true);
  assert.strictEqual(fitsKind('document', 'application/pdf', 100 * MB + 1), false);
  assert.strictEqual(fitsKind('image', 'image/png', 0), false);
});
