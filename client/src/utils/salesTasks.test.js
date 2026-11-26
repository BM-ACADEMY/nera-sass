import test from 'node:test';
import assert from 'node:assert';
import { dayKey, dueInputs, dueState, formatDue, filterTasks, sortTasks, countDue, taskBody, taskTitle } from './salesTasks.js';

const TZ = 'Asia/Kolkata';
// 25 Nov 2026, 20:00 in India (14:30 UTC).
const NOW = new Date('2026-11-25T14:30:00Z');

test('days are read on the workspace clock, not UTC', () => {
  // 26 Nov 01:00 in India is still 25 Nov in UTC.
  assert.strictEqual(dayKey('2026-11-25T19:30:00Z', TZ), '2026-11-26');
  assert.deepStrictEqual(dueInputs('2026-12-01T05:00:00Z', TZ), { date: '2026-12-01', time: '10:30' });
  assert.deepStrictEqual(dueInputs(null, TZ), { date: '', time: '' });
});

test('due state: overdue, today, upcoming, none, done', () => {
  assert.strictEqual(dueState({ due_at: '2026-11-25T10:00:00Z' }, NOW, TZ), 'overdue');
  assert.strictEqual(dueState({ due_at: '2026-11-25T17:00:00Z' }, NOW, TZ), 'today', '22:30 in India is still today');
  assert.strictEqual(dueState({ due_at: '2026-11-25T19:00:00Z' }, NOW, TZ), 'upcoming', '00:30 in India is tomorrow');
  assert.strictEqual(dueState({}, NOW, TZ), 'none');
  assert.strictEqual(dueState({ status: 'completed', due_at: '2026-11-20T10:00:00Z' }, NOW, TZ), 'done');
  assert.strictEqual(formatDue('2026-11-26T04:30:00Z', TZ, NOW), 'Tomorrow, 10:00 am');
});

test('filters: status, assignee, due and search', () => {
  const tasks = [
    { id: 1, task_type: 'manual', title: 'Send price list', status: 'pending', assigned_to: 7, due_at: '2026-11-25T10:00:00Z' },
    { id: 2, task_type: 'hot_lead', status: 'pending', name: 'Ravi', phone: '+91 98765 43210', assigned_to: null },
    { id: 3, task_type: 'manual', title: 'Done one', status: 'completed', assigned_to: 7 },
  ];
  const ids = (filters) => filterTasks(tasks, filters, { me: 7, now: NOW, timeZone: TZ }).map((t) => t.id);
  assert.deepStrictEqual(ids({}), [1, 2], 'open tasks by default');
  assert.deepStrictEqual(ids({ status: 'all' }), [1, 2, 3]);
  assert.deepStrictEqual(ids({ status: 'completed' }), [3]);
  assert.deepStrictEqual(ids({ assignee: 'me', status: 'all' }), [1, 3]);
  assert.deepStrictEqual(ids({ assignee: 'none' }), [2]);
  assert.deepStrictEqual(ids({ due: 'overdue' }), [1]);
  assert.deepStrictEqual(ids({ search: 'price' }), [1]);
  assert.deepStrictEqual(ids({ search: '98765' }), [2]);
  assert.deepStrictEqual(ids({ search: 'contact this' }), [2], 'automatic tasks are found by their title');
  assert.strictEqual(taskTitle(tasks[1]), 'Contact this hot lead');
});

test('overdue first, finished last; counts', () => {
  const tasks = [
    { id: 1, status: 'completed' },
    { id: 2, status: 'pending', due_at: '2026-11-27T10:00:00Z' },
    { id: 3, status: 'pending', due_at: '2026-11-20T10:00:00Z' },
    { id: 4, status: 'pending' },
  ];
  assert.deepStrictEqual(sortTasks(tasks, { now: NOW, timeZone: TZ }).map((t) => t.id), [3, 2, 4, 1]);
  assert.deepStrictEqual(countDue(tasks, { now: NOW, timeZone: TZ }), { overdue: 1, today: 0, upcoming: 1, open: 3 });
});

test('form body', () => {
  assert.deepStrictEqual(
    taskBody({ title: ' Call ', description: '', lead: { id: 4 }, assigned_to: '9', due_date: '2026-12-01', due_time: '' }),
    { title: 'Call', description: '', lead_id: 4, assigned_to: 9, due_date: '2026-12-01', due_time: null }
  );
});

test('bulk task actions ask first and state the count', async () => {
  const { bulkTaskConfirm } = await import('./salesTasks.js');
  const done = bulkTaskConfirm('complete', 4);
  assert.strictEqual(done.title, 'Mark 4 tasks as done?');
  assert.strictEqual(done.actionLabel, 'Mark 4 tasks as done');
  assert.strictEqual(done.destructive, false);
  const del = bulkTaskConfirm('selected', 1);
  assert.strictEqual(del.title, 'Delete 1 task?');
  assert.strictEqual(del.actionLabel, 'Delete 1 task');
  assert.strictEqual(del.destructive, true);
  const range = bulkTaskConfirm('range', 9, { from: '2026-11-01', to: '2026-11-05' });
  assert.strictEqual(range.title, 'Delete 9 tasks?');
  assert.match(range.text, /2026-11-01 to 2026-11-05/);
});
