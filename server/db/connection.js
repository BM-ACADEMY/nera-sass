const pg = require('pg');
require('dotenv').config();

// OID 1114 is for TIMESTAMP (without time zone).
// Parse it as UTC (appending 'Z') to prevent timezone shifting issues when serving to the client.
pg.types.setTypeParser(1114, function(stringValue) {
  return new Date(stringValue.replace(' ', 'T') + 'Z');
});

const pool = new pg.Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
});

pool.on('error', (err) => console.error('Alliance DB error:', err));

// Auto-migrate ID columns to BIGINT to support large Meta phone/lead IDs without integer out-of-range errors
pool.query(`
  ALTER TABLE leads ALTER COLUMN id TYPE BIGINT;
  ALTER TABLE conversations ALTER COLUMN id TYPE BIGINT;
  ALTER TABLE conversations ALTER COLUMN lead_id TYPE BIGINT;
  ALTER TABLE messages ALTER COLUMN id TYPE BIGINT;
  ALTER TABLE messages ALTER COLUMN conversation_id TYPE BIGINT;
`).catch(() => {});

// A custom campaign upload is a temporary audience selection. Keep that
// relationship separate so an existing lead can be reused without changing
// their brand, status, source, or other CRM data.
pool.query(`
  CREATE TABLE IF NOT EXISTS campaign_import_recipients (
    batch_id VARCHAR(30) NOT NULL,
    lead_id BIGINT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (batch_id, lead_id)
  )
`).catch((err) => console.error('Campaign import audience migration failed:', err.message));

pool.query(`
  ALTER TABLE campaign_logs
  ADD COLUMN IF NOT EXISTS error_message TEXT
`).catch((err) => console.error('Campaign log migration failed:', err.message));

module.exports = pool;
