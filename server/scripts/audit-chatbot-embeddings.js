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
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded
    FROM chatbot_knowledgebase
  `);
  const brainDocs = await pool.query(`
    SELECT COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE content IS NOT NULL AND TRIM(content) <> '')::int AS populated
    FROM brain_docs
  `);
  console.log(JSON.stringify({
    chatbotKnowledgebase: result.rows[0],
    brainDocs: brainDocs.rows[0],
  }, null, 2));
  await pool.end();
}

audit().catch(async (error) => {
  console.error('Embedding audit failed:', error.message);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
