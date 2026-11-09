import test from 'node:test';
import assert from 'node:assert';
import { validateConnection, connectionBadge, saveOutcome, EMPTY_CONNECTION } from './connectForm.js';

const good = { whatsapp_number: '+91 98765 43210', phone_number_id: '1000000001', wa_business_id: '2000000001', wa_access_token: `EAAG${'x'.repeat(40)}` };

test('all four details are required on every save', () => {
  assert.strictEqual(validateConnection(EMPTY_CONNECTION).ok, false);
  assert.deepStrictEqual(Object.keys(validateConnection(EMPTY_CONNECTION).errors), ['whatsapp_number', 'phone_number_id', 'wa_business_id', 'wa_access_token']);
  assert.strictEqual(validateConnection(good).ok, true);
});

test('ids are digits only and the token must be pasted whole', () => {
  assert.ok(validateConnection({ ...good, phone_number_id: 'abc' }).errors.phone_number_id);
  assert.ok(validateConnection({ ...good, wa_business_id: '12' }).errors.wa_business_id);
  assert.ok(validateConnection({ ...good, wa_access_token: 'short' }).errors.wa_access_token);
  assert.ok(validateConnection({ ...good, wa_access_token: `EAAG ${'x'.repeat(40)}` }).errors.wa_access_token);
});

test('queue rows say where each customer stands', () => {
  assert.deepStrictEqual(connectionBadge({ status: 'verified' }), { label: 'Connected', tone: 'ok' });
  assert.strictEqual(connectionBadge({ status: 'verification_failed' }).tone, 'bad');
  assert.strictEqual(connectionBadge({ status: 'not_configured', requested_at: '2026-11-09T00:00:00Z' }).label, 'Asked for connection');
  assert.strictEqual(connectionBadge({ status: 'not_configured' }).label, 'Not requested');
});

test('a failed Meta check is a warning, not a lost save', () => {
  assert.strictEqual(saveOutcome({ verified: true }).kind, 'success');
  const outcome = saveOutcome({ verified: false, verify_error: 'Phone number mismatch' });
  assert.strictEqual(outcome.kind, 'warning');
  assert.match(outcome.text, /Saved, but/);
  assert.match(outcome.text, /Phone number mismatch/);
});
