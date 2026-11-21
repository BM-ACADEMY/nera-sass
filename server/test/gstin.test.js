/**
 * GSTIN check character. Pure: no database, no network.
 */
const test = require('node:test');
const assert = require('node:assert');
const { gstinChecksumOk } = require('../services/billing/gstin');

test('S6: GSTIN check character: the real seller GSTIN passes, a changed digit fails', () => {
  assert.strictEqual(gstinChecksumOk('34ABGCA7083D1ZS'), true);
  assert.strictEqual(gstinChecksumOk('34ABGCA7083D1ZT'), false);
  assert.strictEqual(gstinChecksumOk('34ABGCA7084D1ZS'), false);
  assert.strictEqual(gstinChecksumOk('short'), false);
});
