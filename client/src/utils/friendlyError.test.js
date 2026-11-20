import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  friendlyMessage, friendlyError, toApiError, looksTechnical, metaCodeOf,
  addErrorLanguage, setErrorLanguage, ERROR_MESSAGES,
} from './friendlyError.js';

const NO_RAW = [/status code/i, /E11000/, /Cannot read/, /\(#\d+\)/, /\{/, /undefined/, /stack/i, /Mongo/i, /[A-Z]+_[A-Z_]+/];
const assertPlain = (text) => {
  assert.equal(typeof text, 'string');
  assert.ok(text.length > 0 && text.length < 220, text);
  for (const re of NO_RAW) assert.ok(!re.test(text), `"${text}" matches ${re}`);
};

test('known server codes map to their sentence', () => {
  assert.match(friendlyMessage({ status: 409, data: { error: 'WhatsApp is not connected for this workspace', code: 'WHATSAPP_NOT_CONNECTED' } }), /connect WhatsApp in Settings/);
  assert.match(friendlyMessage({ status: 402, data: { error: 'x', code: 'NO_ACTIVE_PLAN' } }), /Choose a plan in Billing/);
  assert.match(friendlyMessage({ status: 403, data: { code: 'CONSENT_REQUIRED' } }), /not agreed/);
  assert.match(friendlyMessage({ status: 503, data: { error: 'The Meta inventory credential (META_INVENTORY_ACCESS_TOKEN) is not configured', code: 'META_CREDENTIAL_NOT_CONFIGURED' } }), /contact Getnera support/);
  assert.match(friendlyMessage({ status: 400, data: { error: 'x-tenant-id header is required for service calls', code: 'TENANT_REQUIRED' } }), /choose a workspace/i);
});

test('every mapped sentence is plain language', () => {
  for (const group of ['codes', 'meta', 'status']) {
    for (const [key, value] of Object.entries(ERROR_MESSAGES.en[group])) {
      assert.ok(value && !/[A-Z]{3,}_/.test(value), `${group}.${key}`);
      assertPlain(value);
    }
  }
});

test('contextual codes keep a plain server sentence, but not a technical one', () => {
  assert.equal(friendlyMessage({ status: 400, data: { error: 'Fill in Customer name', code: 'TEMPLATE_VALUE_MISSING' } }), 'Fill in Customer name');
  assert.match(friendlyMessage({ status: 400, data: { error: "Cannot read properties of undefined (reading 'x')", code: 'TEMPLATE_VALUE_MISSING' } }), /fill in every value/);
});

test('Meta error numbers become a sentence, from text or from meta_code', () => {
  assert.match(friendlyMessage({ status: 502, data: { error: '(#131047) Re-engagement message', code: 'WHATSAPP_SEND_FAILED' } }), /24 hours/);
  assert.match(friendlyMessage({ status: 502, data: { error: 'Message failed (Meta error 131026)', code: 'WHATSAPP_SEND_FAILED' } }), /not be on WhatsApp/);
  assert.match(friendlyMessage({ status: 500, data: { error: 'Something went wrong on our side.', meta_code: 190 } }), /reconnect WhatsApp/);
  for (const code of [100, 190, 131000, 131026, 131047, 131049, 131051, 131056, 130429, 132000, 132001, 133010]) {
    assertPlain(friendlyMessage({ status: 400, data: { error: `(#${code}) raw` } }));
  }
  assert.equal(metaCodeOf({ error: { code: 131000 } }), 131000);
  assert.equal(metaCodeOf({}, 'nothing here'), null);
});

test('raw developer text never reaches the customer', () => {
  const raws = [
    'E11000 duplicate key error collection: leads index: phone_1 dup key',
    "Cannot read properties of undefined (reading 'map')",
    'Request failed with status code 500',
    '{"error":{"message":"(#131000) Something went wrong","fbtrace_id":"A1"}}',
    'Cast to ObjectId failed for value "abc"',
    'TypeError: x is not a function\n    at foo (/srv/app/server.js:10:5)',
    'connect ECONNREFUSED 127.0.0.1:5678',
    'API Error',
  ];
  for (const raw of raws) {
    for (const status of [400, 404, 409, 500, 502]) assertPlain(friendlyMessage({ status, data: { error: raw } }));
  }
});

test('HTTP status fallbacks', () => {
  assert.match(friendlyMessage({ status: 400, data: {} }), /check the details/);
  assert.equal(friendlyMessage({ status: 401, data: {} }), 'Please sign in again.');
  assert.match(friendlyMessage({ status: 403, data: {} }), /permission/);
  assert.match(friendlyMessage({ status: 404, data: {} }), /could not find/);
  assert.match(friendlyMessage({ status: 413, data: {} }), /too large/);
  assert.match(friendlyMessage({ status: 429, data: {} }), /Too many tries/);
  assert.equal(friendlyMessage({ status: 500, data: {} }), 'Something went wrong on our side. Please try again in a minute.');
  assert.equal(friendlyMessage({ status: 503, data: { error: 'Server error', ref: 'ab12cd34' } }), 'Something went wrong on our side. Please try again in a minute. (Reference: ab12cd34)');
});

test('a plain server sentence without a known code is shown as is', () => {
  assert.equal(friendlyMessage({ status: 400, data: { error: 'Enter a campaign name.' } }), 'Enter a campaign name.');
});

test('toApiError: message is friendly, raw kept in detail, callers keep code/status/response', () => {
  const err = toApiError({ status: 500, data: { error: 'E11000 duplicate key', code: 'X_FAILED', ref: 'r1', blockers: ['a'] } });
  assert.ok(err instanceof Error);
  assert.equal(err.message, err.userMessage);
  assertPlain(err.message.replace(/\(Reference: r1\)/, ''));
  assert.equal(err.detail, 'E11000 duplicate key');
  assert.equal(err.status, 500);
  assert.equal(err.code, 'X_FAILED');
  assert.equal(err.ref, 'r1');
  assert.equal(err.response.data.error, err.message);
  assert.deepEqual(err.response.data.blockers, ['a']);
});

test('network, offline, timeout, cancelled and non-JSON replies', () => {
  assert.match(toApiError({ kind: 'network', raw: 'Failed to fetch' }).message, /internet connection/);
  assert.match(toApiError({ kind: 'offline' }).message, /offline/);
  assert.match(toApiError({ kind: 'timeout' }).message, /longer than usual/);
  assert.equal(toApiError({ kind: 'cancelled' }).name, 'AbortError');
  assert.match(toApiError({ status: 502, kind: 'invalid', raw: '<html>Bad Gateway</html>' }).message, /on our side/);
  assert.match(toApiError({ status: 200, kind: 'invalid', raw: '<html>' }).message, /unexpected reply/);
});

test('friendlyError handles any thrown value', () => {
  assert.match(friendlyError(new TypeError('Failed to fetch')), /internet connection|offline/);
  assert.match(friendlyError(new Error("Cannot read properties of undefined (reading 'id')")), /Something went wrong/);
  assert.equal(friendlyError(new Error('Choose at least one contact.')), 'Choose at least one contact.');
  assert.match(friendlyError({ response: { status: 500, data: { error: 'MongoServerError: boom' } }, message: 'Request failed with status code 500' }), /on our side/);
  assert.equal(friendlyError(toApiError({ status: 401, data: {} })), 'Please sign in again.');
  assert.match(friendlyError(null), /Something went wrong/);
});

test('looksTechnical keeps ordinary sentences', () => {
  assert.equal(looksTechnical('Connect your Google Calendar first.'), false);
  assert.equal(looksTechnical('Confirm the deletion by sending confirm: "DELETE".'), false);
  assert.equal(looksTechnical('Some files could not be removed yet. Sending is already stopped.'), false);
  assert.equal(looksTechnical({ message: 'x' }), true);
});

test('a second language overrides English key by key', () => {
  addErrorLanguage('ta', { status: { 401: 'மீண்டும் உள்நுழையவும்.' } });
  setErrorLanguage('ta');
  try {
    assert.equal(friendlyMessage({ status: 401, data: {} }), 'மீண்டும் உள்நுழையவும்.');
    assert.match(friendlyMessage({ status: 403, data: {} }), /permission/); // falls back to English
  } finally {
    setErrorLanguage('en');
  }
});
