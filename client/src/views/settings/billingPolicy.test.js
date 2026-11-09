import test from 'node:test';
import assert from 'node:assert';
import { allowanceBar, aiStatusLine, planAction, validTopup, formatInr, canManageBilling, ledgerLabel, periodPricing, periodLabel, trialStatus, validTrialForm, invoiceLine } from './billingPolicy.js';

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
  assert.strictEqual(planAction(desk, null), 'Choose plan · 1 month');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'desk', price_inr: 799 }), 'Renew for 1 month');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'desk', price_inr: 799 }, 3), 'Renew for 3 months');
  assert.strictEqual(planAction(complete, { status: 'active', plan_code: 'desk', price_inr: 799 }), 'Upgrade · 1 month');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'complete', price_inr: 3999 }, 6), 'Switch · 6 months');
  assert.strictEqual(planAction(desk, { status: 'expired', plan_code: 'desk' }), 'Choose plan · 1 month');
  assert.strictEqual(planAction(desk, { status: 'active', plan_code: 'trial', is_trial: true }, 3), 'Upgrade for 3 months');
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

test('N7: period pricing shows price, GST and total from the server table', () => {
  const desk = { code: 'desk', price_inr: 799, periods: [
    { months: 1, price_inr: 799, price_paise: 79900, gst_rate_percent: 18, gst_paise: 14382, total_paise: 94282 },
    { months: 3, price_inr: 2149, price_paise: 214900, gst_rate_percent: 18, gst_paise: 38682, total_paise: 253582 },
    { months: 6, price_inr: 3799, price_paise: 379900, gst_rate_percent: 18, gst_paise: 68382, total_paise: 448282 },
  ] };
  const three = periodPricing(desk, 3);
  assert.strictEqual(three.price, '₹2,149');
  assert.strictEqual(three.gst, '₹386.82 GST (18%)');
  assert.strictEqual(three.total, '₹2,535.82');
  assert.strictEqual(three.perMonth, '₹716');
  assert.strictEqual(three.saving, 10);
  assert.strictEqual(periodPricing(desk, 1).saving, 0);
  assert.strictEqual(periodPricing(desk, 12), null);
  assert.strictEqual(periodPricing({ periods: [] }, 1), null);
  assert.strictEqual(periodLabel(6), '6 months');
});

test('N7: the trial banner follows the summary', () => {
  const upgrade = { plan_code: 'whatsapp', period_months: 1 };
  const active = trialStatus({ trial: { active: true, days_left: 5, upgrade, limits: { ai_replies_total: 50 } } });
  assert.strictEqual(active.kind, 'active');
  assert.strictEqual(active.tone, 'info');
  assert.match(active.title, /5 days left/);
  assert.deepStrictEqual(active.upgrade, upgrade);
  assert.strictEqual(trialStatus({ trial: { active: true, days_left: 1, upgrade } }).tone, 'error');
  assert.match(trialStatus({ trial: { active: true, days_left: 1, upgrade } }).title, /1 day left/);
  const ended = trialStatus({ trial: { active: false, ended: true, upgrade } });
  assert.strictEqual(ended.kind, 'ended');
  assert.match(ended.text, /one click/);
  const available = trialStatus({ trial: { available: true, limits: { days: 7 } }, plan: null });
  assert.strictEqual(available.kind, 'available');
  assert.match(available.title, /7 days/);
  assert.strictEqual(trialStatus({ trial: { available: false, active: false, ended: false } }).show, false);
  assert.strictEqual(trialStatus({}).show, false);
});

test('N7: trial form and invoice line', () => {
  assert.strictEqual(validTrialForm({ business_name: 'A', website: 'x.in' }).ok, false);
  assert.strictEqual(validTrialForm({ business_name: 'Sunrise Dental', website: 'sunrise' }).ok, false);
  assert.deepStrictEqual(validTrialForm({ business_name: ' Sunrise Dental ', website: 'https://www.sunrisedental.in/' }), { ok: true, business_name: 'Sunrise Dental', website: 'https://www.sunrisedental.in/' });
  assert.strictEqual(invoiceLine({ invoice_number: 'GN-2026-000001', description: 'Desk plan, 3 months', total_paise: 253582, gst_paise: 38682 }), 'GN-2026-000001 · Desk plan, 3 months · ₹2,535.82 (incl. ₹386.82 GST)');
});
