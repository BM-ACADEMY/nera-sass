const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

mongoose.set('strictQuery', false);

const { applyTenantScope } = require('./tenantScope');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nera';

let connectPromise = null;
function connectMongo() {
  if (!connectPromise) {
    connectPromise = mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
      .then((conn) => {
        console.log(`[MongoDB] Connected to ${conn.connection.host}/${conn.connection.name}`);
        return conn;
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

mongoose.connection.on('error', (err) => console.error('[MongoDB] error:', err.message));

// ── Numeric auto-increment ids ───────────────────────────────
// Every former SERIAL/BIGSERIAL table keeps a numeric `id` so the API and the
// frontend continue to address records exactly as before (/leads/42 ...).
const counterSchema = new mongoose.Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false });
const Counter = mongoose.models.counters || mongoose.model('counters', counterSchema, 'counters');

async function nextId(collection, count = 1) {
  const doc = await Counter.findOneAndUpdate(
    { _id: collection },
    { $inc: { seq: count } },
    { new: true, upsert: true, lean: true }
  );
  return doc.seq - count + 1;
}

// Allocates `count` ids at once and returns them as an array.
async function allocIds(collection, count) {
  if (!count) return [];
  const first = await nextId(collection, count);
  return Array.from({ length: count }, (_, i) => first + i);
}

async function syncCounter(collection, model) {
  const top = await model.findOne({}, { id: 1 }).sort({ id: -1 }).lean();
  const max = Number(top?.id) || 0;
  await Counter.updateOne({ _id: collection, seq: { $lt: max } }, { $set: { seq: max } });
  await Counter.updateOne({ _id: collection }, { $setOnInsert: { seq: max } }, { upsert: true });
}

const MONGO_TYPE = { Number: 'number', String: 'string', Date: 'date', Boolean: 'bool' };

/**
 * Defines a model whose collection name equals the former Postgres table name.
 *  - fields:  { column: { type, default } }
 *  - options.autoId: assign a numeric `id` from the counters collection on insert
 *  - options.unique: [[col, ...], ...] — Postgres UNIQUE / composite PK semantics
 *    (rows with NULL in any key column never conflict, as in Postgres)
 *  - options.indexes: [[col, ...], ...] — plain secondary indexes
 */
function defineModel(collection, fields, options = {}) {
  if (mongoose.models[collection]) return mongoose.models[collection];
  const schema = new mongoose.Schema(fields, {
    collection,
    strict: false,
    versionKey: false,
    id: false,
    minimize: false,
    toJSON: { transform: (_doc, ret) => { delete ret._id; return ret; } },
    toObject: { transform: (_doc, ret) => { delete ret._id; return ret; } },
  });

  if (options.autoId) {
    schema.pre('validate', async function assignId() {
      if (this.isNew && (this.id === undefined || this.id === null)) {
        this.id = await nextId(collection);
      }
    });
    schema.index({ id: 1 }, { unique: true });
    schema.statics.nextId = function nextModelId(count = 1) { return nextId(collection, count); };
    schema.statics.allocIds = function allocModelIds(count) { return allocIds(collection, count); };
  }

  for (const keys of options.unique || []) {
    const spec = Object.fromEntries(keys.map((k) => [k, 1]));
    const partial = {};
    for (const k of keys) {
      const t = fields[k]?.type;
      const mongoType = MONGO_TYPE[t?.name] || (t === Number ? 'number' : null);
      if (mongoType) partial[k] = { $type: mongoType };
      else partial[k] = { $exists: true };
    }
    schema.index(spec, { unique: true, partialFilterExpression: partial });
  }
  // UNIQUE (LOWER(col)) WHERE col IS NOT NULL. Named explicitly so it can sit
  // next to an older case-sensitive index on the same key.
  for (const keys of options.uniqueCaseInsensitive || []) {
    schema.index(Object.fromEntries(keys.map((k) => [k, 1])), {
      name: `${keys.join('_')}_ci_unique`,
      unique: true,
      collation: { locale: 'en', strength: 2 },
      partialFilterExpression: Object.fromEntries(keys.map((k) => [k, { $type: 'string' }])),
    });
  }
  for (const keys of options.indexes || []) {
    schema.index(Object.fromEntries(keys.map((k) => [k, 1])));
  }

  // Tenant isolation for every collection listed in db/tenantScope.js.
  applyTenantScope(schema, collection);
  // Extra schema hooks must be registered before the model is compiled.
  if (options.configure) options.configure(schema);

  const model = mongoose.model(collection, schema, collection);
  model.syncCounter = () => syncCounter(collection, model);
  return model;
}

const NO_ID = { _id: 0 };

/**
 * INSERT ... ON CONFLICT (<filter keys>) DO UPDATE SET <update>.
 * Applies `update` (an update document or pipeline) to the document matching
 * `filter`; when none exists, creates `{ ...filter, ...insertDoc }`.
 * Returns the resulting document (plain object, no _id).
 */
async function upsertOne(model, filter, update, insertDoc = {}) {
  const apply = () => (update && (Array.isArray(update) || Object.keys(update).length)
    ? model.findOneAndUpdate(filter, update, { new: true, projection: NO_ID }).lean()
    : model.findOne(filter, NO_ID).lean());
  const existing = await apply();
  if (existing) return existing;
  try {
    return (await model.create({ ...filter, ...insertDoc })).toObject();
  } catch (error) {
    if (error.code === 11000) return apply();
    throw error;
  }
}

// INSERT ... ON CONFLICT DO NOTHING RETURNING * — returns the new document, or null on conflict.
async function insertIgnore(model, doc) {
  try {
    return (await model.create(doc)).toObject();
  } catch (error) {
    if (error.code === 11000) return null;
    throw error;
  }
}

// ── Cross-process mutex (replaces pg_advisory_xact_lock) ──────
const lockSchema = new mongoose.Schema({ _id: String, expires_at: Date }, { versionKey: false });
lockSchema.index({ expires_at: 1 }, { expireAfterSeconds: 0 });
const Lock = mongoose.models.locks || mongoose.model('locks', lockSchema, 'locks');

async function withLock(key, fn, { ttlMs = 30000, waitMs = 15000 } = {}) {
  const id = String(key);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      await Lock.create({ _id: id, expires_at: new Date(Date.now() + ttlMs) });
      break;
    } catch (error) {
      if (error.code !== 11000) throw error;
      // Take over a lock whose holder died without releasing it
      await Lock.deleteOne({ _id: id, expires_at: { $lt: new Date() } });
      if (Date.now() > deadline) throw new Error(`Timed out waiting for lock ${id}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await Lock.deleteOne({ _id: id }).catch(() => {});
  }
}

// RIGHT(REGEXP_REPLACE(phone,'[^0-9]','','g'),10) = RIGHT(digits,10) as a regex on the raw phone field
function phoneTailRegex(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const tail = digits.slice(-10);
  const body = tail.split('').join('\\D*');
  return tail.length >= 10
    ? new RegExp(`${body}\\D*$`)
    : new RegExp(`^\\D*${body}\\D*$`);
}

// Helpers used while translating SQL:
const escapeRegex = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// ILIKE '%value%'
const ilike = (value) => new RegExp(escapeRegex(value), 'i');
// ILIKE 'value' (exact, case-insensitive)
const ieq = (value) => new RegExp(`^${escapeRegex(value)}$`, 'i');
const uuid = () => crypto.randomUUID();
const toInt = (value) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
};

module.exports = {
  mongoose,
  connectMongo,
  defineModel,
  nextId,
  allocIds,
  Counter,
  NO_ID,
  upsertOne,
  insertIgnore,
  withLock,
  phoneTailRegex,
  escapeRegex,
  ilike,
  ieq,
  uuid,
  toInt,
  Mixed: mongoose.Schema.Types.Mixed,
};
