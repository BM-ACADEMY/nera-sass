import test from 'node:test';
import assert from 'node:assert';
import { allowanceBar, aiStatusLine, planAction, validTopup, formatInr, canManageBilling, ledgerLabel } from './billingPolicy.js';

test('allowance bar: used share, warning at 20 percent left, error when used up', () => {
  assert.strictEqual(allowanceBar({ allowance: -1 }), null);
  assert.deepStrictEqual(allowanceBar({ allowance: 100, used: 50 }), { percent: 50, tone: 'ok', label: '50 of 100 AI replies used' });
  assert.strictEqual(allowanceBar({ allowance: 100, used: 80 }).tone, 'warn');
  assert.strictEqual(allowanceBar({ allowance: 100, used: 100 }).tone, 'error');
  assert.strictEqual(allowanceBar({ allowance: 100, used: 140 }).percent, 100);
});

test('status line follows the server verdict', () => {
  assert.match(aiStatusLine({ ai: { allowed: false, reason: 'AI replies are paused: wallet empty' } }), /paused/);
  assert.match(aiStatusLine({ ai: { allowed: true, source: 'plan', allowance: 200, left: 20 } }), /20 plan replies left/);
  assert.match(aiStatusLine({ ai: { allowed: true, source: 'plan', allowance: 200, left: 0, overage_price_paise: 100 } }), /₹1 from the wallet/);
  assert.match(aiStatusLine({ ai: { allowed: true, source: 'legacy', left: 3 } }), /3 AI replies left/);
});

test('plan card actions and top-up validation', () => {
  const desk = { code: 'desk', price_inr: 799 };
  const complete = { code: 'complete', price_inr: 3999 };
  assert.strictEqual(planAction(desk, null), 'Choose plan');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'desk', price_inr: 799 }), 'Renew for a month');
  assert.strictEqual(planAction(complete, { status: 'active', plan_code: 'desk', price_inr: 799 }), 'Upgrade');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'complete', price_inr: 3999 }), 'Switch');
  assert.strictEqual(planAction(desk, { status: 'expired', plan_code: 'desk' }), 'Choose plan');
  const wallet = { topup_min_inr: 100, topup_max_inr: 100000 };
  assert.deepStrictEqual(validTopup('500', wallet), { ok: true, inr: 500 });
  assert.strictEqual(validTopup('50', wallet).ok, false);
  assert.strictEqual(validTopup('12.5', wallet).ok, false);
  assert.strictEqual(validTopup('1000000', wallet).ok, false);
  assert.strictEqual(formatInr(123450), '₹1,234.5');
  assert.strictEqual(canManageBilling({ permissions: { manage_billing: true } }), true);
  assert.strictEqual(canManageBilling({}), false);
  assert.strictEqual(ledgerLabel('ai_overage'), 'AI reply (beyond plan)');
});
