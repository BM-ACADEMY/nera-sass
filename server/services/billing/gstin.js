/** GSTIN rules. Pure: no database, so they can be tested alone. */

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

module.exports = { gstinChecksumOk };
