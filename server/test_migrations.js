require('dotenv').config();
const { connectMongo } = require('./db/mongo');
const { Users, Tenants } = require('./models');

async function testDB() {
  try {
    await connectMongo();
    console.log('Users:', await Users.find().lean());
    console.log('Tenants:', await Tenants.find().lean());
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testDB();
