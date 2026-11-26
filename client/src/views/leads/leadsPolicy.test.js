import test from 'node:test';
import assert from 'node:assert';
import {
  sourceFilters, leadSourceKind, statusInfo, pageInfo, lastMessageText, timeAgo, toggleAll, toggleOne, uniqueLeads, importSummary, importSampleCsv, ADD_LEAD_SOURCES,
} from './leadsPolicy.js';

test('source filters: no Website; Facebook lead form only when there are such leads', () => {
  assert.deepStrictEqual(sourceFilters().map((f) => f.value), ['all', 'whatsapp', 'whatsapp_ad', 'import', 'manual']);
  assert.ok(sourceFilters({ facebook: 0 }).every((f) => f.value !== 'facebook'));
  const withFb = sourceFilters({ whatsapp: 4, whatsapp_ad: 1, import: 2, manual: 3, facebook: 5 });
  assert.deepStrictEqual(withFb.map((f) => f.label), ['All', 'WhatsApp', 'WhatsApp ad', 'Import', 'Manual', 'Facebook lead form']);
  assert.strictEqual(withFb[0].count, 15);
  assert.ok(sourceFilters().every((f) => f.count === null), 'no counts before the summary loads');
  assert.ok([...sourceFilters({ facebook: 1 }), ...ADD_LEAD_SOURCES].every((f) => !/website/i.test(f.label)));
});

test('a lead\'s source kind: server value first, website counts as Manual', () => {
  assert.strictEqual(leadSourceKind({ source_kind: 'whatsapp_ad', source: 'facebook' }), 'whatsapp_ad');
  assert.strictEqual(leadSourceKind({ source: 'website' }), 'manual');
  assert.strictEqual(leadSourceKind({ source: 'facebook', ad_id: '1' }), 'whatsapp_ad');
  assert.strictEqual(leadSourceKind({ source: 'Meta Ads', leadgen_id: 'x' }), 'facebook');
  assert.strictEqual(leadSourceKind({ source: 'XLS Sheet' }), 'import');
  assert.strictEqual(leadSourceKind({ source: 'WhatsApp' }), 'whatsapp');
  assert.strictEqual(leadSourceKind({}), 'manual');
});

test('status labels', () => {
  assert.strictEqual(statusInfo('HOT ').label, 'Hot');
  assert.strictEqual(statusInfo('').label, 'Cold');
  assert.strictEqual(statusInfo('follow up').label, 'Follow up');
});

test('pager uses the server total', () => {
  assert.deepStrictEqual(pageInfo(95, 2, 20), { total: 95, pages: 5, page: 2, from: 21, to: 40, hasPrev: true, hasNext: true });
  assert.deepStrictEqual(pageInfo(95, 5, 20), { total: 95, pages: 5, page: 5, from: 81, to: 95, hasPrev: true, hasNext: false });
  assert.deepStrictEqual(pageInfo(0, 1, 20), { total: 0, pages: 1, page: 1, from: 0, to: 0, hasPrev: false, hasNext: false });
  assert.strictEqual(pageInfo(10, 9, 20).page, 1, 'a page past the end is clamped');
});

test('last message text', () => {
  assert.strictEqual(lastMessageText({ last_msg: { content: 'Hi there' } }), 'Hi there');
  assert.strictEqual(lastMessageText({ last_msg: { msg_type: 'image', media_url: '/m/1' } }), 'Photo');
  assert.strictEqual(lastMessageText({ last_msg: { content: 'x', is_deleted: true } }), 'Message deleted');
  assert.strictEqual(lastMessageText({}), '');
  assert.strictEqual(lastMessageText({ last_msg: { content: 'a'.repeat(100) } }).length, 80);
});

test('time ago', () => {
  const now = Date.parse('2026-11-25T12:00:00Z');
  assert.strictEqual(timeAgo('2026-11-25T11:55:00Z', now), '5 min ago');
  assert.strictEqual(timeAgo('2026-11-25T09:00:00Z', now), '3 h ago');
  assert.strictEqual(timeAgo('2026-11-24T10:00:00Z', now), 'Yesterday');
  assert.strictEqual(timeAgo(null, now), '');
});

test('selection: page toggle and single toggle', () => {
  let selected = toggleAll(new Set(), [1, 2, 3]);
  assert.deepStrictEqual([...selected], [1, 2, 3]);
  selected = toggleOne(selected, 2);
  assert.deepStrictEqual([...selected], [1, 3]);
  selected = toggleAll(selected, [1, 2, 3]);
  assert.deepStrictEqual([...selected].sort(), [1, 2, 3]);
  selected = toggleAll(selected, [1, 2, 3]);
  assert.deepStrictEqual([...selected], []);
});

test('duplicate rows are dropped', () => {
  assert.deepStrictEqual(uniqueLeads([{ id: 1 }, { id: 2 }, { id: 1 }]).map((l) => l.id), [1, 2]);
});

test('import summary and sample', () => {
  assert.strictEqual(importSummary({ imported: 5, inserted: 3, existing: 2, failed: 1 }), '3 new, 2 already in your leads (updated), 1 could not be added');
  assert.match(importSampleCsv(), /^Name,Phone,Country Code/);
  assert.doesNotMatch(importSampleCsv(), /Source|Brand|website/i);
});

test('export and delete follow the server roles', async () => {
  const { leadPermissions } = await import('./leadsPolicy.js');
  assert.deepStrictEqual(leadPermissions('owner'), { canExport: true, canDelete: true });
  assert.deepStrictEqual(leadPermissions('agent'), { canExport: false, canDelete: false });
  assert.deepStrictEqual(leadPermissions(undefined), { canExport: false, canDelete: false });
});

test('bulk lead actions ask first and state the count', async () => {
  const { bulkLeadConfirm, exportButtonLabel } = await import('./leadsPolicy.js');
  const assign = bulkLeadConfirm({ action: 'assign', count: 12, assigneeName: 'Priya' });
  assert.strictEqual(assign.title, 'Assign 12 leads to Priya?');
  assert.strictEqual(assign.actionLabel, 'Assign 12 leads');
  assert.strictEqual(bulkLeadConfirm({ action: 'assign', count: 1, assigneeName: null }).title, 'Unassign 1 lead?');
  const status = bulkLeadConfirm({ action: 'status', count: 3, statusLabel: 'Hot' });
  assert.strictEqual(status.title, 'Change 3 leads to Hot?');
  assert.strictEqual(status.actionLabel, 'Set 3 leads to Hot');
  assert.strictEqual(exportButtonLabel(12), 'Export 12 leads');
  assert.strictEqual(exportButtonLabel(1), 'Export 1 lead');
  assert.strictEqual(exportButtonLabel(1500), 'Export 1,500 leads');
  assert.strictEqual(exportButtonLabel(null), 'Download CSV');
});
