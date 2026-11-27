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
  assert.deepStrictEqual(leadPermissions('owner'), { canExport: true, canDelete: true, canDeleteAnyNote: true });
  assert.deepStrictEqual(leadPermissions('agent'), { canExport: false, canDelete: false, canDeleteAnyNote: false });
  assert.deepStrictEqual(leadPermissions(undefined), { canExport: false, canDelete: false, canDeleteAnyNote: false });
  // Notes: Owner and Admin delete anyone's (leads.notes.delete_any); a manager only their own.
  assert.strictEqual(leadPermissions('admin').canDeleteAnyNote, true);
  assert.strictEqual(leadPermissions('manager').canDeleteAnyNote, false);
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

test('status mapping: every status has its own icon and colour, unknown ones fall back', async () => {
  const { STATUS_OPTIONS, STATUS_ICON_KEYS } = await import('./leadsPolicy.js');
  assert.deepStrictEqual(STATUS_OPTIONS.map((o) => o.value), ['new', 'hot', 'warm', 'cold', 'converted', 'lost']);
  for (const option of STATUS_OPTIONS) {
    assert.ok(STATUS_ICON_KEYS.includes(option.icon), `${option.value} icon`);
    assert.ok(option.tone && option.iconTone, `${option.value} colours`);
  }
  assert.strictEqual(new Set(STATUS_OPTIONS.map((o) => o.icon)).size, STATUS_OPTIONS.length, 'one icon per status');
  assert.strictEqual(new Set(STATUS_OPTIONS.map((o) => o.tone)).size, STATUS_OPTIONS.length, 'one colour per status');
  assert.match(statusInfo('HOT').tone, /red/);
  assert.match(statusInfo('cold').iconTone, /sky/);
  assert.strictEqual(statusInfo('').icon, 'cold');
  const odd = statusInfo('callback');
  assert.strictEqual(odd.icon, 'other');
  assert.ok(STATUS_ICON_KEYS.includes(odd.icon) && odd.tone);
});

test('bulk bar: only ticked rows on the page shown count', async () => {
  const { selectionOnPage } = await import('./leadsPolicy.js');
  assert.strictEqual(selectionOnPage(new Set(), [1, 2]).size, 0);
  assert.strictEqual(selectionOnPage(undefined, [1]).size, 0);
  // Ticked on another page, or a lead that left the list after a change.
  assert.strictEqual(selectionOnPage(new Set([7, 8]), [1, 2, 3]).size, 0);
  assert.deepStrictEqual([...selectionOnPage(new Set([2, 9]), [1, 2, 3])], [2]);
  assert.strictEqual(selectionOnPage(new Set([1]), []).size, 0);
});

test('assign list avatars: initials and a steady colour', async () => {
  const { initials, avatarTone, AVATAR_TONES } = await import('./leadsPolicy.js');
  assert.strictEqual(initials('Aakash Sharma'), 'AS');
  assert.strictEqual(initials('priya'), 'P');
  assert.strictEqual(initials('  Mohammed Ali Khan '), 'MK');
  assert.strictEqual(initials('owner@shop.test'), 'OT');
  assert.strictEqual(initials(''), '?');
  assert.strictEqual(initials(null), '?');
  assert.strictEqual(avatarTone(5), avatarTone(5));
  assert.ok(AVATAR_TONES.includes(avatarTone('anyone')));
});

test('updated by: name and a short time, nothing when no one changed the lead', async () => {
  const { changedBy, shortWhen, noteCountLabel } = await import('./leadsPolicy.js');
  const now = new Date('2026-11-27T12:00:00+05:30').getTime();
  assert.strictEqual(changedBy({}, now), null);
  assert.strictEqual(changedBy({ last_changed_by: null, last_changed_at: '2026-11-27T09:00:00Z' }, now), null);
  assert.deepStrictEqual(changedBy({ last_changed_by: 'Aakash', last_changed_at: '2026-11-27T14:30:00+05:30' }, now), { name: 'Aakash', when: '2:30 pm' });
  assert.match(shortWhen('2026-11-26T10:00:00+05:30', now), /^26 Nov$/);
  assert.match(shortWhen('2025-03-02T10:00:00+05:30', now), /^2 Mar 2025$/);
  assert.strictEqual(shortWhen('not a date', now), '');
  assert.deepStrictEqual(changedBy({ last_changed_by: 'Priya' }, now), { name: 'Priya', when: '' });
  assert.strictEqual(noteCountLabel(0), '');
  assert.strictEqual(noteCountLabel(undefined), '');
  assert.strictEqual(noteCountLabel(1), '1 note');
  assert.strictEqual(noteCountLabel(4), '4 notes');
});
