import test from 'node:test';
import assert from 'node:assert/strict';
import { shownMethods, setupSteps, showsSteps, currentStep, firstCodeMethod, secondsLeft, shouldAutoSend, waitFromError, otherCodeMethods } from './twoStepFlow.js';

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

test('current step', () => {
  assert.equal(currentStep({ step: 'confirm', method: 'totp' }), 1);
  assert.equal(currentStep({ step: 'finish', method: 'totp', codeLength: 0 }), 2);
  assert.equal(currentStep({ step: 'finish', method: 'totp', codeLength: 2 }), 3);
  assert.equal(currentStep({ step: 'finish', method: 'email' }), 3);
  assert.equal(currentStep({ step: 'finish', method: 'whatsapp' }), 3);
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
