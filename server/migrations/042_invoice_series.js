/**
 * Invoice follow-up: gap-free numbering. Invoices now carry `series`
 * (AV/26-27) and `seq` (1, 2, 3 ...), and the next number is read from the
 * rows themselves instead of a counter. This fills series and seq on invoices
 * issued before (parsed from invoice_number) and adds the unique
 * (series, seq) index. Safe to run again: rows that have seq are left alone.
 *
 * Run by hand against the target database, never automatically:
 *   MONGODB_URI=mongodb://... node migrations/042_invoice_series.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const NUMBER_RE = /^(.+\/\d{2}-\d{2})\/(\d+)$/;

async function run() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const models = require('../models');
  await connectMongo();
  // The raw collection: this runs outside any tenant context.
  const invoices = models.Invoices.collection;
  const rows = await invoices.find({ invoice_number: { $type: 'string' }, seq: { $not: { $type: 'number' } } }, { projection: { _id: 1, invoice_number: 1 } }).toArray();
  let filled = 0;
  for (const row of rows) {
    const match = NUMBER_RE.exec(row.invoice_number);
    if (!match) {
      console.warn(`[042] ${row.invoice_number}: not in PREFIX/YY-YY/NNNN form, left as is`);
      continue;
    }
    await invoices.updateOne({ _id: row._id }, { $set: { series: match[1], seq: Number(match[2]) } });
    filled += 1;
  }
  console.log(`[042] ${filled} invoice(s) given series and seq`);
  await models.Invoices.init();
  await models.Invoices.syncIndexes();
  console.log(`[042] ${invoices.collectionName}: indexes in place`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((error) => {
    console.error('[042] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
