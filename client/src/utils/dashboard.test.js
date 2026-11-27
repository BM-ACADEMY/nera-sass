import test from 'node:test';
import assert from 'node:assert';
import { formatRupees, fullRupees, sourceRows, waitText, attentionCards, queryValue, isStaffRole, greeting } from './dashboard.js';

test('rupees read short in Indian units', () => {
  const cases = [
    [0, '₹0'], [null, '₹0'], [undefined, '₹0'], ['abc', '₹0'], [500, '₹500'], [999.6, '₹1000'],
    [1000, '₹1k'], [1200, '₹1.2k'], [45000, '₹45k'], [99949, '₹99.9k'], [99990, '₹1L'],
    [100000, '₹1L'], [340000, '₹3.4L'], [1234567, '₹12.3L'], [9999999, '₹1Cr'], [21000000, '₹2.1Cr'],
    ['2500', '₹2.5k'], [-1500, '-₹1.5k'],
  ];
  for (const [value, expected] of cases) assert.strictEqual(formatRupees(value), expected, String(value));
  assert.strictEqual(fullRupees(123456), '₹1,23,456');
  assert.strictEqual(fullRupees(null), '₹0');
});

test('lead sources get full names, counts and percents that add up to 100', () => {
  const rows = sourceRows([
    { kind: 'manual', count: 1 }, { kind: 'whatsapp', count: 5 }, { kind: 'campaign', count: 1 },
    { kind: 'whatsapp_ad', count: 0 }, { kind: 'facebook', count: 2 }, { kind: 'import', count: 1 }, { kind: 'mystery', count: 1 },
  ]);
  assert.deepStrictEqual(rows.map((r) => r.label), ['WhatsApp', 'Facebook lead form', 'Manual', 'Campaign upload', 'Import', 'Other']);
  assert.deepStrictEqual(rows.map((r) => r.count), [5, 2, 1, 1, 1, 1]);
  assert.strictEqual(rows.reduce((sum, r) => sum + r.percent, 0), 100);
  assert.strictEqual(rows[0].percent, 46);
  assert.deepStrictEqual(sourceRows([]), []);
  assert.deepStrictEqual(sourceRows(null), []);
  assert.deepStrictEqual(sourceRows([{ kind: 'whatsapp', count: 0 }]), []);
  assert.deepStrictEqual(sourceRows([{ kind: 'whatsapp_ad', count: 3 }]), [{ kind: 'whatsapp_ad', count: 3, label: 'WhatsApp ad', percent: 100 }]);
  const thirds = sourceRows([{ kind: 'manual', count: 1 }, { kind: 'import', count: 1 }, { kind: 'whatsapp', count: 1 }]);
  assert.strictEqual(thirds.reduce((sum, r) => sum + r.percent, 0), 100);
});

test('wait times read in minutes, hours and days', () => {
  const now = new Date('2026-11-27T10:00:00Z').getTime();
  const minus = (min) => new Date(now - min * 60000).toISOString();
  assert.strictEqual(waitText(minus(18), now), '18 min');
  assert.strictEqual(waitText(minus(60), now), '1 h');
  assert.strictEqual(waitText(minus(125), now), '2 h 5 min');
  assert.strictEqual(waitText(minus(60 * 24), now), '1 day');
  assert.strictEqual(waitText(minus(60 * 72), now), '3 days');
  assert.strictEqual(waitText(null, now), '');
  assert.strictEqual(waitText('not a date', now), '');
});

test('attention cards link to the right page with a filter', () => {
  const now = new Date('2026-11-27T10:00:00Z').getTime();
  const cards = attentionCards({
    scope: 'mine',
    unanswered: { count: 3, oldest_at: new Date(now - 40 * 60000).toISOString(), oldest_lead_id: 12, after_minutes: 15 },
    hot_no_reply: { count: 1 },
    handovers: { count: 0, oldest_at: null, oldest_lead_id: null },
    overdue_tasks: { count: 2 },
  }, now);
  assert.deepStrictEqual(cards.map((c) => [c.key, c.count, c.to]), [
    ['unanswered', 3, '/inbox'], ['hot', 1, '/leads?status=hot'], ['handovers', 0, '/inbox'], ['overdue', 2, '/sales-tasks?due=overdue'],
  ]);
  assert.deepStrictEqual(cards[0].state, { leadId: 12 }, 'opens the longest-waiting chat');
  assert.strictEqual(cards[0].hint, 'Oldest waiting 40 min');
  assert.strictEqual(cards[2].state, undefined);
  assert.strictEqual(cards[2].hint, 'No chat is waiting for a person');
  assert.strictEqual(cards[3].hint, 'Yours and unassigned');
  assert.deepStrictEqual(attentionCards(null), []);
  assert.strictEqual(attentionCards({ scope: 'all', unanswered: { count: 0, after_minutes: 15 } })[0].hint, 'No customer waiting over 15 min');
});

test('query filters only take known values', () => {
  const statuses = ['new', 'hot', 'warm'];
  assert.strictEqual(queryValue('?status=hot', 'status', statuses, 'all'), 'hot');
  assert.strictEqual(queryValue('?status=HOT', 'status', statuses, 'all'), 'all');
  assert.strictEqual(queryValue('?status=<script>', 'status', statuses, 'all'), 'all');
  assert.strictEqual(queryValue('', 'status', statuses, 'all'), 'all');
  assert.strictEqual(queryValue(undefined, 'due', ['overdue'], 'all'), 'all');
  assert.strictEqual(queryValue('?due=overdue&x=1', 'due', ['overdue', 'today'], 'all'), 'overdue');
});

test('agents (and legacy agent names) get the staff view', () => {
  for (const role of ['agent', 'Agent', 'user', 'ops']) assert.strictEqual(isStaffRole(role), true, role);
  for (const role of ['owner', 'admin', 'manager', null, undefined, '']) assert.strictEqual(isStaffRole(role), false, String(role));
});

test('greeting follows the time of day', () => {
  assert.strictEqual(greeting(new Date(2026, 10, 27, 9)), 'Good morning');
  assert.strictEqual(greeting(new Date(2026, 10, 27, 13)), 'Good afternoon');
  assert.strictEqual(greeting(new Date(2026, 10, 27, 20)), 'Good evening');
});
