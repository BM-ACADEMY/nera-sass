import test from 'node:test';
import assert from 'node:assert';
import { timeAgo, locationLabel, deviceLabel, deviceKind, sessionsError } from './sessionFormat.js';

test('timeAgo', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  assert.strictEqual(timeAgo('2026-11-20T09:59:30Z', now), 'just now');
  assert.strictEqual(timeAgo('2026-11-20T09:58:00Z', now), '2 min ago');
  assert.strictEqual(timeAgo('2026-11-20T09:00:00Z', now), '1 hour ago');
  assert.strictEqual(timeAgo('2026-11-17T10:00:00Z', now), '3 days ago');
  assert.strictEqual(timeAgo(null, now), 'unknown');
});

test('locationLabel', () => {
  assert.strictEqual(locationLabel({ city: 'Chennai', region: 'TN', country: 'India' }), 'Chennai, TN, India');
  assert.strictEqual(locationLabel({ country: 'India' }), 'India');
  assert.strictEqual(locationLabel({ private: true }), 'Local network');
  assert.strictEqual(locationLabel(null), 'Unknown location');
});

test('device labels', () => {
  assert.strictEqual(deviceLabel({ browser: 'Chrome 131', os: 'Windows' }), 'Chrome 131 on Windows');
  assert.strictEqual(deviceLabel({}), 'Unknown browser');
  assert.strictEqual(deviceKind({ device_type: 'mobile' }), 'mobile');
  assert.strictEqual(deviceKind({ device_type: 'toaster' }), 'unknown');
});

test('sessionsError', () => {
  assert.match(sessionsError({ status: 404 }, 'x'), /already ended/);
  assert.match(sessionsError({ code: 'CURRENT_SESSION', status: 400 }, 'x'), /Log out/);
  assert.strictEqual(sessionsError({ status: 500 }, 'fallback'), 'fallback');
});

test('device labels from client hints, names and fallback', async () => {
  const { modelName, platformLabel, sessionTitle, collectClientHints } = await import('./sessionFormat.js');
  assert.strictEqual(deviceLabel({ browser: 'Chrome 158', os: 'Android', model: 'SM-S918B', platform: 'Android', platform_version: '14.0.0' }), 'Samsung Galaxy S23 Ultra · Android 14 · Chrome 158');
  assert.strictEqual(deviceLabel({ browser: 'Chrome 157', os: 'Windows', model: null, platform: 'Windows', platform_version: '15.0.0' }), 'Windows 11 · Chrome 157');
  assert.strictEqual(deviceLabel({ browser: 'Chrome 157', os: 'Windows', platform: 'Windows', platform_version: '10.0.0' }), 'Windows 10 · Chrome 157');
  assert.strictEqual(deviceLabel({ browser: 'Safari 17', os: 'iOS' }), 'iPhone · Safari 17');
  assert.strictEqual(deviceLabel({ browser: 'Safari 17', os: 'iPadOS' }), 'iPad · Safari 17');
  // Nothing extra known: exactly as before.
  assert.strictEqual(deviceLabel({ browser: 'Chrome 131', os: 'Windows', model: null, platform: null, platform_version: null }), 'Chrome 131 on Windows');
  assert.strictEqual(modelName('SM-X999Z'), 'Samsung SM-X999Z');
  assert.strictEqual(modelName('Pixel 8'), 'Google Pixel 8');
  assert.strictEqual(modelName('CPH2581'), 'OnePlus 12');
  assert.strictEqual(modelName('XYZ-1'), 'XYZ-1');
  assert.strictEqual(platformLabel('macOS', '14.5.0'), 'macOS 14');
  assert.strictEqual(platformLabel('Windows', ''), 'Windows');
  assert.strictEqual(sessionTitle({ name: 'Office laptop', browser: 'Chrome 1' }), 'Office laptop');
  assert.strictEqual(sessionTitle({ browser: 'Chrome 1', os: 'Linux' }), 'Chrome 1 on Linux');
  const nav = { userAgentData: { platform: 'Android', getHighEntropyValues: async () => ({ model: 'Pixel 8', platform: 'Android', platformVersion: '14.0.0' }) } };
  assert.deepStrictEqual(await collectClientHints(nav), { model: 'Pixel 8', platform: 'Android', platformVersion: '14.0.0' });
  assert.strictEqual(await collectClientHints({}), null);
  assert.strictEqual(await collectClientHints({ userAgentData: { getHighEntropyValues: async () => { throw new Error('denied'); } } }), null);
});
