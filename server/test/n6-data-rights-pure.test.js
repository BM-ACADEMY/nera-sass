/**
 * N6 pure-logic checks (no database): CSV safety, webhook signing, address
 * policy, retry schedule, and that the erasure hash is keyed per tenant.
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

process.env.TOKEN_ENCRYPTION_KEY = process.env.TOKEN_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const { csvCell, csvLine } = require('../services/csvExport');
const hook = require('../services/replyWebhook');
const erasure = require('../services/erasure');

test('CSV: quotes, line breaks and formula cells are neutralised', () => {
  assert.strictEqual(csvCell('say "hi"\nplease'), '"say ""hi""\nplease"');
  for (const bad of ['=HYPERLINK("http://x")', '+91 98765', '-1+1', '@SUM(A1)', '\tcmd', '\rcmd']) {
    assert.ok(csvCell(bad).startsWith('"\''), `${JSON.stringify(bad)} must start with an apostrophe`);
  }
  assert.strictEqual(csvCell(null), '""');
  assert.strictEqual(csvCell(42), '"42"', 'numbers are not touched');
  assert.strictEqual(csvCell(new Date('2026-01-02T03:04:05Z')), '"2026-01-02T03:04:05.000Z"');
  assert.strictEqual(csvLine(['a', 'b']), '"a","b"\r\n');
});

test('Webhook signature: HMAC-SHA256 over "timestamp.body", constant-time verify', () => {
  const secret = hook.generateSecret();
  assert.match(secret, /^whsec_[0-9a-f]{64}$/);
  const body = JSON.stringify({ id: 'e1', type: 'message.received' });
  const sig = hook.sign(secret, 1700000000, body);
  const expected = `v1=${crypto.createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex')}`;
  assert.strictEqual(sig, expected);
  assert.ok(hook.verifySignature(secret, 1700000000, body, sig));
  assert.ok(!hook.verifySignature(secret, 1700000001, body, sig), 'a different timestamp must fail');
  assert.ok(!hook.verifySignature(secret, 1700000000, `${body} `, sig), 'a changed body must fail');
  assert.ok(!hook.verifySignature(hook.generateSecret(), 1700000000, body, sig), 'another secret must fail');
  assert.ok(!hook.verifySignature(secret, 1700000000, body, ''));
  assert.notStrictEqual(hook.generateSecret(), hook.generateSecret(), 'secrets are random per workspace');
});

test('Webhook URL policy: https and public addresses only', () => {
  assert.doesNotThrow(() => hook.validateUrl('https://hooks.example.com/nera?x=1'));
  for (const bad of [
    'http://hooks.example.com/x', 'ftp://hooks.example.com', 'not a url', '', 'https://localhost/x', 'https://app.localhost/x',
    'https://127.0.0.1/x', 'https://10.1.2.3/x', 'https://192.168.0.5/x', 'https://172.16.0.1/x', 'https://169.254.169.254/latest/meta-data',
    'https://[::1]/x', 'https://[fd00::1]/x', 'https://[::ffff:127.0.0.1]/x', 'https://intranet/x', 'https://db.internal/x',
    'https://user:pass@hooks.example.com/x',
  ]) {
    assert.throws(() => hook.validateUrl(bad), (error) => error.status === 400 && error.code === 'INVALID_WEBHOOK_URL', bad);
  }
  assert.ok(hook.isPrivateAddress('100.64.0.1'));
  assert.ok(!hook.isPrivateAddress('8.8.8.8'));
  assert.ok(!hook.isPrivateAddress('2606:4700:4700::1111'));
});

test('Webhook retries: growing delays, six attempts in all', () => {
  assert.strictEqual(hook.MAX_ATTEMPTS, 6);
  const delays = [1, 2, 3, 4, 5].map(hook.retryDelayMs);
  assert.deepStrictEqual(delays, [60000, 300000, 1800000, 7200000, 21600000]);
  assert.ok(delays.every((d, i) => i === 0 || d > delays[i - 1]));
});

test('Erasure hash: keyed, per tenant, stable across number formats, holds no number', () => {
  const a = erasure.phoneHash(1, '+91 98765 43210');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.strictEqual(a, erasure.phoneHash(1, '919876543210'));
  assert.strictEqual(a, erasure.phoneHash(1, '9876543210'));
  assert.notStrictEqual(a, erasure.phoneHash(2, '9876543210'), 'another workspace gets another hash');
  assert.notStrictEqual(a, erasure.phoneHash(1, '9876543211'));
  assert.ok(!a.includes('9876543210'));
  assert.strictEqual(erasure.phoneHash(1, ''), null);
  assert.strictEqual(erasure.phoneHash(1, 'abc'), null);
});
