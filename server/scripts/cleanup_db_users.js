require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  ssl: false
});

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    console.log('--- DB Cleanup Started ---');

    // 1. Ensure aakash.bmtechx@gmail.com exists and is admin
    const email = 'aakash.bmtechx@gmail.com';
    const password = 'LeadOS_Admin@2026';
    const hash = await bcrypt.hash(password, 12);
    
    let adminId;
    const res = await client.query(`SELECT id FROM users WHERE email = $1`, [email]);
    if (res.rowCount === 0) {
      console.log('Admin user not found. Creating aakash.bmtechx@gmail.com...');
      
      const tenantRes = await client.query(`SELECT id FROM tenants LIMIT 1`);
      let tenantId = tenantRes.rowCount > 0 ? tenantRes.rows[0].id : null;
      
      const insertRes = await client.query(`
        INSERT INTO users (tenant_id, name, email, password_hash, role, created_at)
        VALUES ($1, 'Aakash (Admin)', $2, $3, 'admin', NOW())
        RETURNING id
      `, [tenantId, email, hash]);
      adminId = insertRes.rows[0].id;
      console.log('Admin user created successfully.');
    } else {
      adminId = res.rows[0].id;
      console.log('Admin user exists. Updating role to admin and resetting password...');
      await client.query(`
        UPDATE users SET role = 'admin', password_hash = $2 WHERE email = $1
      `, [email, hash]);
    }

    // 2. Dynamically reassign all references from other users to admin
    const fkQuery = await client.query(`
      SELECT 
          tc.table_name, 
          kcu.column_name
      FROM 
          information_schema.table_constraints AS tc 
          JOIN information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
          JOIN information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
      WHERE constraint_type = 'FOREIGN KEY' AND ccu.table_name='users' AND ccu.column_name='id';
    `);
    
    for (const row of fkQuery.rows) {
      console.log(`Reassigning ${row.table_name}.${row.column_name} to admin...`);
      await client.query(`UPDATE "${row.table_name}" SET "${row.column_name}" = $1 WHERE "${row.column_name}" != $1 OR "${row.column_name}" IS NULL`, [adminId]);
    }

    // 3. Delete all other users
    const deleteRes = await client.query(`
      DELETE FROM users WHERE id != $1
    `, [adminId]);
    console.log(`Deleted ${deleteRes.rowCount} other users.`);

    // 4. Drop the old constraint and add the new one
    await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
    await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin', 'user'))`);
    console.log('Updated users_role_check constraint to strictly allow only admin and user.');

    await client.query('COMMIT');
    console.log('--- DB Cleanup Completed ---');
    console.log(`\nNew Admin Password for ${email}: ${password}\n`);
    
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error during cleanup:', e);
  } finally {
    client.release();
    pool.end();
  }
}

main();
