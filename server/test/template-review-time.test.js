/**
 * Meta review timing on cached templates: sent for review, decided, and
 * templates first seen already decided (no timing).
 */
const test = require('node:test');
const assert = require('node:assert');
const { reviewTiming } = require('../services/metaTemplateApi');

test('Template review timing', async (t) => {
  await t.test('R1. Created or edited in Getnera: exact submit time, old decision cleared', () => {
    const out = reviewTiming({ status: 'APPROVED', submitted_at: new Date(0), reviewed_at: new Date(1) }, 'PENDING', { submitted: true });
    assert.strictEqual(out.$set.submitted_at_estimated, false);
    assert.ok(out.$set.submitted_at instanceof Date);
    assert.deepStrictEqual(out.$unset, { reviewed_at: '' });
  });

  await t.test('R2. First seen in review: estimated submit time; still in review: unchanged', () => {
    const first = reviewTiming(null, 'PENDING');
    assert.strictEqual(first.$set.submitted_at_estimated, true);
    assert.strictEqual(reviewTiming({ status: 'PENDING', submitted_at: new Date() }, 'PENDING'), null);
  });

  await t.test('R3. Leaving review records the decision once', () => {
    const decided = reviewTiming({ status: 'PENDING', submitted_at: new Date() }, 'APPROVED');
    assert.ok(decided.$set.reviewed_at instanceof Date);
    assert.strictEqual(reviewTiming({ status: 'APPROVED', submitted_at: new Date(), reviewed_at: new Date() }, 'APPROVED'), null);
  });

  await t.test('R4. Already decided when first seen: no timing is invented', () => {
    assert.strictEqual(reviewTiming(null, 'APPROVED'), null);
    assert.strictEqual(reviewTiming({ status: 'REJECTED' }, 'APPROVED'), null);
  });
});
