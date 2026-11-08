// What the Billing tab shows, worked out from the server's own answers
// (GET /api/billing/summary and /plans). The server checks every change again.

export const formatInr = (paise) => `₹${(Number(paise || 0) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const formatRupees = (inr) => `₹${Number(inr || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export const canManageBilling = (summary) => Boolean(summary?.permissions?.manage_billing);

// Plan replies used, as a 0-100 bar; null when the plan has no limit.
export function allowanceBar(ai) {
  if (!ai || ai.allowance == null || ai.allowance < 0) return null;
  if (ai.allowance === 0) return { percent: 100, tone: 'error', label: 'No AI replies included' };
  const used = Math.min(Number(ai.used || 0), ai.allowance);
  const percent = Math.round((used / ai.allowance) * 100);
  const leftFraction = (ai.allowance - used) / ai.allowance;
  const tone = leftFraction <= 0 ? 'error' : leftFraction <= 0.2 ? 'warn' : 'ok';
  return { percent, tone, label: `${used.toLocaleString('en-IN')} of ${ai.allowance.toLocaleString('en-IN')} AI replies used` };
}

// The one sentence that tells the owner where AI replies stand.
export function aiStatusLine(summary) {
  const ai = summary?.ai;
  if (!ai) return '';
  if (!ai.allowed) return ai.reason || 'AI replies are paused.';
  if (ai.source === 'legacy') return `${ai.left} AI replies left this month on your workspace quota.`;
  if (ai.source === 'none') return 'AI replies are on with no limit.';
  if (ai.allowance === -1) return 'Your plan includes unlimited AI replies.';
  if (ai.left > 0) return `${ai.left.toLocaleString('en-IN')} plan replies left this period.`;
  return `Plan allowance used; each reply now costs ${formatInr(ai.overage_price_paise)} from the wallet.`;
}

export const planLabel = (plan) => (plan ? `${plan.name} · ${formatRupees(plan.price_inr)} a month` : 'No plan');

// Button text on a plan card given the current subscription.
export function planAction(plan, subscription) {
  if (!subscription || subscription.status !== 'active') return 'Choose plan';
  if (subscription.plan_code === plan.code) return 'Renew for a month';
  return plan.price_inr > (subscription.price_inr || 0) ? 'Upgrade' : 'Switch';
}

// Whole rupees between the server's limits.
export function validTopup(value, wallet) {
  const inr = Number(value);
  if (!Number.isInteger(inr)) return { ok: false, reason: 'Enter a whole number of rupees' };
  const min = wallet?.topup_min_inr ?? 100;
  const max = wallet?.topup_max_inr ?? 100000;
  if (inr < min || inr > max) return { ok: false, reason: `Between ${formatRupees(min)} and ${formatRupees(max)}` };
  return { ok: true, inr };
}

export const LEDGER_LABELS = {
  topup: 'Top-up',
  ai_overage: 'AI reply (beyond plan)',
  extra_seat: 'Extra seat',
  extra_number: 'Extra number',
  adjustment: 'Adjustment by Getnera',
  refund: 'Refund',
};
export const ledgerLabel = (reason) => LEDGER_LABELS[reason] || reason;
