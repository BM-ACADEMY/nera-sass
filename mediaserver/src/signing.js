/**
 * Signed public links: /f/<scope>/<id>/<name>?exp=<unix seconds>&sig=<hmac>
 *
 * The API decides who may see a file and signs a short-lived link; this server
 * only checks the signature and expiry, so it needs no database or login.
 * server/services/mediaStore.js builds the same string: keep them in step.
 */
const crypto = require('crypto');

const signedString = (scope, id, name, exp) => `v1\n${scope}\n${id}\n${name || ''}\n${exp}`;

function sign(secret, { scope, id, name, exp }) {
  return crypto.createHmac('sha256', secret).update(signedString(scope, id, name, exp)).digest('base64url');
}

function verify(secret, { scope, id, name, exp, sig }, now = Date.now()) {
  const expiry = Number(exp);
  if (!Number.isInteger(expiry) || expiry * 1000 < now || typeof sig !== 'string') return false;
  const expected = Buffer.from(sign(secret, { scope, id, name, exp: expiry }));
  const given = Buffer.from(sig);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

module.exports = { sign, verify };
