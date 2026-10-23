/**
 * Hand-offs to n8n. Every call carries the shared secret in x-getnera-secret
 * so the public n8n webhooks can refuse callers that are not this server
 * (n8n Webhook node: Header Auth on that header).
 */
const axios = require('axios');

function n8nHeaders() {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  return secret ? { 'x-getnera-secret': secret } : {};
}

function postToN8n(url, body) {
  return axios.post(url, body, { timeout: 15000, headers: n8nHeaders() });
}

module.exports = { n8nHeaders, postToN8n };
