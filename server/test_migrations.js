require('dotenv').config();
const db = require('./db/connection');

async function testDB() {
  try {
    const res = await db.query('SELECT * FROM users');
    console.log('Users:', res.rows);
    const tenants = await db.query('SELECT * FROM tenants');
    console.log('Tenants:', tenants.rows);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testDB();
