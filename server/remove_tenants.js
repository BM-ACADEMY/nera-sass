const db = require('./db/connection');

async function run() {
  try {
    const res = await db.query("SELECT table_name FROM information_schema.columns WHERE column_name = 'tenant_id' AND table_schema = 'public'");
    
    for (let row of res.rows) {
      console.log('Dropping tenant_id from ' + row.table_name);
      await db.query(`ALTER TABLE "${row.table_name}" DROP COLUMN IF EXISTS tenant_id CASCADE`);
    }
    
    await db.query('DROP TABLE IF EXISTS tenants CASCADE');
    console.log('Done DB clean');
  } catch (error) {
    console.error('Error:', error);
  } finally {
    db.end();
  }
}

run();
