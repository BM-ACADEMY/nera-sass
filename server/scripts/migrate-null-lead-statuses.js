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

    const before = await client.query(`
      SELECT COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS source,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS recent,
             COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '24 hours' OR created_at IS NULL)::int AS old
      FROM leads
      WHERE status IS NULL OR TRIM(status) = ''
      GROUP BY 1
      ORDER BY 1
    `);

    const updated = await client.query(`
      UPDATE leads
      SET status = CASE
        WHEN created_at >= NOW() - INTERVAL '24 hours' THEN 'new'
        ELSE 'cold'
      END,
      updated_at = NOW()
      WHERE status IS NULL OR TRIM(status) = ''
      RETURNING status
    `);

    const summary = updated.rows.reduce((counts, row) => {
      counts[row.status] = (counts[row.status] || 0) + 1;
      return counts;
    }, {});

    const distribution = await client.query(`
      SELECT COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS source,
             COALESCE(NULLIF(TRIM(status), ''), 'Unknown') AS status,
             COUNT(*)::int AS total
      FROM leads
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);

    await client.query('COMMIT');
    console.log(JSON.stringify({ before: before.rows, updated: summary, distribution: distribution.rows }, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error('Lead status migration failed:', error.message);
  process.exitCode = 1;
});
