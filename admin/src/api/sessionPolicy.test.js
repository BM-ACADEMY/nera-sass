import test from 'node:test';
import assert from 'node:assert';
import { shouldEndSession } from './sessionPolicy.js';

test('any 401 ends the session', () => {
  assert.strictEqual(shouldEndSession(401, undefined), true);
  assert.strictEqual(shouldEndSession(401, { error: 'Invalid token' }), true);
  assert.strictEqual(shouldEndSession(401, { code: 'SESSION_REVOKED' }), true);
  assert.strictEqual(shouldEndSession(401, { code: 'ACCOUNT_DEACTIVATED' }), true);
});

test('403 for an account that cannot use the admin panel ends the session', () => {
  assert.strictEqual(shouldEndSession(403, { error: 'Platform staff only', code: 'STAFF_ONLY' }), true);
  assert.strictEqual(shouldEndSession(403, { code: 'NO_WORKSPACE' }), true);
});

test('permission denials and business refusals keep the session', () => {
  assert.strictEqual(shouldEndSession(403, { error: 'You do not have permission to do this', permission: 'platform.meta.admin' }), false);
  assert.strictEqual(shouldEndSession(403, { error: 'Phone registration is disabled on this platform', code: 'REGISTRATION_DISABLED' }), false);
  assert.strictEqual(shouldEndSession(403, undefined), false);
  assert.strictEqual(shouldEndSession(403, {}), false);
});

test('other statuses keep the session', () => {
  for (const status of [200, 400, 404, 409, 500, 503, undefined]) {
    assert.strictEqual(shouldEndSession(status, { code: 'STAFF_ONLY' }), false, `status ${status}`);
  }
});
