import test from 'node:test';
import assert from 'node:assert';
import { readStoredSession, mergeProfile, isInvalidMfaCode, mfaErrorKind, TOKEN_KEY, USER_KEY } from './session.js';

const storage = (values) => ({ getItem: (key) => (key in values ? values[key] : null) });
const user = { id: 7, name: 'Owner Ten', role: 'owner', email: 'o@x.test', tenant_id: 10 };

test('a stored session is available immediately (refresh / bookmark keeps the page)', () => {
  assert.deepStrictEqual(readStoredSession(storage({ [TOKEN_KEY]: 'tok', [USER_KEY]: JSON.stringify(user) })), { token: 'tok', user });
});

test('no usable session: missing token, missing user, "undefined" token, bad JSON', () => {
  assert.strictEqual(readStoredSession(storage({ [USER_KEY]: JSON.stringify(user) })), null);
  assert.strictEqual(readStoredSession(storage({ [TOKEN_KEY]: 'tok' })), null);
  assert.strictEqual(readStoredSession(storage({ [TOKEN_KEY]: 'undefined', [USER_KEY]: JSON.stringify(user) })), null);
  assert.strictEqual(readStoredSession(storage({ [TOKEN_KEY]: 'tok', [USER_KEY]: '{not json' })), null);
  assert.strictEqual(readStoredSession(storage({ [TOKEN_KEY]: 'tok', [USER_KEY]: 'null' })), null);
  assert.strictEqual(readStoredSession({ getItem: () => { throw new Error('blocked'); } }), null);
});

test('the displayed name and role follow /api/auth/me', () => {
  const { user: updated, changed } = mergeProfile(user, { id: 7, name: 'Agent Ten', role: 'agent', email: 'o@x.test' });
  assert.strictEqual(changed, true);
  assert.strictEqual(updated.role, 'agent');
  assert.strictEqual(updated.name, 'Agent Ten');
  assert.strictEqual(updated.tenant_id, 10, 'fields me did not send are kept');
  assert.deepStrictEqual(mergeProfile(user, { ...user }), { user, changed: false });
  assert.deepStrictEqual(mergeProfile(user, { id: 8, role: 'agent' }), { user, changed: false }, 'another account never overwrites this one');
  assert.deepStrictEqual(mergeProfile(null, { id: 7 }), { user: null, changed: false });
});

test('a wrong MFA code is told apart from an ended session', () => {
  assert.strictEqual(isInvalidMfaCode(401, { code: 'INVALID_MFA_CODE' }), true);
  assert.strictEqual(isInvalidMfaCode(401, { code: 'SESSION_REVOKED' }), false);
  assert.strictEqual(isInvalidMfaCode(401, {}), false);
  assert.strictEqual(isInvalidMfaCode(400, { code: 'INVALID_MFA_CODE' }), false);
  assert.strictEqual(mfaErrorKind({ status: 401, code: 'INVALID_MFA_CODE' }), 'invalid_code');
  assert.strictEqual(mfaErrorKind({ status: 401, code: 'SESSION_REVOKED' }), 'expired');
  assert.strictEqual(mfaErrorKind({ status: 401 }), 'expired');
  assert.strictEqual(mfaErrorKind({ status: 400 }), 'other');
  assert.strictEqual(mfaErrorKind(undefined), 'other');
});
