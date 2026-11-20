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
