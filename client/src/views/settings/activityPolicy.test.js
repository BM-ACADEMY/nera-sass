import test from 'node:test';
import assert from 'node:assert';
import { activityQuery, activityFilterProblem, hasActivityFilters, emptyActivityFilters, actorText, groupLabel, ACTIVITY_PAGE_SIZE } from './activityPolicy.js';
import { settingsSections, findSection, canViewActivity } from './settingsPolicy.js';

test('Activity appears in Settings only with the view_activity permission', () => {
  assert.ok(settingsSections({ view_activity: true }).some((s) => s.key === 'activity'));
  assert.ok(!settingsSections({ view_activity: false }).some((s) => s.key === 'activity'));
  assert.ok(!settingsSections().some((s) => s.key === 'activity'));
  assert.strictEqual(findSection('activity').title, 'Activity');
  assert.strictEqual(canViewActivity('owner'), true);
  assert.strictEqual(canViewActivity('admin'), false, 'the activity log is for Owners');
  assert.strictEqual(canViewActivity('staff'), false);
  assert.strictEqual(canViewActivity('agent'), false);
});

test('activity query leaves out "all" and empty filters', () => {
  assert.deepStrictEqual(activityQuery(emptyActivityFilters()), { page: 1, limit: ACTIVITY_PAGE_SIZE });
  assert.deepStrictEqual(activityQuery({ user: '7', group: 'leads', from: '2026-11-01', to: '2026-11-05' }, 3), {
    page: 3, limit: ACTIVITY_PAGE_SIZE, user_id: '7', group: 'leads', from: '2026-11-01', to: '2026-11-05',
  });
  assert.strictEqual(hasActivityFilters(emptyActivityFilters()), false);
  assert.strictEqual(hasActivityFilters({ group: 'chat' }), true);
});

test('date range problems and plain wording', () => {
  assert.match(activityFilterProblem({ from: '2026-11-05', to: '2026-11-01' }), /From/);
  assert.strictEqual(activityFilterProblem({ from: '2026-11-01', to: '2026-11-01' }), '');
  assert.strictEqual(actorText({ name: 'Priya', role: 'staff' }), 'Priya · Staff');
  assert.strictEqual(actorText({ name: 'Ravi', role: 'manager' }), 'Ravi · Staff', 'retired roles read as Staff');
  assert.strictEqual(actorText({ name: 'Getnera team', role: null }), 'Getnera team');
  assert.strictEqual(actorText(null), 'System');
  assert.strictEqual(groupLabel('security'), 'Sign-in & security');
  assert.strictEqual(groupLabel('x'), 'Other');
});
