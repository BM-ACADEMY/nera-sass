/**
 * Lead labels: coloured names a workspace puts on its leads (Leads page,
 * inbox, sales tasks, campaign audiences).
 *
 * lead_labels and lead_label_links are tenant-scoped (db/tenantScope.js), so
 * every function here only ever reads or writes the caller's workspace: a
 * label or lead of another workspace is simply not found. Call these inside a
 * tenant context (an authenticated request) only.
 *
 * Replaces the old lead "tags", which pointed at alliance_inbox_tags, a table
 * shared by every workspace (migrations/043_lead_labels.js copies them over).
 */
const { Labels, LeadLabelLinks, Leads } = require('../models');

// Fixed palette: key -> { hex, name }. The client has the same list
// (client/src/views/leads/labels/labelColors.js).
const PALETTE = Object.freeze({
  slate: '#64748b',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  green: '#22c55e',
  teal: '#14b8a6',
  blue: '#3b82f6',
  violet: '#8b5cf6',
});
const COLORS = Object.keys(PALETTE);
const DEFAULT_COLOR = 'slate';
const NAME_MAX = 40;

class LabelError extends Error {
  constructor(message, status = 400, code = 'LABEL_INVALID') { super(message); this.status = status; this.code = code; }
}

const hexOf = (color) => PALETTE[color] || PALETTE[DEFAULT_COLOR];

// The palette key closest to a CSS hex colour (old tags had free hex colours).
function nearestColor(hex) {
  const value = String(hex || '').trim().toLowerCase();
  if (COLORS.includes(value)) return value;
  const match = /^#?([0-9a-f]{6})$/.exec(value);
  if (!match) return DEFAULT_COLOR;
  const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [r, g, b] = rgb(match[1]);
  let best = DEFAULT_COLOR;
  let bestDistance = Infinity;
  for (const key of COLORS) {
    const [r2, g2, b2] = rgb(PALETTE[key].slice(1));
    const distance = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (distance < bestDistance) { best = key; bestDistance = distance; }
  }
  return best;
}

// Trims and collapses spaces; 1-40 characters.
function cleanName(value) {
  if (typeof value !== 'string') throw new LabelError('Enter a label name.');
  const name = value.replace(/\s+/g, ' ').trim();
  if (!name) throw new LabelError('Enter a label name.');
  if (name.length > NAME_MAX) throw new LabelError(`A label name can be up to ${NAME_MAX} characters.`);
  return name;
}
const nameKey = (name) => name.toLowerCase();

function cleanColor(value, fallback = DEFAULT_COLOR) {
  if (value === undefined || value === null || value === '') return fallback;
  const color = String(value).trim().toLowerCase();
  if (!COLORS.includes(color)) throw new LabelError(`Choose a colour from the list (${COLORS.join(', ')}).`);
  return color;
}

// A positive integer id from a route parameter or body, else null.
function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const present = (label) => ({ id: label.id, name: label.name, color: label.color || DEFAULT_COLOR });

/** This workspace's labels by name, each with how many leads carry it. */
async function list() {
  const labels = await Labels.find({}, { _id: 0, id: 1, name: 1, color: 1, created_at: 1 }).sort({ name_key: 1 }).lean();
  const counts = await leadCounts();
  return labels.map((label) => ({ ...present(label), created_at: label.created_at, lead_count: counts.get(label.id) || 0 }));
}

// label id -> number of this workspace's existing leads carrying it. Leads of
// a brand only when clientId is given.
async function leadCounts(clientId = null) {
  if (clientId == null || clientId === '') {
    const rows = await LeadLabelLinks.aggregate([{ $group: { _id: '$label_id', count: { $sum: 1 } } }]);
    return new Map(rows.map((row) => [row._id, row.count]));
  }
  const links = await LeadLabelLinks.find({}, { _id: 0, lead_id: 1, label_id: 1 }).lean();
  const brandLeads = new Set(await Leads.distinct('id', { client_id: Number(clientId), id: { $in: [...new Set(links.map((l) => l.lead_id))] } }));
  const counts = new Map();
  for (const link of links) if (brandLeads.has(link.lead_id)) counts.set(link.label_id, (counts.get(link.label_id) || 0) + 1);
  return counts;
}

async function find(id) {
  const labelId = toId(id);
  if (!labelId) return null;
  return Labels.findOne({ id: labelId }, { _id: 0 }).lean();
}

async function create({ name, color, userId = null }) {
  const clean = cleanName(name);
  const doc = { name: clean, name_key: nameKey(clean), color: cleanColor(color), created_by: userId, created_at: new Date(), updated_at: new Date() };
  if (await Labels.exists({ name_key: doc.name_key })) throw new LabelError(`A label called "${clean}" already exists.`, 409, 'LABEL_EXISTS');
  try {
    return present((await Labels.create(doc)).toObject());
  } catch (error) {
    if (error.code === 11000) throw new LabelError(`A label called "${clean}" already exists.`, 409, 'LABEL_EXISTS');
    throw error;
  }
}

/** Rename and/or recolour. Returns { before, after } or null when not found. */
async function update(id, { name, color }) {
  const before = await find(id);
  if (!before) return null;
  const set = { updated_at: new Date() };
  if (name !== undefined) {
    set.name = cleanName(name);
    set.name_key = nameKey(set.name);
    if (set.name_key !== before.name_key && await Labels.exists({ name_key: set.name_key, id: { $ne: before.id } })) {
      throw new LabelError(`A label called "${set.name}" already exists.`, 409, 'LABEL_EXISTS');
    }
  }
  if (color !== undefined) set.color = cleanColor(color);
  if (name === undefined && color === undefined) throw new LabelError('Nothing to change.');
  try {
    const after = await Labels.findOneAndUpdate({ id: before.id }, { $set: set }, { new: true, projection: { _id: 0 } }).lean();
    return after ? { before: present(before), after: present(after) } : null;
  } catch (error) {
    if (error.code === 11000) throw new LabelError(`A label called "${set.name}" already exists.`, 409, 'LABEL_EXISTS');
    throw error;
  }
}

/** Deletes a label and takes it off every lead. Null when not found. */
async function remove(id) {
  const label = await find(id);
  if (!label) return null;
  const removedLinks = (await LeadLabelLinks.deleteMany({ label_id: label.id })).deletedCount || 0;
  await Labels.deleteOne({ id: label.id });
  return { label: present(label), removed_links: removedLinks };
}

/**
 * The lead and the label, both of this workspace, or a 404 LabelError.
 * Lead visibility follows the rest of the Leads page: every member of the
 * workspace sees every lead of it (there is no per-assignee restriction).
 */
async function resolvePair(leadIdValue, labelIdValue) {
  const leadId = toId(leadIdValue);
  const lead = leadId ? await Leads.findOne({ id: leadId }, { _id: 0, id: 1, name: 1 }).lean() : null;
  if (!lead) throw new LabelError('Lead not found', 404, 'NOT_FOUND');
  const label = await find(labelIdValue);
  if (!label) throw new LabelError('Label not found', 404, 'NOT_FOUND');
  return { lead, label: present(label) };
}

/** Puts a label on a lead. { lead, label, added } (added false when it was already there). */
async function attach(leadIdValue, labelIdValue, userId = null) {
  const { lead, label } = await resolvePair(leadIdValue, labelIdValue);
  if (await LeadLabelLinks.exists({ lead_id: lead.id, label_id: label.id })) return { lead, label, added: false };
  try {
    await LeadLabelLinks.create({ lead_id: lead.id, label_id: label.id, added_by: userId, added_at: new Date() });
  } catch (error) {
    if (error.code === 11000) return { lead, label, added: false };
    throw error;
  }
  return { lead, label, added: true };
}

/** Takes a label off a lead. { lead, label, removed }. */
async function detach(leadIdValue, labelIdValue) {
  const { lead, label } = await resolvePair(leadIdValue, labelIdValue);
  const removed = (await LeadLabelLinks.deleteMany({ lead_id: lead.id, label_id: label.id })).deletedCount || 0;
  return { lead, label, removed: removed > 0 };
}

/**
 * Sets the exact labels of a lead. Every id must be a label of this
 * workspace (else 404). Returns { lead, added: [label], removed: [label], labels }.
 */
async function setForLead(leadIdValue, labelIds, userId = null) {
  if (!Array.isArray(labelIds)) throw new LabelError('label_ids must be a list.');
  const ids = [...new Set(labelIds.map(toId))];
  if (ids.some((id) => id == null)) throw new LabelError('Unknown label.');
  if (ids.length > 100) throw new LabelError('A lead can have up to 100 labels.');
  const leadId = toId(leadIdValue);
  const lead = leadId ? await Leads.findOne({ id: leadId }, { _id: 0, id: 1, name: 1 }).lean() : null;
  if (!lead) throw new LabelError('Lead not found', 404, 'NOT_FOUND');
  const wanted = ids.length ? await Labels.find({ id: { $in: ids } }, { _id: 0 }).lean() : [];
  if (wanted.length !== ids.length) throw new LabelError('Label not found', 404, 'NOT_FOUND');
  const current = new Set((await LeadLabelLinks.find({ lead_id: lead.id }, { _id: 0, label_id: 1 }).lean()).map((l) => l.label_id));
  const toAdd = wanted.filter((label) => !current.has(label.id));
  const toRemove = [...current].filter((id) => !ids.includes(id));
  for (const label of toAdd) {
    try {
      await LeadLabelLinks.create({ lead_id: lead.id, label_id: label.id, added_by: userId, added_at: new Date() });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
  }
  const removedLabels = toRemove.length ? await Labels.find({ id: { $in: toRemove } }, { _id: 0 }).lean() : [];
  if (toRemove.length) await LeadLabelLinks.deleteMany({ lead_id: lead.id, label_id: { $in: toRemove } });
  const labels = (await labelsForLeads([lead.id])).get(lead.id) || [];
  return { lead, added: toAdd.map(present), removed: removedLabels.map(present), labels };
}

/** lead id -> [{ id, name, color }] sorted by name, in two queries. */
async function labelsForLeads(leadIds) {
  const ids = [...new Set((leadIds || []).map(Number).filter(Number.isFinite))];
  const out = new Map();
  if (!ids.length) return out;
  const links = await LeadLabelLinks.find({ lead_id: { $in: ids } }, { _id: 0, lead_id: 1, label_id: 1 }).lean();
  if (!links.length) return out;
  const labels = new Map((await Labels.find({ id: { $in: [...new Set(links.map((l) => l.label_id))] } }, { _id: 0, id: 1, name: 1, color: 1 }).lean())
    .map((label) => [label.id, present(label)]));
  for (const link of links) {
    const label = labels.get(link.label_id);
    if (!label) continue;
    if (!out.has(link.lead_id)) out.set(link.lead_id, []);
    out.get(link.lead_id).push(label);
  }
  for (const list of out.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

// The older "tags" shape of a row's labels: CSS colour instead of the key.
const asTags = (labels) => (labels || []).map((label) => ({ id: label.id, name: label.name, color: hexOf(label.color) }));

/** Lead ids carrying a label (empty when the label is not this workspace's). */
async function leadIdsWith(labelIdValue) {
  const labelId = toId(labelIdValue);
  if (!labelId) return [];
  return LeadLabelLinks.distinct('lead_id', { label_id: labelId });
}

module.exports = {
  PALETTE, COLORS, DEFAULT_COLOR, NAME_MAX, LabelError,
  hexOf, nearestColor, cleanName, cleanColor, toId,
  list, leadCounts, find, create, update, remove, attach, detach, setForLead, labelsForLeads, asTags, leadIdsWith,
};
