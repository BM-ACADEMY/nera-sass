// MongoDB connection (replaces the former pg Pool). Models live in ../models.
const { connectMongo, mongoose } = require('./mongo');

module.exports = { connectMongo, mongoose };
