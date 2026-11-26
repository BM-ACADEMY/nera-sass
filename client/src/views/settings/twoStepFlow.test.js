import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shownMethods, setupSteps, showsSteps, currentStep, firstCodeMethod, secondsLeft, shouldAutoSend, waitFromError, otherCodeMethods,
  setupChoices, switchState, setupBlocker, removeBlocker, whatsappOnly, needsConfirmation, isConfirmed, confirmationProof,
  needsCodeFor, holdOf, confirmMethods,
} from './twoStepFlow.js';

const me = (enrolled = [], extra = {}) => ({
  mfa_enabled: enrolled.length > 0, mfa_methods: enrolled, mfa_methods_enrolled: enrolled, whatsapp_otp_available: true,
  mfa_extra_methods_enabled: true, ...extra,
});

test('step labels follow the method', () => {
  assert.deepEqual(setupSteps('totp'), ["Confirm it's you", 'Scan the QR code', 'Enter the code']);
  assert.equal(setupSteps('email')[1], 'Get a code');
  assert.equal(setupSteps('whatsapp')[1], 'Get a code');
});

test('only turning a method on shows the step indicator', () => {
  assert.equal(showsSteps('enable'), true);
  assert.equal(showsSteps('disable'), false);
  assert.equal(showsSteps('recovery'), false);
});

test('current step: confirm, then the QR code or getting a code, then the code', () => {
  assert.equal(currentStep('confirm'), 1);
  assert.equal(currentStep('starting'), 2);
  assert.equal(currentStep('scan'), 2);
  assert.equal(currentStep('phone'), 2);
  assert.equal(currentStep('code'), 3);
});

test('first code method: none when off, else the default, then the app', () => {
  assert.equal(firstCodeMethod({ mfa_enabled: false, mfa_methods: [] }), null);
  assert.equal(firstCodeMethod(null), null);
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: ['email'], mfa_default_method: 'email' }), 'email');
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: ['totp', 'email'], mfa_default_method: 'email' }), 'email');
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: ['totp', 'email'], mfa_default_method: 'totp' }), 'totp');
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: ['email', 'totp'] }), 'totp');
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: ['whatsapp'], mfa_default_method: 'totp' }), 'whatsapp');
  assert.equal(firstCodeMethod({ mfa_enabled: true, mfa_methods: [] }), 'recovery');
});

test('auto-send only for an email / WhatsApp code with two-step on, outside the cooldown', () => {
  const now = 1_000_000;
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'email', lastSent: null, now }), true);
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'whatsapp', lastSent: null, now }), true);
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'totp', lastSent: null, now }), false);
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'recovery', lastSent: null, now }), false);
  assert.equal(shouldAutoSend({ hasMfa: false, method: 'email', lastSent: null, now }), false);
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'email', lastSent: { at: now - 10_000, resend_after: 45 }, now }), false);
  assert.equal(shouldAutoSend({ hasMfa: true, method: 'email', lastSent: { at: now - 45_000, resend_after: 45 }, now }), true);
});

test('seconds left in the cooldown', () => {
  const now = 1_000_000;
  assert.equal(secondsLeft(null, now), 0);
  assert.equal(secondsLeft({ at: now - 10_000, resend_after: 45 }, now), 35);
  assert.equal(secondsLeft({ at: now - 10_500 }, now), 35);
  assert.equal(secondsLeft({ at: now - 60_000, resend_after: 45 }, now), 0);
  assert.equal(secondsLeft({ at: now + 120_000, resend_after: 45 }, now), 45);
});

test('wait from a resend-cooldown error', () => {
  assert.equal(waitFromError({ code: 'OTP_RESEND_WAIT', detail: 'Please wait 30 seconds before asking for a new code' }), 30);
  assert.equal(waitFromError({ code: 'OTP_RESEND_WAIT', detail: '' }), 45);
  assert.equal(waitFromError({ code: 'MFA_CODE_LOCKED', detail: 'Please wait 30 seconds' }), null);
  assert.equal(waitFromError(null), null);
});

test('other code methods always offer a recovery code', () => {
  assert.deepEqual(otherCodeMethods(['totp', 'email'], 'email'), ['totp', 'recovery']);
  assert.deepEqual(otherCodeMethods(['email'], 'recovery'), ['email']);
  assert.deepEqual(otherCodeMethods(undefined, 'totp'), ['recovery']);
});

test('method cards: only the app while extra methods are off, unless already on', () => {
  assert.deepStrictEqual(shownMethods({}), ['totp']);
  assert.deepStrictEqual(shownMethods({ mfa_extra_methods_enabled: false }), ['totp']);
  assert.deepStrictEqual(shownMethods({ mfa_extra_methods_enabled: 'true' }), ['totp'], 'only a real true');
  assert.deepStrictEqual(shownMethods({ mfa_extra_methods_enabled: true }), ['totp', 'email', 'whatsapp']);
  // Someone who already uses email codes keeps the card (to turn it off).
  assert.deepStrictEqual(shownMethods({ mfa_extra_methods_enabled: false, mfa_methods_enrolled: ['email'] }), ['totp', 'email']);
  assert.deepStrictEqual(shownMethods({ mfa_methods_enrolled: ['whatsapp', 'totp'] }), ['totp', 'whatsapp']);
});

test('switch: off with no method, on with one, locked when the account must keep it', () => {
  assert.deepStrictEqual(switchState(me()), { on: false, locked: false, reason: '' });
  assert.deepStrictEqual(switchState(me(['email'])), { on: true, locked: false, reason: '' });
  const forced = switchState(me(['totp'], { mfa_required_by_policy: true }));
  assert.equal(forced.locked, true);
  assert.match(forced.reason, /cannot be turned off/);
  assert.equal(switchState(me([], { mfa_required_by_policy: true })).locked, false, 'it can still be turned on');
});

test('turning on offers the authenticator app or email (when allowed), never WhatsApp', () => {
  assert.deepStrictEqual(setupChoices(me()), ['totp', 'email']);
  assert.deepStrictEqual(setupChoices(me([], { mfa_extra_methods_enabled: false })), ['totp']);
});

test('WhatsApp is an extra method', () => {
  assert.match(setupBlocker(me(), 'whatsapp'), /app or email codes first/);
  assert.equal(setupBlocker(me([], { mfa_extra_methods_enabled: false }), 'whatsapp'), 'Turn on the authenticator app first.');
  assert.equal(setupBlocker(me(['email']), 'whatsapp'), '');
  assert.match(setupBlocker(me(['email'], { whatsapp_otp_available: false }), 'whatsapp'), /Not available/);
  assert.equal(setupBlocker(me(), 'totp'), '');
  assert.match(removeBlocker(me(['email', 'whatsapp']), 'email'), /WhatsApp/);
  assert.equal(removeBlocker(me(['email', 'totp', 'whatsapp']), 'email'), '');
  assert.equal(removeBlocker(me(['email', 'whatsapp']), 'whatsapp'), '');
  assert.equal(removeBlocker(me(['email']), 'email'), '');
  assert.match(removeBlocker(me(['email'], { mfa_required_by_policy: true }), 'email'), /keep one/);
  assert.equal(whatsappOnly(me(['whatsapp'])), true);
  assert.equal(whatsappOnly(me(['whatsapp', 'totp'])), false);
});

test('adding a method asks for the password only; other changes also for a code', () => {
  const on = me(['email']);
  assert.equal(needsCodeFor({ kind: 'enable' }, on), false);
  for (const kind of ['disable', 'disableAll', 'default', 'recovery']) assert.equal(needsCodeFor({ kind }, on), true, kind);
  assert.equal(needsCodeFor({ kind: 'disable' }, me()), false);
});

test('confirmation: a password-only one covers adding and nothing else', () => {
  const add = { kind: 'enable' };
  const off = { kind: 'disable' };
  assert.equal(isConfirmed(null, add, 1000), false);
  assert.equal(isConfirmed({ until: 601000, full: false }, add, 1000), true);
  for (const kind of ['disable', 'disableAll', 'default']) assert.equal(isConfirmed({ until: 601000, full: false }, { kind }, 1000), false, kind);
  assert.equal(isConfirmed({ until: 601000, full: true }, off, 1000), true);
  assert.equal(isConfirmed({ until: 601000, full: true }, add, 1000), true);
  assert.equal(isConfirmed({ until: 5000, full: true }, add, 1000), false);
  assert.equal(needsConfirmation({ code: 'PASSWORD_REQUIRED' }), true);
  assert.equal(needsConfirmation({ code: 'MFA_CODE_REQUIRED' }), true);
  assert.equal(needsConfirmation({ code: 'PASSWORD_INCORRECT' }), false);
});

test('a just-added method is not offered to confirm changes', () => {
  const held = me(['email', 'totp'], { mfa_default_method: 'totp', mfa_methods_on_hold: [{ method: 'totp', until: '2026-11-27T10:00:00Z' }] });
  assert.deepStrictEqual(confirmMethods(held), ['email']);
  assert.equal(firstCodeMethod(held), 'email');
  assert.equal(holdOf(held, 'totp').until, '2026-11-27T10:00:00Z');
  assert.equal(holdOf(held, 'email'), null);
  assert.equal(firstCodeMethod(me(['totp'], { mfa_methods_on_hold: [{ method: 'totp' }] })), 'recovery');
});

test('what the pop-up sends', () => {
  const add = { kind: 'enable' };
  const off = { kind: 'disable' };
  assert.deepStrictEqual(confirmationProof({ action: add, needsCode: false, password: 'p', method: 'totp', code: '' }), { password: 'p', purpose: 'add' });
  assert.deepStrictEqual(confirmationProof({ action: off, needsCode: false, password: 'p', method: null, code: '' }), { password: 'p' });
  assert.deepStrictEqual(confirmationProof({ action: off, needsCode: true, password: 'p', method: 'totp', code: '123456' }), { password: 'p', code_method: 'totp', code: '123456' });
  assert.deepStrictEqual(confirmationProof({ action: off, needsCode: true, password: 'p', method: 'recovery', code: ' AB-CD ' }), { password: 'p', recovery_code: 'AB-CD' });
});
