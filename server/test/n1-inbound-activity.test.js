/**
 * Inbound watch, pure part: when a number counts as silent. No database.
 */
const test = require('node:test');
const assert = require('node:assert');
const numberHealth = require('../services/numberHealth');

const HOUR = 3600000;

test('inboundActivity (pure)', () => {
  const now = new Date('2026-11-10T12:00:00Z');
  const ago = (h) => new Date(now.getTime() - h * HOUR);
  const both = numberHealth.inboundActivity({ last_message_received_at: ago(5), last_status_received_at: ago(2) }, { now });
  assert.strictEqual(both.last_inbound_event_at.toISOString(), ago(2).toISOString(), 'the newer of message and receipt');
  assert.strictEqual(both.last_inbound_event_kind, 'status');
  assert.strictEqual(both.silent, false);
  assert.strictEqual(both.silent_after_hours, 24);
  assert.strictEqual(numberHealth.inboundActivity({ last_message_received_at: ago(25) }, { now }).silent, true);
  assert.strictEqual(numberHealth.inboundActivity(null, { since: ago(23), now }).silent, false);
  assert.strictEqual(numberHealth.inboundActivity(null, { since: ago(24), now }).silent, true);
  assert.strictEqual(numberHealth.inboundActivity(null, { now }).silent, false, 'no reference: never flagged');
  process.env.WA_SILENT_ALERT_HOURS = '48';
  try {
    assert.strictEqual(numberHealth.inboundActivity({ last_status_received_at: ago(30) }, { now }).silent, false);
  } finally {
    delete process.env.WA_SILENT_ALERT_HOURS;
  }
});
