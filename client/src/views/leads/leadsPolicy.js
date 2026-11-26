// Pure helpers for the Leads page (views/LeadsView.jsx). Source kinds match
// server/services/leadSources.js.

export const PAGE_SIZE = 20;

export const SOURCE_LABELS = {
  whatsapp: 'WhatsApp',
  whatsapp_ad: 'WhatsApp ad',
  import: 'Import',
  manual: 'Manual',
  facebook: 'Facebook lead form',
};

// Badge colour (components/ui/badge variants) for each source kind.
export const SOURCE_VARIANT = {
  whatsapp: 'success',
  whatsapp_ad: 'purple',
  import: 'info',
  manual: 'muted',
  facebook: 'info',
};

export const STATUS_OPTIONS = [
  { value: 'new', label: 'New', variant: 'info' },
  { value: 'hot', label: 'Hot', variant: 'danger' },
  { value: 'warm', label: 'Warm', variant: 'warning' },
  { value: 'cold', label: 'Cold', variant: 'muted' },
  { value: 'converted', label: 'Converted', variant: 'success' },
  { value: 'lost', label: 'Lost', variant: 'muted' },
];

// Sources a person can pick in Add lead.
export const ADD_LEAD_SOURCES = [
  { value: 'manual', label: 'Manual' },
  { value: 'whatsapp', label: 'WhatsApp' },
];

/**
 * Source filter buttons. "Facebook lead form" shows only when the workspace
 * has such leads (`counts` from GET /api/leads/source-summary).
 */
export function sourceFilters(counts = {}) {
  const kinds = ['whatsapp', 'whatsapp_ad', 'import', 'manual'];
  if (Number(counts.facebook) > 0) kinds.push('facebook');
  const known = Object.keys(counts).length > 0;
  const total = kinds.reduce((sum, kind) => sum + (Number(counts[kind]) || 0), 0);
  return [
    { value: 'all', label: 'All', count: known ? total : null },
    ...kinds.map((kind) => ({ value: kind, label: SOURCE_LABELS[kind], count: known ? Number(counts[kind]) || 0 : null })),
  ];
}

/** The kind a lead row came back with, or a safe guess for older servers. */
export function leadSourceKind(lead) {
  if (lead?.source_kind && SOURCE_LABELS[lead.source_kind]) return lead.source_kind;
  const source = String(lead?.source || '');
  if (lead?.ad_id && !lead?.leadgen_id && !lead?.meta_lead_id && !lead?.lead_ad_form_id) return 'whatsapp_ad';
  if (lead?.leadgen_id || lead?.meta_lead_id || /(facebook|instagram|meta[_ ]?ads)/i.test(source)) return 'facebook';
  if (/whatsapp/i.test(source)) return 'whatsapp';
  if (/^\s*((xls|xlsx|excel|csv)(\s+(sheet|import|upload))?|import(ed)?|csv_.*)\s*$/i.test(source)) return 'import';
  return 'manual';
}

export function statusInfo(status) {
  const value = String(status || '').trim().toLowerCase();
  const found = STATUS_OPTIONS.find((option) => option.value === value);
  if (found) return found;
  if (!value) return STATUS_OPTIONS.find((option) => option.value === 'cold');
  return { value, label: value.charAt(0).toUpperCase() + value.slice(1), variant: 'muted' };
}

/** "Showing 21–40 of 95" numbers and page count, from the server's total. */
export function pageInfo(total, page, size = PAGE_SIZE) {
  const count = Math.max(0, Number(total) || 0);
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, page), pages);
  const from = count === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, count);
  return { total: count, pages, page: current, from, to, hasPrev: current > 1, hasNext: current < pages };
}

/** Short text for the last message of a lead (row.last_msg from the server). */
export function lastMessageText(lead) {
  const message = lead?.last_msg;
  if (!message) return '';
  if (message.is_deleted) return 'Message deleted';
  const text = String(message.content || '').trim();
  if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text;
  const kinds = { image: 'Photo', video: 'Video', audio: 'Voice message', voice: 'Voice message', document: 'Document', sticker: 'Sticker', template: 'Template message', location: 'Location' };
  return kinds[String(message.msg_type || '').toLowerCase()] || (message.media_url ? 'Attachment' : '');
}

/** "5 min ago", "3 h ago", "Yesterday", else a short date. */
export function timeAgo(value, now = Date.now()) {
  if (!value) return '';
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return '';
  const minutes = Math.round((now - at) / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return shortDate(value);
}

export function shortDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Select or clear every row of the current page. */
export function toggleAll(selected, pageIds) {
  const next = new Set(selected);
  const allOn = pageIds.length > 0 && pageIds.every((id) => next.has(id));
  for (const id of pageIds) {
    if (allOn) next.delete(id); else next.add(id);
  }
  return next;
}

export function toggleOne(selected, id) {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}

/** One row per lead id (the list can briefly hold a row twice while paging). */
export function uniqueLeads(leads) {
  return Array.from(new Map((leads || []).map((lead) => [lead.id, lead])).values());
}

// Columns of the sample sheet; the server reads these names
// (server/routes/leados/leads-import.js).
export const IMPORT_COLUMNS = ['Name', 'Phone', 'Country Code', 'Email', 'Status', 'Interest', 'Assigned'];

export function importSampleCsv() {
  const sample = ['Rahul Sharma', '9876543210', '91', 'rahul@example.com', 'new', 'Web Development', ''];
  return [IMPORT_COLUMNS.join(','), sample.join(',')].join('\n');
}

/** One line about an import result (POST /api/leads/import). */
export function importSummary(result = {}) {
  const parts = [];
  const added = Number(result.inserted ?? result.imported) || 0;
  if (added) parts.push(`${added} new`);
  if (Number(result.existing)) parts.push(`${result.existing} already in your leads (updated)`);
  if (Number(result.duplicate_rows)) parts.push(`${result.duplicate_rows} repeated in the file (skipped)`);
  if (Number(result.failed)) parts.push(`${result.failed} could not be added`);
  return parts.length ? parts.join(', ') : 'No rows found in the file';
}

// Same rule as the server (services/permissions.js: leads.export and
// leads.delete). Agents can see, add, import and assign leads.
export function leadPermissions(role) {
  const value = String(role || '').toLowerCase();
  const allowed = ['owner', 'admin', 'manager', 'platform_staff'].includes(value);
  return { canExport: allowed, canDelete: allowed };
}

const leadCount = (count) => `${Number(count) || 0} lead${Number(count) === 1 ? '' : 's'}`;

// The question asked before a bulk change is sent to the server, with the
// number of leads it touches: { title, description, actionLabel }.
// action: 'assign' (assigneeName, or none to unassign) | 'status' (statusLabel).
export function bulkLeadConfirm({ action, count, assigneeName, statusLabel }) {
  const leads = leadCount(count);
  if (action === 'assign') {
    return assigneeName
      ? { title: `Assign ${leads} to ${assigneeName}?`, description: `${assigneeName} becomes the owner of the ${leads} you selected.`, actionLabel: `Assign ${leads}` }
      : { title: `Unassign ${leads}?`, description: `The ${leads} you selected will have no one assigned.`, actionLabel: `Unassign ${leads}` };
  }
  if (action === 'status') {
    return { title: `Change ${leads} to ${statusLabel}?`, description: `The status of the ${leads} you selected becomes ${statusLabel}.`, actionLabel: `Set ${leads} to ${statusLabel}` };
  }
  return { title: `Update ${leads}?`, description: '', actionLabel: `Update ${leads}` };
}

// The export dialog's download button states how many leads it exports.
export function exportButtonLabel(count) {
  return count == null ? 'Download CSV' : `Export ${Number(count).toLocaleString('en-IN')} lead${Number(count) === 1 ? '' : 's'}`;
}
