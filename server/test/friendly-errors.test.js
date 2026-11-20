/**
 * Plain-language error answers (services/errorResponse.js): customers never
 * get a developer error; 500s carry a reference id that is in the log.
 */
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const request = require('supertest');
const {
  GENERIC_SERVER_ERROR, friendlyErrorGuard, finalErrorHandler, looksTechnical, metaCodeOf,
} = require('../services/errorResponse');

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const kind = req.get('x-test-identity');
    if (kind) req.identity = { kind };
    next();
  });
  app.use(friendlyErrorGuard);
  app.get('/raw500', (req, res) => res.status(500).json({ error: 'E11000 duplicate key error collection: leads', code: 'LEAD_SAVE_FAILED', stack: 'at x (/srv/a.js:1:1)' }));
  app.get('/plain502', (req, res) => res.status(502).json({ error: 'The code could not be emailed. Try again in a minute.' }));
  app.get('/meta502', (req, res) => res.status(502).json({ error: '(#131047) Re-engagement message', code: 'WHATSAPP_SEND_FAILED' }));
  app.get('/env503', (req, res) => res.status(503).json({ error: 'META_APP_ID is not set on the server' }));
  app.get('/message500', (req, res) => res.status(500).json({ success: false, message: "Cannot read properties of undefined (reading 'id')" }));
  app.get('/plain400', (req, res) => res.status(400).json({ error: 'Enter a campaign name.', code: 'NAME_REQUIRED' }));
  app.get('/raw400', (req, res) => res.status(400).json({ error: 'Cast to ObjectId failed for value "abc" (type string) at path "_id"' }));
  app.get('/raw409', (req, res) => res.status(409).json({ error: 'E11000 duplicate key error', code: 'DUPLICATE' }));
  app.get('/ok', (req, res) => res.json({ error: null, ok: true, note: 'TypeError is fine in a 200' }));
  app.get('/throw', () => { throw new Error('db exploded at /srv/secret/path'); });
  app.get('/throw-status', () => { const e = new Error('Not yours'); e.status = 403; e.code = 'NOPE'; throw e; });
  app.use(finalErrorHandler);
  return app;
}

function captureConsole(fn) {
  const lines = [];
  const { error, warn } = console;
  console.error = (...a) => lines.push(a.join(' '));
  console.warn = (...a) => lines.push(a.join(' '));
  return Promise.resolve().then(fn).then((v) => ({ v, lines }), (e) => { throw e; })
    .finally(() => { console.error = error; console.warn = warn; });
}

test('friendly error responses', async (t) => {
  const app = makeApp();

  await t.test('a 500 sends a generic sentence and a reference id that is in the log; code and status kept', async () => {
    const { v: res, lines } = await captureConsole(() => request(app).get('/raw500'));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR);
    assert.strictEqual(res.body.code, 'LEAD_SAVE_FAILED');
    assert.match(res.body.ref, /^[0-9a-f]{8}$/);
    assert.strictEqual(res.body.stack, undefined);
    assert.ok(!JSON.stringify(res.body).includes('E11000'));
    assert.ok(lines.some((l) => l.includes(`[Error ref ${res.body.ref}]`) && l.includes('E11000')));
  });

  await t.test('a curated 5xx sentence is kept; a technical one is replaced and keeps the Meta number', async () => {
    const plain = await request(app).get('/plain502');
    assert.strictEqual(plain.status, 502);
    assert.strictEqual(plain.body.error, 'The code could not be emailed. Try again in a minute.');
    assert.strictEqual(plain.body.ref, undefined);

    const { v: meta } = await captureConsole(() => request(app).get('/meta502'));
    assert.strictEqual(meta.status, 502);
    assert.strictEqual(meta.body.error, GENERIC_SERVER_ERROR);
    assert.strictEqual(meta.body.code, 'WHATSAPP_SEND_FAILED');
    assert.strictEqual(meta.body.meta_code, 131047);

    const { v: env } = await captureConsole(() => request(app).get('/env503'));
    assert.strictEqual(env.status, 503);
    assert.strictEqual(env.body.error, GENERIC_SERVER_ERROR);
  });

  await t.test('a 500 that uses `message` instead of `error` is cleaned too', async () => {
    const { v: res } = await captureConsole(() => request(app).get('/message500'));
    assert.strictEqual(res.body.message, GENERIC_SERVER_ERROR);
    assert.strictEqual(res.body.success, false);
  });

  await t.test('4xx: plain sentences pass through; raw developer text becomes a sentence for the status', async () => {
    const plain = await request(app).get('/plain400');
    assert.deepStrictEqual(plain.body, { error: 'Enter a campaign name.', code: 'NAME_REQUIRED' });
    const { v: cast } = await captureConsole(() => request(app).get('/raw400'));
    assert.strictEqual(cast.status, 400);
    assert.match(cast.body.error, /check the details/);
    const { v: dup } = await captureConsole(() => request(app).get('/raw409'));
    assert.strictEqual(dup.status, 409);
    assert.strictEqual(dup.body.code, 'DUPLICATE');
    assert.ok(!dup.body.error.includes('E11000'));
  });

  await t.test('successful answers are never touched', async () => {
    const res = await request(app).get('/ok');
    assert.deepStrictEqual(res.body, { error: null, ok: true, note: 'TypeError is fine in a 200' });
  });

  await t.test('platform staff keep the real text plus detail; service calls keep the real text', async () => {
    const { v: staff } = await captureConsole(() => request(app).get('/raw500').set('x-test-identity', 'staff'));
    assert.strictEqual(staff.status, 500);
    assert.match(staff.body.error, /E11000/);
    assert.match(staff.body.detail, /E11000/);
    assert.ok(staff.body.ref);
    const { v: svc } = await captureConsole(() => request(app).get('/raw400').set('x-test-identity', 'service'));
    assert.match(svc.body.error, /Cast to ObjectId/);
    const { v: tenant } = await captureConsole(() => request(app).get('/raw500').set('x-test-identity', 'tenant'));
    assert.strictEqual(tenant.body.error, GENERIC_SERVER_ERROR);
    assert.strictEqual(tenant.body.detail, undefined);
  });

  await t.test('an uncaught error: generic sentence, reference id logged once with the stack', async () => {
    const { v: res, lines } = await captureConsole(() => request(app).get('/throw'));
    assert.strictEqual(res.status, 500);
    assert.strictEqual(res.body.error, GENERIC_SERVER_ERROR);
    assert.ok(!JSON.stringify(res.body).includes('exploded'));
    const logged = lines.filter((l) => l.includes(`[Error ref ${res.body.ref}]`));
    assert.strictEqual(logged.length, 1);
    assert.match(logged[0], /exploded/);
  });

  await t.test('an uncaught 4xx keeps its status, sentence and code', async () => {
    const res = await request(app).get('/throw-status');
    assert.strictEqual(res.status, 403);
    assert.deepStrictEqual(res.body, { error: 'Not yours', code: 'NOPE' });
  });

  await t.test('a broken JSON body gets a plain sentence, not the parser message', async () => {
    const res = await request(app).post('/ok').set('Content-Type', 'application/json').send('{"a":');
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'The request could not be read. Please try again.');
  });

  await t.test('helpers', () => {
    assert.strictEqual(looksTechnical('Connect your Google Calendar first.'), false);
    assert.strictEqual(looksTechnical("Cannot read properties of undefined (reading 'x')"), true);
    assert.strictEqual(looksTechnical({ message: 'x' }), true);
    assert.strictEqual(metaCodeOf('Message failed (Meta error 131026)'), 131026);
    assert.strictEqual(metaCodeOf('nothing'), null);
  });
});
