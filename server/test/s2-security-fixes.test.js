/**
 * Slice S2: four security fixes.
 *  1. Manual send reads media_url only from the calling workspace's own upload folder.
 *  2. /api/webhooks/meta is retired (410, nothing from the payload logged).
 *  3. /webhook/razorpay fails closed, verifies the signature in constant time,
 *     is idempotent on the event id and runs inside the lead's tenant.
 *  4. No placeholder AI key; no message text / phone / transcript in logs.
 * In-memory MongoDB, synthetic data, Meta stubbed; no real call is made.
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

const SECRET = 'test-dummy-razorpay-secret';
const UPLOADS = fs.mkdtempSync(path.join(os.tmpdir(), 'nera-s2-uploads-'));
const SERVER_ROOT = path.join(__dirname, '..');

let app;
let metaCalls = [];
const realPost = axios.post;
const realFetch = global.fetch;
let fetchCalls = [];

const logged = [];
const realLog = { log: console.log, warn: console.warn, error: console.error };

test.before(async () => {
  process.env.NERA_NO_AUTOSTART = 'true';
  process.env.JOBS_ENABLED = 'false';
  process.env.AUTH_RATE_LIMIT = 'off';
  process.env.EMAIL_DELIVERY = 'memory';
  process.env.MFA_ENFORCED = 'false';
  process.env.UPLOADS_DIR = UPLOADS;
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  delete process.env.N8N_PAYMENT_SUCCESS_WEBHOOK_URL;
  await startTestDb();
  ({ app } = require('../server'));
  axios.post = async (url, body) => {
    if (!/^https:\/\/graph\.facebook\.com\//.test(url)) throw new Error(`Unexpected URL in test: ${url}`);
    metaCalls.push({ url, body });
    return { data: { messages: [{ id: 'wamid.TEST' }] } };
  };
  global.fetch = async (url) => {
    fetchCalls.push(String(url));
    return { ok: true, json: async () => ({ id: 'WA_MEDIA_1' }) };
  };
  for (const level of ['log', 'warn', 'error']) console[level] = (...args) => { logged.push(args.map(String).join(' ')); };
});

test.after(async () => {
  Object.assign(console, realLog);
  axios.post = realPost;
  global.fetch = realFetch;
  await stopTestDb();
  fs.rmSync(UPLOADS, { recursive: true, force: true });
});

test.beforeEach(async () => {
  metaCalls = [];
  fetchCalls = [];
  logged.length = 0;
  process.env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  await clearCollections();
});

const sign = (raw, secret = SECRET) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
const postRazorpay = (raw, headers = {}) => {
  let req = request(app).post('/webhook/razorpay').set('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) req = req.set(k, v);
  return req.send(raw);
};

test('S2-1. Manual send: media_url is confined to the tenant upload folder', async (t) => {
  const { Users, Tenants, Clients, Leads, Conversations, Messages } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');
  const { encryptToken } = require('../services/clientSecrets');
  const tenantUploads = require('../services/tenantUploads');

  async function seed(tenantId, label) {
    if (tenantId === 1) fs.rmSync(path.join(UPLOADS, 'media'), { recursive: true, force: true });
    await runAsSystem(() => Tenants.create({ id: tenantId, name: `Shop ${label}`, status: 'active' }), 'test');
    const owner = (await runAsSystem(() => Users.create({
      tenant_id: tenantId, role: 'owner', email: `owner@${label}.test`, name: 'Owner', password_hash: bcrypt.hashSync('Original-Pass-1', 4), is_active: true, token_version: 0,
    }), 'test')).toObject();
    return runAsTenant(tenantId, async () => {
      const brand = await Clients.create({ name: `Brand ${label}`, phone_number_id: `PN${tenantId}`, whatsapp_status: 'verified', ...encryptToken('test-dummy-token') });
      const lead = await Leads.create({ name: 'Ravi', phone: '919876543210', client_id: brand.id, status: 'new' });
      const conversation = await Conversations.create({ lead_id: lead.id, phone: '9876543210', status: 'open' });
      await Messages.create({ conversation_id: conversation.id, direction: 'inbound', content: 'hi', sent_at: new Date(Date.now() - 60000) });
      return { lead, headers: { Authorization: `Bearer ${makeToken(owner)}` } };
    });
  }
  const put = (tenantId, name, bytes = Buffer.from('PNGDATA')) => {
    const dir = tenantUploads.tenantUploadDir(tenantId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), bytes);
    return `/uploads/media/t_${tenantId}/${name}`;
  };
  const send = (ctx, body) => request(app).post('/api/whatsapp/send').set(ctx.headers).send({ lead_id: ctx.lead.id, ...body });

  await t.test('a file in the tenant\'s own folder is uploaded to Meta', async () => {
    const ctx = await seed(1, 'a');
    const url = put(1, 'photo.png');
    const res = await send(ctx, { msg_type: 'image', media_url: url, message: 'look' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    assert.ok(fetchCalls.some((u) => u.includes('/PN1/media')));
    assert.deepStrictEqual(metaCalls[0].body.image.id, 'WA_MEDIA_1');
  });

  await t.test('attack strings are refused before any read, upload or send', async () => {
    const ctx = await seed(1, 'a');
    put(1, 'photo.png');
    const secret = path.join(UPLOADS, 'secret.png');
    fs.writeFileSync(secret, 'top secret');
    const attacks = [
      '/uploads/media/t_1/../../../.env',
      '/uploads/media/t_1/../secret.png',
      '/uploads/media/t_1/..%2f..%2fsecret.png',
      '/uploads/media/t_1/%2e%2e/secret.png',
      '/uploads/media/t_1/..\\..\\secret.png',
      '/uploads/media/t_1/....//secret.png',
      '/uploads/media/t_1/photo.png%00.jpg',
      '/uploads/media/t_1/photo.png\u0000.jpg',
      '/uploads/media/t_1/photo.png?x=1',
      '/uploads/media/t_1/photo.png#x',
      '/uploads/media//t_1/photo.png',
      '/uploads/media/t_1//photo.png',
      '/uploads/media/t_1/sub/photo.png',
      '/uploads/media/t_2/photo.png',
      '/uploads/media/photo.png',
      '/uploads/secret.png',
      '/etc/passwd',
      '/uploads/media/t_1/photo.png/',
      'uploads/media/t_1/photo.png',
      '../uploads/media/t_1/photo.png',
      `${UPLOADS}/secret.png`,
      'file:///etc/passwd',
      '/uploads/media/t_1/.hidden.png',
      '/uploads/media/t_1/' + 'a'.repeat(400) + '.png',
    ];
    for (const media_url of attacks) {
      const res = await send(ctx, { msg_type: 'image', media_url });
      assert.ok([400, 404].includes(res.status), `${JSON.stringify(media_url)} -> ${res.status} ${JSON.stringify(res.body)}`);
      assert.ok(!/passwd|secret|\.env|t_1|uploads/i.test(JSON.stringify(res.body)), 'no path in the response');
    }
    for (const media_url of [{ a: 1 }, ['x'], 12, true]) {
      const res = await send(ctx, { msg_type: 'image', media_url });
      assert.strictEqual(res.status, 400, JSON.stringify(media_url));
    }
    assert.strictEqual((await send(ctx, { msg_type: 'image' })).status, 400, 'missing media_url');
    assert.strictEqual(fetchCalls.length, 0, 'nothing uploaded to Meta');
    assert.strictEqual(metaCalls.length, 0, 'nothing sent');
  });

  await t.test('another workspace\'s file is refused', async () => {
    const a = await seed(1, 'a');
    await seed(2, 'b');
    const theirs = put(2, 'theirs.png');
    const res = await send(a, { msg_type: 'image', media_url: theirs });
    assert.strictEqual(res.status, 400);
    assert.strictEqual(fetchCalls.length + metaCalls.length, 0);
  });

  await t.test('symlinks are refused, to a file outside and to a file inside the folder', async () => {
    const ctx = await seed(1, 'a');
    const dir = tenantUploads.tenantUploadDir(1);
    fs.mkdirSync(dir, { recursive: true });
    const outside = path.join(UPLOADS, 'outside.png');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(dir, 'link-out.png'));
    put(1, 'real.png');
    fs.symlinkSync(path.join(dir, 'real.png'), path.join(dir, 'link-in.png'));
    for (const name of ['link-out.png', 'link-in.png']) {
      const res = await send(ctx, { msg_type: 'image', media_url: `/uploads/media/t_1/${name}` });
      assert.strictEqual(res.status, 400, name);
    }
    // A workspace folder that is itself a link to another tenant's folder.
    await seed(2, 'b');
    put(2, 'theirs.png');
    fs.rmSync(dir, { recursive: true });
    fs.symlinkSync(tenantUploads.tenantUploadDir(2), dir);
    assert.strictEqual((await send(ctx, { msg_type: 'image', media_url: '/uploads/media/t_1/theirs.png' })).status, 400);
    assert.strictEqual(fetchCalls.length + metaCalls.length, 0);
  });

  await t.test('unexpected types, mismatched types, empty and oversized files are refused', async () => {
    const ctx = await seed(1, 'a');
    const cases = [
      ['image', put(1, 'shell.php')],
      ['image', put(1, 'script.html')],
      ['image', put(1, 'noext')],
      ['image', put(1, 'doc.pdf')], // pdf is not an image
      ['video', put(1, 'photo2.png')],
      ['image', put(1, 'empty.png', Buffer.alloc(0))],
      ['image', put(1, 'huge.png', Buffer.alloc(5 * 1024 * 1024 + 1))],
    ];
    for (const [msg_type, media_url] of cases) {
      const res = await send(ctx, { msg_type, media_url });
      assert.strictEqual(res.status, 400, media_url);
    }
    const okDoc = await send(ctx, { msg_type: 'document', media_url: put(1, 'ok.pdf', Buffer.from('%PDF')) });
    assert.strictEqual(okDoc.status, 200, JSON.stringify(okDoc.body));
    assert.strictEqual((await send(ctx, { msg_type: 'nonsense', media_url: put(1, 'p.png') })).status, 400);
  });

  await t.test('upload route stores in the tenant folder and rejects odd file types', async () => {
    const ctx = await seed(1, 'a');
    const ok = await request(app).post('/api/messages/upload').set(ctx.headers).attach('file', Buffer.from('PNG'), 'x.png');
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body));
    assert.match(ok.body.fileUrl, /^\/uploads\/media\/t_1\/file-\d+-\d+\.png$/);
    assert.ok(fs.existsSync(path.join(UPLOADS, ok.body.fileUrl.replace('/uploads/', ''))));
    const bad = await request(app).post('/api/messages/upload').set(ctx.headers).attach('file', Buffer.from('<?php'), 'x.php');
    assert.strictEqual(bad.status, 400);
    assert.ok(!/Error:|\bat \w+/.test(JSON.stringify(bad.body)), 'no stack trace');
  });
});

test('S2-2. /api/webhooks/meta is retired: 410 and nothing from the payload is logged', async () => {
  const marker = 'SECRET-CUSTOMER-TEXT-12345';
  const body = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ from: '919000000099', text: { body: marker } }] } }] }] });
  const post = await request(app).post('/api/webhooks/meta').set('Content-Type', 'application/json').send(body);
  assert.strictEqual(post.status, 410);
  assert.strictEqual(post.body.code, 'WEBHOOK_RETIRED');
  const get = await request(app).get('/api/webhooks/meta').query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'x', 'hub.challenge': 'abc' });
  assert.strictEqual(get.status, 410);
  assert.ok(logged.some((l) => /Legacy Meta webhook/.test(l)), 'one log line');
  assert.ok(!logged.join('\n').includes(marker) && !logged.join('\n').includes('919000000099'), 'payload not logged');
});

test('S2-3. Razorpay webhook', async (t) => {
  const { Tenants, Clients, Leads, Payments, ProcessedWebhookEvents } = require('../models');
  const { runAsSystem, runAsTenant } = require('../services/tenantContext');

  async function seed() {
    await runAsSystem(() => Tenants.create([{ id: 1, name: 'One', status: 'active' }, { id: 2, name: 'Two', status: 'active' }]), 'test');
    const lead1 = (await runAsTenant(1, () => Leads.create({ name: 'Meena', phone: '919000000001', status: 'new' }))).toObject();
    const lead2 = (await runAsTenant(2, () => Leads.create({ name: 'Ravi', phone: '919000000002', status: 'new' }))).toObject();
    return { lead1, lead2 };
  }
  const captured = (leadId, paymentId = 'pay_1', notes = {}) => JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: paymentId, amount: 150000, notes: { lead_id: String(leadId), ...notes } } } },
  });
  const countPayments = (tenantId) => runAsTenant(tenantId, () => Payments.countDocuments({}));

  await t.test('with no secret every request is refused (503) and nothing is processed', async () => {
    const { lead1 } = await seed();
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const raw = captured(lead1.id);
    for (const headers of [{}, { 'X-Razorpay-Signature': sign(raw) }, { 'X-Razorpay-Signature': sign(raw, '') }]) {
      const res = await postRazorpay(raw, headers);
      assert.strictEqual(res.status, 503);
      assert.strictEqual(res.body.code, 'WEBHOOK_SECRET_NOT_CONFIGURED');
    }
    process.env.RAZORPAY_WEBHOOK_SECRET = '   ';
    assert.strictEqual((await postRazorpay(raw, { 'X-Razorpay-Signature': sign(raw, '   ') })).status, 503);
    assert.strictEqual(await countPayments(1), 0);
  });

  await t.test('the startup warning is logged when the secret is unset', () => {
    const saved = process.env.RAZORPAY_WEBHOOK_SECRET;
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    const handlers = [];
    const fakeApp = { post: (...a) => handlers.push(a) };
    require('../routes/leados/webhook-razorpay')(fakeApp, {});
    process.env.RAZORPAY_WEBHOOK_SECRET = saved;
    assert.ok(logged.some((l) => /RAZORPAY_WEBHOOK_SECRET is not set/.test(l)));
    assert.ok(!logged.join('\n').includes(SECRET));
  });

  await t.test('missing, malformed, wrong and body-modified signatures are refused (401)', async () => {
    const { lead1 } = await seed();
    const raw = captured(lead1.id);
    assert.strictEqual((await postRazorpay(raw)).status, 401);
    assert.strictEqual((await postRazorpay(raw, { 'X-Razorpay-Signature': 'nothex' })).status, 401);
    assert.strictEqual((await postRazorpay(raw, { 'X-Razorpay-Signature': 'a'.repeat(63) })).status, 401);
    assert.strictEqual((await postRazorpay(raw, { 'X-Razorpay-Signature': sign(raw, 'other') })).status, 401);
    assert.strictEqual((await postRazorpay(captured(lead1.id, 'pay_2'), { 'X-Razorpay-Signature': sign(raw) })).status, 401);
    assert.strictEqual(await countPayments(1), 0);
    assert.strictEqual(await runAsTenant(1, () => Leads.countDocuments({ status: 'converted' })), 0);
  });

  await t.test('a signed event records the payment in the lead\'s tenant and converts the lead', async () => {
    const { lead1, lead2 } = await seed();
    const raw = captured(lead1.id);
    const res = await postRazorpay(raw, { 'X-Razorpay-Signature': sign(raw), 'X-Razorpay-Event-Id': 'evt_1' });
    assert.strictEqual(res.status, 200, JSON.stringify(res.body));
    const rows = await runAsTenant(1, () => Payments.find({}).lean());
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].tenant_id, 1);
    assert.strictEqual(rows[0].amount, 1500);
    assert.strictEqual((await runAsTenant(1, () => Leads.findOne({ id: lead1.id }).lean())).status, 'converted');
    assert.strictEqual(await countPayments(2), 0);
    assert.strictEqual((await runAsTenant(2, () => Leads.findOne({ id: lead2.id }).lean())).status, 'new');
  });

  await t.test('redelivery of the same event id changes nothing', async () => {
    const { lead1 } = await seed();
    const raw = captured(lead1.id);
    const headers = { 'X-Razorpay-Signature': sign(raw), 'X-Razorpay-Event-Id': 'evt_same' };
    assert.strictEqual((await postRazorpay(raw, headers)).status, 200);
    const again = await postRazorpay(raw, headers);
    assert.strictEqual(again.status, 200);
    assert.strictEqual(again.body.status, 'duplicate');
    // A different event id for the same payment still cannot double-record it.
    await postRazorpay(raw, { 'X-Razorpay-Signature': sign(raw), 'X-Razorpay-Event-Id': 'evt_other' });
    assert.strictEqual(await countPayments(1), 1);
    assert.strictEqual(await runAsTenant(1, () => ProcessedWebhookEvents.countDocuments({})), 2);
  });

  await t.test('without an event id header the event + payment id is the idempotency key', async () => {
    const { lead1 } = await seed();
    const raw = captured(lead1.id, 'pay_x');
    const headers = { 'X-Razorpay-Signature': sign(raw) };
    await postRazorpay(raw, headers);
    assert.strictEqual((await postRazorpay(raw, headers)).body.status, 'duplicate');
    assert.strictEqual(await countPayments(1), 1);
  });

  await t.test('a tenant note that disagrees with the lead is ignored; unknown leads are ignored', async () => {
    const { lead1 } = await seed();
    const wrong = captured(lead1.id, 'pay_w', { tenant_id: '2' });
    assert.strictEqual((await postRazorpay(wrong, { 'X-Razorpay-Signature': sign(wrong) })).status, 200);
    const unknown = captured(99999, 'pay_u');
    assert.strictEqual((await postRazorpay(unknown, { 'X-Razorpay-Signature': sign(unknown) })).status, 200);
    assert.strictEqual(await countPayments(1) + await countPayments(2), 0);
    assert.strictEqual(await runAsTenant(1, () => Leads.countDocuments({ status: 'converted' })), 0);
  });

  await t.test('a failed run releases the event id so the retry is processed; no raw error reaches the caller', async () => {
    const { lead1 } = await seed();
    const raw = captured(lead1.id, 'pay_f');
    const headers = { 'X-Razorpay-Signature': sign(raw), 'X-Razorpay-Event-Id': 'evt_fail' };
    const realCreate = Payments.create;
    Payments.create = async () => { throw new Error('db exploded at /srv/secret/path'); };
    let res;
    try { res = await postRazorpay(raw, headers); } finally { Payments.create = realCreate; }
    assert.strictEqual(res.status, 500);
    assert.ok(!JSON.stringify(res.body).includes('exploded'));
    assert.strictEqual((await postRazorpay(raw, headers)).body.status, 'processed');
    assert.strictEqual(await countPayments(1), 1);
  });

  await t.test('ignores other event types and never logs the payload', async () => {
    await seed();
    const raw = JSON.stringify({ event: 'payment.failed', payload: { payment: { entity: { id: 'pay_z', contact: '+919000000077' } } } });
    assert.strictEqual((await postRazorpay(raw, { 'X-Razorpay-Signature': sign(raw) })).status, 200);
    const bad = await postRazorpay(raw, { 'X-Razorpay-Signature': 'f'.repeat(64) });
    assert.strictEqual(bad.status, 401);
    assert.ok(!logged.join('\n').includes('919000000077'));
  });
});

test('S2-4. No placeholder credentials, no payload or message text in logs', async (t) => {
  await t.test('AI client has no dummy key: it fails clearly when the key is unset', () => {
    const saved = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      delete require.cache[require.resolve('../services/groqClient')];
      const groq = require('../services/groqClient');
      assert.throws(() => groq.chat, /OPENAI_API_KEY is not configured/);
    } finally {
      if (saved !== undefined) process.env.OPENAI_API_KEY = saved;
    }
  });

  await t.test('source scan: no fallback credentials and no content logging in the code', () => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', 'test', 'uploads'].includes(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) files.push(full);
      }
    };
    walk(SERVER_ROOT);
    const bad = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      const rel = path.relative(SERVER_ROOT, file);
      if (/dummy_key/.test(src)) bad.push(`${rel}: dummy key`);
      if (/process\.env\.[A-Z0-9_]*(SECRET|TOKEN|PASSWORD|API_KEY)[A-Z0-9_]*\s*(\|\||\?\?)\s*['"`][^'"`]{3,}['"`]/.test(src)) bad.push(`${rel}: credential fallback`);
      if (/(password|passwd)\s*=\s*['"][^'"]{6,}['"]/i.test(src) && !/test/.test(rel)) bad.push(`${rel}: hard-coded password`);
      if (/debug_error\.log/.test(src)) bad.push(`${rel}: writes review text to a log file`);
      if (/console\.\w+\([^)]*JSON\.stringify\(req\.body\)/.test(src)) bad.push(`${rel}: logs request body`);
      if (/Transcription success(ful)?:["'`]?,\s*transcript\b|Transcription success: \$\{transcription/i.test(src)) bad.push(`${rel}: logs transcript`);
    }
    assert.deepStrictEqual(bad, []);
  });

  await t.test('committed fixtures hold no password hashes or push keys', () => {
    const dump = fs.readFileSync(path.join(SERVER_ROOT, '..', 'client', 'src', 'chat', 'chat', 'chatbot.users.json'), 'utf8');
    assert.ok(!/\$2[aby]\$\d\d\$/.test(dump));
    assert.ok(!/"(auth|p256dh)"\s*:\s*"(?!\[removed\])/.test(dump));
  });
});
