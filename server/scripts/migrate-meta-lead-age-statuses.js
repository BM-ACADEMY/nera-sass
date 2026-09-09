const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE leads
      SET status = CASE
        WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 'new'
        ELSE 'cold'
      END,
      updated_at = NOW()
      WHERE LOWER(TRIM(COALESCE(source, ''))) IN ('facebook', 'meta ads')
        AND LOWER(TRIM(COALESCE(status, ''))) = 'new'
      RETURNING status
    `);

    const summary = result.rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});

    await client.query('COMMIT');
    console.log(JSON.stringify({ updated: result.rowCount, statuses: summary }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Meta lead age-status migration failed:', error.message);
  process.exitCode = 1;
});
