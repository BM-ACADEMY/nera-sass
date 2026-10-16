/**
 * Seed the platform administrator into an empty Nera database.
 *
 * Reads NERA_ADMIN_EMAIL and NERA_ADMIN_INITIAL_PASSWORD from .env. Refuses to
 * run if the database already has users, so it can never touch existing data.
 * The admin belongs to the platform (no tenant). Change the password after the
 * first login and remove NERA_ADMIN_INITIAL_PASSWORD from .env.
 *
 *   node scripts/seed-platform-admin.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), quiet: true });
const bcrypt = require('bcryptjs');
const { connectMongo, mongoose } = require('../db/connection');
const { Users } = require('../models');

(async () => {
  const email = String(process.env.NERA_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = process.env.NERA_ADMIN_INITIAL_PASSWORD || '';
  if (!email || !email.includes('@')) throw new Error('Set NERA_ADMIN_EMAIL in .env');
  if (password.length < 16) throw new Error('Set NERA_ADMIN_INITIAL_PASSWORD (16+ characters) in .env');

  await connectMongo();
  const database = mongoose.connection.db.databaseName;
  if (await Users.exists({})) {
    throw new Error(`Database "${database}" already has users; nothing was changed.`);
  }

  const admin = await Users.create({
    name: 'Platform Admin',
    email,
    password_hash: await bcrypt.hash(password, 12),
    role: 'admin',
    tenant_id: null,
    is_active: true,
    active: true,
    created_at: new Date(),
  });
  console.log(`Created platform admin ${admin.email} (id ${admin.id}) in "${database}".`);
})()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => mongoose.disconnect());
