import test from 'node:test';
import assert from 'node:assert';
import {
  LABEL_COLORS, labelColor, nearestLabelColor, cleanLabelName, labelNameError, toggleLabelId, filterLabels, labelPermissions, leadCountText,
} from './labelsPolicy.js';

test('palette: the same 8 keys as the server, unknown keys are grey', () => {
  assert.deepStrictEqual(LABEL_COLORS.map((c) => c.key), ['slate', 'red', 'orange', 'amber', 'green', 'teal', 'blue', 'violet']);
  assert.strictEqual(labelColor('nope').key, 'slate');
  assert.strictEqual(labelColor('teal').hex, '#14b8a6');
});

test('nearest palette colour for an inbox hex colour', () => {
  assert.strictEqual(nearestLabelColor('#00a884'), 'teal');
  assert.strictEqual(nearestLabelColor('#7c3aed'), 'violet');
  assert.strictEqual(nearestLabelColor('#ff0000'), 'red');
  assert.strictEqual(nearestLabelColor('green'), 'green');
  assert.strictEqual(nearestLabelColor('not a colour'), 'slate');
});

test('label names: trimmed, 1-40 characters, unique ignoring case', () => {
  const labels = [{ id: 1, name: 'VIP' }, { id: 2, name: 'Call back' }];
  assert.strictEqual(cleanLabelName('  Hot   lead '), 'Hot lead');
  assert.strictEqual(labelNameError('   '), 'Enter a label name.');
  assert.match(labelNameError('x'.repeat(41)), /up to 40/);
  assert.strictEqual(labelNameError('x'.repeat(40)), '');
  assert.match(labelNameError(' vip ', labels), /already exists/);
  assert.strictEqual(labelNameError('Vip', labels, 1), '', 'renaming a label to another case of its own name');
  assert.strictEqual(labelNameError('New', labels), '');
});

test('toggle and filter', () => {
  assert.deepStrictEqual(toggleLabelId([1, 2], 2), [1]);
  assert.deepStrictEqual(toggleLabelId([1], '3'), [1, 3]);
  assert.deepStrictEqual(filterLabels([{ name: 'b' }, { name: 'A' }, { name: 'ab' }], 'a').map((l) => l.name), ['A', 'ab']);
  assert.strictEqual(leadCountText(1), '1 lead');
  assert.strictEqual(leadCountText(0), '0 leads');
});

test('only owners and admins manage labels; everyone labels leads', () => {
  assert.deepStrictEqual(labelPermissions('owner'), { canManage: true, canLabel: true });
  assert.deepStrictEqual(labelPermissions('Admin'), { canManage: true, canLabel: true });
  assert.deepStrictEqual(labelPermissions('staff'), { canManage: false, canLabel: true });
  assert.deepStrictEqual(labelPermissions('agent'), { canManage: false, canLabel: true });
});
