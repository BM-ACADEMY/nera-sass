/**
 * Test setup for isolated in-memory testing.
 * Strictly guarantees that tests only connect to local in-memory MongoMemoryServer.
 */
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

let mongod = null;

const TEST_JWT_SECRET = 'test-secret-key-for-nera-isolation-test-suite-32ch';
const TEST_TOKEN_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const TEST_INTERNAL_KEY = 'test-internal-api-key-32chars-ok';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = TEST_JWT_SECRET;
process.env.TOKEN_ENCRYPTION_KEY = TEST_TOKEN_KEY;
process.env.INTERNAL_API_KEY = TEST_INTERNAL_KEY;
process.env.WA_REGISTRATION_PIN = '123456';
// Temporary dummy URI until MongoMemoryServer provides the real in-memory port
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/never_connected';

// SAFETY GATE: Terminate immediately if any test attempts to connect to a non-local database
mongoose.connection.on('connecting', () => {
  const host = mongoose.connection.host;
  if (host && !['127.0.0.1', 'localhost'].includes(host)) {
    mongoose.disconnect();
    throw new Error(`CRITICAL SAFETY GATE: Tests are forbidden from connecting to remote DB ${host}`);
  }
});

async function startTestDb() {
  if (mongod) return mongod;
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  process.env.MONGODB_URI = uri;

  const { connectMongo } = require('../db/mongo');
  await connectMongo();
  const models = require('../models');
  await Promise.all(Object.values(models).map((m) => m.init && m.init()));

  const host = mongoose.connection.host;
  if (!['127.0.0.1', 'localhost'].includes(host)) {
    await mongoose.disconnect();
    await mongod.stop();
    throw new Error(`CRITICAL SAFETY GATE: Connected host is not local: ${host}`);
  }

  return mongod;
}

async function stopTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}

async function clearCollections() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}


function makeToken(user, { mfa = false } = {}) {
  return jwt.sign(
    { id: user.id, tid: user.tenant_id ?? null, tv: Number(user.token_version || 0), mfa: Boolean(mfa), typ: 'access' },
    TEST_JWT_SECRET,
    { expiresIn: '1d' }
  );
}

module.exports = {
  startTestDb,
  stopTestDb,
  clearCollections,
  makeToken,
  TEST_JWT_SECRET,
  TEST_TOKEN_KEY,
  TEST_INTERNAL_KEY,
};
