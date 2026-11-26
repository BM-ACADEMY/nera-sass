import test from 'node:test';
import assert from 'node:assert';
import {
  shownMethods, setupChoices, switchState, setupBlocker, removeBlocker, whatsappOnly, needsConfirmation, isConfirmed, confirmationProof, firstCodeMethod,
} from './twoStepPolicy.js';

const me = (enrolled = [], extra = {}) => ({
  mfa_enabled: enrolled.length > 0, mfa_methods: enrolled, mfa_methods_enrolled: enrolled, whatsapp_otp_available: true, ...extra,
});

test('Switch: off with no method, on with one, locked when the account must keep it', () => {
  assert.deepStrictEqual(switchState(me()), { on: false, locked: false, reason: '' });
  assert.deepStrictEqual(switchState(me(['email'])), { on: true, locked: false, reason: '' });
  const forced = switchState(me(['totp'], { mfa_required_by_policy: true }));
  assert.strictEqual(forced.locked, true);
  assert.match(forced.reason, /cannot be turned off/);
  assert.strictEqual(switchState(me([], { mfa_required_by_policy: true })).locked, false, 'it can still be turned on');
});

test('Turning on offers the authenticator app or email, never WhatsApp', () => {
  assert.deepStrictEqual(setupChoices(me()), ['totp', 'email']);
  assert.deepStrictEqual(setupChoices(me([], { mfa_extra_methods_enabled: false })), ['totp']);
});

test('Method cards follow the server switch for the newer methods', () => {
  assert.deepStrictEqual(shownMethods(me()), ['totp', 'email', 'whatsapp']);
  assert.deepStrictEqual(shownMethods(me([], { mfa_extra_methods_enabled: false })), ['totp']);
  assert.deepStrictEqual(shownMethods(me(['whatsapp'], { mfa_extra_methods_enabled: false })), ['totp', 'whatsapp']);
});

test('WhatsApp is an extra method', () => {
  assert.match(setupBlocker(me(), 'whatsapp'), /first/);
  assert.strictEqual(setupBlocker(me(['email']), 'whatsapp'), '');
  assert.match(setupBlocker(me(['email'], { whatsapp_otp_available: false }), 'whatsapp'), /Not available/);
  assert.strictEqual(setupBlocker(me(), 'totp'), '');
  assert.match(removeBlocker(me(['email', 'whatsapp']), 'email'), /WhatsApp/);
  assert.strictEqual(removeBlocker(me(['email', 'totp', 'whatsapp']), 'email'), '');
  assert.strictEqual(removeBlocker(me(['email', 'whatsapp']), 'whatsapp'), '');
  assert.strictEqual(removeBlocker(me(['email']), 'email'), '');
  assert.match(removeBlocker(me(['email'], { mfa_required_by_policy: true }), 'email'), /keep one/);
  assert.strictEqual(whatsappOnly(me(['whatsapp'])), true);
  assert.strictEqual(whatsappOnly(me(['whatsapp', 'totp'])), false);
});

test('Confirmation: asked again only when it ran out or the server says so', () => {
  assert.strictEqual(isConfirmed(0, 1000), false);
  assert.strictEqual(isConfirmed(601000, 1000), true);
  assert.strictEqual(isConfirmed(5000, 1000), false);
  assert.strictEqual(needsConfirmation({ code: 'PASSWORD_REQUIRED' }), true);
  assert.strictEqual(needsConfirmation({ code: 'MFA_CODE_REQUIRED' }), true);
  assert.strictEqual(needsConfirmation({ code: 'PASSWORD_INCORRECT' }), false);
});

test('What the pop-up sends, and which code it asks for first', () => {
  assert.deepStrictEqual(confirmationProof({ hasMfa: false, password: 'p', method: 'totp', code: '1' }), { password: 'p' });
  assert.deepStrictEqual(confirmationProof({ hasMfa: true, password: 'p', method: 'totp', code: '123456' }), { password: 'p', code_method: 'totp', code: '123456' });
  assert.deepStrictEqual(confirmationProof({ hasMfa: true, password: 'p', method: 'recovery', code: ' AB-CD ' }), { password: 'p', recovery_code: 'AB-CD' });
  assert.strictEqual(firstCodeMethod(me(['totp', 'email'], { mfa_default_method: 'email' })), 'email');
  assert.strictEqual(firstCodeMethod(me(['email', 'totp'])), 'totp');
  assert.strictEqual(firstCodeMethod({ mfa_methods: [] }), 'recovery');
});
