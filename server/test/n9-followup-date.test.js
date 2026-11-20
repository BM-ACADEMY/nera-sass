/**
 * N9: follow-up on the day the customer names. Pure: no database, no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const { cleanProposal, resolve } = require('../services/followupDate');

// Thursday 19 Nov 2026, 10:00 IST
const NOW = new Date('2026-11-19T04:30:00Z');
const IST = { now: NOW, tz: 'Asia/Kolkata' };
const istParts = (d) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' }).format(d);

test('F1: Monday with no time goes out at 10:00 local', () => {
  const at = resolve({ date: '2026-11-23', time: null }, IST);
  assert.strictEqual(istParts(at), '23/11/2026, 10:00');
});

test('F2: a time the customer gave is kept inside sending hours', () => {
  assert.strictEqual(istParts(resolve({ date: '2026-11-23', time: '15:30' }, IST)), '23/11/2026, 15:30');
});

test('F3: night times are moved into sending hours, never sent at night', () => {
  assert.strictEqual(istParts(resolve({ date: '2026-11-23', time: '06:00' }, IST)), '23/11/2026, 09:00');
  assert.strictEqual(istParts(resolve({ date: '2026-11-23', time: '23:30' }, IST)), '23/11/2026, 20:00');
});

test('F4: past dates, today within an hour, and far dates are refused', () => {
  assert.strictEqual(resolve({ date: '2026-11-18', time: null }, IST), null);
  assert.strictEqual(resolve({ date: '2026-11-19', time: '10:30' }, IST), null);
  assert.strictEqual(resolve({ date: '2027-03-01', time: null }, IST), null);
});

test('F5: later today is allowed', () => {
  assert.strictEqual(istParts(resolve({ date: '2026-11-19', time: '17:00' }, IST)), '19/11/2026, 17:00');
});

test('F6: nonsense is refused', () => {
  for (const bad of [null, undefined, 'Monday', {}, { date: 'Monday' }, { date: '2026-02-31' }, { date: '2026-13-01' }, []]) {
    assert.strictEqual(resolve(bad, IST), null, JSON.stringify(bad));
  }
  assert.strictEqual(cleanProposal({ date: '2026-11-23', time: '25:99' }).time, null);
});

test('F7: other time zones are honoured', () => {
  const at = resolve({ date: '2026-11-23', time: '10:00' }, { now: NOW, tz: 'Asia/Dubai' });
  assert.strictEqual(at.toISOString(), '2026-11-23T06:00:00.000Z');
});
