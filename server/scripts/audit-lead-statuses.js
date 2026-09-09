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

async function audit() {
  const result = await pool.query(`
    SELECT COALESCE(NULLIF(TRIM(source), ''), 'Unknown') AS source,
           COALESCE(NULLIF(TRIM(status), ''), 'Unknown') AS status,
           COUNT(*)::int AS total
    FROM leads
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log(JSON.stringify(result.rows, null, 2));
  await pool.end();
}

audit().catch(async (error) => {
  console.error('Lead status audit failed:', error.message);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
