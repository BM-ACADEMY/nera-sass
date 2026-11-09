import test from 'node:test';
import assert from 'node:assert';
import {
  statusLabel, canManageSetup, showChecklist, stepAction, validateService, serviceBody, testMessageHint, progressLine, STATUS_LABELS,
} from './onboardingPolicy.js';

test('the four statuses have plain labels', () => {
  assert.deepStrictEqual(Object.values(STATUS_LABELS), ['Done', 'In review', 'To do', 'Locked']);
  assert.strictEqual(statusLabel('in_review'), 'In review');
  assert.strictEqual(statusLabel('something-new'), 'To do');
});

test('only owners and admins run the setup; the checklist hides once live', () => {
  assert.strictEqual(canManageSetup('owner'), true);
  assert.strictEqual(canManageSetup('admin'), true);
  assert.strictEqual(canManageSetup('agent'), false);
  assert.strictEqual(showChecklist({ live: { is_live: false } }), true);
  assert.strictEqual(showChecklist({ live: { is_live: true } }), false);
  assert.strictEqual(showChecklist(null), false);
});

test('a locked step offers no action; each other step offers one', () => {
  assert.strictEqual(stepAction({ key: 'templates', status: 'locked' }), null);
  assert.strictEqual(stepAction({ key: 'go_live', status: 'locked' }), null);
  assert.strictEqual(stepAction({ key: 'business', status: 'todo' }), 'Add details');
  assert.strictEqual(stepAction({ key: 'services', status: 'todo' }), 'Add a service');
  assert.strictEqual(stepAction({ key: 'test', status: 'todo' }), 'Send a test message');
  assert.strictEqual(stepAction({ key: 'go_live', status: 'todo' }), 'Go live');
  assert.strictEqual(stepAction({ key: 'business', status: 'todo' }, { canManage: false }), null);
});

test('WhatsApp offers Meta sign-up only when the flag is on, and nothing while our team works on it', () => {
  assert.strictEqual(stepAction({ key: 'whatsapp', status: 'todo' }), 'Ask our team to connect');
  assert.strictEqual(stepAction({ key: 'whatsapp', status: 'todo' }, { embeddedSignup: true }), 'Connect WhatsApp');
  assert.strictEqual(stepAction({ key: 'whatsapp', status: 'in_review' }), null);
  assert.strictEqual(stepAction({ key: 'whatsapp', status: 'done' }), null);
});

test('a service needs a name, a price and a timing', () => {
  assert.strictEqual(validateService({}).ok, false);
  assert.deepStrictEqual(Object.keys(validateService({ name: 'A', price_inr: '', duration_minutes: 2 }).errors), ['name', 'price_inr', 'duration_minutes']);
  assert.strictEqual(validateService({ name: 'Cleaning', price_inr: '500', duration_minutes: '30' }).ok, true);
  assert.strictEqual(validateService({ name: 'Free visit', price_inr: 0, duration_minutes: 15 }).ok, true);
  assert.strictEqual(validateService({ name: 'Cleaning', price_inr: 500, duration_minutes: 30, answers: [{ question: 'Painful?', answer: '' }] }).errors.answers, 'Each question needs an answer');
});

test('the request drops blank question rows and turns numbers into numbers', () => {
  assert.deepStrictEqual(serviceBody({
    name: ' Cleaning ', price_inr: '500', duration_minutes: '30', availability: '', notes: ' ',
    answers: [{ question: 'Painful?', answer: 'No' }, { question: '', answer: '' }],
  }), { name: 'Cleaning', price_inr: 500, duration_minutes: 30, availability: '', notes: '', answers: [{ question: 'Painful?', answer: 'No' }] });
});

test('the test message asks for what the server says is missing', () => {
  assert.deepStrictEqual(testMessageHint({ code: 'CONFIRMATION_REQUIRED' }), { needsConfirm: true });
  assert.deepStrictEqual(testMessageHint({ code: 'PHONE_REQUIRED' }), { needsPhone: true });
  assert.deepStrictEqual(testMessageHint({ code: 'TEST_LIMIT' }), {});
  assert.strictEqual(progressLine({ done_count: 3, total: 6 }), '3 of 6 steps done');
});
