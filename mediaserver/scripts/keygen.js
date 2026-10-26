// Prints fresh secrets for mediaserver/.env. MEDIA_SIGNING_SECRET and
// MEDIA_INTERNAL_KEY must also be copied into server/.env.
const crypto = require('crypto');

console.log(`MEDIA_MASTER_KEY=${crypto.randomBytes(32).toString('hex')}`);
console.log(`MEDIA_SIGNING_SECRET=${crypto.randomBytes(32).toString('base64url')}`);
console.log(`MEDIA_INTERNAL_KEY=${crypto.randomBytes(32).toString('base64url')}`);
