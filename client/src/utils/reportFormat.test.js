import test from 'node:test';
import assert from 'node:assert';
import {
  formatMoney, formatMoneyFull, formatDuration, isAllZero, sortMembers, defaultTeamSort, canViewTeamReport, teamHasActivity,
} from './reportFormat.js';

test('money: short rupee amounts, no "₹0.004k"', () => {
  assert.strictEqual(formatMoney(0), '₹0');
  assert.strictEqual(formatMoney(4), '₹4');
  assert.strictEqual(formatMoney(0.25), '₹0');
  assert.strictEqual(formatMoney(500), '₹500');
  assert.strictEqual(formatMoney(999), '₹999');
  assert.strictEqual(formatMoney(1000), '₹1k');
  assert.strictEqual(formatMoney(1200), '₹1.2k');
  assert.strictEqual(formatMoney(45678), '₹45.7k');
  assert.strictEqual(formatMoney(99999), '₹1L');
  assert.strictEqual(formatMoney(340000), '₹3.4L');
  assert.strictEqual(formatMoney(12500000), '₹1.3Cr');
  assert.strictEqual(formatMoney(-1500), '-₹1.5k');
  assert.strictEqual(formatMoney(undefined), '₹0');
  assert.strictEqual(formatMoney('abc'), '₹0');
  assert.strictEqual(formatMoneyFull(1234567.4), '₹12,34,567');
});

test('durations: short human waits', () => {
  assert.strictEqual(formatDuration(null), '—');
  assert.strictEqual(formatDuration(undefined), '—');
  assert.strictEqual(formatDuration(-5), '—');
  assert.strictEqual(formatDuration(0), '0s');
  assert.strictEqual(formatDuration(45), '45s');
  assert.strictEqual(formatDuration(240), '4m');
  assert.strictEqual(formatDuration(800), '13m');
  assert.strictEqual(formatDuration(3600), '1h');
  assert.strictEqual(formatDuration(4800), '1h 20m');
  assert.strictEqual(formatDuration(86400 + 3 * 3600), '1d 3h');
  assert.strictEqual(formatDuration(2 * 86400), '2d');
});

test('empty charts are detected', () => {
  assert.strictEqual(isAllZero([], ['r']), true);
  assert.strictEqual(isAllZero(undefined, ['r']), true);
  assert.strictEqual(isAllZero([{ r: 0 }, { r: 0 }], ['r']), true);
  assert.strictEqual(isAllZero([{ leads: 0, converted: 1 }], ['leads', 'converted']), false);
});

test('team table sorting', () => {
  const members = [
    { name: 'Priya', replies: 3, avg_first_reply_seconds: 600, last_active_at: '2026-11-25T10:00:00Z' },
    { name: 'arun', replies: 9, avg_first_reply_seconds: null, last_active_at: null },
    { name: 'Meena', replies: 3, avg_first_reply_seconds: 120, last_active_at: '2026-11-26T10:00:00Z' },
  ];
  assert.deepStrictEqual(sortMembers(members, 'name', 'asc').map((m) => m.name), ['arun', 'Meena', 'Priya']);
  assert.deepStrictEqual(sortMembers(members, 'replies', 'desc').map((m) => m.name), ['arun', 'Meena', 'Priya'], 'ties by name');
  assert.deepStrictEqual(sortMembers(members, 'avg_first_reply_seconds', 'asc').map((m) => m.name), ['Meena', 'Priya', 'arun'], 'no reply time goes last');
  assert.deepStrictEqual(sortMembers(members, 'avg_first_reply_seconds', 'desc').map((m) => m.name), ['Priya', 'Meena', 'arun']);
  assert.deepStrictEqual(sortMembers(members, 'last_active_at', 'desc').map((m) => m.name), ['Meena', 'Priya', 'arun']);
  assert.strictEqual(defaultTeamSort('avg_first_reply_seconds'), 'asc');
  assert.strictEqual(defaultTeamSort('name'), 'asc');
  assert.strictEqual(defaultTeamSort('replies'), 'desc');
});

test('who sees the Team tab, and when it is empty', () => {
  assert.strictEqual(canViewTeamReport('owner'), true);
  assert.strictEqual(canViewTeamReport('Admin'), true);
  assert.strictEqual(canViewTeamReport('manager'), false);
  assert.strictEqual(canViewTeamReport('staff'), false);
  assert.strictEqual(canViewTeamReport('agent'), false);
  assert.strictEqual(canViewTeamReport(null), false);
  assert.strictEqual(teamHasActivity(null), false);
  assert.strictEqual(teamHasActivity({ totals: { replies: 0, status_changes: 0 }, ai: { replies: 0, handovers: 0 } }), false);
  assert.strictEqual(teamHasActivity({ totals: { replies: 0 }, ai: { replies: 2 } }), true);
  assert.strictEqual(teamHasActivity({ totals: { notes: 1 }, ai: {} }), true);
});
