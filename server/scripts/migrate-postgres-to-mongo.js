/**
 * One-off data migration: copies every table of the old Postgres database into
 * the MongoDB collection of the same name, then syncs the numeric id counters.
 *
 * Usage:
 *   node scripts/migrate-postgres-to-mongo.js            # copy tables whose collection is empty
 *   node scripts/migrate-postgres-to-mongo.js --reset    # wipe each collection first, then copy
 *   node scripts/migrate-postgres-to-mongo.js leads clients   # only these tables
 *
 * Reads Postgres from PG_HOST/PG_PORT/PG_NAME/PG_USER/PG_PASS (falls back to the
 * legacy DB_* variables) and MongoDB from MONGODB_URI.
 * Requires the `pg` package: npm install --no-save pg
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Pool } = require('pg');
const { connectMongo, mongoose } = require('../db/mongo');
const models = require('../models');

const args = process.argv.slice(2);
const reset = args.includes('--reset');
const only = args.filter((a) => !a.startsWith('--'));

const pg = new Pool({
  host: process.env.PG_HOST || process.env.DB_HOST,
  port: Number(process.env.PG_PORT || process.env.DB_PORT || 5432),
  database: process.env.PG_NAME || process.env.DB_NAME,
  user: process.env.PG_USER || process.env.DB_USER,
  password: process.env.PG_PASS || process.env.DB_PASS,
});

const BATCH = 500;

async function copyTable(model) {
  const table = model.collection.collectionName;
  const existing = await model.estimatedDocumentCount();
  if (existing > 0 && !reset) {
    console.log(`- ${table}: skipped (${existing} documents already present, use --reset)`);
    return;
  }
  if (reset) await model.deleteMany({});

  const hasId = Boolean(model.schema.path('id'));
  const { rows } = await pg.query(`SELECT * FROM "${table}"${hasId ? ' ORDER BY id' : ''}`);
  for (let i = 0; i < rows.length; i += BATCH) {
    await model.insertMany(rows.slice(i, i + BATCH), { ordered: false });
  }
  if (model.syncCounter && hasId && model.schema.path('id').instance === 'Number') {
    await model.syncCounter();
  }
  console.log(`✔ ${table}: ${rows.length} rows`);
}

(async () => {
  await connectMongo();
  const list = Object.values(models).filter((m) => !only.length || only.includes(m.collection.collectionName));
  let failed = 0;
  for (const model of list) {
    try {
      await model.createIndexes();
      await copyTable(model);
    } catch (err) {
      failed += 1;
      console.error(`✖ ${model.collection.collectionName}: ${err.message}`);
    }
  }
  await pg.end();
  await mongoose.disconnect();
  console.log(failed ? `Finished with ${failed} failed table(s).` : 'Migration complete.');
  process.exit(failed ? 1 : 0);
})();
