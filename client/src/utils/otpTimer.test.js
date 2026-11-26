import test from 'node:test';
import assert from 'node:assert';
import { codeDeadline, secondsUntil, formatClock, sendsLeftText, sendsUsedUp } from './otpTimer.js';

test('A code ends at the earlier of its own life and the sign-in step', () => {
  assert.strictEqual(codeDeadline({ expires_in: 600 }, 1000), 601000);
  assert.strictEqual(codeDeadline({ expires_in: 600, step_expires_in: 120 }, 0), 120000);
  assert.strictEqual(codeDeadline({ expires_in: 90, step_expires_in: 600 }, 0), 90000);
  assert.strictEqual(codeDeadline({ expires_in: 600, step_expires_in: 0 }, 0), 0);
  assert.strictEqual(codeDeadline({ expires_in: 0 }, 0), 0);
  assert.strictEqual(codeDeadline(null, 0), 0);
});

test('Seconds left and the clock text', () => {
  assert.strictEqual(secondsUntil(600000, 0), 600);
  assert.strictEqual(secondsUntil(600000, 599001), 1);
  assert.strictEqual(secondsUntil(600000, 700000), 0);
  assert.strictEqual(secondsUntil(0, 0), 0);
  assert.strictEqual(formatClock(600), '10:00');
  assert.strictEqual(formatClock(65), '1:05');
  assert.strictEqual(formatClock(0), '0:00');
});

test('Codes left today', () => {
  assert.strictEqual(sendsLeftText({ sends_left: 2, daily_limit: 3 }), '2 of 3 WhatsApp codes left today.');
  assert.strictEqual(sendsLeftText({ sends_left: 0, daily_limit: 3 }), 'All 3 WhatsApp codes for today are used.');
  assert.strictEqual(sendsLeftText(null), '');
  assert.strictEqual(sendsUsedUp({ sends_left: 0 }), true);
  assert.strictEqual(sendsUsedUp({ sends_left: 1 }), false);
  assert.strictEqual(sendsUsedUp(undefined), false);
});
