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
  const columns = await pool.query(`
    SELECT table_schema, table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND (
        LOWER(column_name) LIKE '%api%key%'
        OR LOWER(column_name) LIKE '%token%'
        OR LOWER(column_name) LIKE '%secret%'
        OR LOWER(column_name) LIKE '%credential%'
      )
    ORDER BY table_schema, table_name, ordinal_position
  `);

  const aiNamedColumns = columns.rows.filter((column) =>
    /(gemini|openrouter|openai|groq|ai_api)/i.test(column.column_name)
  );

  const settingsTables = await pool.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type = 'BASE TABLE'
      AND LOWER(table_name) ~ '(setting|config|credential|secret)'
    ORDER BY table_schema, table_name
  `);

  const searchableColumns = await pool.query(`
    SELECT table_schema, table_name, column_name
    FROM information_schema.columns
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND data_type IN ('text', 'character varying', 'json', 'jsonb')
      AND LOWER(table_name) ~ '(setting|config|credential|secret)'
  `);

  const quoteIdentifier = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const contentMatches = [];
  const markers = [
    '%sk-or-%',
    '%openrouter_api_key%',
    '%openrouter.ai/api%',
    '%gemini_api_key%',
    '%generativelanguage.googleapis.com%',
  ];

  for (const column of searchableColumns.rows) {
    const table = `${quoteIdentifier(column.table_schema)}.${quoteIdentifier(column.table_name)}`;
    const field = quoteIdentifier(column.column_name);
    const result = await pool.query(
      `SELECT COUNT(*)::int AS matches FROM ${table} WHERE ${field}::text ILIKE ANY($1::text[])`,
      [markers]
    );
    if (result.rows[0].matches > 0) {
      contentMatches.push({
        schema: column.table_schema,
        table: column.table_name,
        column: column.column_name,
        matches: result.rows[0].matches,
      });
    }
  }

  console.log(JSON.stringify({
    aiNamedColumns,
    credentialLikeColumns: columns.rows.map((column) => ({
      schema: column.table_schema,
      table: column.table_name,
      column: column.column_name,
      type: column.data_type,
    })),
    settingsTables: settingsTables.rows,
    aiMarkerContentMatches: contentMatches,
  }, null, 2));

  await pool.end();
}

audit().catch(async (error) => {
  console.error('Database API-key audit failed:', error.message);
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
