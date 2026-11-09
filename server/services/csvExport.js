/**
 * CSV writing for customer data exports.
 * Every cell is quoted. A text cell that a spreadsheet would run as a formula
 * (starts with = + - @, tab or carriage return) gets a leading apostrophe, so
 * a customer's message cannot execute in the business's Excel.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function csvCell(value) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const csvLine = (values) => `${values.map(csvCell).join(',')}\r\n`;

const BOM = '﻿';

/** Starts a CSV download: headers plus the column row. Call before writing rows. */
function startCsv(res, filename, columns) {
  res.status(200);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${String(filename).replace(/[^A-Za-z0-9._-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.write(BOM + csvLine(columns));
}

async function writeRows(res, rows) {
  for (const row of rows) {
    if (!res.write(csvLine(row))) await new Promise((resolve) => res.once('drain', resolve));
  }
}

module.exports = { csvCell, csvLine, startCsv, writeRows };
