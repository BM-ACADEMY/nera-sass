import test from 'node:test';
import assert from 'node:assert';
import { isFeatureOff, lastLeadText, pageBadge, facebookState } from './facebookLeadsPolicy.js';

test('feature off is a 404 from the status call', () => {
  assert.strictEqual(isFeatureOff({ status: 404 }), true);
  assert.strictEqual(isFeatureOff({ status: 500 }), false);
  assert.strictEqual(isFeatureOff(null), false);
});

test('last lead text is plain English', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  assert.strictEqual(lastLeadText(null, now), 'No leads received yet');
  assert.strictEqual(lastLeadText('2026-11-25T11:59:50Z', now), 'Last lead just now');
  assert.strictEqual(lastLeadText('2026-11-25T11:30:00Z', now), 'Last lead 30 min ago');
  assert.strictEqual(lastLeadText('2026-11-25T09:00:00Z', now), 'Last lead 3 h ago');
  assert.match(lastLeadText('2026-11-01T09:00:00Z', now), /^Last lead on /);
});

test('page badge and card state', () => {
  assert.strictEqual(pageBadge({ status: 'error', subscribed: true }).label, 'Needs attention');
  assert.strictEqual(pageBadge({ status: 'connected', subscribed: true }).label, 'Receiving leads');
  assert.strictEqual(facebookState(null), 'loading');
  assert.strictEqual(facebookState({ configured: false }), 'not-configured');
  assert.strictEqual(facebookState({ configured: true, pending: { pages: [{ id: '1' }] }, pages: [] }), 'choosing');
  assert.strictEqual(facebookState({ configured: true, pages: [{ page_id: '1' }] }), 'connected');
  assert.strictEqual(facebookState({ configured: true, pages: [] }), 'not-connected');
});
