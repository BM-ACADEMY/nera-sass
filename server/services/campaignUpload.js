/**
 * Custom contact lists for a campaign (CSV or Excel).
 *
 * parseList() reads the file and checks every row without writing anything, so
 * the owner sees "48 contacts ready, 2 rows skipped: row 5 phone missing"
 * before choosing to send. saveList() stores the ready rows as an upload batch
 * (campaign_import_recipients, batch id "csv_...") that the campaign audience
 * reads. Row numbers are the sheet's own row numbers (the heading is row 1).
 *
 * Columns (any case): phone (with country code), name (optional),
 * whatsapp_opt_in (optional yes/no) and, when the template takes values from
 * the sheet, "Body {{n}}" / "Header {{n}}".
 */
const xlsx = require('xlsx');
const { Leads, CampaignImportRecipients } = require('../models');
const consent = require('./consent');

const MAX_ROWS = 10000;
const SKIPPED_SHOWN = 50;
const PHONE_COLUMNS = ['phone', 'phone number', 'phone_number', 'mobile', 'mobile number', 'whatsapp', 'whatsapp number', 'number'];
const NAME_COLUMNS = ['name', 'full name', 'first name', 'contact name'];
const OPT_IN_COLUMNS = ['whatsapp_opt_in', 'whatsapp opt-in', 'whatsapp opt in', 'opt_in', 'opt in', 'opt-in', 'consent'];
const OPT_IN_YES = new Set(['yes', 'y', 'true', '1', 'opted in', 'opted_in', 'opt in', 'opt-in', 'ஆம்']);

class ListError extends Error {
  constructor(message) { super(message); this.code = 'LIST_INVALID'; }
}

const clean = (value) => String(value ?? '').trim();
const key = (value) => clean(value).toLowerCase().replace(/\s+/g, ' ');

/** "Body {{2}} - Offer" -> { section: 'body', number: '2' } */
const variableColumn = (column) => {
  const match = clean(column).match(/^(Header|Body)\s*\{\{\s*(\d+)\s*\}\}(?:\s*-.*)?$/i);
  return match ? { section: match[1].toLowerCase(), number: match[2] } : null;
};

/** Variables the sheet must fill: mappings with source "excel_parameter". */
function sheetVariables(mappings = {}) {
  const out = [];
  for (const section of ['header', 'body']) {
    for (const [number, mapping] of Object.entries(mappings?.[section] || {})) {
      if (mapping?.source === 'excel_parameter') out.push({ section, number: String(number) });
    }
  }
  return out.sort((a, b) => (a.section === b.section ? Number(a.number) - Number(b.number) : a.section === 'header' ? -1 : 1));
}

const columnLabel = ({ section, number }) => `${section === 'header' ? 'Header' : 'Body'} {{${number}}}`;

/** The columns of the sample file for a template's mappings. */
function sampleColumns(mappings = {}) {
  return ['phone', 'name', 'whatsapp_opt_in', ...sheetVariables(mappings).map(columnLabel)];
}

/** A sample workbook (xlsx buffer) with the phone column stored as text. */
function sampleWorkbook(mappings = {}) {
  const columns = sampleColumns(mappings);
  const examples = [
    ['919876543210', 'Priya', 'yes'],
    ['14155550123', 'John', 'yes'],
  ].map((row) => [...row, ...columns.slice(3).map((c) => `Value for ${c}`)]);
  const sheet = xlsx.utils.aoa_to_sheet([columns, ...examples]);
  for (let r = 1; r <= examples.length; r += 1) {
    const cell = sheet[xlsx.utils.encode_cell({ r, c: 0 })];
    if (cell) { cell.t = 's'; cell.z = '@'; }
  }
  sheet['!cols'] = columns.map((c) => ({ wch: Math.max(16, c.length + 4) }));
  const notes = xlsx.utils.aoa_to_sheet([
    ['How to fill this sheet'],
    ['phone: the WhatsApp number with country code, digits only (91 for India). Example: 919876543210'],
    ['name: optional. Used where the message says the contact\'s name.'],
    ['whatsapp_opt_in: write yes only if this person agreed to get WhatsApp offers from you. Marketing messages go only to people who agreed.'],
    ...columns.slice(3).map((c) => [`${c}: the value for ${c} in the message, for this contact. Required.`]),
    ['Keep the column names in row 1 unchanged. One contact per row.'],
  ]);
  const book = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(book, sheet, 'Contacts');
  xlsx.utils.book_append_sheet(book, notes, 'How to fill');
  return xlsx.write(book, { type: 'buffer', bookType: 'xlsx' });
}

/** Phone cell -> { phone, problem, addedCountryCode }. */
function normalisePhone(raw) {
  let text = typeof raw === 'number' ? (Number.isSafeInteger(raw) ? String(raw) : raw.toExponential()) : clean(raw);
  text = text.replace(/^=/, '').replace(/"/g, '').trim();
  if (!text) return { problem: 'phone missing' };
  if (/^\d+(?:\.\d+)?e\+?\d+$/i.test(text)) return { problem: 'phone was changed by Excel into a short form (like 9.19E+11). Format the phone column as Text and type it again' };
  let digits = text.replace(/\D/g, '');
  let addedCountryCode = false;
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10 && /^[6-9]/.test(digits)) { digits = `91${digits}`; addedCountryCode = true; }
  if (digits.length < 11) return { problem: 'phone is too short. Add the country code (for example 91 for India)' };
  if (digits.length > 15) return { problem: 'phone is too long' };
  return { phone: digits, addedCountryCode };
}

/** Reads a CSV/XLSX buffer into { headers, rows } (rows keep their sheet row number). */
function readSheet(buffer, filename = '') {
  const isCsv = /\.csv$/i.test(filename);
  let book;
  try {
    book = isCsv
      ? xlsx.read(buffer.toString('utf8').replace(/^﻿/, ''), { type: 'string', raw: true })
      : xlsx.read(buffer, { type: 'buffer' });
  } catch {
    throw new ListError('We could not read this file. Save it as .xlsx or .csv and try again.');
  }
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) throw new ListError('The file is empty.');
  const grid = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true });
  const headers = (grid[0] || []).map(clean);
  const rows = [];
  for (let i = 1; i < grid.length; i += 1) {
    const cells = grid[i] || [];
    if (cells.every((cell) => clean(cell) === '')) continue;
    rows.push({ rowNumber: i + 1, cells });
  }
  return { headers, rows };
}

/**
 * Checks a list. Returns { contacts, skipped, summary } where contacts are the
 * ready rows: { row, phone, name, opted_in, template_parameters }.
 */
function parseList(buffer, filename, { mappings = {} } = {}) {
  if (!/\.(csv|xlsx|xls)$/i.test(filename || '')) throw new ListError('Upload a .csv or .xlsx file.');
  const { headers, rows } = readSheet(buffer, filename);
  const index = (names) => headers.findIndex((h) => names.includes(key(h)));
  const phoneAt = index(PHONE_COLUMNS);
  if (phoneAt === -1) throw new ListError('We could not find a "phone" column. Download the sample file and keep its column names in the first row.');
  if (!rows.length) throw new ListError('The file has no contacts. Add one contact per row under the column names.');
  if (rows.length > MAX_ROWS) throw new ListError(`A list can have up to ${MAX_ROWS.toLocaleString('en-IN')} contacts. Split the file and send it as two campaigns.`);
  const nameAt = index(NAME_COLUMNS);
  const optInAt = index(OPT_IN_COLUMNS);
  const variableAt = new Map();
  headers.forEach((h, i) => { const v = variableColumn(h); if (v) variableAt.set(`${v.section}:${v.number}`, i); });
  const required = sheetVariables(mappings);
  const missing = required.filter((v) => !variableAt.has(`${v.section}:${v.number}`));
  if (missing.length) {
    throw new ListError(`The file needs a column for ${missing.map(columnLabel).join(', ')}. Download the sample file for this template.`);
  }

  const contacts = [];
  const skipped = [];
  const firstRowOf = new Map();
  let addedCountryCode = 0;
  for (const { rowNumber, cells } of rows) {
    const { phone, problem, addedCountryCode: added } = normalisePhone(cells[phoneAt]);
    if (problem) { skipped.push({ row: rowNumber, reason: problem }); continue; }
    const tail = phone.slice(-10);
    if (firstRowOf.has(tail)) { skipped.push({ row: rowNumber, reason: `same phone as row ${firstRowOf.get(tail)}` }); continue; }
    const empty = required.find((v) => clean(cells[variableAt.get(`${v.section}:${v.number}`)]) === '');
    if (empty) { skipped.push({ row: rowNumber, reason: `${columnLabel(empty)} is empty` }); continue; }
    firstRowOf.set(tail, rowNumber);
    if (added) addedCountryCode += 1;
    const templateParameters = { header: {}, body: {} };
    for (const [k, i] of variableAt) {
      const [section, number] = k.split(':');
      templateParameters[section][number] = clean(cells[i]);
    }
    contacts.push({
      row: rowNumber, phone, name: nameAt === -1 ? '' : clean(cells[nameAt]),
      opted_in: optInAt !== -1 && OPT_IN_YES.has(key(cells[optInAt])), template_parameters: templateParameters,
    });
  }
  return {
    contacts,
    skipped,
    summary: {
      rows: rows.length, ready: contacts.length, skipped_count: skipped.length, skipped: skipped.slice(0, SKIPPED_SHOWN),
      added_country_code: addedCountryCode, opted_in: contacts.filter((c) => c.opted_in).length,
      has_opt_in_column: optInAt !== -1,
    },
  };
}

const tailRegex = (digits) => new RegExp(`${digits.slice(-10)}$`);

/**
 * Stores the ready contacts as a new batch inside the current tenant. New
 * numbers become contacts of the brand; existing contacts are only linked (a
 * campaign list never changes their CRM fields). A "yes" in the opt-in column
 * records consent with the file name as its source.
 */
async function saveList(contacts, { clientId, filename = 'a sheet', by = null, now = new Date() } = {}) {
  const batchId = `csv_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
  let created = 0;
  let existing = 0;
  for (const contact of contacts) {
    let lead = await Leads.findOne({ phone: tailRegex(contact.phone) }, { _id: 0, id: 1, opted_out: 1, whatsapp_opt_out: 1 }).lean();
    if (lead) existing += 1;
    else {
      lead = (await Leads.create({ client_id: clientId, name: contact.name || 'Unknown', phone: contact.phone, status: 'new', source: 'Campaign upload', created_at: now })).toObject();
      created += 1;
    }
    // A "yes" in a sheet never overrides a STOP the contact sent us.
    if (contact.opted_in && !consent.optedOut(lead, await consent.getConsent({ phone: contact.phone }))) {
      await consent.recordOptIn({ leadId: lead.id, phone: contact.phone, source: 'import', text: `Marked as opted in on ${filename}`, by })
        .catch((err) => console.error(`[campaign upload] consent not recorded for lead ${lead.id}:`, err.message));
    }
    await CampaignImportRecipients.updateOne(
      { batch_id: batchId, lead_id: lead.id },
      { $set: { template_parameters: contact.template_parameters }, $setOnInsert: { created_at: new Date(now.getTime() + contact.row) } },
      { upsert: true },
    );
  }
  return { batch_id: batchId, created, existing };
}

module.exports = { MAX_ROWS, ListError, sheetVariables, sampleColumns, sampleWorkbook, normalisePhone, parseList, saveList };
