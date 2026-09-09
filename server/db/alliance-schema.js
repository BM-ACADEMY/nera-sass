const fs = require('fs');
const path = require('path');
const db = require('./connection');

let schemaPromise;

function ensureAllianceSchema() {
  if (!schemaPromise) {
    const migrationsDirectory = path.join(__dirname, '..', 'migrations');
    const migrationFiles = fs.readdirSync(migrationsDirectory)
      .filter((file) => file.endsWith('.sql'))
      .sort();
    schemaPromise = migrationFiles.reduce(
      (promise, file) => promise.then(() => db.query(fs.readFileSync(path.join(migrationsDirectory, file), 'utf8'))),
      Promise.resolve()
    ).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

module.exports = ensureAllianceSchema;
