require('dotenv').config();
const bcrypt = require('bcryptjs');
const { connectMongo, mongoose } = require('./db/mongo');
const { Users } = require('./models');

async function setup() {
  const salt = await bcrypt.genSalt(10);
  const hash = await bcrypt.hash('password123', salt);

  try {
    await connectMongo();
    const existing = await Users.findOne({ email: 'superadmin@admin.com' });
    let user;
    if (existing) {
      existing.password_hash = hash;
      user = await existing.save();
    } else {
      user = await Users.create({ tenant_id: 1, name: 'System Admin', email: 'superadmin@admin.com', password_hash: hash, role: 'admin' });
    }
    console.log('Super admin setup successful. ID:', user.id);
  } catch(e) {
    console.error(e);
  }
  await mongoose.disconnect();
  process.exit();
}
setup();
