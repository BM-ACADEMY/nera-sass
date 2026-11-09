/**
 * A very small PDF writer for invoices (N7): one A4 page, the two standard
 * Helvetica fonts (no embedding, no dependency), text lines and rules. It
 * writes plain, uncompressed content streams, so a test can read the text
 * straight out of the file. Characters outside Latin-1 become '?', which is
 * why amounts are written as "Rs." rather than the rupee sign.
 */
const PAGE = { width: 595.28, height: 841.89 };

const escapeText = (value) => String(value ?? '')
  .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
  .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

/**
 * ops: [{ text, x, y, size?, bold? }] or [{ line: [x1, y1, x2, y2], width? }]
 * y is measured from the top of the page, in points.
 */
function render(ops) {
  const parts = [];
  for (const op of ops) {
    if (op.line) {
      const [x1, y1, x2, y2] = op.line;
      parts.push(`${(op.width || 0.6).toFixed(2)} w ${x1.toFixed(2)} ${(PAGE.height - y1).toFixed(2)} m ${x2.toFixed(2)} ${(PAGE.height - y2).toFixed(2)} l S`);
    } else {
      parts.push(`BT /${op.bold ? 'F2' : 'F1'} ${(op.size || 10).toFixed(1)} Tf ${op.x.toFixed(2)} ${(PAGE.height - op.y).toFixed(2)} Td (${escapeText(op.text)}) Tj ET`);
    }
  }
  const content = parts.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width} ${PAGE.height}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Rough width of Helvetica text, for right-aligned columns. */
const textWidth = (text, size = 10) => String(text ?? '').length * size * 0.52;

module.exports = { PAGE, render, textWidth, escapeText };
