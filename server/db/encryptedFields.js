/**
 * Keeps chosen string fields of a model encrypted at rest (utils/crypto.js,
 * with key versions) while the rest of the server keeps reading and writing
 * them as plain strings:
 *   - every write through the model encrypts the field;
 *   - every read through the model decrypts it in memory.
 *
 * A value that is not yet encrypted (a row from before this was added) is
 * returned as it is, so the app works before, during and after
 * scripts/security/encrypt-plaintext-tokens.js converts existing rows.
 * A value that cannot be decrypted reads as null; nothing about it is logged.
 *
 * Covered: save/create, insertMany, updateOne, updateMany, findOneAndUpdate,
 * replaceOne, findOneAndReplace and find/findOne (documents and lean).
 * Not covered: bulkWrite and aggregate, which bypass Mongoose query hooks.
 */
const { encrypt, tryDecrypt, looksEncrypted } = require('../utils/crypto');

const READ_OPS = ['find', 'findOne', 'findOneAndUpdate', 'findOneAndReplace', 'findOneAndDelete'];
const WRITE_OPS = ['findOneAndUpdate', 'updateOne', 'updateMany', 'replaceOne', 'findOneAndReplace'];

function seal(value) {
  if (typeof value !== 'string' || !value || looksEncrypted(value)) return value;
  return encrypt(value);
}

function open(value, collection) {
  if (!looksEncrypted(value)) return value;
  const opened = tryDecrypt(value);
  if (opened.ok) return opened.value;
  console.error(`[encryptedFields] A stored token in ${collection} could not be decrypted (wrong TOKEN_ENCRYPTION_KEY?)`);
  return null;
}

function sealIn(target, fields) {
  if (!target || typeof target !== 'object') return;
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(target, field)) target[field] = seal(target[field]);
  }
}

function encryptedFields(schema, collection, fields) {
  schema.pre('save', function encryptOnSave() {
    for (const field of fields) {
      if (this.isNew || this.isModified(field)) {
        const sealed = seal(this.get(field));
        if (sealed !== this.get(field)) this.set(field, sealed);
      }
    }
  });

  schema.pre('insertMany', function encryptOnInsertMany(next, docs) {
    for (const doc of Array.isArray(docs) ? docs : [docs]) sealIn(doc, fields);
    next();
  });

  schema.pre(WRITE_OPS, function encryptOnUpdate() {
    const update = this.getUpdate();
    if (!update || Array.isArray(update)) return;
    sealIn(update, fields);
    sealIn(update.$set, fields);
    sealIn(update.$setOnInsert, fields);
  });

  const decryptResults = (result) => {
    for (const doc of Array.isArray(result) ? result : [result]) {
      if (!doc || typeof doc !== 'object') continue;
      const target = doc._doc || doc;
      for (const field of fields) {
        if (typeof target[field] === 'string') target[field] = open(target[field], collection);
      }
    }
  };
  schema.post(READ_OPS, decryptResults);
  // A document that was just saved goes back to the caller readable.
  schema.post('save', decryptResults);
}

module.exports = { encryptedFields };
