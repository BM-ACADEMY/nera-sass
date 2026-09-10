require('dotenv').config();
const db = require('./db/connection');
const bcrypt = require('bcryptjs');

async function setup() {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('password123', salt);
  
  try {
    const res = await db.query(
      "INSERT INTO users (tenant_id, name, email, password_hash, role) VALUES (1, 'System Admin', 'superadmin@admin.com', $1, 'admin') ON CONFLICT (email) DO UPDATE SET password_hash = $1 RETURNING id",
      [hash]
    );
    console.log('Super admin setup successful. ID:', res.rows[0].id);
  } catch(e) {
    console.error(e);
  }
  process.exit();
}
setup();
