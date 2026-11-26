import test from 'node:test';
import assert from 'node:assert/strict';
import { WIZARD_KEY, saveWizard, readWizard, clearWizard } from './twoStepWizard.js';

const memory = () => {
  const data = new Map();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
};

test('only the user, method and step are stored', () => {
  const storage = memory();
  saveWizard(7, { method: 'totp', step: 'scan', setup: { secret: 'SECRET', otpauth_url: 'otpauth://x' }, phone: '+91 9', password: 'p', code: '123456', codes: ['AAAAA'] }, storage);
  assert.deepStrictEqual(JSON.parse(storage.data.get(WIZARD_KEY)), { user: 7, method: 'totp', step: 'scan' });
  assert.deepStrictEqual(readWizard(7, storage), { method: 'totp', step: 'scan' });
});

test('bound to the signed-in user', () => {
  const storage = memory();
  saveWizard(7, { method: 'email', step: 'code' }, storage);
  assert.equal(readWizard(8, storage), null);
  assert.equal(storage.data.size, 0, 'another user\'s position is removed');
  saveWizard(7, { method: 'email', step: 'code' }, storage);
  assert.equal(readWizard(undefined, storage), null);
});

test('cleared on cancel; unknown values are not kept', () => {
  const storage = memory();
  saveWizard(7, { method: 'whatsapp', step: 'phone' }, storage);
  clearWizard(storage);
  assert.equal(readWizard(7, storage), null);
  saveWizard(7, { method: 'sms', step: 'code' }, storage);
  saveWizard(7, { method: 'totp', step: 'starting' }, storage);
  saveWizard(7, { method: null, step: 'code' }, storage);
  assert.equal(storage.data.size, 0);
  saveWizard(7, { method: null, step: 'codes' }, storage);
  assert.deepStrictEqual(readWizard(7, storage), { method: null, step: 'codes' });
  storage.data.set(WIZARD_KEY, '{broken');
  assert.equal(readWizard(7, storage), null);
  assert.equal(storage.data.size, 0);
});

test('a browser without storage does not break the screen', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.doesNotThrow(() => saveWizard(7, { method: 'totp', step: 'scan' }, broken));
  assert.equal(readWizard(7, broken), null);
  assert.doesNotThrow(() => clearWizard(null));
});
