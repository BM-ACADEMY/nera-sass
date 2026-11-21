/** Invoice numbering rules. Pure: no database, so they can be tested alone. */

/** 12 Sep 2026 -> '26-27'; 5 Feb 2027 -> '26-27'. India's financial year runs April to March (IST). */
function financialYear(date) {
  const ist = new Date(new Date(date).getTime() + 330 * 60000);
  const year = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(start).slice(-2)}-${String(start + 1).slice(-2)}`;
}

/**
 * The next number of a series: one more than the highest already issued for
 * this prefix and financial year. Worked out from the invoices that exist, not
 * from a counter, so a failed issue never uses up a number (GST needs an
 * unbroken series).
 */
function nextSequence(invoiceNumbers, prefix, fy) {
  const head = `${prefix}/${fy}/`;
  let max = 0;
  for (const number of invoiceNumbers) {
    if (!String(number).startsWith(head)) continue;
    const n = Number(String(number).slice(head.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}

const GST_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** True when the 15th character of a GSTIN is the right check character for the first 14. */
function gstinChecksumOk(gstin) {
  const value = String(gstin || '').toUpperCase();
  if (value.length !== 15) return false;
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const code = GST_CHARS.indexOf(value[i]);
    if (code < 0) return false;
    const product = code * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GST_CHARS[(36 - (sum % 36)) % 36] === value[14];
}

module.exports = { financialYear, nextSequence, gstinChecksumOk };
