/**
 * Migration: Add workflow columns to leads table
 * Run: node server/scripts/migrate_add_workflow_cols.js
 */

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST || 'leados-api.abmgroups.org',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'leados_db',
  user: process.env.DB_USER || 'leados_user',
  password: process.env.DB_PASS || 'LeadOS_DB@2026',
});

async function migrate() {
  console.log('🔄 Running migration...\n');

  const client = await pool.connect();

  try {
    // Check and add columns one by one
    const columns = [
      { name: 'next_followup_due', type: 'TIMESTAMP' },
      { name: 'touch_count', type: 'INT DEFAULT 0' },
      { name: 'call_booked_at', type: 'TIMESTAMP' },
      { name: 'owner', type: 'VARCHAR(50)' },
      { name: 'flow_step', type: 'VARCHAR(50)' },
      { name: 'payment_status', type: 'VARCHAR(20)' },
      { name: 'stage', type: 'VARCHAR(50)' },
    ];

    for (const col of columns) {
      try {
        await client.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
        console.log(`✅ Added column: ${col.name}`);
      } catch (err) {
        if (err.message.includes('already exists')) {
          console.log(`⏭️  Column already exists: ${col.name}`);
        } else {
          console.log(`❌ Error adding ${col.name}:`, err.message);
        }
      }
    }

    console.log('\n✅ Migration complete!');

    // Show current table structure
    const result = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'leads'
      ORDER BY ordinal_position
    `);

    console.log('\n📋 Current leads table columns:');
    result.rows.forEach(r => console.log(`   - ${r.column_name}: ${r.data_type}`));

  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
