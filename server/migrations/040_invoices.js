/**
 * N3 follow-up: GST invoices. Creates the invoices collection and its indexes
 * (unique invoice number, one invoice per order). Safe to run again.
 *
 * Run by hand against the target database, never automatically:
 *   MONGODB_URI=mongodb://... node migrations/040_invoices.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const { connectMongo, mongoose } = require('../db/mongo');
  const models = require('../models');
  await connectMongo();
  await models.Invoices.init();
  await models.Invoices.syncIndexes();
  console.log(`[040] ${models.Invoices.collection.name}: indexes in place`);
  await mongoose.disconnect();
}

if (require.main === module) {
  run().then(() => process.exit(0)).catch((error) => {
    console.error('[040] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { run };
