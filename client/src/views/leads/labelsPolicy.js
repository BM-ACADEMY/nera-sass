// Pure helpers for lead labels (views/leads/labels/*). Colours and rules match
// server/services/leadLabels.js.

export const LABEL_NAME_MAX = 40;

// The 8 palette colours. Class names are written out in full so Tailwind
// keeps them.
export const LABEL_COLORS = [
  { key: 'slate', name: 'Grey', hex: '#64748b', chip: 'border-slate-200 bg-slate-100 text-slate-700', dot: 'bg-slate-500' },
  { key: 'red', name: 'Red', hex: '#ef4444', chip: 'border-red-200 bg-red-50 text-red-700', dot: 'bg-red-500' },
  { key: 'orange', name: 'Orange', hex: '#f97316', chip: 'border-orange-200 bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  { key: 'amber', name: 'Yellow', hex: '#f59e0b', chip: 'border-amber-200 bg-amber-50 text-amber-800', dot: 'bg-amber-500' },
  { key: 'green', name: 'Green', hex: '#22c55e', chip: 'border-green-200 bg-green-50 text-green-700', dot: 'bg-green-500' },
  { key: 'teal', name: 'Teal', hex: '#14b8a6', chip: 'border-teal-200 bg-teal-50 text-teal-700', dot: 'bg-teal-500' },
  { key: 'blue', name: 'Blue', hex: '#3b82f6', chip: 'border-blue-200 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  { key: 'violet', name: 'Violet', hex: '#8b5cf6', chip: 'border-violet-200 bg-violet-50 text-violet-700', dot: 'bg-violet-500' },
];
export const DEFAULT_LABEL_COLOR = 'slate';

/** Palette entry for a colour key (unknown keys get grey). */
export function labelColor(key) {
  return LABEL_COLORS.find((color) => color.key === key) || LABEL_COLORS[0];
}

/** The palette key nearest to a CSS hex colour (the inbox picks hex colours). */
export function nearestLabelColor(hex) {
  const value = String(hex || '').trim().toLowerCase();
  if (LABEL_COLORS.some((color) => color.key === value)) return value;
  const match = /^#?([0-9a-f]{6})$/.exec(value);
  if (!match) return DEFAULT_LABEL_COLOR;
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(match[1]);
  let best = DEFAULT_LABEL_COLOR;
  let bestDistance = Infinity;
  for (const color of LABEL_COLORS) {
    const [r2, g2, b2] = rgb(color.hex.slice(1));
    const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (distance < bestDistance) { best = color.key; bestDistance = distance; }
  }
  return best;
}

/** Trimmed name with single spaces. */
export const cleanLabelName = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

/**
 * The problem with a label name, or '' when it is fine. `labels` are the
 * workspace's labels; `exceptId` is the label being renamed.
 */
export function labelNameError(value, labels = [], exceptId = null) {
  const name = cleanLabelName(value);
  if (!name) return 'Enter a label name.';
  if (name.length > LABEL_NAME_MAX) return `A label name can be up to ${LABEL_NAME_MAX} characters.`;
  const key = name.toLowerCase();
  if (labels.some((label) => label.id !== exceptId && cleanLabelName(label.name).toLowerCase() === key)) return `A label called "${name}" already exists.`;
  return '';
}

/** Adds or removes one label id from a list of ids. */
export function toggleLabelId(ids, id) {
  const list = (ids || []).map(Number);
  const value = Number(id);
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/** Labels sorted by name, optionally only those whose name contains `query`. */
export function filterLabels(labels, query = '') {
  const term = cleanLabelName(query).toLowerCase();
  return [...(labels || [])]
    .filter((label) => !term || String(label.name).toLowerCase().includes(term))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Same rule as the server (services/permissions.js labels.manage): owners and
// admins create, rename, recolour and delete labels; every member labels leads.
export function labelPermissions(role) {
  const value = String(role || '').toLowerCase();
  return { canManage: ['owner', 'admin', 'platform_staff'].includes(value), canLabel: true };
}

export const leadCountText = (count) => `${Number(count) || 0} lead${Number(count) === 1 ? '' : 's'}`;
