/**
 * Lazily created Groq client. The key is read from OPENAI_API_KEY (the name
 * the deployment already uses). There is no placeholder key: with it unset
 * the first AI call fails with a clear error instead of sending a fake key.
 */
const Groq = require('groq-sdk');

let client = null;
function getClient() {
  if (!client) {
    const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
    if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
    client = new Groq({ apiKey });
  }
  return client;
}

module.exports = new Proxy({}, { get: (_target, prop) => getClient()[prop] });
