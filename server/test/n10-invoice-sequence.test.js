/**
 * N10: GST invoice numbering. Pure: no database, no network.
 * The series must have no gaps, so the next number comes from the invoices that
 * exist, never from a counter that a failed issue could use up.
 */
const test = require('node:test');
const assert = require('node:assert');
const { nextSequence, financialYear, gstinChecksumOk } = require('../services/billing/invoiceNumber');

test('S1: the first invoice of a year is 1', () => {
  assert.strictEqual(nextSequence([], 'AV', '26-27'), 1);
});

test('S2: the next number is one more than the highest issued, in any order', () => {
  assert.strictEqual(nextSequence(['AV/26-27/0001', 'AV/26-27/0003', 'AV/26-27/0002'], 'AV', '26-27'), 4);
});

test('S3: another year or another prefix does not count', () => {
  assert.strictEqual(nextSequence(['AV/25-26/0040', 'XX/26-27/0009'], 'AV', '26-27'), 1);
});

test('S4: a failed issue leaves no hole, because nothing was saved', () => {
  const issued = ['AV/26-27/0001'];
  const failedAttempt = nextSequence(issued, 'AV', '26-27'); // 2, but the save fails: nothing added
  assert.strictEqual(failedAttempt, 2);
  assert.strictEqual(nextSequence(issued, 'AV', '26-27'), 2, 'the retry gets the same number');
});

test('S5: junk numbers are ignored; the year rolls over on 1 April IST', () => {
  assert.strictEqual(nextSequence(['AV/26-27/abc', 'AV/26-27/'], 'AV', '26-27'), 1);
  assert.strictEqual(financialYear(new Date('2027-03-31T12:00:00Z')), '26-27');
  assert.strictEqual(financialYear(new Date('2027-03-31T19:00:00Z')), '27-28'); // 1 Apr 00:30 IST
});

test('S6: GSTIN check character: the real seller GSTIN passes, a changed digit fails', () => {
  assert.strictEqual(gstinChecksumOk('34ABGCA7083D1ZS'), true);
  assert.strictEqual(gstinChecksumOk('34ABGCA7083D1ZT'), false);
  assert.strictEqual(gstinChecksumOk('34ABGCA7084D1ZS'), false);
  assert.strictEqual(gstinChecksumOk('short'), false);
});
